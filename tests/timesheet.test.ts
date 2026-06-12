/**
 * Unit tests for the timesheet helpers backing the get_timesheet_total tool.
 * These are pure functions, so no OpenProject instance is required.
 */

import { describe, expect, test } from 'bun:test';
import type { TimeEntry } from '../src/openproject-client.ts';
import {
  aggregateTimeEntries,
  buildTimeEntryFilters,
  isoDurationToHours,
  resolvePeriod,
  roundHours,
} from '../src/timesheet.ts';

describe('isoDurationToHours', () => {
  test('converts plain hours', () => {
    expect(isoDurationToHours('PT8H')).toBe(8);
  });

  test('converts hours with minutes', () => {
    expect(isoDurationToHours('PT7H30M')).toBe(7.5);
    expect(isoDurationToHours('PT2H15M')).toBe(2.25);
  });

  test('converts minutes only', () => {
    expect(isoDurationToHours('PT45M')).toBe(0.75);
    expect(isoDurationToHours('PT1M')).toBeCloseTo(1 / 60, 10);
  });

  test('converts days and weeks', () => {
    expect(isoDurationToHours('P1DT2H')).toBe(26);
    expect(isoDurationToHours('P2W')).toBe(336);
  });

  test('supports zero, negative and comma-decimal durations', () => {
    expect(isoDurationToHours('PT0S')).toBe(0);
    expect(isoDurationToHours('-PT2H')).toBe(-2);
    expect(isoDurationToHours('PT1,5H')).toBe(1.5);
    expect(isoDurationToHours('PT1.5H')).toBe(1.5);
  });

  test('returns null for missing or unconvertible values', () => {
    expect(isoDurationToHours(null)).toBeNull();
    expect(isoDurationToHours(undefined)).toBeNull();
    expect(isoDurationToHours('')).toBeNull();
    expect(isoDurationToHours('garbage')).toBeNull();
    expect(isoDurationToHours('P')).toBeNull();
    expect(isoDurationToHours('PT')).toBeNull();
    // Years/months are calendar-dependent
    expect(isoDurationToHours('P1Y')).toBeNull();
    expect(isoDurationToHours('P1M')).toBeNull();
  });
});

describe('roundHours', () => {
  test('removes floating point noise', () => {
    expect(roundHours(0.1 + 0.1 + 0.1)).toBe(0.3);
    expect(roundHours(7.499999999)).toBe(7.5);
    expect(roundHours(8)).toBe(8);
  });
});

describe('resolvePeriod', () => {
  // Friday 2026-06-12, the example run date from the timesheet instructions
  const now = new Date(2026, 5, 12);

  test('today and yesterday', () => {
    expect(resolvePeriod({ period: 'today' }, now)).toEqual({
      preset: 'today',
      startDate: '2026-06-12',
      endDate: '2026-06-12',
    });
    expect(resolvePeriod({ period: 'yesterday' }, now)).toEqual({
      preset: 'yesterday',
      startDate: '2026-06-11',
      endDate: '2026-06-11',
    });
  });

  test('this_week and last_week run Monday through Sunday', () => {
    expect(resolvePeriod({ period: 'this_week' }, now)).toEqual({
      preset: 'this_week',
      startDate: '2026-06-08',
      endDate: '2026-06-14',
    });
    expect(resolvePeriod({ period: 'last_week' }, now)).toEqual({
      preset: 'last_week',
      startDate: '2026-06-01',
      endDate: '2026-06-07',
    });
  });

  test('weeks handle Sunday and Monday edges', () => {
    const sunday = new Date(2026, 5, 14);
    expect(resolvePeriod({ period: 'this_week' }, sunday).startDate).toBe('2026-06-08');
    expect(resolvePeriod({ period: 'this_week' }, sunday).endDate).toBe('2026-06-14');

    const monday = new Date(2026, 5, 8);
    expect(resolvePeriod({ period: 'this_week' }, monday).startDate).toBe('2026-06-08');
    expect(resolvePeriod({ period: 'last_week' }, monday).startDate).toBe('2026-06-01');
  });

  test('this_month and last_month cover full calendar months', () => {
    expect(resolvePeriod({ period: 'this_month' }, now)).toEqual({
      preset: 'this_month',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
    });
    // Matches the documented example: run on 2026-06-12 -> 2026-05-01..2026-05-31
    expect(resolvePeriod({ period: 'last_month' }, now)).toEqual({
      preset: 'last_month',
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    });
  });

  test('months handle year boundaries and short months', () => {
    const january = new Date(2026, 0, 15);
    expect(resolvePeriod({ period: 'last_month' }, january)).toEqual({
      preset: 'last_month',
      startDate: '2025-12-01',
      endDate: '2025-12-31',
    });

    const february = new Date(2026, 1, 10);
    expect(resolvePeriod({ period: 'this_month' }, february).endDate).toBe('2026-02-28');
  });

  test('accepts an explicit date range', () => {
    expect(resolvePeriod({ startDate: '2026-05-01', endDate: '2026-05-31' }, now)).toEqual({
      preset: 'custom',
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    });
  });

  test('rejects ambiguous or invalid input', () => {
    expect(() => resolvePeriod({ period: 'this_week', startDate: '2026-05-01' }, now)).toThrow('not both');
    expect(() => resolvePeriod({}, now)).toThrow('both "startDate" and "endDate"');
    expect(() => resolvePeriod({ startDate: '2026-05-01' }, now)).toThrow('both "startDate" and "endDate"');
    expect(() => resolvePeriod({ startDate: '2026-5-1', endDate: '2026-05-31' }, now)).toThrow('Invalid startDate');
    expect(() => resolvePeriod({ startDate: '2026-02-01', endDate: '2026-02-30' }, now)).toThrow('Invalid endDate');
    expect(() => resolvePeriod({ startDate: '2026-06-01', endDate: '2026-05-01' }, now)).toThrow('after endDate');
  });
});

