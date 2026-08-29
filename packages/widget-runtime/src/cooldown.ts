import type { Cooldown } from '@lcp/contracts';

/**
 * Repeat-appearance control and the pseudonymous visitor identifier
 * (blueprint 4.4).
 *
 * Two locked decisions live here:
 *
 *   "Visitor identity | Per-widget pseudonymous identifier in the host origin's
 *    localStorage, rotated every 30 days"
 *   "Repeat appearances | Configurable session-only or multi-day cooldown"
 *
 * Per-widget and per-origin both matter. The key includes the public widget id,
 * so two widgets on one site do not share an identity, and localStorage is
 * already partitioned by origin - so the same visitor on two customer sites is
 * two unrelated identifiers, with nothing linking them. Rotation caps how long
 * any one of them can be followed.
 *
 * Every access is wrapped: storage throws in private modes and when a host page
 * has disabled it. A widget that cannot remember is a widget that shows again,
 * which is a mildly annoying outcome - not a broken page.
 */

const ROTATION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function idKey(publicId: string): string {
  return `lcp.v1.${publicId}.visitor`;
}

function seenKey(publicId: string): string {
  return `lcp.v1.${publicId}.seen`;
}

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable; the widget simply does not remember.
  }
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

interface VisitorRecord {
  readonly id: string;
  readonly issuedAt: number;
}

/**
 * This visitor's identifier for this widget, rotating every 30 days.
 *
 * Rotation is by reissue rather than by expiry sweep: if the stored record is
 * older than the window, a brand-new identifier replaces it, so nothing links
 * the old one to the new.
 */
export function visitorId(publicId: string, now = Date.now()): string {
  const raw = readLocal(idKey(publicId));
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as VisitorRecord;
      if (
        typeof parsed.id === 'string' &&
        typeof parsed.issuedAt === 'number' &&
        now - parsed.issuedAt < ROTATION_DAYS * DAY_MS
      ) {
        return parsed.id;
      }
    } catch {
      // Corrupt value; reissue rather than trust it.
    }
  }

  const fresh: VisitorRecord = { id: randomId(), issuedAt: now };
  writeLocal(idKey(publicId), JSON.stringify(fresh));
  return fresh.id;
}

/**
 * Whether the widget may appear right now.
 *
 * A session cooldown uses sessionStorage, which is exactly the "until this tab
 * closes" lifetime the setting describes; a multi-day cooldown uses
 * localStorage with a timestamp, because it has to outlive the session.
 */
export function isSuppressed(publicId: string, cooldown: Cooldown, now = Date.now()): boolean {
  if (cooldown.kind === 'session') {
    try {
      return window.sessionStorage.getItem(seenKey(publicId)) !== null;
    } catch {
      return false;
    }
  }

  const raw = readLocal(seenKey(publicId));
  if (raw === null) return false;
  const seenAt = Number.parseInt(raw, 10);
  if (Number.isNaN(seenAt)) return false;
  return now - seenAt < cooldown.days * DAY_MS;
}

/** Record that the widget has been shown, starting its cooldown. */
export function markSeen(publicId: string, cooldown: Cooldown, now = Date.now()): void {
  if (cooldown.kind === 'session') {
    try {
      window.sessionStorage.setItem(seenKey(publicId), String(now));
    } catch {
      // Nothing to do; it will show again next time.
    }
    return;
  }
  writeLocal(seenKey(publicId), String(now));
}
