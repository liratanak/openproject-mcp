/**
 * Helpers for the list_work_packages_by_status tool.
 *
 * The tool needs two related views over work packages: a compact paged task
 * list for display and count summaries by status. These pure helpers keep the
 * response shaping testable without a live OpenProject instance.
 */

import type { WorkPackage } from './openproject-client.ts';

export const DEFAULT_STATUS_TASK_PAGE_SIZE = 100;

export interface StatusTask {
  id: number;
  subject: string;
  projectId: number | null;
  project: string | null;
  assigneeId: number | null;
  assignee: string | null;
  statusId: number | null;
  status: string;
  type: string | null;
  priority: string | null;
  startDate: string | null;
  dueDate: string | null;
  percentageDone: number | null;
}

export interface StatusCount {
  statusId: number | null;
  status: string;
  count: number;
}

export interface StatusTaskGroup extends StatusCount {
  tasks: StatusTask[];
}

type WorkPackageFilter = Record<string, { operator: string; values: string[] }>;

function extractId(href: string | undefined, resource: string): number | null {
  if (!href) return null;
  const match = href.match(new RegExp(`/${resource}/(\\d+)(?:/|$)`));
  return match && match[1] ? Number(match[1]) : null;
}

function compareStatusCounts(a: StatusCount, b: StatusCount): number {
  return a.status.localeCompare(b.status);
}

function statusKey(statusId: number | null, status: string): string {
  return statusId !== null ? `id:${statusId}` : `name:${status}`;
}

export function buildStatusWorkPackageFilters(options: { statusId?: number; assigneeId?: number }): string {
  const filters: WorkPackageFilter[] = [];
  if (options.statusId !== undefined) {
    filters.push({ status: { operator: '=', values: [String(options.statusId)] } });
  } else {
    filters.push({ status: { operator: 'o', values: [] } });
  }
  if (options.assigneeId !== undefined) {
    filters.push({ assignee: { operator: '=', values: [String(options.assigneeId)] } });
  }
  return JSON.stringify(filters);
}

export function toStatusTask(workPackage: WorkPackage): StatusTask {
  const links = workPackage._links ?? {};
  const projectId = extractId(links.project?.href, 'projects');
  const assigneeId = extractId(links.assignee?.href, 'users');
  const statusId = extractId(links.status?.href, 'statuses');

  return {
    id: workPackage.id,
    subject: workPackage.subject,
    projectId,
    project: links.project?.title ?? (projectId !== null ? `Project #${projectId}` : null),
    assigneeId,
    assignee: links.assignee?.title ?? null,
    statusId,
    status: links.status?.title ?? (statusId !== null ? `Status #${statusId}` : 'No status'),
    type: links.type?.title ?? null,
    priority: links.priority?.title ?? null,
    startDate: workPackage.startDate ?? null,
    dueDate: workPackage.dueDate ?? null,
    percentageDone: workPackage.percentageDone ?? null,
  };
}

export function summarizeWorkPackagesByStatus(workPackages: WorkPackage[]): StatusCount[] {
  const counts = new Map<string, StatusCount>();

  for (const task of workPackages.map(toStatusTask)) {
    const key = statusKey(task.statusId, task.status);
    const count = counts.get(key);
    if (count) {
      count.count += 1;
    } else {
      counts.set(key, { statusId: task.statusId, status: task.status, count: 1 });
    }
  }

  return [...counts.values()].sort(compareStatusCounts);
}

export function groupStatusTasks(tasks: StatusTask[]): StatusTaskGroup[] {
  const groups = new Map<string, StatusTaskGroup>();

  for (const task of tasks) {
    const key = statusKey(task.statusId, task.status);
    let group = groups.get(key);
    if (!group) {
      group = { statusId: task.statusId, status: task.status, count: 0, tasks: [] };
      groups.set(key, group);
    }
    group.count += 1;
    group.tasks.push(task);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      tasks: group.tasks.sort((a, b) => a.id - b.id),
    }))
    .sort(compareStatusCounts);
}

export function getStatusLabelForSummary(
  workPackages: WorkPackage[],
  fallback: { statusId: number; statusRef?: number | string }
): string {
  const fromTask = workPackages.map(toStatusTask).find((task) => task.statusId === fallback.statusId);
  if (fromTask) return fromTask.status;
  if (typeof fallback.statusRef === 'string' && fallback.statusRef.trim() !== '') return fallback.statusRef.trim();
  return `Status #${fallback.statusId}`;
}
