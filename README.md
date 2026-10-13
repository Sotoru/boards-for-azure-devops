# Boards for Azure DevOps

Browse and edit Azure DevOps work items without leaving VS Code: a sidebar with your items, a detail page, a Kanban board and Git integration. Not affiliated with Microsoft.

## Features

### Sign in and scope

- Uses the Microsoft account built into VS Code: no personal access token.
- Organizations of your account are discovered automatically; add others (e.g. in a different tenant) in `board_azr_devops.organizations`.
- Switch organization, project and team from the status bar.

### Sidebar

- Toggle between work items assigned to you and all work items of the team (current sprint by default).
- Filter by state, type, assignee, iteration, tags and priority; filters are remembered per team.
- Group by state, hierarchy (parent → children), assignee, or not at all.
- Expand a work item for a quick look (ID, title, priority, tags, description); every value can be copied.
- Saved queries (My Queries, Shared Queries) in their own section: expanding a query runs it.
- Auto-refresh while the window is focused, a badge with your open items, a notification on new assignments.

### Detail page

- Header with type and state in their Azure DevOps colors; click the title or the state to change them.
- Side panel with assignee, iteration, priority and tags: click a value to edit it.
- Tabs for details (description, acceptance criteria, repro steps), comments and history (state path and every field change).
- Write comments in Markdown right in the page (Ctrl/Cmd+Enter to post).
- Linked pull requests and commits.

### Editing

- Create work items (team area, current sprint) and child items.
- Edit state, title, priority, tags, assignee (any team member) and sprint from the context menu or the detail page.
- Edit the description and write comments in a Markdown editor tab: saving sends them to Azure DevOps. Saves are rejected if someone else changed the item meanwhile, and your text stays in the editor.

### Kanban board

- The team's real board columns with WIP limits, in an editor tab.
- Drag & drop (or Alt+←/→) to move cards; filters are shared with the sidebar.

### Git (Azure Repos)

- **Start working**: creates (or checks out) a branch from a template (default `{type}/{id}`) off the remote default branch, moves the item to its in-progress state and assigns it to you.
- The work item of the current branch is shown in the status bar and highlighted in the sidebar.
- An empty commit message gets `#<id>`, so Azure Repos links the commit to the work item.

### AI assistants

- **Copilot / VS Code MCP clients:** the extension offers the official [Azure DevOps MCP server](https://github.com/microsoft/azure-devops-mcp) (`@azure-devops/mcp`) for the active organization, with its tenant. Disable with `board_azr_devops.registerMcp` if you configured it yourself.
- **Copy for AI** (context menu or detail page) copies a work item as Markdown: fields, description, acceptance criteria, repro steps, comments.
- The work item id is the number in the branch name (`feature/123`), so an assistant with Git access and the MCP server can find and read the current item without extra setup.

## Getting started

1. Install the extension and open the **Azure Boards** view in the activity bar.
2. Sign in with your Microsoft account when asked.
3. Pick organization, project and team from the status bar.

## Settings

| Setting | Default | Description |
|---|---|---|
| `board_azr_devops.organizations` | `[]` | Extra organizations to show, besides the discovered ones. |
| `board_azr_devops.query` | my open items | WIQL query for the "Assigned to me" view. |
| `board_azr_devops.refreshMinutes` | `5` | Minutes between automatic refreshes (only while the window is focused). |
| `board_azr_devops.notifyAssigned` | `true` | Notify when a work item is assigned to you. |
| `board_azr_devops.branchTemplate` | `{type}/{id}` | Branch name for "Start working": `{type}` (`bugfix` for bugs, `feature` otherwise), `{id}`, `{title}`. |
| `board_azr_devops.baseBranch` | remote default | Branch to start from, e.g. `origin/develop`. |
| `board_azr_devops.commitReference` | `true` | Prefill empty commit messages with `#<id>`. |
| `board_azr_devops.registerMcp` | `true` | Offer the Azure DevOps MCP server to Copilot. |

English and Italian.

## Build

```sh
npm install
npm run build     # or: npm run watch
npm test
npm run package   # creates the .vsix
```

Roadmap: [PLAN.md](PLAN.md).
