/**
 * Helpers for smart work package search.
 *
 * OpenProject provides a `search` filter for broad text search. These helpers
 * add bounded local ranking on top so callers get typo tolerance, lightweight
 * related-term matching, and compact result rows without adding a search index
 * or external embedding service.
 */

import type { WorkPackage } from './openproject-client.ts';

export const DEFAULT_WORK_PACKAGE_SEARCH_LIMIT = 25;
export const DEFAULT_WORK_PACKAGE_SEARCH_PAGE_SIZE = 200;
export const DEFAULT_WORK_PACKAGE_SEARCH_MAX_PAGES = 5;
export const DEFAULT_WORK_PACKAGE_SEARCH_MIN_SCORE = 6;
export const DEFAULT_PROJECT_MEMORY_CANDIDATE_LIMIT = 500;
export const DEFAULT_PROJECT_MEMORY_SEARCH_MIN_SCORE = 1;

export const MAX_WORK_PACKAGE_SEARCH_LIMIT = 100;
export const MAX_WORK_PACKAGE_SEARCH_PAGE_SIZE = 1000;
export const MAX_WORK_PACKAGE_SEARCH_MAX_PAGES = 25;
export const MAX_PROJECT_MEMORY_CANDIDATE_LIMIT = 500;

export const PROJECT_MEMORY_SEARCH_SELECT =
  'total,count,pageSize,offset,elements/id,elements/subject,elements/description,elements/updatedAt,self';
export const PROJECT_MEMORY_SEARCH_SORT_BY = JSON.stringify([['updated_at', 'desc']]);

type WorkPackageFilter = Record<string, { operator: string; values: string[] }>;

export interface WorkPackageSearchFilterOptions {
  query?: string;
  statusId?: number;
  assigneeId?: number;
  includeClosed?: boolean;
  useFullText?: boolean;
}

export interface SearchScoreOptions {
  serverMatchedIds?: Set<number>;
  minScore?: number;
  limit?: number;
}

export interface WorkPackageSearchResult {
  id: number;
  subject: string;
  score: number;
  matchReasons: string[];
  matchedTerms: string[];
  projectId: number | null;
  project: string | null;
  assigneeId: number | null;
  assignee: string | null;
  statusId: number | null;
  status: string | null;
  type: string | null;
  priority: string | null;
  updatedAt: string;
  descriptionSnippet: string | null;
}

export interface ProjectMemorySearchResult extends WorkPackageSearchResult {
  vectorScore: number;
  keywordScore: number;
  combinedScore: number;
  semanticTerms: string[];
}

interface SearchDocument {
  subject: string;
  description: string;
  linked: string;
}

interface ScoreAccumulator {
  score: number;
  reasons: Map<string, number>;
  terms: Set<string>;
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'the',
  'this',
  'to',
  'with',
]);

const SYNONYM_GROUPS = [
  ['bug', 'defect', 'issue', 'error', 'problem', 'fault', 'failure'],
  ['login', 'signin', 'signon', 'auth', 'authentication', 'sso'],
  ['signup', 'register', 'registration', 'onboarding'],
  ['search', 'find', 'filter', 'query', 'lookup'],
  ['upload', 'attach', 'attachment', 'file', 'document', 'docs'],
  ['payment', 'billing', 'invoice', 'checkout', 'transaction'],
  ['customer', 'client', 'user', 'member', 'principal'],
  ['task', 'ticket', 'workpackage', 'work', 'package'],
  ['deadline', 'due', 'schedule', 'date', 'timeline'],
  ['sprint', 'iteration', 'milestone', 'version', 'release'],
  ['deploy', 'deployment', 'release', 'publish'],
  ['ui', 'frontend', 'interface', 'screen', 'page', 'view'],
  ['backend', 'api', 'server', 'service', 'endpoint'],
  ['database', 'db', 'storage', 'data'],
  ['permission', 'access', 'role', 'authorization', 'rights'],
  ['report', 'dashboard', 'analytics', 'summary'],
  ['create', 'add', 'new', 'insert'],
  ['update', 'edit', 'change', 'modify'],
  ['delete', 'remove', 'archive'],
  ['improve', 'enhance', 'optimize', 'refactor'],
];

