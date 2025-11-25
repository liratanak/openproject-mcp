
# Tonle OpenProject MCP Server
## A Model Context Protocol Server for OpenProject - Open Source Project Management Software

---

## Project Overview

### Vision Statement

The **OpenProject MCP Server** is a comprehensive Model Context Protocol (MCP) server that provides seamless integration between AI assistants (such as Claude, Cursor, Windsurf, and other MCP-compatible clients) and OpenProject, the leading open-source project management software. This server enables AI agents to perform the full spectrum of project management operations through OpenProject's API v3, making it possible to automate, query, and manage all aspects of project management through natural language interactions.

### What is OpenProject?

OpenProject is an open-source project management software supporting classic, agile, and hybrid project management methodologies. It provides:

- **Task Management**: Work packages with customizable types, statuses, and workflows
- **Gantt Charts**: Visual project timelines and scheduling
- **Boards**: Kanban-style boards for agile workflows
- **Team Collaboration**: User management, memberships, and notifications
- **Time & Cost Reporting**: Time tracking and budget management
- **Document Management**: Wiki pages, attachments, and file storage integrations
- **Repository Integration**: Version control and revision tracking

### What is MCP (Model Context Protocol)?

The Model Context Protocol, developed by Anthropic, is an open standard that enables AI applications to connect to external data sources and tools in a standardized way. MCP provides:

- **Standardized Communication**: JSON-RPC 2.0 based protocol for consistent interactions
- **Universal Compatibility**: One integration works with any MCP-compatible AI client
- **Three Core Primitives**: Tools (actions), Resources (data), and Prompts (templates)
- **Secure Data Access**: Controlled, authenticated access to external systems

---

## Project Goals

### Primary Objectives

1. **Complete API Coverage**: Implement tools for every OpenProject API v3 endpoint, ensuring no functionality is left inaccessible
2. **Intuitive Tool Design**: Create well-named, well-documented tools that AI agents can effectively discover and use
3. **Production-Ready Quality**: Build a robust, secure, and performant server suitable for enterprise deployment
4. **Extensibility**: Design an architecture that can easily accommodate future OpenProject API expansions

### Target Users

- **Development Teams**: Automate project management tasks through AI-assisted workflows
- **Project Managers**: Query project status, generate reports, and manage resources via natural language
- **DevOps Engineers**: Integrate project management into CI/CD pipelines and automation scripts
- **Enterprise Organizations**: Enable AI-driven project management at scale

---

## Technical Architecture

### Technology Stack

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```


```
┌─────────────────────────────────────────────────────────────┐
│                    MCP-Compatible Clients                    │
│         (Claude Desktop, Cursor, Windsurf, etc.)            │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ MCP Protocol (JSON-RPC 2.0)
                              │
┌─────────────────────────────────────────────────────────────┐
│                  OpenProject MCP Server                      │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    Transport Layer                       ││
│  │         (Stdio / Streamable HTTP / WebSocket)           ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   MCP Server Core                        ││
│  │    (@modelcontextprotocol/sdk TypeScript SDK)           ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   Tool Registry                          ││
│  │      (Tool definitions, schemas, handlers)              ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │                Resource Provider                         ││
│  │   (Dynamic data exposure for projects, users, etc.)     ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │               OpenProject API Client                     ││
│  │        (HAL+JSON API v3 communication layer)            ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS (HAL+JSON)
                              │
┌─────────────────────────────────────────────────────────────┐
│                   OpenProject Instance                       │
│                      (API v3 Endpoints)                      │
└─────────────────────────────────────────────────────────────┘
```

### Core Technologies

| Component | Technology | Purpose |
|-----------|------------|---------|
| Runtime | Bun | Server execution environment |
| Language | TypeScript 5.x | Type-safe development |
| MCP SDK | @modelcontextprotocol/sdk | MCP protocol implementation |
| Validation | Zod | Runtime schema validation |
| HTTP Client | Axios/Fetch | OpenProject API communication |
| Testing | Vitest | Unit and integration testing |
| Documentation | TypeDoc | API documentation generation |

### Transport Options

The server supports multiple transport mechanisms:

1. **Stdio Transport**: For local development and Claude Desktop integration
2. **Streamable HTTP Transport**: For remote deployments and web-based clients
3. **SSE (Server-Sent Events)**: For real-time notifications and streaming responses

---

## OpenProject API v3 - Complete Endpoint Coverage

### API Fundamentals

The OpenProject API v3 is a hypermedia REST API using HAL+JSON format. Key characteristics:

- **Base URL**: `/api/v3/`
- **Authentication**: OAuth2, Session-based, or Basic Auth (API key)
- **Response Format**: HAL+JSON with embedded resources and links
- **Pagination**: Offset-based with configurable page size (max 1000)
- **Filtering**: JSON-based filter expressions
- **Sorting**: JSON-based sort criteria

### Complete Endpoint Categories

The MCP server implements tools for **all** OpenProject API v3 endpoints organized into the following categories:

---

#### 1. Work Packages (Core Project Tasks)

Work packages are the fundamental unit of work in OpenProject, representing tasks, features, bugs, milestones, and other work items.

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_work_packages` | GET | `/api/v3/work_packages` | List all work packages with filtering |
| `get_work_package` | GET | `/api/v3/work_packages/{id}` | Get a single work package |
| `create_work_package` | POST | `/api/v3/work_packages` | Create a new work package |
| `update_work_package` | PATCH | `/api/v3/work_packages/{id}` | Update an existing work package |
| `delete_work_package` | DELETE | `/api/v3/work_packages/{id}` | Delete a work package |
| `get_work_package_form` | POST | `/api/v3/work_packages/form` | Get form for creating work packages |
| `get_work_package_update_form` | POST | `/api/v3/work_packages/{id}/form` | Get form for updating work packages |
| `list_project_work_packages` | GET | `/api/v3/projects/{id}/work_packages` | List work packages in a project |
| `create_project_work_package` | POST | `/api/v3/projects/{id}/work_packages` | Create work package in a project |
| `get_work_package_schema` | GET | `/api/v3/work_packages/schemas/{id}` | Get work package schema |
| `list_work_package_schemas` | GET | `/api/v3/work_packages/schemas` | List all work package schemas |
| `get_available_watchers` | GET | `/api/v3/work_packages/{id}/available_watchers` | Get users who can watch |
| `list_watchers` | GET | `/api/v3/work_packages/{id}/watchers` | List work package watchers |
| `add_watcher` | POST | `/api/v3/work_packages/{id}/watchers` | Add a watcher |
| `remove_watcher` | DELETE | `/api/v3/work_packages/{id}/watchers/{user_id}` | Remove a watcher |
| `list_available_assignees` | GET | `/api/v3/projects/{id}/available_assignees` | Get assignable users |
| `list_available_responsibles` | GET | `/api/v3/projects/{id}/available_responsibles` | Get responsible users |
| `execute_custom_action` | POST | `/api/v3/work_packages/{id}/custom_actions/{action_id}/execute` | Execute custom action |

