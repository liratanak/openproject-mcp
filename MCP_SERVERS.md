# OpenProject MCP Server (`openproject-mcp`)

This document summarizes the Model Context Protocol (MCP) tools exposed by `index.ts`. Use it as a catalog when wiring the server into MCP-compatible clients.

## Usage Notes

- All tools return JSON payloads from the upstream OpenProject REST API.
- Parameters marked “JSON” expect a stringified JSON expression, mirroring OpenProject’s filtering/sorting syntax.
- Resource identifiers accept either numeric IDs or, where noted, string identifiers such as `me`.
- Dates should be formatted as `YYYY-MM-DD`; durations follow ISO-8601 (e.g., `PT8H30M`).

## Tool Catalog

### Root & Configuration

#### `get_api_root`

**Description:** Returns the OpenProject API root document.

**Parameters:** _None_

#### `get_configuration`

**Description:** Fetches configuration metadata for the current OpenProject instance.

**Parameters:** _None_

### Projects

#### `list_projects`

**Description:** Lists accessible projects with optional pagination and filtering.

**Parameters:**
- `offset` (number, optional) – Page offset (default `0`).
- `pageSize` (number, optional) – Items per page (default `20`, max `1000`).
- `filters` (string, optional) – JSON filter expression.
- `sortBy` (string, optional) – JSON array describing sort order.

#### `get_project`

**Description:** Retrieves details for a project.

**Parameters:**
- `id` (number|string) – Project ID or identifier.

#### `create_project`

**Description:** Creates a new project.

**Parameters:**
- `name` (string) – Project name.
- `identifier` (string, optional) – Unique identifier; auto-generated when omitted.
- `description` (string, optional) – Markdown/HTML description.
- `public` (boolean, optional) – Whether the project is public (default `false`).
- `status` (`on_track`|`at_risk`|`off_track`|`not_set`, optional) – Health status.
- `statusExplanation` (string, optional) – Rationale for the current status.
- `parentId` (number, optional) – Parent project ID.

#### `update_project`

**Description:** Updates metadata for an existing project.

**Parameters:**
- `id` (number|string) – Project ID or identifier.
- `name` (string, optional) – New name.
- `description` (string, optional) – New description.
- `public` (boolean, optional) – Toggle public visibility.
- `active` (boolean, optional) – Activate/deactivate.
- `status` (`on_track`|`at_risk`|`off_track`|`not_set`, optional) – Updated status.
- `statusExplanation` (string, optional) – Updated status rationale.

#### `delete_project`

**Description:** Deletes a project after confirmation.

**Parameters:**
- `id` (number|string) – Project ID or identifier.

### Work Packages

#### `list_work_packages`

**Description:** Returns open work packages by default, with optional filtering, grouping, and pagination. Pass an explicit `filters` value if you need closed tasks.

**Parameters:**
- `offset` (number, optional) – Page offset.
- `pageSize` (number, optional) – Items per page.
- `filters` (string, optional) – JSON filter expression.
- `sortBy` (string, optional) – JSON sort definition.
- `groupBy` (string, optional) – Attribute to group by.

#### `list_work_packages_by_status`

**Description:** Lists work packages that have a specific status, or — when `statusId` is omitted — open work packages grouped by status name. The status filter is built for you, so you do not need to hand-write the `filters` JSON. Optionally scope to a project and/or assignee. The response includes `summary` counts, `pagination`, a paged `tasks` list, and `groupedByStatus` for the returned page.

**Parameters:**
- `statusId` (number | string, optional) – Status ID or status NAME (e.g. `7` or `"In Progress"`, `"New"`, `"Closed"`). Names are resolved to IDs automatically via `list_statuses`; you do not need a separate lookup. Omit to list open work packages grouped by status.
- `projectId` (number | string, optional) – Project ID or identifier to scope the listing to one project.
- `assigneeId` (number, optional) – Assignee user ID to return only that member's work packages.
- `offset` (number, optional) – Page offset (default `1`).
- `pageSize` (number, optional) – Tasks to list per page (default `100`).
- `sortBy` (string, optional) – JSON sort definition.

#### `list_project_work_packages`

**Description:** Lists open work packages scoped to a specific project by default. Pass an explicit `filters` value if you need closed tasks.

