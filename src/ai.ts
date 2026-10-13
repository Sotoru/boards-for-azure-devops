import * as vscode from 'vscode';
import { getWorkItemFull, isMarkdown, tenantOf, WorkItem } from './api';
import { aiMarkdown } from './aiText';
import { branchName } from './gitText';
import { htmlToMarkdown } from './markdown';
import { ScopeStore } from './scope';

const t = vscode.l10n.t;

/** Copies the work item as minimal Markdown (title, description, branch and commit conventions) for pasting into an AI chat. */
export async function copyForAi(w: WorkItem) {
  const full = await getWorkItemFull(w);
  const f = full.fields;
  const md = (field: 'System.Description' | 'Microsoft.VSTS.TCM.ReproSteps') =>
    f[field] && (isMarkdown(full, field) ? f[field] : htmlToMarkdown(f[field]!));
  const template = vscode.workspace.getConfiguration('board_azr_devops').get('branchTemplate', '{type}/{id}');
  await vscode.env.clipboard.writeText(aiMarkdown({
    id: w.id,
    fields: f,
    description: md('System.Description'),
    reproSteps: md('Microsoft.VSTS.TCM.ReproSteps'),
    branch: branchName(template, { ...w, fields: f }),
  }));
  vscode.window.setStatusBarMessage(t('#{0} copied as Markdown for AI', w.id), 4000);
}

// The MCP API arrived in VS Code 1.101; typed loosely so the extension still runs on older versions.
interface McpApi {
  lm?: { registerMcpServerDefinitionProvider?(id: string, p: object): vscode.Disposable };
  McpStdioServerDefinition?: new (label: string, command: string, args?: string[], env?: Record<string, string>, version?: string) => object;
}

/** Offers the official Azure DevOps MCP server, for the active organization, to Copilot and other MCP clients in VS Code. */
export function registerMcp(scope: ScopeStore): vscode.Disposable {
  const api = vscode as unknown as McpApi;
  const Stdio = api.McpStdioServerDefinition;
  if (!api.lm?.registerMcpServerDefinitionProvider || !Stdio) return new vscode.Disposable(() => {});
  const changed = new vscode.EventEmitter<void>();
  const registration = api.lm.registerMcpServerDefinitionProvider('board_azr_devops.mcp', {
    onDidChangeMcpServerDefinitions: changed.event,
    async provideMcpServerDefinitions() {
      const { org, project, team } = scope.current;
      if (!org || !vscode.workspace.getConfiguration('board_azr_devops').get('registerMcp', true)) return [];
      const tenant = await tenantOf(org);
      const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      // The scope's project and team become the server's defaults, so "work on #1234" needs no project.
      const env: Record<string, string> = { ...(project ? { ado_mcp_project: project } : {}), ...(team ? { ado_mcp_team: team } : {}) };
      return [new Stdio(`Azure DevOps (${org})`, npx, ['-y', '@azure-devops/mcp', org, ...(tenant ? ['--tenant', tenant] : [])], env)];
    },
  });
  return vscode.Disposable.from(
    registration,
    changed,
    scope.onDidChange(() => changed.fire()),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('board_azr_devops.registerMcp')) changed.fire(); }),
  );
}
