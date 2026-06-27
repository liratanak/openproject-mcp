/**
 * Unit tests for the bulk work package update helpers behind the
 * bulk_update_work_packages tool. A fake in-memory client is used, so no
 * OpenProject instance is required.
 */

import { describe, expect, test } from 'bun:test';
import type { WorkPackage } from '../src/openproject-client.ts';
import {
  buildWorkPackageUpdateBody,
  executeBulkWorkPackageUpdate,
  isLockVersionConflict,
  listChangedFields,
  mergeWorkPackageChanges,
  type WorkPackageUpdateBody,
  type WorkPackageUpdateClient,
} from '../src/bulk-update.ts';

const LOCK_CONFLICT_ERROR =
  'OpenProject API Error: Information has been updated by at least one other user in the meantime (urn:openproject-org:api:v3:errors:UpdateConflict)';

function makeFakeClient(
  workPackages: Record<number, { lockVersion: number; subject: string }>,
  options?: {
    failUpdateIds?: number[];
    failGetIds?: number[];
    /** Throw a lockVersion conflict for the first N PATCH attempts, then succeed. */
    conflictOnceIds?: number[];
    /** Always throw a lockVersion conflict for these IDs. */
    conflictPersistIds?: number[];
  }
) {
  const getCalls: number[] = [];
  const updateCalls: Array<{ id: number; data: WorkPackageUpdateBody; notify?: boolean }> = [];
  const conflictsRemaining = new Map<number, number>();
  for (const id of options?.conflictOnceIds ?? []) conflictsRemaining.set(id, 1);
  for (const id of options?.conflictPersistIds ?? []) conflictsRemaining.set(id, Number.POSITIVE_INFINITY);

  const client: WorkPackageUpdateClient = {
    async getWorkPackage(id) {
      getCalls.push(id);
      const workPackage = workPackages[id];
      if (!workPackage || options?.failGetIds?.includes(id)) {
        throw new Error(`OpenProject API Error: Work package ${id} not found (NotFound)`);
      }
      return { id, subject: workPackage.subject, lockVersion: workPackage.lockVersion } as WorkPackage;
    },
    async updateWorkPackage(id, data, notify) {
      updateCalls.push({ id, data, notify });
      const remainingConflicts = conflictsRemaining.get(id) ?? 0;
      if (remainingConflicts > 0) {
        conflictsRemaining.set(id, remainingConflicts - 1);
        throw new Error(LOCK_CONFLICT_ERROR);
      }
      if (options?.failUpdateIds?.includes(id)) {
        // A non-conflict, non-retryable validation error.
        throw new Error("OpenProject API Error: Subject can't be blank (PropertyConstraintViolation)");
      }
      const workPackage = workPackages[id];
      return {
        id,
        subject: data.subject ?? workPackage?.subject ?? '',
        lockVersion: data.lockVersion + 1,
      } as WorkPackage;
    },
  };

  return { client, getCalls, updateCalls };
}

describe('isLockVersionConflict', () => {
  test('recognizes OpenProject lock conflict errors', () => {
    expect(isLockVersionConflict(new Error(LOCK_CONFLICT_ERROR))).toBe(true);
    expect(isLockVersionConflict(new Error('OpenProject API Error: stale lockVersion (UpdateConflict)'))).toBe(true);
    expect(isLockVersionConflict(new Error('Request failed with status 409'))).toBe(true);
  });

  test('does not treat unrelated errors as conflicts', () => {
    expect(isLockVersionConflict(new Error("OpenProject API Error: Subject can't be blank (PropertyConstraintViolation)"))).toBe(false);
    expect(isLockVersionConflict(new Error('OpenProject API Error: Work package 5 not found (NotFound)'))).toBe(false);
  });
});

describe('mergeWorkPackageChanges', () => {
  test('item fields override defaults, defaults fill the gaps', () => {
    const merged = mergeWorkPackageChanges(
      { statusId: 7, assigneeId: 5 },
      { id: 101, lockVersion: 3, statusId: 8, dueDate: '2026-06-30' }
    );
    expect(merged).toEqual({ statusId: 8, assigneeId: 5, dueDate: '2026-06-30' });
  });

  test('id and lockVersion are never treated as changes', () => {
    const merged = mergeWorkPackageChanges(undefined, { id: 101, lockVersion: 3 });
    expect(merged).toEqual({});
    expect(listChangedFields(merged)).toEqual([]);
  });

  test('percentageDone 0 counts as a change', () => {
    const merged = mergeWorkPackageChanges(undefined, { id: 101, percentageDone: 0 });
    expect(merged).toEqual({ percentageDone: 0 });
    expect(listChangedFields(merged)).toEqual(['percentageDone']);
  });
});