describe('buildTimeEntryFilters', () => {
  test('builds an inclusive spentOn range filter', () => {
    const filters = JSON.parse(buildTimeEntryFilters({ startDate: '2026-05-01', endDate: '2026-05-31' }));
    expect(filters).toEqual([{ spentOn: { operator: '<>d', values: ['2026-05-01', '2026-05-31'] } }]);
  });

  test('adds user and project filters when given', () => {
    const filters = JSON.parse(
      buildTimeEntryFilters({ startDate: '2026-05-01', endDate: '2026-05-31', userId: 5, projectId: 42 })
    );
    expect(filters).toEqual([
      { spentOn: { operator: '<>d', values: ['2026-05-01', '2026-05-31'] } },
      { user: { operator: '=', values: ['5'] } },
      { project: { operator: '=', values: ['42'] } },
    ]);
  });
});

function makeEntry(overrides: Partial<TimeEntry> & { id: number }): TimeEntry {
  return {
    spentOn: '2026-05-04',
    hours: 'PT8H',
    createdAt: '2026-05-04T08:00:00Z',
    updatedAt: '2026-05-04T08:00:00Z',
    _links: {},
    ...overrides,
  };
}

describe('aggregateTimeEntries', () => {
  test('returns empty aggregation for no entries', () => {
    const result = aggregateTimeEntries([]);
    expect(result.totals).toEqual({ entries: 0, hours: 0 });
    expect(result.byUser).toEqual([]);
    expect(result.byProject).toEqual([]);
    expect(result.byDate).toEqual([]);
    expect(result.entries).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test('aggregates totals, byUser, byProject and byDate', () => {
    const entries: TimeEntry[] = [
      makeEntry({
        id: 11,
        spentOn: '2026-05-04',
        hours: 'PT8H',
        comment: { format: 'plain', raw: 'API integration work', html: '' },
        _links: {
          user: { href: '/api/v3/users/9', title: 'Vanntha Eng' },
          project: { href: '/api/v3/projects/3', title: 'Kardal Development' },
          workPackage: { href: '/api/v3/work_packages/421', title: 'API integration' },
          activity: { href: '/api/v3/time_entries/activities/1', title: 'Development' },
        },
      }),
      makeEntry({
        id: 12,
        spentOn: '2026-05-05',
        hours: 'PT7H30M',
        _links: {
          user: { href: '/api/v3/users/9', title: 'Vanntha Eng' },
          project: { href: '/api/v3/projects/8', title: 'POS Acquiring' },
        },
      }),
      makeEntry({
        id: 10,
        spentOn: '2026-05-04',
        hours: 'PT2H15M',
        _links: {
          user: { href: '/api/v3/users/4', title: 'Tona Song' },
          project: { href: '/api/v3/projects/3', title: 'Kardal Development' },
        },
      }),
      makeEntry({
        id: 13,
        spentOn: '2026-05-05',
        hours: 'not-a-duration',
        _links: {
          user: { href: '/api/v3/users/7' }, // no title -> falls back to User #7
        },
      }),
    ];

    const result = aggregateTimeEntries(entries);

    expect(result.totals).toEqual({ entries: 4, hours: 17.75 });

    expect(result.byUser).toEqual([
      { user: 'Tona Song', entries: 1, hours: 2.25 },
      { user: 'User #7', entries: 1, hours: 0 },
      { user: 'Vanntha Eng', entries: 2, hours: 15.5 },
    ]);

    expect(result.byProject).toEqual([
      { project: 'Kardal Development', entries: 2, hours: 10.25 },
      { project: 'POS Acquiring', entries: 1, hours: 7.5 },
      { project: 'Unknown project', entries: 1, hours: 0 },
    ]);

    expect(result.byDate).toEqual([
      { date: '2026-05-04', entries: 2, hours: 10.25 },
      { date: '2026-05-05', entries: 2, hours: 7.5 },
    ]);

    // Entries are sorted by date, then by entry id
    expect(result.entries.map((row) => row.entry_id)).toEqual([10, 11, 12, 13]);

    const first = result.entries[1]!;
    expect(first).toEqual({
      entry_id: 11,
      spent_on: '2026-05-04',
      user: 'Vanntha Eng',
      project: 'Kardal Development',
      work_package_id: 421,
      work_package: 'API integration',
      activity: 'Development',
      hours_iso: 'PT8H',
      hours_decimal: 8,
      comment: 'API integration work',
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('13');
  });

  test('sums exact durations without accumulating floating point noise', () => {
    const entries = [1, 2, 3].map((id) =>
      makeEntry({ id, hours: 'PT6M', _links: { user: { href: '/api/v3/users/1', title: 'A' } } })
    );
    const result = aggregateTimeEntries(entries);
    expect(result.totals.hours).toBe(0.3);
    expect(result.byUser[0]?.hours).toBe(0.3);
  });
});
