/**
 * Timesheet helpers
 * Period resolution, ISO 8601 duration conversion and time entry aggregation
 * used by the get_timesheet_total MCP tool.
 */

import type { TimeEntry } from './openproject-client.ts';

export const TIMESHEET_PERIOD_PRESETS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
] as const;

export type TimesheetPeriodPreset = (typeof TIMESHEET_PERIOD_PRESETS)[number];

export interface ResolvedPeriod {
  preset: TimesheetPeriodPreset | 'custom';
  startDate: string; // YYYY-MM-DD, inclusive
  endDate: string; // YYYY-MM-DD, inclusive
}

export interface NormalizedTimeEntry {
  entry_id: number;
  spent_on: string;
  user: string;
  project: string;
  work_package_id: number | null;
  work_package: string;
  activity: string;
  hours_iso: string | null;
  hours_decimal: number;
  comment: string;
}

export interface TimesheetBucket {
  entries: number;
  hours: number;
}

export interface TimesheetAggregation {
  totals: TimesheetBucket;
  byUser: Array<{ user: string } & TimesheetBucket>;
  byProject: Array<{ project: string } & TimesheetBucket>;
  byDate: Array<{ date: string } & TimesheetBucket>;
  entries: NormalizedTimeEntry[];
  warnings: string[];
}

const DATE_FORMAT_RE = /^\d{4}-\d{2}-\d{2}$/;