**Supported Work Package Properties:**
- Subject, description, type, status, priority
- Assignee, responsible, author
- Start date, due date, estimated time, remaining time
- Percentage done, spent time
- Parent work package, children
- Project, version, category
- Custom fields (customFieldN)
- Attachments, relations, watchers

---

#### 2. Projects

Projects are containers that organize work packages, members, and other resources.

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_projects` | GET | `/api/v3/projects` | List all visible projects |
| `get_project` | GET | `/api/v3/projects/{id}` | Get a single project |
| `create_project` | POST | `/api/v3/projects` | Create a new project |
| `update_project` | PATCH | `/api/v3/projects/{id}` | Update a project |
| `delete_project` | DELETE | `/api/v3/projects/{id}` | Delete a project |
| `get_project_form` | POST | `/api/v3/projects/form` | Get form for creating projects |
| `get_project_update_form` | POST | `/api/v3/projects/{id}/form` | Get form for updating projects |
| `copy_project` | POST | `/api/v3/projects/{id}/copy` | Copy an existing project |
| `list_project_statuses` | GET | `/api/v3/project_statuses` | List available project statuses |
| `get_project_status` | GET | `/api/v3/project_statuses/{id}` | Get a project status |

**Supported Project Properties:**
- Name, identifier, description
- Public/private visibility
- Active status
- Parent project
- Status (on_track, at_risk, off_track)
- Status explanation
- Custom fields

---

#### 3. Users & Authentication

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_users` | GET | `/api/v3/users` | List all users |
| `get_user` | GET | `/api/v3/users/{id}` | Get a single user |
| `create_user` | POST | `/api/v3/users` | Create a new user |
| `update_user` | PATCH | `/api/v3/users/{id}` | Update a user |
| `delete_user` | DELETE | `/api/v3/users/{id}` | Delete a user |
| `lock_user` | POST | `/api/v3/users/{id}/lock` | Lock a user account |
| `unlock_user` | DELETE | `/api/v3/users/{id}/lock` | Unlock a user account |
| `get_current_user` | GET | `/api/v3/users/me` | Get the authenticated user |

**User Properties:**
- Login, email, first name, last name
- Admin status
- Status (active, registered, locked, invited)
- Avatar, language preference
- Identity URL (for SSO)

---

#### 4. Groups

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_groups` | GET | `/api/v3/groups` | List all groups |
| `get_group` | GET | `/api/v3/groups/{id}` | Get a single group |
| `create_group` | POST | `/api/v3/groups` | Create a new group |
| `update_group` | PATCH | `/api/v3/groups/{id}` | Update a group |
| `delete_group` | DELETE | `/api/v3/groups/{id}` | Delete a group |

---

#### 5. Principals (Users, Groups, Placeholder Users)

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_principals` | GET | `/api/v3/principals` | List all principals |
| `list_placeholder_users` | GET | `/api/v3/placeholder_users` | List placeholder users |
| `get_placeholder_user` | GET | `/api/v3/placeholder_users/{id}` | Get a placeholder user |
| `create_placeholder_user` | POST | `/api/v3/placeholder_users` | Create placeholder user |
| `update_placeholder_user` | PATCH | `/api/v3/placeholder_users/{id}` | Update placeholder user |
| `delete_placeholder_user` | DELETE | `/api/v3/placeholder_users/{id}` | Delete placeholder user |

---

#### 6. Memberships

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_memberships` | GET | `/api/v3/memberships` | List all memberships |
| `list_project_members` | GET | `/api/v3/memberships?filters=[{"project":{"operator":"=","values":["{projectId}"]}}]` | List members within a project |
| `list_work_package_members` | GET | `/api/v3/memberships?filters=[{"project":{"operator":"=","values":["project_of_work_package"]}}]` | List members of the project owning a work package |
| `get_membership` | GET | `/api/v3/memberships/{id}` | Get a single membership |
| `create_membership` | POST | `/api/v3/memberships` | Create a membership |
| `update_membership` | PATCH | `/api/v3/memberships/{id}` | Update a membership |
| `delete_membership` | DELETE | `/api/v3/memberships/{id}` | Delete a membership |
| `get_membership_form` | POST | `/api/v3/memberships/form` | Get form for memberships |
| `get_membership_schema` | GET | `/api/v3/memberships/schema` | Get membership schema |

**Membership Features:**
- Custom notification messages on create/update
- Multiple role assignment
- Project-specific permissions

---

#### 7. Roles

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_roles` | GET | `/api/v3/roles` | List all roles |
| `get_role` | GET | `/api/v3/roles/{id}` | Get a single role |

