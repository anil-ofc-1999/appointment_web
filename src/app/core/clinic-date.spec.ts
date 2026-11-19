import {
  addDays,
  bookableDateOrToday,
  bookableRange,
  clinicToday,
  formatLongDate,
  formatShortDate,
  isValidDate,
  partOfDay,
} from './clinic-date';

// Monday 2030-01-07 08:00 in the clinic (02:30 UTC).
const NOW = new Date('2030-01-07T08:00:00+05:30');

describe('clinicToday (Asia/Kolkata)', () => {
  it('returns the clinic date', () => {
    expect(clinicToday(NOW)).toBe('2030-01-07');
  });

  it('is already "tomorrow" in the clinic when UTC is still on the previous day', () => {
    // 20:00 UTC on the 7th = 01:30 on the 8th in India
    expect(clinicToday(new Date('2030-01-07T20:00:00Z'))).toBe('2030-01-08');
  });

  it('is still "today" just before clinic midnight', () => {
    expect(clinicToday(new Date('2030-01-07T18:29:00Z'))).toBe('2030-01-07');
  });
});

describe('isValidDate', () => {
  it.each(['2030-01-07', '2028-02-29', '2030-12-31'])('accepts %s', (value) => {
    expect(isValidDate(value)).toBe(true);
  });

  it.each(['2030-02-29', '2030-13-01', '2030-1-7', '07-01-2030', 'abc', '', null, undefined])(
    'rejects %j',
    (value) => {
      expect(isValidDate(value)).toBe(false);
    },
  );
});

describe('addDays', () => {
  it.each([
    ['2030-01-07', 1, '2030-01-08'],
    ['2030-01-31', 1, '2030-02-01'],
    ['2030-12-31', 1, '2031-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2030-01-07', 30, '2030-02-06'],
    ['2030-01-07', -7, '2029-12-31'],
  ])('%s + %i = %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });
});

describe('bookable dates (FR-4.3: today .. today + 30)', () => {
  it('range is today to today + 30 days', () => {
    expect(bookableRange(NOW)).toEqual({ min: '2030-01-07', max: '2030-02-06' });
  });

  it.each(['2030-01-07', '2030-01-20', '2030-02-06'])('keeps %s', (value) => {
    expect(bookableDateOrToday(value, NOW)).toBe(value);
  });

  it.each([
    ['a past date', '2030-01-06'],
    ['31 days ahead', '2030-02-07'],
    ['an invalid date', '2030-02-30'],
    ['text', 'tomorrow'],
    ['nothing', undefined],
  ])('falls back to today for %s', (_label, value) => {
    expect(bookableDateOrToday(value, NOW)).toBe('2030-01-07');
  });
});

describe('formatting', () => {
  it('short date', () => {
    expect(formatShortDate('2030-01-08')).toBe('Tue 8 Jan');
  });

  it('long date', () => {
    expect(formatLongDate('2030-01-08')).toBe('Tuesday, 8 January 2030');
  });

  it.each([
    ['09:30', 'Morning'],
    ['11:45', 'Morning'],
    ['12:00', 'Afternoon'],
    ['16:59', 'Afternoon'],
    ['17:00', 'Evening'],
    ['18:30', 'Evening'],
  ])('%s is %s', (time, part) => {
    expect(partOfDay(time)).toBe(part);
  });
});