const SYNONYMS = buildSynonymMap(SYNONYM_GROUPS);

export function clampSearchLimit(value: number | undefined): number {
  return clampInt(value, DEFAULT_WORK_PACKAGE_SEARCH_LIMIT, 1, MAX_WORK_PACKAGE_SEARCH_LIMIT);
}

export function clampSearchPageSize(value: number | undefined): number {
  return clampInt(value, DEFAULT_WORK_PACKAGE_SEARCH_PAGE_SIZE, 1, MAX_WORK_PACKAGE_SEARCH_PAGE_SIZE);
}

export function clampSearchMaxPages(value: number | undefined): number {
  return clampInt(value, DEFAULT_WORK_PACKAGE_SEARCH_MAX_PAGES, 1, MAX_WORK_PACKAGE_SEARCH_MAX_PAGES);
}

export function clampProjectMemoryCandidateLimit(value: number | undefined): number {
  return clampInt(value, DEFAULT_PROJECT_MEMORY_CANDIDATE_LIMIT, 1, MAX_PROJECT_MEMORY_CANDIDATE_LIMIT);
}

/**
 * Build OpenProject filters for smart search. When no explicit status is
 * provided, searches keep the existing tool behavior of open work packages only
 * unless `includeClosed` is true.
 */
export function buildWorkPackageSearchFilters(options: WorkPackageSearchFilterOptions): string {
  const filters: WorkPackageFilter[] = [];
  const query = options.query?.trim();

  if (options.statusId !== undefined) {
    filters.push({ status: { operator: '=', values: [String(options.statusId)] } });
  } else if (options.includeClosed !== true) {
    filters.push({ status: { operator: 'o', values: [] } });
  }

  if (options.assigneeId !== undefined) {
    filters.push({ assignee: { operator: '=', values: [String(options.assigneeId)] } });
  }

  if (options.useFullText !== false && query) {
    filters.push({ search: { operator: '~', values: [query] } });
  }

  return JSON.stringify(filters);
}

export function rankWorkPackageSearchResults(
  workPackages: WorkPackage[],
  query: string,
  options: SearchScoreOptions = {}
): WorkPackageSearchResult[] {
  const minScore = options.minScore ?? DEFAULT_WORK_PACKAGE_SEARCH_MIN_SCORE;
  const limit = options.limit ?? DEFAULT_WORK_PACKAGE_SEARCH_LIMIT;
  const serverMatchedIds = options.serverMatchedIds ?? new Set<number>();

  return workPackages
    .map((workPackage) => {
      const score = scoreWorkPackage(workPackage, query, serverMatchedIds.has(workPackage.id));
      return { workPackage, score };
    })
    .filter(({ score }) => score.score >= minScore)
    .sort((a, b) => {
      if (b.score.score !== a.score.score) return b.score.score - a.score.score;
      return a.workPackage.id - b.workPackage.id;
    })
    .slice(0, limit)
    .map(({ workPackage, score }) => toSearchResult(workPackage, score));
}

export function rankProjectMemorySearchResults(
  workPackages: WorkPackage[],
  query: string,
  options: { limit?: number; minScore?: number } = {}
): ProjectMemorySearchResult[] {
  const limit = options.limit ?? DEFAULT_WORK_PACKAGE_SEARCH_LIMIT;
  const minScore = options.minScore ?? DEFAULT_PROJECT_MEMORY_SEARCH_MIN_SCORE;
  const vectorIndex = buildProjectMemoryVectorIndex(workPackages, query);

  return workPackages
    .map((workPackage, index) => {
      const keyword = scoreWorkPackage(workPackage, query, false);
      const vector = scoreVectorSimilarity(vectorIndex, index);
      const keywordScore = Math.min(keyword.score, 100);
      const vectorScore = Math.round(vector.score * 10000) / 100;
      const combinedScore = Math.round((vectorScore * 0.65 + keywordScore * 0.35) * 100) / 100;
      return {
        workPackage,
        keyword,
        vector,
        score: combinedScore,
        result: {
          ...toSearchResult(workPackage, {
            score: combinedScore,
            reasons: mergeReasons(
              vector.score > 0 ? [`local vector similarity: ${vectorScore}`] : [],
              keyword.reasons
            ),
            terms: [...new Set([...keyword.terms, ...vector.terms])].sort(),
          }),
          vectorScore,
          keywordScore,
          combinedScore,
          semanticTerms: vector.terms,
        },
      };
    })
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const bUpdated = Date.parse(b.workPackage.updatedAt ?? '') || 0;
      const aUpdated = Date.parse(a.workPackage.updatedAt ?? '') || 0;
      if (bUpdated !== aUpdated) return bUpdated - aUpdated;
      return a.workPackage.id - b.workPackage.id;
    })
    .slice(0, limit)
    .map(({ result }) => result);
}