---

#### 8. Time Entries

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_time_entries` | GET | `/api/v3/time_entries` | List all time entries |
| `get_time_entry` | GET | `/api/v3/time_entries/{id}` | Get a single time entry |
| `create_time_entry` | POST | `/api/v3/time_entries` | Create a time entry |
| `update_time_entry` | PATCH | `/api/v3/time_entries/{id}` | Update a time entry |
| `delete_time_entry` | DELETE | `/api/v3/time_entries/{id}` | Delete a time entry |
| `get_time_entry_form` | POST | `/api/v3/time_entries/form` | Get form for time entries |
| `get_time_entry_schema` | GET | `/api/v3/time_entries/schema` | Get time entry schema |

---

#### 9. Time Entry Activities

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `get_time_entry_activity` | GET | `/api/v3/time_entries/activities/{id}` | Get a time entry activity |

---

#### 10. Activities (Journal Entries)

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `get_activity` | GET | `/api/v3/activities/{id}` | Get an activity |
| `update_activity` | PATCH | `/api/v3/activities/{id}` | Update activity comment |
| `list_work_package_activities` | GET | `/api/v3/work_packages/{id}/activities` | List work package activities |

**Activity Features:**
- Internal/external visibility
- Attachments on comments
- Emoji reactions

---

#### 11. Attachments

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `get_attachment` | GET | `/api/v3/attachments/{id}` | Get an attachment |
| `delete_attachment` | DELETE | `/api/v3/attachments/{id}` | Delete an attachment |
| `upload_attachment` | POST | `/api/v3/attachments` | Upload a new attachment |
| `list_work_package_attachments` | GET | `/api/v3/work_packages/{id}/attachments` | List work package attachments |
| `add_work_package_attachment` | POST | `/api/v3/work_packages/{id}/attachments` | Add attachment to work package |
| `list_activity_attachments` | GET | `/api/v3/activities/{id}/attachments` | List activity attachments |
| `add_activity_attachment` | POST | `/api/v3/activities/{id}/attachments` | Add attachment to activity |

**Attachment Features:**
- Multipart upload with metadata
- Containerless attachments (upload then claim)
- Download location links
- Content type and file size information

---

#### 12. Versions (Releases/Milestones)

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_versions` | GET | `/api/v3/versions` | List all versions |
| `get_version` | GET | `/api/v3/versions/{id}` | Get a single version |
| `create_version` | POST | `/api/v3/versions` | Create a version |
| `update_version` | PATCH | `/api/v3/versions/{id}` | Update a version |
| `delete_version` | DELETE | `/api/v3/versions/{id}` | Delete a version |
| `list_project_versions` | GET | `/api/v3/projects/{id}/versions` | List project versions |
| `get_version_form` | POST | `/api/v3/versions/form` | Get form for versions |
| `get_available_projects_for_versions` | GET | `/api/v3/versions/available_projects` | Get projects for version creation |

**Version Properties:**
- Name, description, status
- Start date, end date
- Sharing scope (none, descendants, hierarchy, tree, system)
- Custom fields

---

#### 13. Categories

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_categories` | GET | `/api/v3/categories` | List all categories |
| `get_category` | GET | `/api/v3/categories/{id}` | Get a single category |
| `list_project_categories` | GET | `/api/v3/projects/{id}/categories` | List project categories |

---

#### 14. Types (Work Package Types)

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_types` | GET | `/api/v3/types` | List all work package types |
| `get_type` | GET | `/api/v3/types/{id}` | Get a single type |
| `list_project_types` | GET | `/api/v3/projects/{id}/types` | List types available in a project |

**Type Properties:**
- Name, color, position
- Is default, is milestone
- Attribute groups and visibility

---

#### 15. Statuses (Work Package Statuses)

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_statuses` | GET | `/api/v3/statuses` | List all statuses |
| `get_status` | GET | `/api/v3/statuses/{id}` | Get a single status |

**Status Properties:**
- Name, color, position
- Is closed, is default, is readonly

---

#### 16. Priorities

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_priorities` | GET | `/api/v3/priorities` | List all priorities |
| `get_priority` | GET | `/api/v3/priorities/{id}` | Get a single priority |

---

#### 17. Relations

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_relations` | GET | `/api/v3/relations` | List all relations |
| `get_relation` | GET | `/api/v3/relations/{id}` | Get a single relation |
| `create_relation` | POST | `/api/v3/relations` | Create a relation |
| `update_relation` | PATCH | `/api/v3/relations/{id}` | Update a relation |
| `delete_relation` | DELETE | `/api/v3/relations/{id}` | Delete a relation |
| `list_work_package_relations` | GET | `/api/v3/work_packages/{id}/relations` | List work package relations |

**Relation Types:**
- relates, duplicates, duplicated, blocks, blocked
- precedes, follows, includes, partof, requires, required

---

#### 18. Queries (Saved Filters)

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_queries` | GET | `/api/v3/queries` | List all queries |
| `get_query` | GET | `/api/v3/queries/{id}` | Get a single query |
| `create_query` | POST | `/api/v3/queries` | Create a query |
| `update_query` | PATCH | `/api/v3/queries/{id}` | Update a query |
| `delete_query` | DELETE | `/api/v3/queries/{id}` | Delete a query |
| `get_default_query` | GET | `/api/v3/queries/default` | Get the default query |
| `star_query` | PATCH | `/api/v3/queries/{id}/star` | Star a query |
| `unstar_query` | PATCH | `/api/v3/queries/{id}/unstar` | Unstar a query |

---

