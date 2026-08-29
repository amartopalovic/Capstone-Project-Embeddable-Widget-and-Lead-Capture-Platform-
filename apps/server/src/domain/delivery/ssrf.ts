import { isIP } from 'node:net';

/**
 * SSRF-safe destination validation (blueprint 12.4, 17).
 *
 * A webhook URL is a customer-supplied address that this server will connect
 * to with its own network identity. On a cloud host that identity can reach
 * things the customer cannot: the cloud metadata service, the private VPC, the
 * loopback interface where an unauthenticated admin port might listen. So the
 * URL is not a preference, it is an instruction to make a request, and it gets
 * checked like one.
 *
 * The rule is an ALLOWLIST of shapes and a denylist of destinations, applied
 * both when an endpoint is saved and again immediately before every request -
 * blueprint 12.4 says destinations are blocked, not that they are blocked once.
 * A hostname that resolved to a public address last week can resolve to
 * 169.254.169.254 today.
 */

export type DestinationRejection =
  | 'invalid_url'
  | 'scheme_not_allowed'
  | 'https_required'
  | 'credentials_in_url'
  | 'port_not_allowed'
  | 'hostname_not_resolvable'
  | 'private_address'
  | 'loopback_address'
  | 'link_local_address'
  | 'metadata_service';

export type DestinationCheck =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: DestinationRejection };

/**
 * Ports a webhook may target.
 *
 * Restricting these is not about HTTP: it stops a URL being used as a probe
 * against arbitrary internal services (`http://internal:6379/`), which is the
 * cheapest half of an SSRF.
 */
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

/** The cloud metadata addresses, which are the classic SSRF prize. */
const METADATA_ADDRESSES = new Set([
  '169.254.169.254',
  '169.254.170.2',
  'fd00:ec2::254',
  '100.100.100.200',
]);

function parseIPv4(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets;
}

/**
 * Whether an already-resolved IP address is one we refuse to talk to.
 *
 * Written against the numeric address rather than the hostname on purpose: a
 * hostname check can be defeated by anything that resolves inward, and
 * `nip.io`-style services exist precisely to do that.
 */
export function classifyAddress(address: string): DestinationRejection | null {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');

  if (METADATA_ADDRESSES.has(normalized)) return 'metadata_service';

  const v4 = parseIPv4(normalized);
  if (v4 !== null) {
    const [a = 0, b = 0] = v4;
    if (a === 127) return 'loopback_address';
    if (a === 0) return 'private_address';
    if (a === 10) return 'private_address';
    if (a === 172 && b >= 16 && b <= 31) return 'private_address';
    if (a === 192 && b === 168) return 'private_address';
    // Carrier-grade NAT, and 198.18/15 benchmarking - neither is a customer.
    if (a === 100 && b >= 64 && b <= 127) return 'private_address';
    if (a === 198 && (b === 18 || b === 19)) return 'private_address';
    if (a === 169 && b === 254) return 'link_local_address';
    // Multicast and reserved.
    if (a >= 224) return 'private_address';
    return null;
  }

  if (isIP(normalized) === 6) {
    if (normalized === '::1' || normalized === '::') return 'loopback_address';
    // Unique-local fc00::/7.
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return 'private_address';
    // Link-local fe80::/10.
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9')) return 'link_local_address';
    if (normalized.startsWith('fea') || normalized.startsWith('feb')) return 'link_local_address';
    /**
     * IPv4-mapped addresses such as `::ffff:127.0.0.1` are a real bypass: they
     * are IPv6 syntactically and IPv4 in effect, so the embedded address is
     * re-checked rather than trusted.
     */
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    if (mapped?.[1] !== undefined) return classifyAddress(mapped[1]);
    return null;
  }

  return null;
}

/**
 * Check the URL's shape, before any DNS work.
 *
 * `requireHttps` follows blueprint 12.4: HTTPS only in production. Development
 * and the test suite may target a local http receiver, which is what makes the
 * delivery tests possible without a certificate.
 */
export function checkDestinationUrl(raw: string, requireHttps: boolean): DestinationCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'scheme_not_allowed' };
  }
  if (requireHttps && url.protocol !== 'https:') {
    return { ok: false, reason: 'https_required' };
  }
  /**
   * Credentials in the URL would be sent to the destination and would end up
   * in any log that records the endpoint, so the URL is rejected rather than
   * quietly stripped - a customer who pasted a secret needs to know.
   */
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'credentials_in_url' };
  }

  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  if (!ALLOWED_PORTS.has(port)) return { ok: false, reason: 'port_not_allowed' };

  // A literal IP in the URL is checked immediately; a hostname needs DNS,
  // which the resolving check below does.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) {
    const rejection = classifyAddress(host);
    if (rejection !== null) return { ok: false, reason: rejection };
  }

  return { ok: true, url };
}

export type Resolver = (hostname: string) => Promise<readonly string[]>;

/**
 * The full check: shape, then every address the hostname resolves to.
 *
 * EVERY address is checked, not just the first. A hostname with an A record
 * pointing at a public address and a second pointing at 127.0.0.1 would
 * otherwise pass and then connect wherever the OS resolver felt like.
 *
 * A known limitation, stated rather than hidden: this is a check-then-connect
 * sequence, so a DNS entry that changes between the two is not caught. Closing
 * that properly means pinning the connection to the validated address, which
 * Node's fetch does not expose. The check still removes every static
 * misconfiguration and every naive attack, and the port allowlist limits what a
 * won race could reach.
 */
export async function checkDestination(
  raw: string,
  requireHttps: boolean,
  resolve: Resolver,
): Promise<DestinationCheck> {
  const shape = checkDestinationUrl(raw, requireHttps);
  if (!shape.ok) return shape;

  const host = shape.url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return shape;

  let addresses: readonly string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, reason: 'hostname_not_resolvable' };
  }
  if (addresses.length === 0) return { ok: false, reason: 'hostname_not_resolvable' };

  for (const address of addresses) {
    const rejection = classifyAddress(address);
    if (rejection !== null) return { ok: false, reason: rejection };
  }

  return shape;
}
