/**
 * OpenProject API Client
 * A typed HTTP client for OpenProject API v3
 */

import logger from './logger.ts';

export interface OpenProjectConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
  caller?: string;
}

export interface HALResponse<T = unknown> {
  _type: string;
  _embedded?: Record<string, unknown>;
  _links: Record<string, { href: string; title?: string }>;
  total?: number;
  count?: number;
  pageSize?: number;
  offset?: number;
  elements?: T[];
}

export interface Project {
  id: number;
  identifier: string;
  name: string;
  description?: { format: string; raw: string; html: string };
  public: boolean;
  active: boolean;
  statusExplanation?: { format: string; raw: string; html: string };
  createdAt: string;
  updatedAt: string;
  _links: Record<string, { href: string; title?: string }>;
}

export interface WorkPackage {
  id: number;
  lockVersion: number;
  subject: string;
  description?: { format: string; raw: string; html: string };
  scheduleManually: boolean;
  startDate?: string;
  dueDate?: string;
  derivedStartDate?: string;
  derivedDueDate?: string;
  estimatedTime?: string;
  derivedEstimatedTime?: string;
  spentTime?: string;
  percentageDone: number;
  createdAt: string;
  updatedAt: string;
  _links: Record<string, { href: string; title?: string }>;
}

export interface User {
  id: number;
  login: string;
  firstName: string;
  lastName: string;
  name: string;
  email?: string;
  admin: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  _links: Record<string, { href: string; title?: string }>;
}

export interface Type {
  id: number;
  name: string;
  color: string;
  position: number;
  isDefault: boolean;
  isMilestone: boolean;
  createdAt: string;
  updatedAt: string;
  _links: Record<string, { href: string; title?: string }>;
}

export interface Status {
  id: number;
  name: string;
  color: string;
  position: number;
  isDefault: boolean;
  isClosed: boolean;
  isReadonly: boolean;
  _links: Record<string, { href: string; title?: string }>;
}

export interface Priority {
  id: number;
  name: string;
  color: string;
  position: number;
  isDefault: boolean;
  isActive: boolean;
  _links: Record<string, { href: string; title?: string }>;
}

export interface MembershipRole {
  id: number;
  name: string;
  _links: Record<string, { href: string; title?: string }>;
}

export interface MembershipPrincipal {
  id: number;
  name: string;
  _type: string;
  [key: string]: unknown;
}

export interface Membership {
  id: number;
  _type: 'Membership';
  createdAt: string;
  updatedAt: string;
  _embedded?: {
    project?: Project;
    principal?: MembershipPrincipal;
    roles?: MembershipRole[];
  };
  _links: Record<string, { href: string; title?: string }>;
}

export interface TimeEntry {
  id: number;
  comment?: { format: string; raw: string; html: string };
  spentOn: string;
  hours: string;
  createdAt: string;
  updatedAt: string;
  _links: Record<string, { href: string; title?: string }>;
}

export interface Version {
  id: number;
  name: string;
  description?: { format: string; raw: string; html: string };
  startDate?: string;
  endDate?: string;
  status: string;
  sharing: string;
  createdAt: string;
  updatedAt: string;
  _links: Record<string, { href: string; title?: string }>;
}

export interface Activity {
  id: number;
  comment?: { format: string; raw: string; html: string };
  version: number;
  createdAt: string;
  _links: Record<string, { href: string; title?: string }>;
}

export interface Attachment {
  id: number;
  fileName: string;
  fileSize: number;
  description?: { format: string; raw: string; html: string };
  contentType: string;
  status: string;
  digest?: { algorithm: string; hash: string };
  createdAt: string;
  _links: Record<string, { href: string; title?: string }>;
}

export interface OpenProjectError {
  _type: 'Error';
  errorIdentifier: string;
  message: string;
  _embedded?: {
    details?: {
      attribute?: string;
    };
  };
}

export interface OpenProjectMultipartBody {
  body: Buffer;
  boundary: string;
  contentType: string;
  contentLength: number;
}

function createMultipartBoundary(): string {
  return `----tonle-openproject-${crypto.randomUUID()}`;
}

function escapeMultipartHeaderValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '_');
}

