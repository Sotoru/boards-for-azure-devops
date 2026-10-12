# Boards for Azure DevOps

Browse and edit Azure DevOps work items from the VS Code sidebar. Not affiliated with Microsoft.

- Sign in with the Microsoft account built into VS Code, no personal access token needed.
- Organizations of your account are discovered automatically. Add others (e.g. in a different tenant) in `board_azr_devops.organizations`.
- Switch organization, project and team from the status bar.
- Toggle between work items assigned to you and all work items of the team (current sprint by default).
- Filter by state, type, assignee, iteration, tags and priority; filters are remembered per team.
- Group by state, hierarchy (parent → children), assignee, or not at all.
- Expand a work item for details; "Show all" opens a full view with comments.
- Create work items (team area, current sprint) and child items.
- Edit state, title, priority, tags, assignee (any team member) and sprint from the context menu or the full view.
- Edit the description and write comments in a Markdown editor tab: saving sends them to Azure DevOps. Saves are rejected if someone else changed the item meanwhile, and the text stays in the editor.
- "Start working": creates (or checks out) a branch from a template (default `{type}/{id}`) off the remote default branch, moves the item to its in-progress state and assigns it to you.
- The work item of the current branch is highlighted and shown in the status bar; an empty commit message gets `#<id>` so Azure Repos links the commit.
- Linked pull requests and commits in the full view.
- Auto-refresh while the window is focused, badge with your open items, notification on new assignments.

English and Italian. See [PLAN.md](PLAN.md) for the roadmap.

## Build

```sh
npm install
npm run build     # or: npm run watch
npm test
npm run package   # creates the .vsix
```
