# AGENTS.md

VS Code extension to browse and edit Azure DevOps work items from the sidebar. Public, open repository.

## Must stay generic: no company or personal data

This repo is public. Nothing tied to a specific employer, customer, or person may be committed:

- No real organization, project, team, area or iteration names. In code, docs, tests and examples use Microsoft's sample names: `contoso`, `fabrikam`, `Fabrikam Fiber`.
- No tenant IDs, user IDs, emails, display names, internal URLs, server names, PATs or tokens.
- No screenshots, logs, fixtures or API responses captured from a real organization. Write test data by hand.
- No defaults that assume a specific organization: everything environment-specific comes from user settings (`board_azr_devops.*`) or is discovered at runtime.
- Commits use the GitHub noreply email (set in this repo's local git config), never a work email.

Before committing, grep the diff for anything that looks like real data.

## Development

- TypeScript, bundled with esbuild into `dist/`. `npm run build`, `npm run watch`, `npm run typecheck`.
- Tests cover pure logic only (`src/text.ts` and similar, no `vscode` import): `npm test` (Node's built-in test runner, runs `.ts` directly).
- Try it locally: symlink the repo folder into `~/.vscode/extensions/sotoru.boards-for-azure-devops-<version>`, run `npm run build`, then "Developer: Reload Window".
- Package: `npm run package` → `.vsix`.
- Native VS Code UI only (TreeView, QuickPick, InputBox, status bar, webviews styled with theme variables). No UI frameworks.
- User-facing strings: English source via `vscode.l10n.t()` and `%key%` in `package.json`; Italian in `l10n/bundle.l10n.it.json` and `package.nls.it.json`.

Roadmap and decisions: [PLAN.md](PLAN.md).
