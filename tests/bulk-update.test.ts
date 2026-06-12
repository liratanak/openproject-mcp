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
  listChangedFields,
  mergeWorkPackageChanges,
  type WorkPackageUpdateBody,
  type WorkPackageUpdateClient,
} from '../src/bulk-update.ts';

function makeFakeClient(
  workPackages: Record<number, { lockVersion: number; subject: string }>,
  options?: { failUpdateIds?: number[]; failGetIds?: number[] }
) {
  const getCalls: number[] = [];
  const updateCalls: Array<{ id: number; data: WorkPackageUpdateBody; notify?: boolean }> = [];

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
      if (options?.failUpdateIds?.includes(id)) {
        throw new Error('OpenProject API Error: Update conflict (UpdateConflict)');
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

    expect(updateCalls.map((call) => call.id)).toEqual([101, 102, 103]);
    expect(result.summary).toEqual({ requested: 3, updated: 2, failed: 1, skipped: 0 });
    expect(result.results[1]).toEqual({
      id: 102,
      status: 'failed',
      error: 'OpenProject API Error: Update conflict (UpdateConflict)',
    });
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
