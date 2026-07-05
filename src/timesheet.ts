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

export interface TimesheetMatrixRow {
  member: string;
  hoursByProject: Record<string, number>;
  entries: number;
  totalHours: number;
}

export interface TimesheetMatrix {
  members: string[];
  projects: string[];
  rows: TimesheetMatrixRow[];
  projectTotals: Record<string, number>;
  grandTotal: TimesheetBucket;
  warnings: string[];
}

export type TimesheetPeriodInput = {
  period?: TimesheetPeriodPreset;
  startDate?: string;
  endDate?: string;
};

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

const PROMPT_PERIOD_PATTERNS: Array<[TimesheetPeriodPreset, RegExp]> = [
  ['last_month', /\blast\s+month\b/],
  ['this_month', /\b(this|current)\s+month\b/],
  ['last_week', /\blast\s+week\b/],
  ['this_week', /\b(this|current)\s+week\b/],
  ['yesterday', /\byesterday\b/],
  ['today', /\btoday\b/],
];

/**
 * Infer a timesheet date range from a natural-language prompt. This is
 * deliberately deterministic and small: it supports the named period presets
 * exposed by the MCP tools plus explicit YYYY-MM-DD start/end pairs.
 */
export function parseTimesheetPrompt(prompt: string): TimesheetPeriodInput {
  const trimmed = prompt.trim();
  if (trimmed === '') {
    throw new Error('Prompt must not be empty; include a period like "last month" or explicit YYYY-MM-DD dates');
  }

  const dateMatches = [...trimmed.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((match) => match[0]);
  if (dateMatches.length >= 2) {
    return { startDate: dateMatches[0], endDate: dateMatches[1] };
  }
  if (dateMatches.length === 1) {
    throw new Error('Prompt contains only one YYYY-MM-DD date; include both start and end dates');
  }

  const normalized = trimmed.toLowerCase().replace(/[_-]+/g, ' ');
  const matches = PROMPT_PERIOD_PATTERNS.filter(([, pattern]) => pattern.test(normalized)).map(([period]) => period);

  if (matches.length === 1) {
    return { period: matches[0] };
  }
  if (matches.length > 1) {
    throw new Error(`Prompt contains multiple time periods (${matches.join(', ')}); use one period or explicit dates`);
  }

  throw new Error(
    'Could not infer a timesheet period from prompt; include today, yesterday, this week, last week, this month, last month, or explicit YYYY-MM-DD start/end dates'
  );
}

export function resolveTimesheetPeriodInput(options: TimesheetPeriodInput & { prompt?: string }): TimesheetPeriodInput {
  if (options.period !== undefined || options.startDate !== undefined || options.endDate !== undefined) {
    const periodInput: TimesheetPeriodInput = {};
    if (options.period !== undefined) periodInput.period = options.period;
    if (options.startDate !== undefined) periodInput.startDate = options.startDate;
    if (options.endDate !== undefined) periodInput.endDate = options.endDate;
    return periodInput;
  }
  if (options.prompt !== undefined) {
    return parseTimesheetPrompt(options.prompt);
  }
  return {};
}

/**
 * Resolve a named period preset or an explicit date range into inclusive
 * YYYY-MM-DD boundaries. Presets are evaluated against the local timezone
 * of the machine running the server (the business timezone).
 */
export function resolvePeriod(
  options: TimesheetPeriodInput,
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

function timeEntryMemberLabel(entry: TimeEntry): string {
  const links = entry._links ?? {};
  const userId = extractIdFromHref(links.user?.href, 'users');
  return links.user?.title ?? (userId !== null ? `User #${userId}` : 'Unknown user');
}

function timeEntryProjectLabel(entry: TimeEntry): string {
  return entry._links?.project?.title ?? 'Unknown project';
}

/**
 * Cross-tabulate raw OpenProject time entries into a member × project hours
 * matrix: one row per member, one column per project, with per-member totals,
 * per-project totals and a grand total. Hours are summed from the exact
 * durations and only rounded (2 decimals) in the output. Rows are sorted by
 * total hours (highest first, ties by name), columns alphabetically.
 */
export function buildTimesheetMatrix(timeEntries: TimeEntry[]): TimesheetMatrix {
  const warnings: string[] = [];
  const cells = new Map<string, Map<string, TimesheetBucket>>();
  const projectSet = new Set<string>();
  let grandEntries = 0;
  let grandHours = 0;

  for (const entry of timeEntries) {
    const exactHours = isoDurationToHours(entry.hours);
    if (exactHours === null) {
      warnings.push(
        `Time entry ${entry.id} has a missing or unparsable hours value (${JSON.stringify(entry.hours ?? null)}); counted as 0`
      );
    }
    const hours = exactHours ?? 0;
    const member = timeEntryMemberLabel(entry);
    const project = timeEntryProjectLabel(entry);

    projectSet.add(project);
    const memberCells = cells.get(member) ?? new Map<string, TimesheetBucket>();
    accumulate(memberCells, project, hours);
    cells.set(member, memberCells);
    grandEntries += 1;
    grandHours += hours;
  }

  const projects = [...projectSet].sort((a, b) => a.localeCompare(b));

  const unsortedRows = [...cells.entries()].map(([member, memberCells]) => {
    let exactTotal = 0;
    let entries = 0;
    const hoursByProject: Record<string, number> = {};
    for (const project of projects) {
      const bucket = memberCells.get(project);
      if (!bucket) continue;
      hoursByProject[project] = roundHours(bucket.hours);
      exactTotal += bucket.hours;
      entries += bucket.entries;
    }
    return { member, hoursByProject, entries, exactTotal };
  });

  unsortedRows.sort((a, b) => b.exactTotal - a.exactTotal || a.member.localeCompare(b.member));
  const rows: TimesheetMatrixRow[] = unsortedRows.map(({ member, hoursByProject, entries, exactTotal }) => ({
    member,
    hoursByProject,
    entries,
    totalHours: roundHours(exactTotal),
  }));

  const projectTotals: Record<string, number> = {};
  for (const project of projects) {
    let exactTotal = 0;
    for (const memberCells of cells.values()) {
      exactTotal += memberCells.get(project)?.hours ?? 0;
    }
    projectTotals[project] = roundHours(exactTotal);
  }

  return {
    members: rows.map((row) => row.member),
    projects,
    rows,
    projectTotals,
    grandTotal: { entries: grandEntries, hours: roundHours(grandHours) },
    warnings,
  };
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

/**
 * Render a timesheet matrix as a single GitHub-flavored markdown table:
 * members as rows, projects as columns, a Total column per member and a
 * final Total row per project. Cells without logged time show "-".
 */
export function renderTimesheetMatrixMarkdown(matrix: TimesheetMatrix): string {
  if (matrix.rows.length === 0) {
    return 'No time entries found for this period.';
  }

  const header = ['Member', ...matrix.projects.map(escapeMarkdownCell), 'Total'];
  const separator = ['---', ...matrix.projects.map(() => '---:'), '---:'];
  const lines = [`| ${header.join(' | ')} |`, `| ${separator.join(' | ')} |`];

  for (const row of matrix.rows) {
    const cells = matrix.projects.map((project) =>
      project in row.hoursByProject ? String(row.hoursByProject[project]) : '-'
    );
    lines.push(`| ${escapeMarkdownCell(row.member)} | ${cells.join(' | ')} | ${row.totalHours} |`);
  }

  const totalCells = matrix.projects.map((project) => `**${matrix.projectTotals[project] ?? 0}**`);
  lines.push(`| **Total** | ${totalCells.join(' | ')} | **${matrix.grandTotal.hours}** |`);

  return lines.join('\n');
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

    const row: NormalizedTimeEntry = {
      entry_id: entry.id,
      spent_on: entry.spentOn,
      user: timeEntryMemberLabel(entry),
      project: timeEntryProjectLabel(entry),
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
