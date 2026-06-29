/**
 * Unit tests for smart work package search helpers.
 *
 * These run without a live OpenProject instance. They cover the generated API
 * filters and the local fuzzy/related-term ranking used by search_work_packages.
 */

import { describe, expect, test } from 'bun:test';
import type { WorkPackage } from '../src/openproject-client.ts';
import {
  buildWorkPackageSearchFilters,
  mergeWorkPackages,
  parseWorkPackageIdQuery,
  rankProjectMemorySearchResults,
  rankWorkPackageSearchResults,
} from '../src/work-package-search.ts';

function workPackage(
  id: number,
  subject: string,
  description = '',
  links: WorkPackage['_links'] = {}
): WorkPackage {
  return {
    id,
    subject,
    description: description ? { format: 'markdown', raw: description, html: description } : undefined,
    lockVersion: 1,
    scheduleManually: false,
    percentageDone: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    _links: links,
  };
}

describe('buildWorkPackageSearchFilters', () => {
  test('defaults to open work packages and adds OpenProject full-text search', () => {
    expect(JSON.parse(buildWorkPackageSearchFilters({ query: 'login error' }))).toEqual([
      { status: { operator: 'o', values: [] } },
      { search: { operator: '~', values: ['login error'] } },
    ]);
  });

  test('can search closed work packages by sending an empty/base filter instead of the open default', () => {
    expect(JSON.parse(buildWorkPackageSearchFilters({ query: 'archive', includeClosed: true }))).toEqual([
      { search: { operator: '~', values: ['archive'] } },
    ]);
  });

  test('combines explicit status and assignee filters with text search', () => {
    expect(
      JSON.parse(
        buildWorkPackageSearchFilters({
          query: 'invoice',
          statusId: 7,
          assigneeId: 3,
        })
      )
    ).toEqual([
      { status: { operator: '=', values: ['7'] } },
      { assignee: { operator: '=', values: ['3'] } },
      { search: { operator: '~', values: ['invoice'] } },
    ]);
  });

  test('can build a broad candidate filter without full-text search', () => {
    expect(
      JSON.parse(
        buildWorkPackageSearchFilters({
          query: 'invoice',
          statusId: 7,
          assigneeId: 3,
          useFullText: false,
        })
      )
    ).toEqual([
      { status: { operator: '=', values: ['7'] } },
      { assignee: { operator: '=', values: ['3'] } },
    ]);
  });
});

describe('rankWorkPackageSearchResults', () => {
  test('uses related terms so natural wording can match different task vocabulary', () => {
    const results = rankWorkPackageSearchResults(
      [
        workPackage(1, 'Login defect on auth screen', 'SSO users cannot sign in'),
        workPackage(2, 'Payment issue cleanup', 'Tidy checkout copy'),
      ],
      'signin bug'
    );

    expect(results[0]?.id).toBe(1);
    expect(results[0]?.matchReasons.join(' ')).toContain('related subject term');
  });

  test('matches small typos with fuzzy token scoring', () => {
    const results = rankWorkPackageSearchResults(
      [
        workPackage(10, 'Installation checklist for upload service'),
        workPackage(11, 'Payment export report'),
      ],
      'instalation'
    );

    expect(results.map((result) => result.id)).toEqual([10]);
    expect(results[0]?.matchReasons.join(' ')).toContain('fuzzy');
  });

  test('keeps OpenProject full-text candidates even when local fields do not explain the match', () => {
    const results = rankWorkPackageSearchResults(
      [workPackage(21, 'Unrelated title')],
      'custom hidden value',
      {
        serverMatchedIds: new Set([21]),
      }
    );

    expect(results[0]?.id).toBe(21);
    expect(results[0]?.matchReasons).toContain('OpenProject full-text match');
  });

  test('ranks exact work package IDs above text matches', () => {
    const results = rankWorkPackageSearchResults(
      [
        workPackage(42, 'Small cleanup'),
        workPackage(5, 'Fix task #42 mention in description', 'Reference #42 in docs'),
      ],
      '#42'
    );

    expect(results[0]?.id).toBe(42);
    expect(results[0]?.matchReasons).toContain('exact id match');
  });
});

describe('rankProjectMemorySearchResults', () => {
  test('blends local vector similarity with keyword relevance over subject and description', () => {
    const results = rankProjectMemorySearchResults(
      [
        workPackage(1, 'Configure MPGS payment authorization', 'Capture and refund flow for checkout transactions'),
        workPackage(2, 'Polish member dashboard filters', 'Improve report widgets and team summary'),
      ],
      'payment checkout capture'
    );

    expect(results[0]?.id).toBe(1);
    expect(results[0]?.vectorScore).toBeGreaterThan(0);
    expect(results[0]?.keywordScore).toBeGreaterThan(0);
    expect(results[0]?.matchReasons.join(' ')).toContain('local vector similarity');
    expect(results[0]?.semanticTerms).toContain('payment');
  });

  test('uses related query terms in the local vector query', () => {
    const results = rankProjectMemorySearchResults(
      [
        workPackage(10, 'Login defect on auth page', 'Users cannot authenticate with SSO'),
        workPackage(11, 'Invoice export report', 'CSV download for finance'),
      ],
      'signin bug'
    );

    expect(results[0]?.id).toBe(10);
    expect(results[0]?.semanticTerms).toContain('login');
  });
});

describe('mergeWorkPackages', () => {
  test('deduplicates candidates by work package ID with later entries winning', () => {
    const first = workPackage(1, 'Old title');
    const second = workPackage(1, 'New title');

    expect(mergeWorkPackages([first], [second])).toEqual([second]);
  });
});

describe('parseWorkPackageIdQuery', () => {
  test('extracts hashtag ID searches and exact numeric searches', () => {
    expect(parseWorkPackageIdQuery('#42')).toBe(42);
    expect(parseWorkPackageIdQuery('42')).toBe(42);
    expect(parseWorkPackageIdQuery('task #42')).toBe(42);
    expect(parseWorkPackageIdQuery('release 42')).toBeNull();
  });
});
