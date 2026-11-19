/**
 * Clinic dates are in Asia/Kolkata (UTC+05:30, no daylight saving) — same as the API (D-22).
 * Dates are plain 'YYYY-MM-DD' strings so they never shift with the browser's time zone.
 */
export const CLINIC_TIME_ZONE = 'Asia/Kolkata';
/** Same as the API: bookings at most 30 days ahead (FR-4.3). */
export const BOOKING_WINDOW_DAYS = 30;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's date in the clinic, e.g. '2030-01-07'. */
export function clinicToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isValidDate(value: string | null | undefined): value is string {
  const match = value ? DATE_PATTERN.exec(value) : null;
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Dates that can be booked: today .. today + 30 days. */
export function bookableRange(now: Date = new Date()): { min: string; max: string } {
  const min = clinicToday(now);
  return { min, max: addDays(min, BOOKING_WINDOW_DAYS) };
}

/** A date from the URL if it is valid and bookable, otherwise today. */
export function bookableDateOrToday(value: string | null | undefined, now = new Date()): string {
  const { min, max } = bookableRange(now);
  return isValidDate(value) && value >= min && value <= max ? value : min;
}

/** 'Tue, 8 Jan' — weekday and day of a clinic date, independent of the browser time zone. */
export function formatShortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** 'Tuesday, 8 January 2030'. */
export function formatLongDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Clinic date 'YYYY-MM-DD' of an instant (ISO string). */
export function clinicDateOf(iso: string): string {
  return clinicToday(new Date(iso));
}

/** Clinic time 'HH:MM' (24-hour) of an instant (ISO string). */
export function clinicTimeOf(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: CLINIC_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** A valid ISO instant with a time zone, e.g. '2030-01-08T04:30:00.000Z'. */
export function isIsoInstant(value: string | null | undefined): value is string {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    return false;
  }
  return !Number.isNaN(new Date(value).getTime());
}

/** Part of the day for grouping slots: '10:30' -> 'Morning'. */
export function partOfDay(time: string): 'Morning' | 'Afternoon' | 'Evening' {
  const hour = Number(time.slice(0, 2));
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}
