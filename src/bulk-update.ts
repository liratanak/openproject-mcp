/**
 * Bulk work package update helpers
 * Defaults merging, PATCH payload building and sequential execution with
 * per-item results, used by the bulk_update_work_packages MCP tool.
 */

import type { WorkPackage } from './openproject-client.ts';

export interface WorkPackageChanges {
  subject?: string;
  description?: string;
  typeId?: number;
  statusId?: number;
  priorityId?: number;
  assigneeId?: number;
  responsibleId?: number;
  versionId?: number;
  parentId?: number;
  startDate?: string;
  dueDate?: string;
  estimatedTime?: string;
  percentageDone?: number;
}

export interface BulkUpdateItem extends WorkPackageChanges {
  id: number;
  lockVersion?: number;
}

export interface WorkPackageUpdateBody {
  lockVersion: number;
  subject?: string;
  description?: { raw: string };
  _links?: {
    type?: { href: string };
    status?: { href: string };
    priority?: { href: string };
    assignee?: { href: string };
    responsible?: { href: string };
    version?: { href: string };
    parent?: { href: string };
  };
  startDate?: string;
  dueDate?: string;
  estimatedTime?: string;
  percentageDone?: number;
}

// Minimal structural view of OpenProjectClient so the executor can be unit
// tested with a fake client instead of a live OpenProject instance.
export interface WorkPackageUpdateClient {
  getWorkPackage(id: number): Promise<WorkPackage>;
  updateWorkPackage(id: number, data: WorkPackageUpdateBody, notify?: boolean): Promise<WorkPackage>;
}

export interface BulkUpdateItemResult {
  id: number;
  status: 'updated' | 'failed' | 'skipped';
  appliedChanges?: ChangeField[];
  subject?: string;
  lockVersion?: number;
  /** True when the first PATCH hit a lockVersion conflict and a refetch+retry was needed. */
  retried?: boolean;
  error?: string;
  reason?: string;
}

export interface BulkUpdateResult {
  summary: { requested: number; updated: number; failed: number; skipped: number };
  results: BulkUpdateItemResult[];
}

const CHANGE_FIELDS = [
  'subject',
  'description',
  'typeId',
  'statusId',
  'priorityId',
  'assigneeId',
  'responsibleId',
  'versionId',
  'parentId',
  'startDate',
  'dueDate',
  'estimatedTime',
  'percentageDone',
] as const;

export type ChangeField = (typeof CHANGE_FIELDS)[number];

function apiLink(resource: string, id: number): string {
  return `/api/v3/${resource}/${id}`;
}

/**
 * Combine shared defaults with one item's own fields; values set on the item
 * win. Only recognized change fields are copied, never id/lockVersion.
 */
export function mergeWorkPackageChanges(
  defaults: WorkPackageChanges | undefined,
  item: BulkUpdateItem
): WorkPackageChanges {
  const merged: WorkPackageChanges = {};
  for (const field of CHANGE_FIELDS) {
    const value = item[field] !== undefined ? item[field] : defaults?.[field];
    if (value !== undefined) {
      (merged as Record<string, unknown>)[field] = value;
    }
  }
  return merged;
}

export function listChangedFields(changes: WorkPackageChanges): ChangeField[] {
  return CHANGE_FIELDS.filter((field) => changes[field] !== undefined);
}

/**
 * Translate user-friendly change fields into the OpenProject PATCH body
 * (ID fields become _links hrefs, description becomes a rich text object).
 */
export function buildWorkPackageUpdateBody(lockVersion: number, changes: WorkPackageChanges): WorkPackageUpdateBody {
  const body: WorkPackageUpdateBody = { lockVersion };

  if (changes.subject !== undefined) body.subject = changes.subject;
  if (changes.description !== undefined) body.description = { raw: changes.description };
  if (changes.startDate !== undefined) body.startDate = changes.startDate;
  if (changes.dueDate !== undefined) body.dueDate = changes.dueDate;
  if (changes.estimatedTime !== undefined) body.estimatedTime = changes.estimatedTime;
  if (changes.percentageDone !== undefined) body.percentageDone = changes.percentageDone;

  const links: NonNullable<WorkPackageUpdateBody['_links']> = {};
  if (changes.typeId !== undefined) links.type = { href: apiLink('types', changes.typeId) };
  if (changes.statusId !== undefined) links.status = { href: apiLink('statuses', changes.statusId) };
  if (changes.priorityId !== undefined) links.priority = { href: apiLink('priorities', changes.priorityId) };
  if (changes.assigneeId !== undefined) links.assignee = { href: apiLink('users', changes.assigneeId) };
  if (changes.responsibleId !== undefined) links.responsible = { href: apiLink('users', changes.responsibleId) };
  if (changes.versionId !== undefined) links.version = { href: apiLink('versions', changes.versionId) };
  if (changes.parentId !== undefined) links.parent = { href: apiLink('work_packages', changes.parentId) };
  if (Object.keys(links).length > 0) body._links = links;

  return body;
}