describe('buildWorkPackageUpdateBody', () => {
  test('maps ID fields to _links hrefs and wraps description', () => {
    const body = buildWorkPackageUpdateBody(4, {
      subject: 'New subject',
      description: 'New **description**',
      typeId: 1,
      statusId: 7,
      priorityId: 9,
      assigneeId: 5,
      responsibleId: 6,
      versionId: 11,
      parentId: 99,
      startDate: '2026-06-01',
      dueDate: '2026-06-30',
      estimatedTime: 'PT8H',
      percentageDone: 0,
    });

    expect(body).toEqual({
      lockVersion: 4,
      subject: 'New subject',
      description: { raw: 'New **description**' },
      startDate: '2026-06-01',
      dueDate: '2026-06-30',
      estimatedTime: 'PT8H',
      percentageDone: 0,
      _links: {
        type: { href: '/api/v3/types/1' },
        status: { href: '/api/v3/statuses/7' },
        priority: { href: '/api/v3/priorities/9' },
        assignee: { href: '/api/v3/users/5' },
        responsible: { href: '/api/v3/users/6' },
        version: { href: '/api/v3/versions/11' },
        parent: { href: '/api/v3/work_packages/99' },
      },
    });
  });

  test('omits _links when no relation fields change', () => {
    const body = buildWorkPackageUpdateBody(2, { subject: 'Rename only' });
    expect(body).toEqual({ lockVersion: 2, subject: 'Rename only' });
  });
});

