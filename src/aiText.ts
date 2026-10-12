// Pure: a work item as Markdown context for an AI assistant. No `vscode` import, so it runs under `node --test`.
import type { Fields } from './types.ts';

export interface AiInput {
  id: number;
  url: string;
  fields: Fields;
  /** Already converted to Markdown by the caller. */
  description?: string;
  acceptanceCriteria?: string;
  reproSteps?: string;
  comments: { author?: string; date: string; text: string }[];
}

export function aiMarkdown(w: AiInput): string {
  const f = w.fields;
  const meta = [
    ['Type', f['System.WorkItemType']],
    ['State', f['System.State']],
    ['Assigned to', f['System.AssignedTo']?.displayName],
    ['Priority', f['Microsoft.VSTS.Common.Priority']?.toString()],
    ['Iteration', f['System.IterationPath']],
    ['Area', f['System.AreaPath']],
    ['Tags', f['System.Tags']],
    ['Parent', f['System.Parent'] !== undefined ? `#${f['System.Parent']}` : undefined],
    ['Link', w.url],
  ].filter(([, v]) => v).map(([k, v]) => `- **${k}:** ${v}`);
  const section = (title: string, body?: string) => (body?.trim() ? [`## ${title}`, '', body.trim(), ''] : []);
  return [
    `# #${w.id} ${f['System.Title']}`,
    '',
    ...meta,
    '',
    ...section('Description', w.description),
    ...section('Acceptance criteria', w.acceptanceCriteria),
    ...section('Repro steps', w.reproSteps),
    ...(w.comments.length
      ? ['## Comments', '', ...w.comments.flatMap(c => [`**${c.author ?? '?'}** (${c.date.slice(0, 10)}):`, '', c.text.trim(), ''])]
      : []),
    `When committing, reference this work item with #${w.id}.`,
  ].join('\n');
}
