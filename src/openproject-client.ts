/**
 * OpenProject API Client
 * A typed HTTP client for OpenProject API v3
 */

export interface OpenProjectConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
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

export class OpenProjectClient {
  private config: OpenProjectConfig;
  private headers: Record<string, string>;

  constructor(config: OpenProjectConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl.replace(/\/$/, ''), // Remove trailing slash
      timeout: config.timeout ?? 30000,
    };

    // Basic Auth with API key as username and 'x' as password
    const credentials = Buffer.from(`apikey:${config.apiKey}`).toString('base64');
    this.headers = {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/hal+json',
    };
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
        throw new Error(
          `OpenProject API Error: ${error.message || response.statusText} (${error.errorIdentifier || response.status})`
        );
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.config.timeout}ms`);
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
    }
  ): Promise<HALResponse<WorkPackage>> {
    return this.request('GET', `/projects/${projectId}/work_packages`, undefined, params);
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

export function createClient(): OpenProjectClient {
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
  });
}

