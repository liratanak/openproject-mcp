/**
 * Member task grouping helpers
 * Build the Project -> Member (assignee) -> Status -> tasks hierarchy returned
 * by the list_member_tasks MCP tool, plus the work package filter for its
 * optional assignee/status filters. Pure functions so they can be unit tested
 * without a live OpenProject instance.
 */

import type { WorkPackage } from './openproject-client.ts';

/** Level 4 — a single task under a (member, status) bucket. */
export interface MemberTask {
  id: number;
  subject: string;
  type: string | null;
  priority: string | null;
  startDate: string | null;
  dueDate: string | null;
  percentageDone: number | null;
}

/** Level 3 — tasks of one member that share the same status. */
export interface MemberStatusGroup {
  statusId: number | null;
  status: string;
  taskCount: number;
  tasks: MemberTask[];
}

/** Level 2 — one member (assignee) and their tasks grouped by status. */
export interface ProjectMemberGroup {
  assigneeId: number | null;
  assignee: string;
  taskCount: number;
  statuses: MemberStatusGroup[];
}

/** Level 1 — one project and the members who have tasks in it. */
export interface ProjectTaskGroup {
  projectId: number | null;
  project: string;
  taskCount: number;
  members: ProjectMemberGroup[];
}

export interface MemberTaskHierarchy {
  totalTasks: number;
  projectCount: number;
  projects: ProjectTaskGroup[];
}

export const UNASSIGNED_LABEL = 'Unassigned';

type WorkPackageFilter = Record<string, { operator: string; values: string[] }>;

function extractId(href: string | undefined, resource: string): number | null {
  if (!href) return null;
  const match = href.match(new RegExp(`/${resource}/(\\d+)(?:/|$)`));
  return match && match[1] ? Number(match[1]) : null;
}

/**
 * Build the OpenProject work package filter JSON for the optional assignee
 * and/or status filters. When no explicit status is supplied, the filter keeps
 * the default task-read behavior to open work packages only. Passing a status
 * ID intentionally bypasses that default so callers can ask for a closed status
 * by name/ID when they need it.
 */
export function buildMemberTaskFilters(options: { assigneeId?: number; statusId?: number }): string {
  const filters: WorkPackageFilter[] = [];
  if (options.assigneeId !== undefined) {
    filters.push({ assignee: { operator: '=', values: [String(options.assigneeId)] } });
  }
  if (options.statusId !== undefined) {
    filters.push({ status: { operator: '=', values: [String(options.statusId)] } });
  } else {
    filters.push({ status: { operator: 'o', values: [] } });
  }
  return JSON.stringify(filters);
}

// Members are ordered by name, but the synthetic "Unassigned" bucket always
// sorts last so real people lead the list.
function compareMembers(a: ProjectMemberGroup, b: ProjectMemberGroup): number {
  const aUnassigned = a.assigneeId === null;
  const bUnassigned = b.assigneeId === null;
  if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1;
  return a.assignee.localeCompare(b.assignee);
}

interface StatusAcc {
  statusId: number | null;
  status: string;
  tasks: MemberTask[];
}
interface MemberAcc {
  assigneeId: number | null;
  assignee: string;
  statuses: Map<string, StatusAcc>;
}
interface ProjectAcc {
  projectId: number | null;
  project: string;
  members: Map<string, MemberAcc>;
}

/**
 * Group work packages into the four-level Project -> Member -> Status -> tasks
 * hierarchy. Each level carries a `taskCount`. Projects/statuses are sorted by
 * name and members by name (Unassigned last); tasks are sorted by ID so the
 * output is deterministic regardless of the order returned by the API.
 *
 * The project, assignee, status, type and priority names are read straight
 * from each work package's HAL `_links` titles, so the whole tree is built
 * from a single work package listing without any extra lookups.
 */
export function groupWorkPackagesByProjectMemberStatus(workPackages: WorkPackage[]): MemberTaskHierarchy {
  const projects = new Map<string, ProjectAcc>();

  for (const wp of workPackages) {
    const links = wp._links ?? {};

    const projectId = extractId(links.project?.href, 'projects');
    const projectName = links.project?.title ?? (projectId !== null ? `Project #${projectId}` : 'No project');
    const projectKey = projectId !== null ? `id:${projectId}` : `name:${projectName}`;

    const assigneeId = extractId(links.assignee?.href, 'users');
    const assigneeName = links.assignee?.title ?? (assigneeId !== null ? `User #${assigneeId}` : UNASSIGNED_LABEL);
    const memberKey = assigneeId !== null ? `id:${assigneeId}` : UNASSIGNED_LABEL;

    const statusId = extractId(links.status?.href, 'statuses');
    const statusName = links.status?.title ?? (statusId !== null ? `Status #${statusId}` : 'No status');
    const statusKey = statusId !== null ? `id:${statusId}` : `name:${statusName}`;

    let project = projects.get(projectKey);
    if (!project) {
      project = { projectId, project: projectName, members: new Map() };
      projects.set(projectKey, project);
    }

    let member = project.members.get(memberKey);
    if (!member) {
      member = { assigneeId, assignee: assigneeName, statuses: new Map() };
      project.members.set(memberKey, member);
    }

    let status = member.statuses.get(statusKey);
    if (!status) {
      status = { statusId, status: statusName, tasks: [] };
      member.statuses.set(statusKey, status);
    }

    status.tasks.push({
      id: wp.id,
      subject: wp.subject,
      type: links.type?.title ?? null,
      priority: links.priority?.title ?? null,
      startDate: wp.startDate ?? null,
      dueDate: wp.dueDate ?? null,
      percentageDone: wp.percentageDone ?? null,
    });
  }

  const projectGroups: ProjectTaskGroup[] = [...projects.values()]
    .map((project) => {
      const members: ProjectMemberGroup[] = [...project.members.values()]
        .map((member) => {
          const statuses: MemberStatusGroup[] = [...member.statuses.values()]
            .map((status) => ({
              statusId: status.statusId,
              status: status.status,
              taskCount: status.tasks.length,
              tasks: status.tasks.sort((a, b) => a.id - b.id),
            }))
            .sort((a, b) => a.status.localeCompare(b.status));
          const taskCount = statuses.reduce((sum, group) => sum + group.taskCount, 0);
          return { assigneeId: member.assigneeId, assignee: member.assignee, taskCount, statuses };
        })
        .sort(compareMembers);
      const taskCount = members.reduce((sum, group) => sum + group.taskCount, 0);
      return { projectId: project.projectId, project: project.project, taskCount, members };
    })
    .sort((a, b) => a.project.localeCompare(b.project));

  const totalTasks = projectGroups.reduce((sum, group) => sum + group.taskCount, 0);
  return { totalTasks, projectCount: projectGroups.length, projects: projectGroups };
}
