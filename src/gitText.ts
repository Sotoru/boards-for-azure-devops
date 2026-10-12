// Pure Git helpers, no `vscode` import, so they run under `node --test`.
import type { WorkItem } from './types.ts';

const slug = (s: string) =>
  s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');

/** Template placeholders: {type} (bugfix for bugs, feature otherwise), {id}, {title} (slug). */
export function branchName(template: string, w: WorkItem) {
  const type = w.fields['System.WorkItemType'] === 'Bug' ? 'bugfix' : 'feature';
  return template
    .replace(/\{type\}/g, type)
    .replace(/\{id\}/g, String(w.id))
    .replace(/\{title\}/g, slug(w.fields['System.Title']))
    .replace(/\/{2,}/g, '/');
}

/** First path/word segment that is only digits: feature/123, users/me/123-fix, bugfix/123_x → 123. */
export function idFromBranch(branch: string | undefined): number | undefined {
  const seg = branch?.split(/[\/_-]/).find(s => /^\d+$/.test(s));
  return seg ? Number(seg) : undefined;
}

/** Commit message reference that Azure Repos turns into a work item link. */
export const commitRef = (id: number) => `#${id}`;
export const hasCommitRef = (message: string, id: number) => new RegExp(`(^|[^\\w])#${id}\\b`).test(message);

export interface ArtifactLink { kind: 'pr' | 'commit'; projectId: string; repoId: string; key: string }

/** vstfs:///Git/PullRequestId/<project>%2F<repo>%2F<pr> and vstfs:///Git/Commit/<project>%2F<repo>%2F<sha>. */
export function parseArtifactLinks(relations: { rel: string; url: string }[] | undefined): ArtifactLink[] {
  return (relations ?? []).flatMap(r => {
    const m = r.rel === 'ArtifactLink' && r.url.match(/^vstfs:\/\/\/Git\/(PullRequestId|Commit)\/(.+)$/i);
    if (!m) return [];
    const [projectId, repoId, key] = decodeURIComponent(m[2]).split('/');
    return projectId && repoId && key ? [{ kind: m[1].toLowerCase() === 'commit' ? 'commit' as const : 'pr' as const, projectId, repoId, key }] : [];
  });
}
