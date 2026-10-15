import { api, ApiError } from '../api.ts';

/** Uploads a Word or PowerPoint file to the person's Google Drive as a Google Doc or Slides deck; returns its link. */
export async function saveToGoogle(file: Blob, name: string, as: 'docs' | 'slides'): Promise<string> {
  const res = await fetch(`/api/integrations/google/upload?${new URLSearchParams({ as, name })}`, { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' }, credentials: 'same-origin' });
  const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !j.url) throw new ApiError(res.status, j.error ?? 'Could not save to Google. Connect Google in Account settings first.');
  return j.url;
}

export interface Contact {
  name: string;
  email: string;
  photo: string | null;
}

/** People from the person's Google Contacts (and people they have emailed) matching a search. */
export async function searchContacts(q: string): Promise<Contact[]> {
  if (q.trim().length < 2) return [];
  return (await api<{ contacts: Contact[] }>(`/integrations/google/contacts?q=${encodeURIComponent(q)}`).catch(() => ({ contacts: [] }))).contacts;
}

interface PickerConfig {
  token: string;
  apiKey: string;
  appId: string;
}
type PickerDoc = { id: string; name: string; mimeType: string };
declare global {
  interface Window {
    gapi?: { load(name: string, cb: () => void): void };
    google?: {
      picker: {
        PickerBuilder: new () => {
          addView(v: unknown): unknown;
          setOAuthToken(t: string): unknown;
          setDeveloperKey(k: string): unknown;
          setAppId(id: string): unknown;
          setCallback(cb: (d: { action: string; docs?: PickerDoc[] }) => void): unknown;
          enableFeature(f: unknown): unknown;
          build(): { setVisible(v: boolean): void };
        };
        DocsView: new (id?: unknown) => { setIncludeFolders(v: boolean): unknown; setMimeTypes(m: string): unknown };
        ViewId: Record<string, unknown>;
        Feature: Record<string, unknown>;
        Action: Record<string, string>;
      };
    };
  }
}

let loader: Promise<void> | null = null;
function loadPicker(): Promise<void> {
  loader ??= new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.onload = () => window.gapi!.load('picker', () => ok());
    s.onerror = () => no(new Error('Could not load the Google file picker.'));
    document.head.append(s);
  });
  return loader;
}

/** Opens Google's own file chooser; resolves with the picked files (empty if cancelled). */
export async function pickFromDrive(): Promise<PickerDoc[]> {
  const cfg = await api<PickerConfig>('/integrations/google/picker');
  await loadPicker();
  const g = window.google!.picker;
  return new Promise((resolve) => {
    const view = new g.DocsView(g.ViewId.DOCS);
    view.setIncludeFolders(true);
    view.setMimeTypes(
      ['application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet', 'application/vnd.google-apps.presentation', 'text/plain', 'text/markdown'].join(','),
    );
    const b = new g.PickerBuilder();
    b.addView(view);
    b.setOAuthToken(cfg.token);
    b.setDeveloperKey(cfg.apiKey);
    b.setAppId(cfg.appId);
    b.enableFeature(g.Feature.MULTISELECT_ENABLED);
    b.setCallback((d) => {
      if (d.action === g.Action.PICKED) resolve(d.docs ?? []);
      else if (d.action === g.Action.CANCEL) resolve([]);
    });
    b.build().setVisible(true);
  });
}
