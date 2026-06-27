/**
 * Unit tests for the list_work_packages_by_status response helpers.
 */

import { describe, expect, test } from 'bun:test';
import type { WorkPackage } from '../src/openproject-client.ts';
import {
  DEFAULT_STATUS_TASK_PAGE_SIZE,
  buildStatusWorkPackageFilters,
  getStatusLabelForSummary,
  groupStatusTasks,
  summarizeWorkPackagesByStatus,
  toStatusTask,
} from '../src/status-tasks.ts';

interface FakeLinks {
  project?: { id: number; title: string };
  assignee?: { id: number; title: string };
  status: { id: number; title: string };
  type?: string;
  priority?: string;
}

function wp(id: number, links: FakeLinks, extra?: Partial<WorkPackage>): WorkPackage {
  const _links: Record<string, { href: string; title?: string }> = {
    status: { href: `/api/v3/statuses/${links.status.id}`, title: links.status.title },
  };
  if (links.project) _links.project = { href: `/api/v3/projects/${links.project.id}`, title: links.project.title };
  if (links.assignee) _links.assignee = { href: `/api/v3/users/${links.assignee.id}`, title: links.assignee.title };
  if (links.type) _links.type = { href: '/api/v3/types/1', title: links.type };
  if (links.priority) _links.priority = { href: '/api/v3/priorities/1', title: links.priority };

  return {
    id,
    subject: `Task ${id}`,
    percentageDone: 0,
    _links,
    ...extra,
  } as WorkPackage;
}

const IN_PROGRESS = { id: 7, title: 'In Progress' };
const NEW = { id: 1, title: 'New' };
const CLOSED = { id: 12, title: 'Closed' };

describe('buildStatusWorkPackageFilters', () => {
  test('defaults to open work packages only', () => {
    expect(buildStatusWorkPackageFilters({})).toBe('[{"status":{"operator":"o","values":[]}}]');
  });

  test('combines the default open filter with assignee filters', () => {
    expect(buildStatusWorkPackageFilters({ assigneeId: 5 })).toBe(
      '[{"status":{"operator":"o","values":[]}},{"assignee":{"operator":"=","values":["5"]}}]'
    );
  });

  test('builds status and assignee filters', () => {
    expect(buildStatusWorkPackageFilters({ statusId: 7, assigneeId: 5 })).toBe(
      '[{"status":{"operator":"=","values":["7"]}},{"assignee":{"operator":"=","values":["5"]}}]'
    );
  });
});

describe('status task helpers', () => {
  test('uses a 100-record default task page size', () => {
    expect(DEFAULT_STATUS_TASK_PAGE_SIZE).toBe(100);
  });

  test('maps work packages to compact task rows', () => {
    expect(
      toStatusTask(
        wp(
          42,
          {
            project: { id: 3, title: 'Mobile App' },
            assignee: { id: 5, title: 'Jane Roe' },
            status: IN_PROGRESS,
            type: 'Bug',
            priority: 'High',
          },
          { subject: 'Fix sync', dueDate: '2026-07-01', percentageDone: 25 }
        )
      )
    ).toEqual({
      id: 42,
      subject: 'Fix sync',
      projectId: 3,
      project: 'Mobile App',
      assigneeId: 5,
      assignee: 'Jane Roe',
      statusId: 7,
      status: 'In Progress',
      type: 'Bug',
      priority: 'High',
      startDate: null,
      dueDate: '2026-07-01',
      percentageDone: 25,
    });
  });

  test('summarizes counts by status across all supplied work packages', () => {
    const summary = summarizeWorkPackagesByStatus([
      wp(1, { status: IN_PROGRESS }),
      wp(2, { status: IN_PROGRESS }),
      wp(3, { status: NEW }),
      wp(4, { status: CLOSED }),
    ]);

    expect(summary).toEqual([
      { statusId: 12, status: 'Closed', count: 1 },
      { statusId: 7, status: 'In Progress', count: 2 },
      { statusId: 1, status: 'New', count: 1 },
    ]);
  });

  test('groups the paged task list by status without changing summary semantics', () => {
    const groups = groupStatusTasks([
      toStatusTask(wp(3, { status: NEW })),
      toStatusTask(wp(1, { status: IN_PROGRESS })),
      toStatusTask(wp(2, { status: IN_PROGRESS })),
    ]);

    expect(groups.map((group) => ({ status: group.status, count: group.count }))).toEqual([
      { status: 'In Progress', count: 2 },
      { status: 'New', count: 1 },
    ]);
    expect(groups[0]!.tasks.map((task) => task.id)).toEqual([1, 2]);
  });

  test('uses the requested status name as the single-status fallback label', () => {
    expect(getStatusLabelForSummary([], { statusId: 7, statusRef: 'In Progress' })).toBe('In Progress');
    expect(getStatusLabelForSummary([], { statusId: 7 })).toBe('Status #7');
  });
});
