/**
 * Unit tests for the member task grouping helpers behind the list_member_tasks
 * tool. Pure functions are exercised with fabricated work packages, so no
 * OpenProject instance is required.
 */

import { describe, expect, test } from 'bun:test';
import type { WorkPackage } from '../src/openproject-client.ts';
import {
  buildMemberTaskFilters,
  groupWorkPackagesByProjectMemberStatus,
} from '../src/member-tasks.ts';

interface FakeLinks {
  project?: { id: number; title: string };
  assignee?: { id: number; title: string };
  status: { id: number; title: string };
  type?: string;
  priority?: string;
}

// Build a minimal work package whose HAL _links carry the project, assignee and
// status titles the grouping reads. Only the fields the helper touches are set.
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

const ALPHA = { id: 1, title: 'Alpha' };
const BETA = { id: 2, title: 'Beta' };
const JOHN = { id: 5, title: 'John Doe' };
const JANE = { id: 6, title: 'Jane Roe' };
const IN_PROGRESS = { id: 7, title: 'In Progress' };
const NEW = { id: 1, title: 'New' };
const CLOSED = { id: 12, title: 'Closed' };

describe('buildMemberTaskFilters', () => {
  test('defaults to open work packages only', () => {
    expect(buildMemberTaskFilters({})).toBe('[{"status":{"operator":"o","values":[]}}]');
  });

  test('builds an assignee-only filter while keeping the open default', () => {
    expect(buildMemberTaskFilters({ assigneeId: 5 })).toBe(
      '[{"assignee":{"operator":"=","values":["5"]}},{"status":{"operator":"o","values":[]}}]'
    );
  });

  test('builds a status-only filter', () => {
    expect(buildMemberTaskFilters({ statusId: 7 })).toBe('[{"status":{"operator":"=","values":["7"]}}]');
  });

  test('combines assignee and status filters in order', () => {
    expect(buildMemberTaskFilters({ assigneeId: 5, statusId: 7 })).toBe(
      '[{"assignee":{"operator":"=","values":["5"]}},{"status":{"operator":"=","values":["7"]}}]'
    );
  });
});

describe('groupWorkPackagesByProjectMemberStatus', () => {
  test('returns an empty hierarchy for no work packages', () => {
    expect(groupWorkPackagesByProjectMemberStatus([])).toEqual({
      totalTasks: 0,
      projectCount: 0,
      projects: [],
    });
  });

  test('nests Project -> Member -> Status -> tasks with counts and deterministic sorting', () => {
    const result = groupWorkPackagesByProjectMemberStatus([
      wp(2, { project: ALPHA, assignee: JOHN, status: IN_PROGRESS }),
      wp(1, { project: ALPHA, assignee: JOHN, status: IN_PROGRESS }),
      wp(3, { project: ALPHA, assignee: JOHN, status: NEW }),
      wp(4, { project: ALPHA, assignee: JANE, status: NEW }),
      wp(5, { project: BETA, assignee: JOHN, status: CLOSED }),
      wp(6, { project: ALPHA, status: NEW }), // unassigned
    ]);

    expect(result.totalTasks).toBe(6);
    expect(result.projectCount).toBe(2);

    // Projects sorted by name: Alpha before Beta.
    expect(result.projects.map((project) => project.project)).toEqual(['Alpha', 'Beta']);

    const alpha = result.projects[0]!;
    expect(alpha.projectId).toBe(1);
    expect(alpha.taskCount).toBe(5);

    // Members sorted by name with Unassigned last: Jane, John, Unassigned.
    expect(alpha.members.map((member) => member.assignee)).toEqual(['Jane Roe', 'John Doe', 'Unassigned']);
    expect(alpha.members.map((member) => member.assigneeId)).toEqual([6, 5, null]);

    const john = alpha.members[1]!;
    expect(john.taskCount).toBe(3);
    // Statuses sorted by name: In Progress before New.
    expect(john.statuses.map((status) => status.status)).toEqual(['In Progress', 'New']);

    const johnInProgress = john.statuses[0]!;
    expect(johnInProgress.statusId).toBe(7);
    expect(johnInProgress.taskCount).toBe(2);
    // Tasks sorted by id regardless of input order.
    expect(johnInProgress.tasks.map((task) => task.id)).toEqual([1, 2]);

    const unassigned = alpha.members[2]!;
    expect(unassigned.assigneeId).toBeNull();
    expect(unassigned.taskCount).toBe(1);
    expect(unassigned.statuses[0]!.tasks[0]!.id).toBe(6);

    const beta = result.projects[1]!;
    expect(beta.taskCount).toBe(1);
    expect(beta.members[0]!.statuses[0]!.status).toBe('Closed');
  });

  test('copies task fields from the work package and its links', () => {
    const [project] = groupWorkPackagesByProjectMemberStatus([
      wp(
        42,
        { project: ALPHA, assignee: JOHN, status: IN_PROGRESS, type: 'Bug', priority: 'High' },
        { subject: 'Fix login', dueDate: '2026-07-01', startDate: '2026-06-20', percentageDone: 40 }
      ),
    ]).projects;

    expect(project!.members[0]!.statuses[0]!.tasks[0]).toEqual({
      id: 42,
      subject: 'Fix login',
      type: 'Bug',
      priority: 'High',
      startDate: '2026-06-20',
      dueDate: '2026-07-01',
      percentageDone: 40,
    });
  });

  test('falls back to placeholders when project/assignee/type links are missing', () => {
    const result = groupWorkPackagesByProjectMemberStatus([
      wp(9, { status: NEW }), // no project, no assignee, no type/priority
    ]);

    const project = result.projects[0]!;
    expect(project.project).toBe('No project');
    expect(project.projectId).toBeNull();

    const member = project.members[0]!;
    expect(member.assignee).toBe('Unassigned');

    const task = member.statuses[0]!.tasks[0]!;
    expect(task.type).toBeNull();
    expect(task.priority).toBeNull();
    expect(task.dueDate).toBeNull();
  });
});