export function mergeWorkPackages(...groups: WorkPackage[][]): WorkPackage[] {
  const byId = new Map<number, WorkPackage>();
  for (const group of groups) {
    for (const workPackage of group) {
      byId.set(workPackage.id, workPackage);
    }
  }
  return [...byId.values()];
}

interface ProjectMemoryVectorIndex {
  queryVector: Map<string, number>;
  documentVectors: Map<string, number>[];
}

export function parseWorkPackageIdQuery(query: string): number | null {
  const match = query.match(/#(\d+)\b/) ?? query.trim().match(/^(\d+)$/);
  if (!match?.[1]) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function normalizeSearchText(value: string): string {
  return expandCommonPhrases(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeSearchText(value: string): string[] {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];

  const tokens = normalized
    .split(' ')
    .filter((token) => token.length > 1)
    .filter((token) => !STOP_WORDS.has(token))
    .map(stemToken);

  return [...new Set(tokens)];
}

export function expandSearchTokens(tokens: string[]): string[] {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    const synonyms = SYNONYMS.get(token);
    if (!synonyms) continue;
    for (const synonym of synonyms) {
      expanded.add(synonym);
    }
  }
  return [...expanded];
}

function buildProjectMemoryVectorIndex(workPackages: WorkPackage[], query: string): ProjectMemoryVectorIndex {
  const documents = workPackages.map((workPackage) => {
    const document = buildSearchDocument(workPackage);
    return tokenizeSearchText(`${document.subject} ${document.description}`);
  });
  const documentFrequency = new Map<string, number>();

  for (const tokens of documents) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const documentCount = Math.max(documents.length, 1);
  const idf = (token: string) => Math.log((documentCount + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1;

  return {
    queryVector: weightedTokenVector(buildWeightedQueryTokens(query), idf),
    documentVectors: documents.map((tokens) => weightedTokenVector(weightTokens(tokens), idf)),
  };
}

function scoreVectorSimilarity(
  index: ProjectMemoryVectorIndex,
  documentIndex: number
): { score: number; terms: string[] } {
  const documentVector = index.documentVectors[documentIndex] ?? new Map<string, number>();
  const score = cosineSimilarity(index.queryVector, documentVector);
  const terms = [...index.queryVector.keys()]
    .filter((token) => documentVector.has(token))
    .sort((a, b) => (index.queryVector.get(b) ?? 0) - (index.queryVector.get(a) ?? 0))
    .slice(0, 10);

  return { score, terms };
}

function buildWeightedQueryTokens(query: string): Map<string, number> {
  const originalTokens = tokenizeSearchText(query);
  const weighted = new Map<string, number>();

  for (const token of originalTokens) {
    weighted.set(token, (weighted.get(token) ?? 0) + 1.25);
    const synonyms = SYNONYMS.get(token);
    if (!synonyms) continue;
    for (const synonym of synonyms) {
      weighted.set(synonym, (weighted.get(synonym) ?? 0) + 0.65);
    }
  }

  return weighted;
}

function weightTokens(tokens: string[]): Map<string, number> {
  const weighted = new Map<string, number>();
  for (const token of tokens) {
    weighted.set(token, (weighted.get(token) ?? 0) + 1);
  }
  return weighted;
}

function weightedTokenVector(tokens: Map<string, number>, idf: (token: string) => number): Map<string, number> {
  const vector = new Map<string, number>();
  for (const [token, weight] of tokens) {
    vector.set(token, weight * idf(token));
  }
  return vector;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (const value of a.values()) {
    aNorm += value * value;
  }
  for (const value of b.values()) {
    bNorm += value * value;
  }
  for (const [token, aValue] of a) {
    dot += aValue * (b.get(token) ?? 0);
  }

  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function mergeReasons(...groups: string[][]): string[] {
  return [...new Set(groups.flat())].slice(0, 6);
}

function scoreWorkPackage(workPackage: WorkPackage, query: string, serverMatched: boolean) {
  const document = buildSearchDocument(workPackage);
  const queryPhrase = normalizeSearchText(query);
  const queryTokens = tokenizeSearchText(query);
  const expandedTokens = expandSearchTokens(queryTokens);
  const synonymTokens = expandedTokens.filter((token) => !queryTokens.includes(token));

  const subjectNorm = normalizeSearchText(document.subject);
  const descriptionNorm = normalizeSearchText(document.description);
  const linkedNorm = normalizeSearchText(document.linked);

  const subjectTokens = tokenizeSearchText(document.subject);
  const descriptionTokens = tokenizeSearchText(document.description);
  const linkedTokens = tokenizeSearchText(document.linked);

  const acc: ScoreAccumulator = { score: 0, reasons: new Map(), terms: new Set() };

  if (serverMatched) {
    addScore(acc, 12, 'OpenProject full-text match');
  }

  scoreId(workPackage.id, queryPhrase, acc);

  if (queryPhrase.length >= 3) {
    if (subjectNorm.includes(queryPhrase)) addScore(acc, 80, 'subject phrase match', queryPhrase);
    if (descriptionNorm.includes(queryPhrase)) addScore(acc, 35, 'description phrase match', queryPhrase);
    if (linkedNorm.includes(queryPhrase)) addScore(acc, 20, 'linked field phrase match', queryPhrase);
  }

  for (const token of queryTokens) {
    scoreExactToken(acc, token, subjectTokens, 18, 'subject token match');
    scoreExactToken(acc, token, descriptionTokens, 7, 'description token match');
    scoreExactToken(acc, token, linkedTokens, 5, 'linked field token match');

    scoreFuzzyToken(acc, token, subjectTokens, 11, 'subject fuzzy match');
    scoreFuzzyToken(acc, token, descriptionTokens, 5, 'description fuzzy match');
    scoreFuzzyToken(acc, token, linkedTokens, 4, 'linked field fuzzy match');
  }

  for (const token of synonymTokens) {
    scoreExactToken(acc, token, subjectTokens, 10, 'related subject term');
    scoreExactToken(acc, token, descriptionTokens, 4, 'related description term');
    scoreExactToken(acc, token, linkedTokens, 3, 'related linked term');
  }

  return {
    score: Math.round(acc.score * 100) / 100,
    reasons: [...acc.reasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([reason]) => reason),
    terms: [...acc.terms].sort(),
  };
}

function buildSearchDocument(workPackage: WorkPackage): SearchDocument {
  const links = workPackage._links ?? {};
  return {
    subject: workPackage.subject ?? '',
    description: [
      workPackage.description?.raw ?? '',
      stripHtml(workPackage.description?.html ?? ''),
    ].join(' '),
    linked: [
      links.project?.title,
      links.assignee?.title,
      links.responsible?.title,
      links.status?.title,
      links.type?.title,
      links.priority?.title,
      links.version?.title,
      links.parent?.title,
    ]
      .filter(Boolean)
      .join(' '),
  };
}

function toSearchResult(
  workPackage: WorkPackage,
  score: { score: number; reasons: string[]; terms: string[] }
): WorkPackageSearchResult {
  const links = workPackage._links ?? {};
  const projectId = extractId(links.project?.href, 'projects');
  const assigneeId = extractId(links.assignee?.href, 'users');
  const statusId = extractId(links.status?.href, 'statuses');

  return {
    id: workPackage.id,
    subject: workPackage.subject,
    score: score.score,
    matchReasons: score.reasons,
    matchedTerms: score.terms,
    projectId,
    project: links.project?.title ?? (projectId !== null ? `Project #${projectId}` : null),
    assigneeId,
    assignee: links.assignee?.title ?? null,
    statusId,
    status: links.status?.title ?? (statusId !== null ? `Status #${statusId}` : null),
    type: links.type?.title ?? null,
    priority: links.priority?.title ?? null,
    updatedAt: workPackage.updatedAt,
    descriptionSnippet: createDescriptionSnippet(workPackage.description?.raw ?? stripHtml(workPackage.description?.html ?? '')),
  };
}

function scoreId(id: number, queryPhrase: string, acc: ScoreAccumulator): void {
  if (!queryPhrase) return;
  const idText = String(id);
  const numericTerms = queryPhrase.match(/\d+/g) ?? [];

  for (const term of numericTerms) {
    if (term === idText) {
      addScore(acc, 250, 'exact id match', `#${idText}`);
    } else if (term.length >= 2 && idText.includes(term)) {
      addScore(acc, 20, 'partial id match', term);
    }
  }
}

function scoreExactToken(
  acc: ScoreAccumulator,
  token: string,
  fieldTokens: string[],
  weight: number,
  reason: string
): void {
  if (fieldTokens.includes(token)) {
    addScore(acc, weight, `${reason}: ${token}`, token);
  }
}

function scoreFuzzyToken(
  acc: ScoreAccumulator,
  token: string,
  fieldTokens: string[],
  weight: number,
  reason: string
): void {
  const match = bestFuzzyTokenMatch(token, fieldTokens);
  if (!match) return;
  addScore(acc, weight * match.similarity, `${reason}: ${token} ~ ${match.token}`, match.token);
}

function bestFuzzyTokenMatch(queryToken: string, fieldTokens: string[]): { token: string; similarity: number } | null {
  if (queryToken.length < 4) return null;

  let best: { token: string; similarity: number } | null = null;
  for (const candidate of fieldTokens) {
    if (candidate === queryToken || candidate.length < 4) continue;
    if (Math.abs(candidate.length - queryToken.length) > 3) continue;

    const similarity = normalizedLevenshteinSimilarity(queryToken, candidate);
    const threshold = queryToken.length <= 4 ? 0.78 : 0.68;
    if (similarity >= threshold && (!best || similarity > best.similarity)) {
      best = { token: candidate, similarity };
    }
  }

  return best;
}

function normalizedLevenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length]!;
}

function addScore(acc: ScoreAccumulator, score: number, reason: string, term?: string): void {
  acc.score += score;
  acc.reasons.set(reason, (acc.reasons.get(reason) ?? 0) + score);
  if (term) acc.terms.add(term);
}

function createDescriptionSnippet(description: string): string | null {
  const text = description.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= 220) return text;
  return `${text.slice(0, 217).trimEnd()}...`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractId(href: string | undefined, resource: string): number | null {
  if (!href) return null;
  const match = href.match(new RegExp(`/${resource}/(\\d+)(?:/|$)`));
  return match && match[1] ? Number(match[1]) : null;
}

function expandCommonPhrases(value: string): string {
  return value
    .replace(/\blog[\s_-]?in\b/gi, 'login')
    .replace(/\bsign[\s_-]?in\b/gi, 'signin')
    .replace(/\bsign[\s_-]?on\b/gi, 'signon')
    .replace(/\bsign[\s_-]?up\b/gi, 'signup')
    .replace(/\bwork[\s_-]?package\b/gi, 'workpackage');
}

function stemToken(token: string): string {
  if (token.length <= 3 || token.startsWith('#')) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ing') && token.length > 5) return token.slice(0, -3);
  if (token.endsWith('ed') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (
    token.endsWith('s') &&
    token.length > 4 &&
    !token.endsWith('ss') &&
    !token.endsWith('us') &&
    !token.endsWith('is')
  ) {
    return token.slice(0, -1);
  }
  return token;
}

function buildSynonymMap(groups: string[][]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  for (const group of groups) {
    const tokens = group.map((token) => stemToken(normalizeSearchText(token)));
    for (const token of tokens) {
      const values = map.get(token) ?? new Set<string>();
      for (const synonym of tokens) {
        if (synonym !== token) values.add(synonym);
      }
      map.set(token, values);
    }
  }

  return map;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