#### 19. Query Filters, Columns, Operators, Sort Bys

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_query_filters` | GET | `/api/v3/queries/filters` | List available filters |
| `get_query_filter` | GET | `/api/v3/queries/filters/{id}` | Get a single filter |
| `list_query_columns` | GET | `/api/v3/queries/columns` | List available columns |
| `get_query_column` | GET | `/api/v3/queries/columns/{id}` | Get a single column |
| `list_query_operators` | GET | `/api/v3/queries/operators` | List available operators |
| `get_query_operator` | GET | `/api/v3/queries/operators/{id}` | Get a single operator |
| `list_query_sort_bys` | GET | `/api/v3/queries/sort_bys` | List available sort options |
| `get_query_sort_by` | GET | `/api/v3/queries/sort_bys/{id}` | Get a single sort option |
| `get_query_filter_instance_schema` | GET | `/api/v3/queries/filter_instance_schemas/{id}` | Get filter instance schema |

---

#### 20. Views

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_views` | GET | `/api/v3/views` | List all views |
| `get_view` | GET | `/api/v3/views/{id}` | Get a single view |
| `create_work_packages_table_view` | POST | `/api/v3/views/work_packages_table` | Create table view |
| `create_team_planner_view` | POST | `/api/v3/views/team_planner` | Create team planner view |
| `create_gantt_view` | POST | `/api/v3/views/gantt` | Create Gantt view |

---

#### 21. Notifications

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_notifications` | GET | `/api/v3/notifications` | List all notifications |
| `get_notification` | GET | `/api/v3/notifications/{id}` | Get a single notification |
| `mark_notification_read` | POST | `/api/v3/notifications/{id}/read_ian` | Mark as read |
| `mark_notification_unread` | POST | `/api/v3/notifications/{id}/unread_ian` | Mark as unread |
| `mark_all_notifications_read` | POST | `/api/v3/notifications/read_ian` | Mark all as read |
| `mark_all_notifications_unread` | POST | `/api/v3/notifications/unread_ian` | Mark all as unread |

**Notification Reasons:**
- mentioned, assigned, responsible, watched
- dateAlert, commented, created, scheduled

---

#### 22. News

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_news` | GET | `/api/v3/news` | List all news articles |
| `get_news` | GET | `/api/v3/news/{id}` | Get a single news article |
| `list_project_news` | GET | `/api/v3/projects/{id}/news` | List project news |

---

#### 23. Posts (Forum Messages)

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `get_post` | GET | `/api/v3/posts/{id}` | Get a forum post |

---

#### 24. Wiki Pages

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `get_wiki_page` | GET | `/api/v3/wiki_pages/{id}` | Get a wiki page |
| `update_wiki_page` | PUT | `/api/v3/wiki_pages/{id}` | Update a wiki page |

---

#### 25. Documents

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_documents` | GET | `/api/v3/documents` | List all documents |
| `get_document` | GET | `/api/v3/documents/{id}` | Get a single document |
| `list_project_documents` | GET | `/api/v3/projects/{id}/documents` | List project documents |

---

#### 26. Budgets

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `get_budget` | GET | `/api/v3/budgets/{id}` | Get a single budget |
| `list_project_budgets` | GET | `/api/v3/projects/{id}/budgets` | List project budgets |

---

#### 27. Revisions (Repository Commits)

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `get_revision` | GET | `/api/v3/revisions/{id}` | Get a revision |
| `list_work_package_revisions` | GET | `/api/v3/work_packages/{id}/revisions` | List work package revisions |

---

#### 28. File Links & Storages (External File Integration)

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_storages` | GET | `/api/v3/storages` | List all storages |
| `get_storage` | GET | `/api/v3/storages/{id}` | Get a single storage |
| `create_storage` | POST | `/api/v3/storages` | Create a storage |
| `update_storage` | PATCH | `/api/v3/storages/{id}` | Update a storage |
| `delete_storage` | DELETE | `/api/v3/storages/{id}` | Delete a storage |
| `create_oauth_client_credentials` | POST | `/api/v3/storages/{id}/oauth_client_credentials` | Create OAuth credentials |
| `list_project_storages` | GET | `/api/v3/project_storages` | List project storages |
| `get_project_storage` | GET | `/api/v3/project_storages/{id}` | Get a project storage |
| `list_file_links` | GET | `/api/v3/work_packages/{id}/file_links` | List file links |
| `create_file_link` | POST | `/api/v3/work_packages/{id}/file_links` | Create a file link |
| `get_file_link` | GET | `/api/v3/file_links/{id}` | Get a file link |
| `delete_file_link` | DELETE | `/api/v3/file_links/{id}` | Delete a file link |

**Supported Storage Types:**
- Nextcloud
- OneDrive/SharePoint

---

#### 29. Grids (Dashboard Layouts)

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_grids` | GET | `/api/v3/grids` | List all grids |
| `get_grid` | GET | `/api/v3/grids/{id}` | Get a single grid |
| `create_grid` | POST | `/api/v3/grids` | Create a grid |
| `update_grid` | PATCH | `/api/v3/grids/{id}` | Update a grid |
| `get_grid_form` | POST | `/api/v3/grids/form` | Get form for grids |

**Grid Widgets:**
- time_entries_current_user
- news, documents
- work_packages_table
- and more...

---

#### 30. Work Schedule (Days & Non-Working Days)

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_days` | GET | `/api/v3/days` | List days with working status |
| `get_day` | GET | `/api/v3/days/{date}` | Get a single day |
| `list_week_days` | GET | `/api/v3/days/week` | List week days |
| `get_week_day` | GET | `/api/v3/days/week/{day}` | Get a week day |
| `update_week_days` | PATCH | `/api/v3/days/week` | Update week day settings |
| `list_non_working_days` | GET | `/api/v3/days/non_working` | List non-working days |
| `get_non_working_day` | GET | `/api/v3/days/non_working/{date}` | Get a non-working day |
| `create_non_working_day` | POST | `/api/v3/days/non_working` | Create non-working day |
| `update_non_working_day` | PATCH | `/api/v3/days/non_working/{date}` | Update non-working day |
| `delete_non_working_day` | DELETE | `/api/v3/days/non_working/{date}` | Delete non-working day |