function assertNoHeaderLineBreaks(value: string, label: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${label} must not contain line breaks`);
  }
}

export function buildOpenProjectMultipartBody(
  fileName: string,
  content: Uint8Array,
  contentType?: string,
  description?: string,
  options: { boundary?: string } = {}
): OpenProjectMultipartBody {
  const boundary = options.boundary ?? createMultipartBoundary();
  const fileType = contentType || 'application/octet-stream';

  assertNoHeaderLineBreaks(boundary, 'multipart boundary');
  assertNoHeaderLineBreaks(fileType, 'attachment contentType');

  const metadata: Record<string, unknown> = { fileName };
  if (description) metadata.description = { raw: description };

  const chunks = [
    Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="metadata"\r\n' +
        'Content-Type: application/json\r\n\r\n' +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${escapeMultipartHeaderValue(fileName)}"\r\n` +
        `Content-Type: ${fileType}\r\n\r\n`,
      'utf8'
    ),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ];

  const body = Buffer.concat(chunks);

  return {
    body,
    boundary,
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: body.byteLength,
  };
}

export class OpenProjectClient {
  private config: OpenProjectConfig;
  private headers: Record<string, string>;
  private caller: string;

  constructor(config: OpenProjectConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl.replace(/\/$/, ''), // Remove trailing slash
      timeout: config.timeout ?? 30000,
    };

    this.caller = config.caller || 'unknown';

