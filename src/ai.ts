import * as vscode from 'vscode';
import { getComments, getWorkItemFull, isMarkdown, tenantOf, webUrl, WorkItem } from './api';
import { aiMarkdown } from './aiText';
import { htmlToMarkdown } from './markdown';
import { ScopeStore } from './scope';

const t = vscode.l10n.t;

/** Copies the work item as Markdown (fields, texts, comments) for pasting into an AI chat. */
export async function copyForAi(w: WorkItem) {
  const [full, comments] = await Promise.all([getWorkItemFull(w), getComments(w)]);
  const f = full.fields;
  const md = (field: 'System.Description' | 'Microsoft.VSTS.Common.AcceptanceCriteria' | 'Microsoft.VSTS.TCM.ReproSteps') =>
    f[field] && (isMarkdown(full, field) ? f[field] : htmlToMarkdown(f[field]!));
  await vscode.env.clipboard.writeText(aiMarkdown({
    id: w.id,
    url: webUrl({ ...w, fields: f }),
    fields: f,
    description: md('System.Description'),
    acceptanceCriteria: md('Microsoft.VSTS.Common.AcceptanceCriteria'),
    reproSteps: md('Microsoft.VSTS.TCM.ReproSteps'),
    // A comment with renderedText was written in Markdown (text is the source); otherwise text is HTML.
    comments: comments.map(c => ({ author: c.createdBy?.displayName, date: c.createdDate, text: c.renderedText ? c.text : htmlToMarkdown(c.text) })),
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
      const { org } = scope.current;
      if (!org || !vscode.workspace.getConfiguration('board_azr_devops').get('registerMcp', true)) return [];
      const tenant = await tenantOf(org);
      const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      return [new Stdio(`Azure DevOps (${org})`, npx, ['-y', '@azure-devops/mcp', org, ...(tenant ? ['--tenant', tenant] : [])])];
    },
  });
  return vscode.Disposable.from(
    registration,
    changed,
    scope.onDidChange(() => changed.fire()),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('board_azr_devops.registerMcp')) changed.fire(); }),
  );
}