---

#### 31. Actions & Capabilities

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_actions` | GET | `/api/v3/actions` | List all actions |
| `get_action` | GET | `/api/v3/actions/{id}` | Get a single action |
| `list_capabilities` | GET | `/api/v3/capabilities` | List user capabilities |
| `get_capability` | GET | `/api/v3/capabilities/{id}` | Get a capability |

---

#### 32. Custom Actions

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `get_custom_action` | GET | `/api/v3/custom_actions/{id}` | Get a custom action |
| `execute_custom_action` | POST | `/api/v3/custom_actions/{id}/execute` | Execute custom action |

---

#### 33. Custom Options (Custom Field Values)

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `get_custom_option` | GET | `/api/v3/custom_options/{id}` | Get a custom option |

---

#### 34. Help Texts

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_help_texts` | GET | `/api/v3/help_texts` | List all help texts |
| `get_help_text` | GET | `/api/v3/help_texts/{id}` | Get a single help text |

---

#### 35. Project Phases & Definitions

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_project_phases` | GET | `/api/v3/project_phases` | List project phases |
| `get_project_phase` | GET | `/api/v3/project_phases/{id}` | Get a project phase |
| `list_project_phase_definitions` | GET | `/api/v3/project_phase_definitions` | List phase definitions |
| `get_project_phase_definition` | GET | `/api/v3/project_phase_definitions/{id}` | Get phase definition |

---

#### 36. Previewing (Markup Preview)

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `preview_markup` | POST | `/api/v3/render/markdown` | Preview markdown |
| `preview_plain` | POST | `/api/v3/render/plain` | Preview plain text |

---

#### 37. Schemas

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `get_schema` | GET | `/api/v3/schemas/{schema_id}` | Get a specific schema |

---

#### 38. User Preferences

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `get_user_preferences` | GET | `/api/v3/my_preferences` | Get current user preferences |
| `update_user_preferences` | PATCH | `/api/v3/my_preferences` | Update user preferences |

---

#### 39. Values (String Objects)

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `get_string_object` | GET | `/api/v3/string_objects` | Get string object value |

---

#### 40. Root & Configuration

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `get_root` | GET | `/api/v3` | Get API root |
| `get_configuration` | GET | `/api/v3/configuration` | Get instance configuration |

**Configuration Properties:**
- Maximum attachment file size
- Host name
- Per-page options
- Duration format
- Active feature flags

---

#### 41. OAuth 2.0

| Tool Name | HTTP Method | Endpoint | Description |
|-----------|-------------|----------|-------------|
| `list_oauth_applications` | GET | `/api/v3/oauth_applications` | List OAuth applications |
| `get_oauth_application` | GET | `/api/v3/oauth_applications/{id}` | Get OAuth application |
| `create_oauth_application` | POST | `/api/v3/oauth_applications` | Create OAuth application |
| `delete_oauth_application` | DELETE | `/api/v3/oauth_applications/{id}` | Delete OAuth application |
| `list_oauth_client_credentials` | GET | `/api/v3/oauth_client_credentials` | List client credentials |

---

## MCP Server Implementation Details

### Tool Implementation Pattern

Each tool follows a consistent implementation pattern:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Tool registration example
server.registerTool(
  'create_work_package',
  {
    title: 'Create Work Package',
    description: 'Creates a new work package in OpenProject with specified properties',
    inputSchema: {
      project_id: z.number().describe('The ID of the project'),
      subject: z.string().describe('The subject/title of the work package'),
      type_id: z.number().optional().describe('The work package type ID'),
      description: z.string().optional().describe('Detailed description (supports markdown)'),
      assignee_id: z.number().optional().describe('User ID of the assignee'),
      priority_id: z.number().optional().describe('Priority ID'),
      start_date: z.string().optional().describe('Start date (ISO 8601)'),
      due_date: z.string().optional().describe('Due date (ISO 8601)'),
      estimated_hours: z.number().optional().describe('Estimated hours'),
      notify: z.boolean().optional().default(true).describe('Send notifications'),
    },
    outputSchema: {
      id: z.number(),
      subject: z.string(),
      project: z.object({ id: z.number(), name: z.string() }),
      status: z.object({ id: z.number(), name: z.string() }),
      _links: z.object({
        self: z.object({ href: z.string() })
      })
    }
  },
  async (params) => {
    const response = await openProjectClient.createWorkPackage(params);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  }
);
```

### Resource Implementation

Resources provide read-only access to OpenProject data:

```typescript
// Resource registration example
server.resource(
  'projects',
  'openproject://projects',
  {
    name: 'OpenProject Projects',
    description: 'List of all accessible projects',
    mimeType: 'application/json'
  },
  async () => {
    const projects = await openProjectClient.listProjects();
    return {
      contents: [{
        uri: 'openproject://projects',
        mimeType: 'application/json',
        text: JSON.stringify(projects, null, 2)
      }]
    };
  }
);
```

### Prompt Templates

Pre-built prompts for common operations:

```typescript
// Prompt registration example
server.prompt(
  'create_sprint_backlog',
  {
    name: 'Create Sprint Backlog',
    description: 'Template for creating work packages for a sprint',
    arguments: [
      { name: 'project_id', description: 'Project ID', required: true },
      { name: 'sprint_name', description: 'Sprint name', required: true },
      { name: 'tasks', description: 'JSON array of task titles', required: true }
    ]
  },
  async ({ project_id, sprint_name, tasks }) => {
    return {
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Create work packages in project ${project_id} for sprint "${sprint_name}" with these tasks: ${tasks}`
        }
      }]
    };
  }
);
```

---

## Configuration

### Prerequisites

Before configuring the MCP server, ensure you have:

1. **Bun installed** - The server requires Bun runtime
   ```bash
   # Install Bun (macOS, Linux, WSL)
   curl -fsSL https://bun.sh/install | bash

   # Or using npm
   npm install -g bun
   ```

2. **OpenProject API Key** - Generate one from your OpenProject instance:
   - Navigate to your OpenProject instance
   - Go to "My account" → "Access tokens"
   - Click "Generate" and copy the API key
   - Store it securely (you won't be able to see it again)

3. **Clone this repository**:
   ```bash
   git clone https://github.com/yourusername/tonle.git
   cd tonle
   bun install
   ```

### Environment Variables

The server requires these environment variables:

```bash
# Required
OPENPROJECT_URL=https://your-instance.openproject.com
OPENPROJECT_API_KEY=your-api-key-here

# Optional
OPENPROJECT_TIMEOUT=30000  # Request timeout in milliseconds (default: 30000)
```

**Note**: The current implementation reads environment variables directly. Advanced configuration features (rate limiting, retries) are planned for future releases.

---

## MCP Client Configuration

### Claude Desktop

Claude Desktop is Anthropic's official desktop application with built-in MCP support.

#### Configuration Location

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

#### Configuration

Edit or create the `claude_desktop_config.json` file:

```json
{
  "mcpServers": {
    "openproject": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/tonle/index.ts"],
      "env": {
        "OPENPROJECT_URL": "https://your-instance.openproject.com",
        "OPENPROJECT_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Important**:
- Use the **absolute path** to your `index.ts` file
- Replace `your-instance.openproject.com` with your actual OpenProject URL
- Replace `your-api-key-here` with your generated API key
- Restart Claude Desktop after configuration changes

#### Verification

1. Restart Claude Desktop
2. Look for the 🔌 icon in the bottom-right corner
3. Click it to see available MCP servers
4. You should see "openproject" listed with available tools
5. Try asking: "List all my OpenProject projects"

---

### Claude Code (CLI)

Claude Code is Anthropic's official command-line interface with built-in MCP support.

#### Installation

```bash
# Install Claude Code CLI globally
npm install -g @anthropic-ai/claude-code
```

#### Configuration Location

- **macOS**: `~/.config/claude-code/config.json`
- **Windows**: `%APPDATA%\claude-code\config.json`
- **Linux**: `~/.config/claude-code/config.json`

#### Configuration

Edit or create the `config.json` file:

```json
{
  "mcpServers": {
    "openproject": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/tonle/index.ts"],
      "env": {
        "OPENPROJECT_URL": "https://your-instance.openproject.com",
        "OPENPROJECT_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

#### Usage

After configuration, start Claude Code:

```bash
# Start Claude Code
claude-code

# Or start in a specific directory
claude-code /path/to/your/project
```

The OpenProject MCP server will automatically connect when you start Claude Code.

#### Verification

1. Start Claude Code CLI
2. Check for connection messages in the terminal
3. Try asking: "List all OpenProject tools available"
4. Test with: "Show me my OpenProject projects"

#### Tips

- Use `claude-code --help` to see all available options
- Check logs with `claude-code --verbose` for debugging
- The CLI respects the same configuration format as Claude Desktop

---

### Cursor IDE

Cursor is an AI-powered code editor with MCP support.

#### Configuration Location

- **All platforms**: `.cursor/mcp.json` in your project root or home directory

#### Configuration

Create or edit `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "openproject": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/tonle/index.ts"],
      "env": {
        "OPENPROJECT_URL": "https://your-instance.openproject.com",
        "OPENPROJECT_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Note**: Check Cursor's documentation for the latest MCP configuration format as it may evolve.

---

### Windsurf IDE

Windsurf is an AI-powered development environment with MCP support.

#### Configuration

Windsurf typically uses a similar configuration format. Check the Windsurf documentation for:
- Configuration file location
- MCP server registration format
- Environment variable handling

Expected configuration format:

```json
{
  "mcpServers": {
    "openproject": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/tonle/index.ts"],
      "env": {
        "OPENPROJECT_URL": "https://your-instance.openproject.com",
        "OPENPROJECT_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

---

### MCP Inspector (Development & Testing)

The MCP Inspector is a browser-based tool for testing and debugging MCP servers.

#### Installation & Usage

```bash
# Run the server with Inspector
bun run inspect

# Or manually
bunx @modelcontextprotocol/inspector bun run index.ts
```

#### What You Can Do

- **Test Tools**: Execute any tool with custom parameters
- **View Responses**: See raw JSON responses from the OpenProject API
- **Debug Errors**: Inspect error messages and stack traces
- **Explore Schema**: View input/output schemas for all tools

#### Inspector Workflow

1. Start the Inspector (it will open in your browser)
2. The server will automatically connect
3. Browse available tools in the left sidebar
4. Select a tool to see its parameters
5. Fill in parameters and click "Execute"
6. View the response in the output panel

**Pro Tip**: Use the Inspector to test your OpenProject connection before configuring client applications.

---

### HTTP Transport (Remote/Web Clients)

The MCP server supports HTTP transport using the Streamable HTTP protocol, enabling remote connections from web-based clients or distributed systems.

#### Starting the HTTP Server

```bash
# Start the HTTP server (default port 3100)
bun run start:http

# Or with custom port
MCP_HTTP_PORT=8080 bun run start:http

# Development mode with hot reload
bun run dev:http
```

#### Environment Variables

```bash
# Required
OPENPROJECT_URL=https://your-instance.openproject.com
OPENPROJECT_API_KEY=your-api-key-here

# Optional
MCP_HTTP_PORT=3100        # HTTP server port (default: 3100)
MCP_HTTP_HOST=0.0.0.0     # HTTP server host (default: 0.0.0.0)
OPENPROJECT_TIMEOUT=30000 # Request timeout in milliseconds
```

#### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST | Handle MCP JSON-RPC requests |
| `/mcp` | GET | Get session status |
| `/mcp` | DELETE | Close a session |
| `/health` | GET | Health check endpoint |

#### Testing the HTTP Server

Use curl to verify the server is running:

```bash
# Health check
curl http://localhost:3100/health
# Response: {"status":"ok","transport":"http"}

# Initialize a session
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0.0"}
    }
  }'
```

#### Programmatic HTTP Client Integration

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Connect via HTTP
const transport = new StreamableHTTPClientTransport(
  new URL('http://localhost:3100/mcp')
);

const client = new Client({
  name: 'my-http-client',
  version: '1.0.0',
});

await client.connect(transport);

// List available tools
const tools = await client.listTools();
console.log('Available tools:', tools.tools.map(t => t.name));

// Call a tool
const result = await client.callTool({
  name: 'get_current_user',
  arguments: {},
});
console.log('Current user:', result.content);

// Close the connection
await client.close();
```

#### MCP Inspector with HTTP Transport

```bash
# Inspect the HTTP server
bun run inspect:http

# Or manually
bunx @modelcontextprotocol/inspector --transport http --url http://localhost:3100/mcp
```

#### Deploying the HTTP Server

For production deployments:

1. **Using a process manager (PM2)**:
   ```bash
   pm2 start "bun run start:http" --name openproject-mcp
   ```

2. **Using Docker**:
   ```dockerfile
   FROM oven/bun:1
   WORKDIR /app
   COPY . .
   RUN bun install
   ENV MCP_HTTP_PORT=3100
   EXPOSE 3100
   CMD ["bun", "run", "start:http"]
   ```

3. **Behind a reverse proxy (nginx)**:
   ```nginx
   location /mcp {
       proxy_pass http://localhost:3100;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection 'upgrade';
       proxy_set_header Host $host;
       proxy_cache_bypass $http_upgrade;
   }
   ```

---

### Custom MCP Clients

The server supports two transport mechanisms:

#### Option 1: STDIO Transport (Local/Subprocess)

Best for local development and desktop applications that spawn the server as a subprocess.

1. **Protocol**: Standard input/output streams
2. **Command**: `bun run /path/to/tonle/index.ts`
3. **Environment Variables**: Pass `OPENPROJECT_URL` and `OPENPROJECT_API_KEY`
4. **Protocol Version**: MCP SDK version 1.22.0

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'bun',
  args: ['run', '/path/to/tonle/index.ts'],
  env: {
    OPENPROJECT_URL: 'https://your-instance.openproject.com',
    OPENPROJECT_API_KEY: 'your-api-key',
  },
});