/**
 * OpenProject rejects a PATCH whose lockVersion is stale with an
 * `UpdateConflict` error (HTTP 409). This recognizes that case from the error
 * message the client surfaces so the update can be retried with a fresh
 * lockVersion.
 */
export function isLockVersionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UpdateConflict|\b409\b|lockversion|conflict/i.test(message);
}

async function fetchLockVersion(client: WorkPackageUpdateClient, id: number): Promise<number> {
  const lockVersion = (await client.getWorkPackage(id)).lockVersion;
  if (typeof lockVersion !== 'number') {
    throw new Error(`Could not determine lockVersion for work package ${id}`);
  }
  return lockVersion;
}

/**
 * PATCH one work package, recovering from a stale lockVersion. The supplied
 * lockVersion (or a freshly fetched one) is tried first; on a lockVersion
 * conflict the current version is refetched and the PATCH is retried once.
 *
 * Exported so the single-item `update_work_package` MCP tool can share the
 * same optimistic-locking behavior as `bulk_update_work_packages`: omit
 * `lockVersion` to auto-fetch the freshest value, or supply a known one to
 * skip the extra read.
 */
export async function updateWithLockRetry(
  client: WorkPackageUpdateClient,
  item: BulkUpdateItem,
  changes: WorkPackageChanges,
  notify?: boolean
): Promise<{ workPackage: WorkPackage; retried: boolean }> {
  const lockVersion = item.lockVersion ?? (await fetchLockVersion(client, item.id));
  try {
    const workPackage = await client.updateWorkPackage(item.id, buildWorkPackageUpdateBody(lockVersion, changes), notify);
    return { workPackage, retried: false };
  } catch (error) {
    if (!isLockVersionConflict(error)) throw error;
    // Stale lockVersion: refetch the current one and retry the PATCH once.
    const freshLockVersion = await fetchLockVersion(client, item.id);
    const workPackage = await client.updateWorkPackage(item.id, buildWorkPackageUpdateBody(freshLockVersion, changes), notify);
    return { workPackage, retried: true };
  }
}

/**
 * Update every listed work package sequentially. The whole request is
 * validated up front (duplicates, items without changes) before anything is
 * written. Each item's current lockVersion is fetched right before its PATCH
 * when not supplied, and a stale lockVersion is automatically refetched and
 * retried once. Failures never abort the run unless stopOnError is set;
 * the outcome of every item is reported individually.
 */
export async function executeBulkWorkPackageUpdate(
  client: WorkPackageUpdateClient,
  options: {
    updates: BulkUpdateItem[];
    defaults?: WorkPackageChanges;
    notify?: boolean;
    stopOnError?: boolean;
  }
): Promise<BulkUpdateResult> {
  const { updates, defaults, notify, stopOnError = false } = options;

  if (updates.length === 0) {
    throw new Error('updates must contain at least one work package');
  }

  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const item of updates) {
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  if (duplicates.size > 0) {
    throw new Error(`Duplicate work package IDs in updates: ${[...duplicates].join(', ')}`);
  }

  const planned = updates.map((item) => {
    const changes = mergeWorkPackageChanges(defaults, item);
    return { item, changes, fields: listChangedFields(changes) };
  });

  const withoutChanges = planned.filter((plan) => plan.fields.length === 0).map((plan) => plan.item.id);
  if (withoutChanges.length > 0) {
    throw new Error(
      `No changes specified for work package(s) ${withoutChanges.join(', ')}: set fields on the item or provide defaults`
    );
  }

  const results: BulkUpdateItemResult[] = [];
  let failed = 0;

  for (const { item, changes, fields } of planned) {
    if (stopOnError && failed > 0) {
      results.push({
        id: item.id,
        status: 'skipped',
        reason: 'Skipped because an earlier update failed and stopOnError is enabled',
      });
      continue;
    }

    try {
      const { workPackage: updated, retried } = await updateWithLockRetry(client, item, changes, notify);
      results.push({
        id: item.id,
        status: 'updated',
        appliedChanges: fields,
        subject: updated.subject,
        lockVersion: updated.lockVersion,
        ...(retried ? { retried: true } : {}),
      });
    } catch (error) {
      failed += 1;
      results.push({
        id: item.id,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    summary: {
      requested: updates.length,
      updated: results.filter((result) => result.status === 'updated').length,
      failed,
      skipped: results.filter((result) => result.status === 'skipped').length,
    },
    results,
  };
}
