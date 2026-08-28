/**
 * Time port.
 *
 * Session expiry, token expiry, throttle windows, and lockouts are all
 * time-dependent, so tests need to control time explicitly rather than sleep.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