const client = new Client({
  name: 'my-mcp-client',
  version: '1.0.0',
});

await client.connect(transport);
const tools = await client.listTools();
```

#### Option 2: HTTP Transport (Remote/Web)

Best for web applications, remote clients, or microservice architectures.

1. **Protocol**: Streamable HTTP (JSON-RPC over HTTP with SSE)
2. **URL**: `http://your-server:3100/mcp`
3. **Environment Variables**: Set on the server side
4. **Protocol Version**: MCP SDK version 1.22.0

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('http://your-server:3100/mcp')
);

const client = new Client({
  name: 'my-http-client',
  version: '1.0.0',
});

await client.connect(transport);
const tools = await client.listTools();
```

---

## Testing Your Configuration

### Quick Connection Test

After configuring your MCP client, test the connection:

1. **List all tools**: Ask your AI assistant to show available OpenProject tools
2. **Get current user**: Try `get_current_user` tool to verify authentication
3. **List projects**: Try `list_projects` to confirm API access

### Example Queries

Try these natural language queries:

- "Show me all my OpenProject projects"
- "List work packages in project X"
- "Create a new task in project Y with title 'Setup testing environment'"
- "Who is the current authenticated user?"
- "Show me all work package types available"

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Server not appearing in client | Check absolute path to `index.ts`, restart client |
| Authentication errors | Verify API key is correct and has proper permissions |
| Connection timeout | Check `OPENPROJECT_URL` is accessible and correct |
| Bun command not found | Ensure Bun is installed and in your PATH |
| Tools not loading | Check server logs for errors, verify OpenProject instance is running |

### Viewing Server Logs

When running via MCP clients, server logs (from `console.error()`) typically appear in:
- **Claude Desktop**: View → Developer → Toggle Developer Tools → Console
- **MCP Inspector**: Visible in the terminal where you ran the inspector
- **Cursor/Windsurf**: Check the IDE's output/debug panels

---

## Advanced Configuration

### Using Environment Files

For development, create a `.env` file (never commit this):

```bash
OPENPROJECT_URL=https://your-instance.openproject.com
OPENPROJECT_API_KEY=your-api-key-here
OPENPROJECT_TIMEOUT=30000
```

Load it before running:

```bash
# Using bun's built-in env support
bun run index.ts

