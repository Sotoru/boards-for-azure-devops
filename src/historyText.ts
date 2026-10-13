// Pure work item history logic, no `vscode` import, so it runs under `node --test`.
import { plain } from './text.ts';

export interface WorkItemUpdate {
  rev: number;
  revisedBy?: { displayName?: string };
  revisedDate: string;
  fields?: Record<string, { oldValue?: unknown; newValue?: unknown }>;
  relations?: { added?: unknown[]; removed?: unknown[] };
}
export interface Change { field: string; from?: string; to?: string }
export interface HistoryEntry { rev: number; by: string; date: string; created: boolean; changes: Change[]; linksAdded: number; linksRemoved: number }

// Bookkeeping fields that change on every save; comments (System.History) have their own section.
const NOISE = new Set([
  'System.Rev', 'System.ChangedDate', 'System.ChangedBy', 'System.AuthorizedDate', 'System.AuthorizedAs', 'System.RevisedDate',
  'System.Watermark', 'System.PersonId', 'System.CommentCount', 'System.History', 'System.IsDeleted',
  'Microsoft.VSTS.Common.StateChangeDate', 'Microsoft.VSTS.Common.ActivatedDate', 'Microsoft.VSTS.Common.ActivatedBy',
  'Microsoft.VSTS.Common.ResolvedDate', 'Microsoft.VSTS.Common.ResolvedBy', 'Microsoft.VSTS.Common.ClosedDate', 'Microsoft.VSTS.Common.ClosedBy',
  'System.BoardColumnDone',
]);
const isNoise = (f: string) => NOISE.has(f) || f.endsWith('_Kanban.Column.Done');

const MAX = 80;
/** Identities show their name; HTML fields their text, cut short. */
export function display(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'object') return (v as { displayName?: string }).displayName ?? JSON.stringify(v);
  const s = typeof v === 'string' && v.includes('<') ? plain(v) : String(v);
  return s.length > MAX ? `${s.slice(0, MAX)}…` : s;
}

// The update's revisedDate is unreliable for the latest revision; ChangedDate is the moment of the change.
const when = (u: WorkItemUpdate) => String(u.fields?.['System.ChangedDate']?.newValue ?? u.revisedDate);

/** Newest first. The first revision is summarized as "created"; saves with nothing visible are dropped. */
export function historyEntries(updates: WorkItemUpdate[]): HistoryEntry[] {
  return updates.map(u => {
    const created = u.rev === 1;
    const changes = created ? [] : Object.entries(u.fields ?? {})
      .filter(([f]) => !isNoise(f))
      .map(([field, c]) => ({ field, from: display(c.oldValue), to: display(c.newValue) }))
      .filter(c => c.from !== c.to);
    return {
      rev: u.rev, by: u.revisedBy?.displayName ?? '', date: when(u), created, changes,
      linksAdded: u.relations?.added?.length ?? 0, linksRemoved: u.relations?.removed?.length ?? 0,
    };
  }).filter(e => e.created || e.changes.length || e.linksAdded || e.linksRemoved).reverse();
}

/** Oldest first: each state the item went through and when it entered it. */
export const statePath = (updates: WorkItemUpdate[]) =>
  updates.flatMap(u => {
    const s = u.fields?.['System.State']?.newValue;
    return typeof s === 'string' ? [{ state: s, date: when(u) }] : [];
  });
