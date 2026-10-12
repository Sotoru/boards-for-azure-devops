# Boards for Azure DevOps

Browse and edit Azure DevOps work items from the VS Code sidebar. Not affiliated with Microsoft.

- Sign in with the Microsoft account built into VS Code, no personal access token needed.
- Organizations of your account are discovered automatically. Add others (e.g. in a different tenant) in `board_azr_devops.organizations`.
- Switch organization, project and team from the status bar.
- Work items assigned to you, expandable for details. "Show all" opens a full view with comments.
- Change state, title, assignee and add comments from the context menu.

English and Italian. See [PLAN.md](PLAN.md) for the roadmap.

## Build

```sh
npm install
npm run build     # or: npm run watch
npm test
npm run package   # creates the .vsix
```