**Parameters:**
- `projectId` (number|string) – Project identifier.
- `offset` (number, optional) – Page offset.
- `pageSize` (number, optional) – Items per page.
- `filters` (string, optional) – JSON filter expression.
- `sortBy` (string, optional) – JSON sort definition.

#### `get_work_package`

**Description:** Fetches a single work package by ID.

**Parameters:**
- `id` (number) – Work package ID.

#### `create_work_package`

**Description:** Creates a work package inside a project.

**Parameters:**
- `projectId` (number|string) – Project identifier.
- `subject` (string) – Title/subject.
- `description` (string, optional) – Markdown description.
- `typeId` (number, optional) – Work package type.
- `statusId` (number, optional) – Status ID.
- `priorityId` (number, optional) – Priority ID.
- `assigneeId` (number, optional) – Assignee user ID.
- `responsibleId` (number, optional) – Responsible user ID.
- `versionId` (number, optional) – Version/milestone ID.
- `parentId` (number, optional) – Parent work package ID.
- `startDate` (string, optional) – Start date (`YYYY-MM-DD`).
- `dueDate` (string, optional) – Due date (`YYYY-MM-DD`).
- `estimatedTime` (string, optional) – ISO-8601 duration (e.g., `PT8H`).
- `percentageDone` (number, optional) – Completion percentage (`0-100`).
- `notify` (boolean, optional) – Send notifications (defaults to OpenProject behavior).

#### `update_work_package`

**Description:** Updates a work package using optimistic locking. The current `lockVersion` is fetched automatically when omitted (preferred for LLM/external callers that do not already know it); a stale `lockVersion` (`UpdateConflict`) is automatically refetched and the update retried once. Only pass the fields you want to change.

**Parameters:**
- `id` (number) – Work package ID.
- `lockVersion` (number, optional) – Current lock version. Fetched automatically when omitted; a stale version is refetched and the update retried once. Supply it only when you already have a fresh value to skip the extra read.
- `subject` (string, optional) – Updated subject.
- `description` (string, optional) – Updated description. Accepts a plain text/markdown string, or an OpenProject-style rich-text object `{ raw: string }` (extra keys like `format`/`html` are ignored) which is coerced to a string.
- `typeId` (number, optional) – New type ID.
- `statusId` (number, optional) – New status ID.
- `priorityId` (number, optional) – New priority ID.
- `assigneeId` (number, optional) – New assignee.
- `responsibleId` (number, optional) – New responsible user.
- `versionId` (number, optional) – New version/milestone.
- `parentId` (number, optional) – New parent work package.
- `startDate` (string, optional) – Updated start date.
- `dueDate` (string, optional) – Updated due date.
- `estimatedTime` (string, optional) – Updated estimate.
- `percentageDone` (number, optional) – Updated completion percent.
- `notify` (boolean, optional) – Send notifications flag.

#### `delete_work_package`

**Description:** Deletes a work package.

**Parameters:**
- `id` (number) – Work package ID.

#### `list_work_package_activities`

**Description:** Lists journal entries/activities for a work package.

**Parameters:**
- `id` (number) – Work package ID.

### Users

#### `list_users`

**Description:** Lists users with pagination and filtering (administrator accounts only).

**Parameters:**
- `offset` (number, optional) – Page offset.
- `pageSize` (number, optional) – Items per page.
- `filters` (string, optional) – JSON filter expression.
- `sortBy` (string, optional) – JSON sort definition.

#### `get_user`

**Description:** Fetches a user by ID or returns the special `me` record.

**Parameters:**
- `id` (number|string) – Numeric ID or `"me"`.

#### `get_current_user`

**Description:** Shortcut for retrieving the authenticated user.

**Parameters:** _None_

#### `create_user`

**Description:** Creates a new user (admin only).

**Parameters:**
- `login` (string) – Username.
- `email` (string, email) – Email address.
- `firstName` (string) – First name.
- `lastName` (string) – Last name.
- `admin` (boolean, optional) – Admin flag.
- `language` (string, optional) – Preferred language code.
- `password` (string, optional) – Initial password.

#### `update_user`

**Description:** Updates user profile fields.

**Parameters:**
- `id` (number) – User ID.
- `login` (string, optional) – New username.
- `email` (string, email, optional) – New email.
- `firstName` (string, optional) – New first name.
- `lastName` (string, optional) – New last name.
- `admin` (boolean, optional) – Admin flag.
- `language` (string, optional) – Preferred language code.

#### `delete_user`

