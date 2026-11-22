/** Clinic (Asia/Kolkata) dates for E2E tests, computed from the real current time. */

export function clinicDate(offsetDays = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

/** 0 = Sunday .. 6 = Saturday, for a 'YYYY-MM-DD' date. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** ISO instant of a clinic date + time, e.g. ('2030-01-08', '10:00'). */
export function clinicInstant(date: string, time: string): string {
  return new Date(`${date}T${time}:00+05:30`).toISOString();
}
