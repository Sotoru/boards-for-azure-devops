# Plan

## Decisions

**Scope & navigation**
- Multiple organizations: auto-discovered from the signed-in account, plus an optional manual list (`board_azr_devops.organizations`) for orgs in other tenants. The tenant of each org is detected automatically.
- Per organization, the user picks a project and team (remembered). Switched from the status bar via QuickPick (org → project → team).

**Sidebar (TreeView)**
- Toggle "Mine / All". "All" = work items in the team's area paths.
- Filter (funnel icon): one multi-select QuickPick grouped by state, type, assignee, sprint (default: current), tags, priority. Client-side except sprint (re-queries). Remembered per team. Active filters summarized in the view description, with a clear button.
- Text search: native tree type-to-filter.
- Group by: state (default), hierarchy, assignee, none. Expanding an item shows "Details" as first child, then its children.
- Auto-refresh every 5 min while the window is focused, and on focus. Badge with my open items. Notification on new assignment (can be disabled).

**Editing**
- Create work items and child tasks.
- State, title, priority, tags, assignee (anyone on the team), sprint via QuickPick/InputBox.
- Description and multi-line comments in a Markdown editor tab, sent on save (check whether the org stores Markdown or HTML first).
- Out of scope: attachments, non parent/child links, custom fields.

**Kanban (webview panel)**
- Real team board columns (with WIP limits), drag & drop updates the board column (revert + error on failure), card click opens the full view, filters shared with the sidebar.
- Out of scope for now: swimlanes.

**Git (Azure Repos)**
- "Start working": creates a branch from a template (default `{type}/{id}`), sets the item Active and assigns it to me.
- Active item detected from the id in the current branch name.
- Commit message prefilled with `#<id>`.
- Linked PRs and commits (read-only) in the full view.

**AI**
- Register the Azure DevOps MCP server for Copilot via the VS Code MCP API.
- "Copy work item for AI" (Markdown to clipboard).
- Assistants find the active item from the branch name and read the rest through MCP.

**Tech & distribution**
- TypeScript + esbuild, Node test runner for pure logic. English + Italian. Distributed as `.vsix`.

## Phases

1. **Foundation**: TypeScript + esbuild, l10n, multiple orgs with tenant detection, project/team in the status bar.
2. **Sidebar**: Mine/All, filters, group by, details node, polling, badge, notifications.
3. **Editing**: create, all fields, Markdown editor for description/comments.
4. **Git**: start working, active item, commit reference, linked PRs/commits.
5. **Kanban**.
6. **AI**: MCP registration for Copilot, copy for AI.
