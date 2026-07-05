import { describe, expect, test } from 'bun:test';
import {
  MAX_AGENT_CONTINUATION_PAGES,
  addAgentPaginationContinuation,
  buildAgentPaginationContinuation,
} from '../src/server-setup.ts';

describe('agent pagination continuation', () => {
  test('builds a continuation hint capped at five pages when more items remain', () => {
    const continuation = buildAgentPaginationContinuation('list_projects', {
      _type: 'Collection',
      total: 125,
      count: 20,
      pageSize: 20,
      offset: 1,
    });

    expect(continuation).toEqual({
      hasMore: true,
      message:
        'More items are available. To continue, call list_projects with offset=2 and pageSize=20. ' +
        'Continue for at most 5 additional pages unless the user asks for more.',
      currentOffset: 1,
      nextOffset: 2,
      pageSize: 20,
      returned: 20,
      total: 125,
      remainingItemsEstimate: 105,
      maxAdditionalPages: MAX_AGENT_CONTINUATION_PAGES,
      suggestedOffsets: [2, 3, 4, 5, 6],
    });
  });

  test('uses embedded element count when the HAL response omits count', () => {
    const continuation = buildAgentPaginationContinuation(
      'list_work_packages',
      {
        _type: 'Collection',
        total: 7,
        pageSize: 2,
        offset: 2,
        _embedded: { elements: [{ id: 3 }, { id: 4 }] },
      },
      { pageSize: 2 }
    );

    expect(continuation?.nextOffset).toBe(3);
    expect(continuation?.suggestedOffsets).toEqual([3, 4]);
    expect(continuation?.remainingItemsEstimate).toBe(3);
  });

  test('does not add a continuation hint for complete lists', () => {
    const result = addAgentPaginationContinuation('list_versions', {
      _type: 'Collection',
      total: 10,
      count: 5,
      pageSize: 5,
      offset: 2,
    });

    expect(result).not.toHaveProperty('agentContinuation');
  });
});
