import * as vscode from 'vscode';
import { defaultFilters, FILTER_KEYS, FilterKey, filterOptions, Filters, GroupBy } from './filters';
import { Mode, Model } from './model';
import type { WorkItem } from './types';

const t = vscode.l10n.t;
type Item = vscode.QuickPickItem & { key?: FilterKey; value?: string; sprint?: true };

const sectionTitle = (): Record<FilterKey, string> => ({
  state: t('State'), type: t('Type'), assignee: t('Assigned to'), iteration: t('Iteration'), tags: t('Tags'), priority: t('Priority'),
});
const emptyLabel = (k: FilterKey) => (k === 'assignee' ? t('Unassigned') : t('(none)'));

/** One multi-select QuickPick with a section per field; options come from the loaded data. */
export async function pickFilters(model: Model, mode: Mode = model.mode, data: WorkItem[] = model.items) {
  const f = model.filtersFor(mode);
  const options = filterOptions(data);
  const titles = sectionTitle();
  const items: Item[] = [];
  if (mode === 'all') {
    items.push({ label: t('Sprint'), kind: vscode.QuickPickItemKind.Separator },
      { label: t('Current sprint only'), description: t('uncheck to include backlog and other sprints'), picked: f.currentSprint, sprint: true });
  }
  for (const key of FILTER_KEYS) {
    // Keep selected values that no longer appear in the data, so reopening the picker doesn't silently drop them.
    const values = [...new Set([...options[key], ...f[key]])];
    if (!values.length) continue;
    items.push({ label: titles[key], kind: vscode.QuickPickItemKind.Separator },
      ...values.map(value => ({ label: value || emptyLabel(key), picked: f[key].includes(value), key, value })));
  }
  const picked = await vscode.window.showQuickPick(items, { canPickMany: true, placeHolder: t('Filter work items'), matchOnDescription: true });
  if (!picked) return;
  const next = defaultFilters();
  next.currentSprint = picked.some(i => i.sprint);
  for (const i of picked) if (i.key) next[i.key].push(i.value!);
  await model.setFilters(next, mode);
}

export async function pickGroupBy(model: Model) {
  const choices: (vscode.QuickPickItem & { by: GroupBy })[] = [
    { label: t('State'), by: 'state' },
    { label: t('Board column'), description: t("the team's boards"), by: 'column' },
    { label: t('Hierarchy'), description: t('parent → children'), by: 'hierarchy' },
    { label: t('Assigned to'), by: 'assignee' },
    { label: t('None'), by: 'none' },
  ];
  const current = model.groupBy;
  choices.sort((a, b) => Number(b.by === current) - Number(a.by === current));
  const pick = await vscode.window.showQuickPick(choices, { placeHolder: t('Group by') });
  if (pick) await model.setGroupBy(pick.by);
}

export const clearFilters = (model: Model) =>
  model.setFilters({ ...defaultFilters(), currentSprint: model.filters.currentSprint });