// Durations with years/months are calendar-dependent and never produced by
// OpenProject for time entry hours, so they are rejected (groups 2 and 3).
const ISO_DURATION_RE =
  /^([+-]?)P(?:(\d+(?:[.,]\d+)?)Y)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)W)?(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/;

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function stripTime(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const result = stripTime(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Monday is the first day of the week (ISO 8601)
function startOfWeek(date: Date): Date {
  const daysSinceMonday = (date.getDay() + 6) % 7;
  return addDays(date, -daysSinceMonday);
}

function isValidDateString(value: string): boolean {
  if (!DATE_FORMAT_RE.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * Resolve a named period preset or an explicit date range into inclusive
 * YYYY-MM-DD boundaries. Presets are evaluated against the local timezone
 * of the machine running the server (the business timezone).
 */
export function resolvePeriod(
  options: { period?: TimesheetPeriodPreset; startDate?: string; endDate?: string },
  now: Date = new Date()
): ResolvedPeriod {
  const { period, startDate, endDate } = options;

  if (period && (startDate || endDate)) {
    throw new Error('Provide either "period" or an explicit "startDate"/"endDate" range, not both');
  }

  if (period) {
    const today = stripTime(now);
    switch (period) {
      case 'today':
        return { preset: period, startDate: formatLocalDate(today), endDate: formatLocalDate(today) };
      case 'yesterday': {
        const yesterday = addDays(today, -1);
        return { preset: period, startDate: formatLocalDate(yesterday), endDate: formatLocalDate(yesterday) };
      }
      case 'this_week': {
        const monday = startOfWeek(today);
        return { preset: period, startDate: formatLocalDate(monday), endDate: formatLocalDate(addDays(monday, 6)) };
      }
      case 'last_week': {
        const monday = addDays(startOfWeek(today), -7);
        return { preset: period, startDate: formatLocalDate(monday), endDate: formatLocalDate(addDays(monday, 6)) };
      }
      case 'this_month': {
        const first = new Date(today.getFullYear(), today.getMonth(), 1);
        const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        return { preset: period, startDate: formatLocalDate(first), endDate: formatLocalDate(last) };
      }
      case 'last_month': {
        const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const last = new Date(today.getFullYear(), today.getMonth(), 0);
        return { preset: period, startDate: formatLocalDate(first), endDate: formatLocalDate(last) };
      }
      default: {
        const unsupported: never = period;
        throw new Error(`Unsupported period: ${unsupported}`);
      }
    }
  }

  if (!startDate || !endDate) {
    throw new Error('Provide a named "period" or both "startDate" and "endDate" (YYYY-MM-DD)');
  }
  if (!isValidDateString(startDate)) {
    throw new Error(`Invalid startDate "${startDate}", expected a valid YYYY-MM-DD date`);
  }
  if (!isValidDateString(endDate)) {
    throw new Error(`Invalid endDate "${endDate}", expected a valid YYYY-MM-DD date`);
  }
  if (startDate > endDate) {
    throw new Error(`startDate ${startDate} is after endDate ${endDate}`);
  }

  return { preset: 'custom', startDate, endDate };
}

/**
 * Convert an ISO 8601 duration (e.g. PT8H, PT7H30M, PT45M, P1DT2H) into
 * decimal hours. Returns null when the value is missing or not convertible.
 */
export function isoDurationToHours(iso: string | null | undefined): number | null {
  if (iso == null || iso.trim() === '') return null;
  const match = ISO_DURATION_RE.exec(iso.trim());
  if (!match) return null;

  const [, sign, years, months, weeks, days, hours, minutes, seconds] = match;
  if (years || months) return null;
  if (!weeks && !days && !hours && !minutes && !seconds) return null;

  const toNumber = (value: string | undefined): number => (value ? Number(value.replace(',', '.')) : 0);
  const totalSeconds =
    toNumber(weeks) * 7 * 24 * 3600 +
    toNumber(days) * 24 * 3600 +
    toNumber(hours) * 3600 +
    toNumber(minutes) * 60 +
    toNumber(seconds);

  const result = totalSeconds / 3600;
  return sign === '-' ? -result : result;
}

export function roundHours(hours: number): number {
  return Math.round(hours * 100) / 100;
}

/**
 * Build the OpenProject time entries filter JSON for a spentOn date range,
 * optionally scoped to a single user and/or project. Boundaries are inclusive
 * (operator <>d).
 */
export function buildTimeEntryFilters(options: {
  startDate: string;
  endDate: string;
  userId?: number;
  projectId?: number;
}): string {
  const filters: Array<Record<string, { operator: string; values: string[] }>> = [
    { spentOn: { operator: '<>d', values: [options.startDate, options.endDate] } },
  ];
  if (options.userId !== undefined) {
    filters.push({ user: { operator: '=', values: [String(options.userId)] } });
  }
  if (options.projectId !== undefined) {
    filters.push({ project: { operator: '=', values: [String(options.projectId)] } });
  }
  return JSON.stringify(filters);
}

function extractIdFromHref(href: string | undefined, resource: string): number | null {
  if (!href) return null;
  const match = href.match(new RegExp(`/${resource}/(\\d+)(?:/|$)`));
  return match && match[1] ? Number(match[1]) : null;
}

function accumulate(map: Map<string, TimesheetBucket>, key: string, hours: number): void {
  const bucket = map.get(key) ?? { entries: 0, hours: 0 };
  bucket.entries += 1;
  bucket.hours += hours;
  map.set(key, bucket);
}

function toSortedBreakdown<K extends string>(
  map: Map<string, TimesheetBucket>,
  keyName: K
): Array<Record<K, string> & TimesheetBucket> {
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, bucket]) => ({ [keyName]: key, entries: bucket.entries, hours: roundHours(bucket.hours) }) as Record<K, string> & TimesheetBucket);
}

/**
 * Aggregate raw OpenProject time entries into totals plus per-user,
 * per-project and per-date breakdowns. Hours are summed from the exact
 * durations and only rounded (2 decimals) in the output, so totals do not
 * accumulate floating point noise.
 */
export function aggregateTimeEntries(timeEntries: TimeEntry[]): TimesheetAggregation {
  const warnings: string[] = [];
  const items: Array<{ row: NormalizedTimeEntry; exactHours: number }> = timeEntries.map((entry) => {
    const links = entry._links ?? {};
    const exactHours = isoDurationToHours(entry.hours);
    if (exactHours === null) {
      warnings.push(
        `Time entry ${entry.id} has a missing or unparsable hours value (${JSON.stringify(entry.hours ?? null)}); counted as 0`
      );
    }

    const userId = extractIdFromHref(links.user?.href, 'users');
    const row: NormalizedTimeEntry = {
      entry_id: entry.id,
      spent_on: entry.spentOn,
      user: links.user?.title ?? (userId !== null ? `User #${userId}` : 'Unknown user'),
      project: links.project?.title ?? 'Unknown project',
      work_package_id: extractIdFromHref(links.workPackage?.href, 'work_packages'),
      work_package: links.workPackage?.title ?? '',
      activity: links.activity?.title ?? '',
      hours_iso: entry.hours ?? null,
      hours_decimal: roundHours(exactHours ?? 0),
      comment: entry.comment?.raw ?? '',
    };
    return { row, exactHours: exactHours ?? 0 };
  });

  items.sort((a, b) => a.row.spent_on.localeCompare(b.row.spent_on) || a.row.entry_id - b.row.entry_id);

  const byUser = new Map<string, TimesheetBucket>();
  const byProject = new Map<string, TimesheetBucket>();
  const byDate = new Map<string, TimesheetBucket>();
  let totalHours = 0;

  for (const { row, exactHours } of items) {
    totalHours += exactHours;
    accumulate(byUser, row.user, exactHours);
    accumulate(byProject, row.project, exactHours);
    accumulate(byDate, row.spent_on, exactHours);
  }

  return {
    totals: { entries: items.length, hours: roundHours(totalHours) },
    byUser: toSortedBreakdown(byUser, 'user'),
    byProject: toSortedBreakdown(byProject, 'project'),
    byDate: toSortedBreakdown(byDate, 'date'),
    entries: items.map((item) => item.row),
    warnings,
  };
}