    // Basic Auth with API key as username and 'x' as password
    const credentials = Buffer.from(`apikey:${config.apiKey}`).toString('base64');
    this.headers = {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/hal+json',
    };
  }

  setCaller(caller: string): void {
    this.caller = caller;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    const url = new URL(`${this.config.baseUrl}/api/v3${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    // Log the API request
    logger.logApiRequest(this.caller, method, endpoint, params, body);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: this.headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        const error = data as OpenProjectError;
        const errorMessage = `OpenProject API Error: ${error.message || response.statusText} (${error.errorIdentifier || response.status})`;

        // Log the API error
        logger.logApiError(this.caller, method, endpoint, new Error(errorMessage));

        throw new Error(errorMessage);
      }

      // Log the successful API response
      logger.logApiResponse(this.caller, method, endpoint, response.status, data);

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutError = new Error(`Request timeout after ${this.config.timeout}ms`);
        logger.logApiError(this.caller, method, endpoint, timeoutError);
        throw timeoutError;
      }

      // Log any other errors
      if (error instanceof Error) {
        logger.logApiError(this.caller, method, endpoint, error);
      }

      throw error;
    }
  }

  /**
   * Upload raw file content using a `multipart/form-data` request, as required
   * by OpenProject's attachment endpoints. The body is built manually so the
   * JSON metadata part is not serialized as a file upload with `filename=""`;
   * the binary content is never logged (only its metadata).
   */
  private async uploadMultipart<T>(
    endpoint: string,
    fileName: string,
    content: Uint8Array,
    contentType?: string,
    description?: string
  ): Promise<T> {
    const url = `${this.config.baseUrl}/api/v3${endpoint}`;
    const fileType = contentType || 'application/octet-stream';
    const multipart = buildOpenProjectMultipartBody(fileName, content, fileType, description);

    logger.logApiRequest(this.caller, 'POST', endpoint, undefined, {
      fileName,
      contentType: fileType,
      fileSize: content.byteLength,
      description,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': this.headers['Authorization'] ?? '',
          'Accept': 'application/hal+json',
          'Content-Type': multipart.contentType,
          'Content-Length': String(multipart.contentLength),
        } as Record<string, string>,
        body: multipart.body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        const error = data as OpenProjectError;
        const errorMessage = `OpenProject API Error: ${error.message || response.statusText} (${error.errorIdentifier || response.status})`;
        logger.logApiError(this.caller, 'POST', endpoint, new Error(errorMessage));
        throw new Error(errorMessage);
      }

      logger.logApiResponse(this.caller, 'POST', endpoint, response.status, data);

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutError = new Error(`Request timeout after ${this.config.timeout}ms`);
        logger.logApiError(this.caller, 'POST', endpoint, timeoutError);
        throw timeoutError;
      }
      if (error instanceof Error) {
        logger.logApiError(this.caller, 'POST', endpoint, error);
      }
      throw error;
    }
  }

  // ============== Root & Configuration ==============

  async getRoot(): Promise<HALResponse> {
    return this.request('GET', '');
  }

  async getConfiguration(): Promise<HALResponse> {
    return this.request('GET', '/configuration');
  }

  // ============== Projects ==============

  async listProjects(params?: {
    offset?: number;
    pageSize?: number;
    filters?: string;
    sortBy?: string;
  }): Promise<HALResponse<Project>> {
    return this.request('GET', '/projects', undefined, params);
  }

  async getProject(id: number | string): Promise<Project> {
    return this.request('GET', `/projects/${id}`);
  }

  async createProject(data: {
    name: string;
    identifier?: string;
    description?: { raw: string };
    public?: boolean;
    status?: string;
    statusExplanation?: { raw: string };
    parent?: { href: string };
  }): Promise<Project> {
    return this.request('POST', '/projects', data);
  }

  async updateProject(
    id: number | string,
    data: {
      name?: string;
      description?: { raw: string };
      public?: boolean;
      active?: boolean;
      status?: string;
      statusExplanation?: { raw: string };
    }
  ): Promise<Project> {
    return this.request('PATCH', `/projects/${id}`, data);
  }

  async deleteProject(id: number | string): Promise<void> {
    await this.request('DELETE', `/projects/${id}`);
  }

  // ============== Work Packages ==============

  async listWorkPackages(params?: {
    offset?: number;
    pageSize?: number;
    filters?: string;
    sortBy?: string;
    groupBy?: string;
    showSums?: boolean;
    query_id?: number;
    select?: string;
  }): Promise<HALResponse<WorkPackage>> {
    return this.request('GET', '/work_packages', undefined, params);
  }

  async listProjectWorkPackages(
    projectId: number | string,
    params?: {
      offset?: number;
      pageSize?: number;
      filters?: string;
      sortBy?: string;
      query_id?: number;
      select?: string;
    }
  ): Promise<HALResponse<WorkPackage>> {
    return this.request('GET', `/projects/${projectId}/work_packages`, undefined, params);
  }

  /**
   * Fetch every work package matching the given filters, following pagination
   * until the collection is exhausted. Mirrors listAllTimeEntries: OpenProject's
   * `offset` is a 1-based page number, so pages are requested as 1, 2, 3, ...
   * When `projectId` is given the project-scoped endpoint is used instead of
   * the global one.
   */
  async listAllWorkPackages(params?: {
    projectId?: number | string;
    filters?: string;
    sortBy?: string;
    pageSize?: number;
    maxPages?: number;
    select?: string;
  }): Promise<{ workPackages: WorkPackage[]; total: number }> {
    const pageSize = Math.min(Math.max(params?.pageSize ?? 200, 1), 1000);
    const maxPages = params?.maxPages ?? 100;
    const workPackages: WorkPackage[] = [];
    let total = 0;

    for (let offset = 1; offset <= maxPages; offset++) {
      const page = params?.projectId === undefined
        ? await this.listWorkPackages({ offset, pageSize, filters: params?.filters, sortBy: params?.sortBy, select: params?.select })
        : await this.listProjectWorkPackages(params.projectId, { offset, pageSize, filters: params?.filters, sortBy: params?.sortBy, select: params?.select });
      const elements = (page._embedded?.elements as WorkPackage[] | undefined) ?? page.elements ?? [];
      total = page.total ?? workPackages.length + elements.length;
      workPackages.push(...elements);
      if (elements.length === 0 || workPackages.length >= total) break;
    }

    return { workPackages, total };
  }

  async getWorkPackage(id: number): Promise<WorkPackage> {
    return this.request('GET', `/work_packages/${id}`);
  }

  async createWorkPackage(
    projectId: number | string,
    data: {
      subject: string;
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
    },
    notify?: boolean
  ): Promise<WorkPackage> {
    return this.request('POST', `/projects/${projectId}/work_packages`, data, { notify });
  }

  async updateWorkPackage(
    id: number,
    data: {
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
    },
    notify?: boolean
  ): Promise<WorkPackage> {
    return this.request('PATCH', `/work_packages/${id}`, data, { notify });
  }

  async deleteWorkPackage(id: number): Promise<void> {
    await this.request('DELETE', `/work_packages/${id}`);
  }

  async listWorkPackageActivities(id: number): Promise<HALResponse<Activity>> {
    return this.request('GET', `/work_packages/${id}/activities`);
  }

  // ============== Attachments ==============

  /**
   * Attach a file to a work package. Sends a multipart upload to
   * `POST /work_packages/{id}/attachments`. The returned attachment's
   * `/api/v3/attachments/{id}/content` link can be used to embed images inline
   * in the work package description.
   */
  async createWorkPackageAttachment(
    workPackageId: number,
    attachment: { fileName: string; content: Uint8Array; contentType?: string; description?: string }
  ): Promise<Attachment> {
    return this.uploadMultipart(
      `/work_packages/${workPackageId}/attachments`,
      attachment.fileName,
      attachment.content,
      attachment.contentType,
      attachment.description
    );
  }

  async listWorkPackageAttachments(workPackageId: number): Promise<HALResponse<Attachment>> {
    return this.request('GET', `/work_packages/${workPackageId}/attachments`);
  }

  async getAttachment(id: number): Promise<Attachment> {
    return this.request('GET', `/attachments/${id}`);
  }

  async deleteAttachment(id: number): Promise<void> {
    await this.request('DELETE', `/attachments/${id}`);
  }

  // ============== Users ==============

  async listUsers(params?: {
    offset?: number;
    pageSize?: number;
    filters?: string;
    sortBy?: string;
  }): Promise<HALResponse<User>> {
    return this.request('GET', '/users', undefined, params);
  }

  async getUser(id: number | string): Promise<User> {
    return this.request('GET', `/users/${id}`);
  }

  async getCurrentUser(): Promise<User> {
    return this.request('GET', '/users/me');
  }

  async createUser(data: {
    login: string;
    email: string;
    firstName: string;
    lastName: string;
    admin?: boolean;
    language?: string;
    password?: string;
  }): Promise<User> {
    return this.request('POST', '/users', data);
  }

  async updateUser(
    id: number,
    data: {
      login?: string;
      email?: string;
      firstName?: string;
      lastName?: string;
      admin?: boolean;
      language?: string;
    }
  ): Promise<User> {
    return this.request('PATCH', `/users/${id}`, data);
  }

  async deleteUser(id: number): Promise<void> {
    await this.request('DELETE', `/users/${id}`);
  }

  async lockUser(id: number): Promise<User> {
    return this.request('POST', `/users/${id}/lock`);
  }

  async unlockUser(id: number): Promise<User> {
    return this.request('DELETE', `/users/${id}/lock`);
  }

  // ============== Types ==============

  async listTypes(): Promise<HALResponse<Type>> {
    return this.request('GET', '/types');
  }

  async getType(id: number): Promise<Type> {
    return this.request('GET', `/types/${id}`);
  }

  async listProjectTypes(projectId: number | string): Promise<HALResponse<Type>> {
    return this.request('GET', `/projects/${projectId}/types`);
  }

  // ============== Statuses ==============

  async listStatuses(): Promise<HALResponse<Status>> {
    return this.request('GET', '/statuses');
  }

  async getStatus(id: number): Promise<Status> {
    return this.request('GET', `/statuses/${id}`);
  }

  // ============== Priorities ==============

  async listPriorities(): Promise<HALResponse<Priority>> {
    return this.request('GET', '/priorities');
  }

  async getPriority(id: number): Promise<Priority> {
    return this.request('GET', `/priorities/${id}`);
  }

  // ============== Time Entries ==============

  async listTimeEntries(params?: {
    offset?: number;
    pageSize?: number;
    filters?: string;
    sortBy?: string;
  }): Promise<HALResponse<TimeEntry>> {
    return this.request('GET', '/time_entries', undefined, params);
  }

  /**
   * Fetch every time entry matching the given filters, following pagination
   * until the collection is exhausted. OpenProject's `offset` is a 1-based
   * page number, so pages are requested as offset 1, 2, 3, ...
   */
  async listAllTimeEntries(params?: {
    filters?: string;
    pageSize?: number;
    maxPages?: number;
  }): Promise<{ entries: TimeEntry[]; total: number }> {
    const pageSize = Math.min(Math.max(params?.pageSize ?? 1000, 1), 1000);
    const maxPages = params?.maxPages ?? 100;
    const entries: TimeEntry[] = [];
    let total = 0;

    for (let offset = 1; offset <= maxPages; offset++) {
      const page = await this.listTimeEntries({ offset, pageSize, filters: params?.filters });
      const elements = (page._embedded?.elements as TimeEntry[] | undefined) ?? page.elements ?? [];
      total = page.total ?? entries.length + elements.length;
      entries.push(...elements);
      if (elements.length === 0 || entries.length >= total) break;
    }

    return { entries, total };
  }

  async getTimeEntry(id: number): Promise<TimeEntry> {
    return this.request('GET', `/time_entries/${id}`);
  }

  async createTimeEntry(data: {
    _links: {
      project: { href: string };
      workPackage?: { href: string };
      activity: { href: string };
    };
    hours: string;
    spentOn: string;
    comment?: { raw: string };
  }): Promise<TimeEntry> {
    return this.request('POST', '/time_entries', data);
  }

  async updateTimeEntry(
    id: number,
    data: {
      _links?: {
        activity?: { href: string };
      };
      hours?: string;
      spentOn?: string;
      comment?: { raw: string };
    }
  ): Promise<TimeEntry> {
    return this.request('PATCH', `/time_entries/${id}`, data);
  }

  async deleteTimeEntry(id: number): Promise<void> {
    await this.request('DELETE', `/time_entries/${id}`);
  }

  // ============== Versions ==============

  async listVersions(params?: {
    offset?: number;
    pageSize?: number;
    filters?: string;
  }): Promise<HALResponse<Version>> {
    return this.request('GET', '/versions', undefined, params);
  }

  async getVersion(id: number): Promise<Version> {
    return this.request('GET', `/versions/${id}`);
  }

  async listProjectVersions(projectId: number | string): Promise<HALResponse<Version>> {
    return this.request('GET', `/projects/${projectId}/versions`);
  }

  async createVersion(data: {
    name: string;
    _links: {
      definingProject: { href: string };
    };
    description?: { raw: string };
    startDate?: string;
    endDate?: string;
    status?: string;
    sharing?: string;
  }): Promise<Version> {
    return this.request('POST', '/versions', data);
  }

  async updateVersion(
    id: number,
    data: {
      name?: string;
      description?: { raw: string };
      startDate?: string;
      endDate?: string;
      status?: string;
      sharing?: string;
    }
  ): Promise<Version> {
    return this.request('PATCH', `/versions/${id}`, data);
  }

  async deleteVersion(id: number): Promise<void> {
    await this.request('DELETE', `/versions/${id}`);
  }

  // ============== Activities (Journal) ==============

  async getActivity(id: number): Promise<Activity> {
    return this.request('GET', `/activities/${id}`);
  }

  // ============== Principals ==============

  async listPrincipals(params?: {
    offset?: number;
    pageSize?: number;
    filters?: string;
  }): Promise<HALResponse> {
    return this.request('GET', '/principals', undefined, params);
  }

  // ============== Memberships ==============

  async listMemberships(params?: {
    offset?: number;
    pageSize?: number;
    filters?: string;
    sortBy?: string;
  }): Promise<HALResponse<Membership>> {
    return this.request('GET', '/memberships', undefined, params);
  }
}

export function createClient(caller?: string): OpenProjectClient {
  const baseUrl = process.env.OPENPROJECT_URL;
  const apiKey = process.env.OPENPROJECT_API_KEY || process.env.OPENPROJECT_TOKEN;

  if (!baseUrl) {
    throw new Error('OPENPROJECT_URL environment variable is required');
  }

  if (!apiKey) {
    throw new Error('OPENPROJECT_API_KEY or OPENPROJECT_TOKEN environment variable is required');
  }

  return new OpenProjectClient({
    baseUrl,
    apiKey,
    timeout: process.env.OPENPROJECT_TIMEOUT ? parseInt(process.env.OPENPROJECT_TIMEOUT) : 30000,
    caller: caller || 'system',
  });
}