# Or manually
export $(cat .env | xargs) && bun run index.ts
```

### Multiple OpenProject Instances

To connect to multiple OpenProject instances, create separate server entries:

```json
{
  "mcpServers": {
    "openproject-production": {
      "command": "bun",
      "args": ["run", "/path/to/tonle/index.ts"],
      "env": {
        "OPENPROJECT_URL": "https://prod.openproject.com",
        "OPENPROJECT_API_KEY": "prod-api-key"
      }
    },
    "openproject-staging": {
      "command": "bun",
      "args": ["run", "/path/to/tonle/index.ts"],
      "env": {
        "OPENPROJECT_URL": "https://staging.openproject.com",
        "OPENPROJECT_API_KEY": "staging-api-key"
      }
    }
  }
}
```

### Docker Deployment

While the server primarily uses stdio transport (local only), future HTTP transport support will enable Docker deployment:

```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --production
COPY . .
ENV OPENPROJECT_URL=""
ENV OPENPROJECT_API_KEY=""
CMD ["bun", "run", "index.ts"]
```

**Note**: HTTP transport implementation is planned for future releases.

---

## Security Considerations

### Authentication

1. **API Key Security**: API keys should be stored securely using environment variables or secret management systems
2. **OAuth 2.0**: Support for OAuth 2.0 with authorization code flow and PKCE
3. **Session Management**: Proper handling of session tokens with secure refresh mechanisms

### Authorization

- All operations respect OpenProject's permission system
- Tools only expose actions the authenticated user is authorized to perform
- Sensitive operations require explicit confirmation

### Data Protection

- HTTPS enforcement for all API communications
- No sensitive data logging
- Request/response payload sanitization

---

## Error Handling

### Standard Error Responses

```typescript
interface OpenProjectError {
  _type: 'Error';
  errorIdentifier: string;
  message: string;
  _embedded?: {
    details?: {
      attribute?: string;
    };
  };
}

// Common error identifiers
const ERROR_CODES = {
  NOT_FOUND: 'urn:openproject-org:api:v3:errors:NotFound',
  UNAUTHORIZED: 'urn:openproject-org:api:v3:errors:Unauthenticated',
  FORBIDDEN: 'urn:openproject-org:api:v3:errors:MissingPermission',
  VALIDATION: 'urn:openproject-org:api:v3:errors:PropertyConstraintViolation',
  CONFLICT: 'urn:openproject-org:api:v3:errors:UpdateConflict',
  INVALID_BODY: 'urn:openproject-org:api:v3:errors:InvalidRequestBody'
};
```

### Error Recovery

- Automatic retry with exponential backoff for transient errors
- Clear error messages with actionable suggestions
- Graceful degradation for non-critical failures

---

## Testing Strategy

### Unit Tests

- Individual tool handler testing
- Schema validation testing
- Error handling verification

### Integration Tests

- Full API endpoint testing against OpenProject test instance
- Authentication flow testing
- Rate limiting behavior verification

### End-to-End Tests

- Complete workflow testing with MCP Inspector
- Claude Desktop integration testing
- Performance benchmarking

---

## Deployment Options

### Local Development

```bash
# Clone and install
git clone https://github.com/your-org/openproject-mcp-server.git
cd openproject-mcp-server
bun install

# Run with stdio transport (Bun + TypeScript)
bun run index.ts

# Test with MCP Inspector
bunx @modelcontextprotocol/inspector bun run index.ts
```

### Docker Deployment

```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --production
COPY . .
EXPOSE 3000
CMD ["bun", "run", "index.ts"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openproject-mcp-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: openproject-mcp
  template:
    metadata:
      labels:
        app: openproject-mcp
    spec:
      containers:
      - name: mcp-server
        image: your-registry/openproject-mcp-server:latest
        ports:
        - containerPort: 3000
        env:
        - name: OPENPROJECT_URL
          valueFrom:
            secretKeyRef:
              name: openproject-secrets
              key: url
        - name: OPENPROJECT_API_KEY
          valueFrom:
            secretKeyRef:
              name: openproject-secrets
              key: api-key
```

---

## Project Roadmap

### Phase 1: Core Implementation (MVP)
- [ ] Project setup and configuration
- [ ] OpenProject API client implementation
- [ ] Work packages CRUD tools
- [ ] Projects CRUD tools
- [ ] Basic authentication (API key)
- [ ] Stdio transport support

### Phase 2: Extended Coverage
- [ ] All remaining endpoint implementations
- [ ] OAuth 2.0 authentication
- [ ] Resource providers
- [ ] Prompt templates
- [ ] HTTP transport support

### Phase 3: Enterprise Features
- [ ] Rate limiting and throttling
- [ ] Caching layer
- [ ] Audit logging
- [ ] Multi-instance support
- [ ] SSO integration

### Phase 4: Advanced Features
- [ ] Webhook event handling
- [ ] Real-time notifications via SSE
- [ ] Batch operations
- [ ] Advanced filtering DSL
- [ ] AI-assisted project planning prompts

---

## Contributing

### Development Setup

```bash
# Fork and clone
git clone https://github.com/your-username/openproject-mcp-server.git
cd openproject-mcp-server

# Install dependencies
bun install

# Run in development mode
bun run dev

# Run tests
bun test

# Build for production
bun run build
```

### Code Style

- ESLint with TypeScript rules
- Prettier for formatting
- Conventional commits for changelog generation

### Pull Request Process

1. Create feature branch from `main`
2. Implement changes with tests
3. Ensure all tests pass
4. Update documentation
5. Submit PR with detailed description

---

## License

MIT License - See LICENSE file for details

---

## Acknowledgments

- **OpenProject GmbH** for the excellent open-source project management software
- **Anthropic** for developing the Model Context Protocol
- **MCP Community** for tooling and best practices

---

## Support & Resources

- **OpenProject Documentation**: https://www.openproject.org/docs/
- **OpenProject API Reference**: https://www.openproject.org/docs/api/
- **MCP Specification**: https://spec.modelcontextprotocol.io/
- **MCP TypeScript SDK**: https://github.com/modelcontextprotocol/typescript-sdk

---

*This project description was created as a comprehensive blueprint for implementing a full-featured MCP server for OpenProject. The implementation covers all available API endpoints to provide complete project management capabilities through AI assistants.*