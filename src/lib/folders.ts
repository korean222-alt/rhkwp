import type { Folder } from '../types';
export function folderPath(id: string | undefined, folders: Folder[]): string {
  const byId = new Map(folders.map(f => [f.id, f]));
  const parts: string[] = [], seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id); const folder = byId.get(id); if (!folder) break;
    parts.unshift(folder.name); id = folder.parentId;
  }
  return parts.join(' / ') || '미분류';
}
export function folderContains(parent: string, id: string | undefined, folders: Folder[]) {
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    if (id === parent) return true;
    seen.add(id); id = folders.find(f => f.id === id)?.parentId;
  }
  return false;
}