**Description:** Removes a user (admin only).

**Parameters:**
- `id` (number) – User ID.

#### `lock_user`

**Description:** Locks a user account.

**Parameters:**
- `id` (number) – User ID.

#### `unlock_user`

**Description:** Unlocks a user account.

**Parameters:**
- `id` (number) – User ID.

### Types

#### `list_types`

**Description:** Lists all work package types.

**Parameters:** _None_

#### `get_type`

**Description:** Fetches a work package type.

**Parameters:**
- `id` (number) – Type ID.

#### `list_project_types`

**Description:** Lists types enabled for a specific project.

**Parameters:**
- `projectId` (number|string) – Project identifier.

### Statuses

#### `list_statuses`

**Description:** Lists all work package statuses.

**Parameters:** _None_

#### `get_status`

**Description:** Fetches status metadata.

**Parameters:**
- `id` (number) – Status ID.

### Priorities

#### `list_priorities`

**Description:** Lists available priorities.

**Parameters:** _None_

#### `get_priority`

**Description:** Fetches a priority definition.

**Parameters:**
- `id` (number) – Priority ID.

### Time Entries

#### `list_time_entries`

**Description:** Lists time entries with pagination/filtering.

**Parameters:**
- `offset` (number, optional) – Page offset.
- `pageSize` (number, optional) – Items per page.
- `filters` (string, optional) – JSON filter expression.
- `sortBy` (string, optional) – JSON sort definition.

#### `get_time_entry`

**Description:** Fetches a time entry.

**Parameters:**
- `id` (number) – Time entry ID.

#### `create_time_entry`

**Description:** Creates a new time entry.

**Parameters:**
- `projectId` (number) – Project ID.
- `workPackageId` (number, optional) – Work package ID.
- `activityId` (number) – Activity ID.
- `hours` (string) – ISO-8601 duration (e.g., `PT8H30M`).
- `spentOn` (string) – Date spent on (`YYYY-MM-DD`).
- `comment` (string, optional) – Comment text.

#### `update_time_entry`

**Description:** Updates fields on an existing time entry.

**Parameters:**
- `id` (number) – Time entry ID.
- `activityId` (number, optional) – New activity.
- `hours` (string, optional) – New duration.
- `spentOn` (string, optional) – New date.
- `comment` (string, optional) – New comment.

#### `delete_time_entry`

**Description:** Deletes a time entry.

**Parameters:**
- `id` (number) – Time entry ID.

### Versions

#### `list_versions`

**Description:** Lists versions/milestones globally.

**Parameters:**
- `offset` (number, optional) – Page offset.
- `pageSize` (number, optional) – Items per page.
- `filters` (string, optional) – JSON filter expression.

#### `get_version`

**Description:** Fetches a version.

**Parameters:**
- `id` (number) – Version ID.

#### `list_project_versions`

**Description:** Lists versions belonging to a project.

**Parameters:**
- `projectId` (number|string) – Project identifier.

#### `create_version`

**Description:** Creates a new version/milestone.

**Parameters:**
- `name` (string) – Version name.
- `projectId` (number) – Defining project.
- `description` (string, optional) – Description.
- `startDate` (string, optional) – Start date.
- `endDate` (string, optional) – End date.
- `status` (`open`|`locked`|`closed`, optional) – Status.
- `sharing` (`none`|`descendants`|`hierarchy`|`tree`|`system`, optional) – Sharing scope.

#### `update_version`

**Description:** Updates an existing version.

**Parameters:**
- `id` (number) – Version ID.
- `name` (string, optional) – New name.
- `description` (string, optional) – New description.
- `startDate` (string, optional) – New start date.
- `endDate` (string, optional) – New end date.
- `status` (`open`|`locked`|`closed`, optional) – New status.
- `sharing` (`none`|`descendants`|`hierarchy`|`tree`|`system`, optional) – New sharing scope.

#### `delete_version`

**Description:** Deletes a version.

**Parameters:**
- `id` (number) – Version ID.

### Activities

#### `get_activity`

**Description:** Retrieves a work-package activity/journal entry.

**Parameters:**
- `id` (number) – Activity ID.

### Principals

#### `list_principals`

**Description:** Lists principals (users, groups, placeholder users).

**Parameters:**
- `offset` (number, optional) – Page offset.
- `pageSize` (number, optional) – Items per page.
- `filters` (string, optional) – JSON filter expression.





