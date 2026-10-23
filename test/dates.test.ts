import { describe, expect, it } from 'vitest';
import { addDays, atLocal, daysBetween, isDate, nextWeekday, parseWithOffset } from '../src/dates.js';

const TZ = 'Asia/Dhaka';
const wed = new Date('2026-10-21T10:00:00+06:00'); // Wednesday

describe('nextWeekday', () => {
  it('"by friday" sent Wednesday is that Friday', () => {
    expect(nextWeekday(wed, 5, TZ)).toBe('2026-10-23');
  });
  it('"monday 11 am" sent Wednesday gives next Monday with the zone offset', () => {
    expect(nextWeekday(wed, 1, TZ, '11:00')).toBe('2026-10-26T11:00:00+06:00');
  });
  it('today counts only while the time is still ahead', () => {
    expect(nextWeekday(wed, 3, TZ, '15:00')).toBe('2026-10-21T15:00:00+06:00');
    expect(nextWeekday(wed, 3, TZ, '09:00')).toBe('2026-10-28T09:00:00+06:00');
    expect(nextWeekday(wed, 3, TZ)).toBe('2026-10-21');
  });
  it('resolves against the sent time, not the run time', () => {
    // sent Wednesday evening UTC is already Thursday in Dhaka
    expect(nextWeekday(new Date('2026-10-21T20:00:00Z'), 4, TZ)).toBe('2026-10-22');
  });
});

describe('helpers', () => {
  it('atLocal follows DST', () => {
    expect(atLocal('2026-07-01', '09:00', 'Europe/London')).toBe('2026-07-01T09:00:00+01:00');
    expect(atLocal('2026-12-01', '09:00', 'Europe/London')).toBe('2026-12-01T09:00:00+00:00');
  });
  it('isDate rejects impossible dates', () => {
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('2026-10-23')).toBe(true);
    expect(isDate(20261023)).toBe(false);
  });
  it('parseWithOffset needs an offset', () => {
    expect(parseWithOffset('2026-10-26T11:00:00+06:00')).toBeInstanceOf(Date);
    expect(parseWithOffset('2026-10-26T11:00:00')).toBeNull();
    expect(parseWithOffset('tomorrow')).toBeNull();
  });
  it('date arithmetic', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
  });
});
