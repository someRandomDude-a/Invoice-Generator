import { initialWorkspace, workspaceSchema, type Workspace } from './model';

export const STORAGE_KEY = 'indiabikes-invoice-studio-v1';
export function loadWorkspace(): { workspace: Workspace; error: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return { workspace: raw ? workspaceSchema.parse(JSON.parse(raw)) : initialWorkspace(), error: '' };
  } catch {
    return { workspace: initialWorkspace(), error: 'Saved data could not be read. It has not been overwritten. Download the recovery data in Settings, then restore a valid backup to resume saving.' };
  }
}
export function downloadFile(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadBytes(name: string, content: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function parseBackup(text: string) {
  if (text.length > 25_000_000) throw new Error('Backup exceeds the 25 MB import limit.');
  return workspaceSchema.parse(JSON.parse(text));
}