describe('executeBulkWorkPackageUpdate', () => {
  const initial = {
    101: { lockVersion: 3, subject: 'Task A' },
    102: { lockVersion: 1, subject: 'Task B' },
    103: { lockVersion: 8, subject: 'Task C' },
  };

  test('applies shared defaults to every work package with auto-fetched lockVersion', async () => {
    const { client, getCalls, updateCalls } = makeFakeClient(initial);

    const result = await executeBulkWorkPackageUpdate(client, {
      updates: [{ id: 101 }, { id: 102 }, { id: 103 }],
      defaults: { statusId: 7 },
      notify: false,
    });

    expect(getCalls).toEqual([101, 102, 103]);
    expect(updateCalls.map((call) => call.data.lockVersion)).toEqual([3, 1, 8]);
    expect(updateCalls.every((call) => call.data._links?.status?.href === '/api/v3/statuses/7')).toBe(true);
    expect(updateCalls.every((call) => call.notify === false)).toBe(true);

    expect(result.summary).toEqual({ requested: 3, updated: 3, failed: 0, skipped: 0 });
    expect(result.results.map((item) => item.status)).toEqual(['updated', 'updated', 'updated']);
    expect(result.results[0]).toEqual({
      id: 101,
      status: 'updated',
      appliedChanges: ['statusId'],
      subject: 'Task A',
      lockVersion: 4,
    });
  });

  test('per-item fields override defaults', async () => {
    const { client, updateCalls } = makeFakeClient(initial);

    await executeBulkWorkPackageUpdate(client, {
      updates: [{ id: 101 }, { id: 102, statusId: 8 }],
      defaults: { statusId: 7 },
    });

    expect(updateCalls[0]?.data._links?.status?.href).toBe('/api/v3/statuses/7');
    expect(updateCalls[1]?.data._links?.status?.href).toBe('/api/v3/statuses/8');
  });

  test('a provided lockVersion skips the extra fetch', async () => {
    const { client, getCalls, updateCalls } = makeFakeClient(initial);

    await executeBulkWorkPackageUpdate(client, {
      updates: [
        { id: 101, lockVersion: 3, subject: 'Renamed A' },
        { id: 102, subject: 'Renamed B' },
      ],
    });

    expect(getCalls).toEqual([102]);
    expect(updateCalls.map((call) => call.data.lockVersion)).toEqual([3, 1]);
  });

  test('continues after a failure and reports per-item outcomes', async () => {
    const { client, updateCalls } = makeFakeClient(initial, { failUpdateIds: [102] });

    const result = await executeBulkWorkPackageUpdate(client, {
      updates: [{ id: 101 }, { id: 102 }, { id: 103 }],
      defaults: { percentageDone: 100 },
    });

    // A non-conflict failure is not retried, so 102 is attempted exactly once.
    expect(updateCalls.map((call) => call.id)).toEqual([101, 102, 103]);
    expect(result.summary).toEqual({ requested: 3, updated: 2, failed: 1, skipped: 0 });
    expect(result.results[1]).toEqual({
      id: 102,
      status: 'failed',
      error: "OpenProject API Error: Subject can't be blank (PropertyConstraintViolation)",
    });
  });

  test('retries with a refetched lockVersion after a stale-lock conflict, then succeeds', async () => {
    const { client, getCalls, updateCalls } = makeFakeClient(initial, { conflictOnceIds: [102] });

    const result = await executeBulkWorkPackageUpdate(client, {
      updates: [{ id: 101 }, { id: 102 }, { id: 103 }],
      defaults: { statusId: 7 },
    });

    // 102 is fetched again and PATCHed again after the conflict; 101 and 103 once each.
    expect(getCalls).toEqual([101, 102, 102, 103]);
    expect(updateCalls.map((call) => call.id)).toEqual([101, 102, 102, 103]);
    expect(result.summary).toEqual({ requested: 3, updated: 3, failed: 0, skipped: 0 });
    expect(result.results[1]).toEqual({
      id: 102,
      status: 'updated',
      appliedChanges: ['statusId'],
      subject: 'Task B',
      lockVersion: 2,
      retried: true,
    });
  });

  test('retries a stale lockVersion supplied on the item', async () => {
    const { client, getCalls, updateCalls } = makeFakeClient(initial, { conflictOnceIds: [101] });

    const result = await executeBulkWorkPackageUpdate(client, {
      // A stale lockVersion the caller remembered from an earlier read.
      updates: [{ id: 101, lockVersion: 1, statusId: 7 }],
    });

    // First PATCH uses the supplied (stale) version; after the conflict the
    // current version is fetched and the retry uses it.
    expect(getCalls).toEqual([101]);
    expect(updateCalls.map((call) => call.data.lockVersion)).toEqual([1, 3]);
    expect(result.summary).toEqual({ requested: 1, updated: 1, failed: 0, skipped: 0 });
    expect(result.results[0]?.retried).toBe(true);
  });

  test('reports a failure when the lock conflict persists after the retry', async () => {
    const { client, getCalls, updateCalls } = makeFakeClient(initial, { conflictPersistIds: [102] });

    const result = await executeBulkWorkPackageUpdate(client, {
      updates: [{ id: 102, statusId: 7 }],
    });

    // Initial fetch + PATCH (conflict) + refetch + retry PATCH (conflict) → failed.
    expect(getCalls).toEqual([102, 102]);
    expect(updateCalls.length).toBe(2);
    expect(result.summary).toEqual({ requested: 1, updated: 0, failed: 1, skipped: 0 });
    expect(result.results[0]?.status).toBe('failed');
    expect(result.results[0]?.error).toContain('UpdateConflict');
  });

  test('stopOnError skips the remaining work packages after a failure', async () => {
    const { client, getCalls, updateCalls } = makeFakeClient(initial, { failGetIds: [101] });

    const result = await executeBulkWorkPackageUpdate(client, {
      updates: [{ id: 101 }, { id: 102 }, { id: 103 }],
      defaults: { statusId: 7 },
      stopOnError: true,
    });

    expect(getCalls).toEqual([101]);
    expect(updateCalls).toEqual([]);
    expect(result.summary).toEqual({ requested: 3, updated: 0, failed: 1, skipped: 2 });
    expect(result.results.map((item) => item.status)).toEqual(['failed', 'skipped', 'skipped']);
    expect(result.results[1]?.reason).toContain('stopOnError');
  });

  test('rejects duplicate IDs before any API call', async () => {
    const { client, getCalls, updateCalls } = makeFakeClient(initial);

    await expect(
      executeBulkWorkPackageUpdate(client, {
        updates: [{ id: 101 }, { id: 101 }],
        defaults: { statusId: 7 },
      })
    ).rejects.toThrow('Duplicate work package IDs in updates: 101');
    expect(getCalls).toEqual([]);
    expect(updateCalls).toEqual([]);
  });

  test('rejects items with no effective changes before any API call', async () => {
    const { client, getCalls, updateCalls } = makeFakeClient(initial);

    await expect(
      executeBulkWorkPackageUpdate(client, {
        updates: [{ id: 101, subject: 'Renamed' }, { id: 102 }, { id: 103 }],
      })
    ).rejects.toThrow('No changes specified for work package(s) 102, 103');
    expect(getCalls).toEqual([]);
    expect(updateCalls).toEqual([]);
  });

  test('rejects an empty updates list', async () => {
    const { client } = makeFakeClient(initial);
    await expect(executeBulkWorkPackageUpdate(client, { updates: [] })).rejects.toThrow(
      'at least one work package'
    );
  });
});
