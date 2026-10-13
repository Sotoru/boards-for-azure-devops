// Pure: a work item as Markdown context for an AI assistant. No `vscode` import, so it runs under `node --test`.
import type { Fields } from './types.ts';

export interface AiInput {
  id: number;
  fields: Fields;
  /** Already converted to Markdown by the caller. */
  description?: string;
  reproSteps?: string;
  /** Branch name from the "Start working" template. */
  branch: string;
}

/** Minimal: title, what to do, and how to name the branch and reference the item in commits. */
export function aiMarkdown(w: AiInput): string {
  const f = w.fields;
  // Bugs often keep everything in the repro steps.
  const body = w.description?.trim() || w.reproSteps?.trim();
  return [
    `# #${w.id} ${f['System.Title']} (${f['System.WorkItemType']})`,
    '',
    ...(body ? [body, ''] : []),
    `- Branch: \`${w.branch}\``,
    `- Commit: include \`#${w.id}\` in the message, so Azure Repos links it to the work item.`,
  ].join('\n');
}
