import * as m from '@mdi/js';

/** One Material icon (Google's icon set) drawn from its SVG path, sized like Google's own apps. */
export function MIcon({ path, size = 20, color, className, title }: { path: string; size?: number; color?: string; className?: string; title?: string }) {
  return (
    <svg className={`micon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill={color ?? 'currentColor'} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={path} />
    </svg>
  );
}

/** Coloured file-type icons as Google Drive draws them. */
export function FileTypeIcon({ mime, name = '', size = 20 }: { mime: string; name?: string; size?: number }) {
  const [path, color] = fileType(mime, name);
  const boxed = color !== '#5f6368' && !mime.includes('form') && !mime.includes('drawing');
  return (
    <svg className="micon" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {/* Drive's icons are white inside, whatever the page colour */}
      {boxed && <rect x="4.5" y="4.5" width="15" height="15" fill="#fff" />}
      <path d={path} fill={color} />
    </svg>
  );
}

export function fileType(mime: string, name = ''): [string, string] {
  if (mime === 'application/vnd.google-apps.folder') return [m.mdiFolder, '#5f6368'];
  if (mime === 'application/vnd.google-apps.document' || /wordprocessing|msword/.test(mime) || /\.docx?$/i.test(name)) return [m.mdiTextBox, '#4285f4'];
  if (mime === 'application/vnd.google-apps.spreadsheet' || /spreadsheet|excel|csv/.test(mime) || /\.(xlsx?|csv)$/i.test(name)) return [m.mdiGoogleSpreadsheet, '#0f9d58'];
  if (mime === 'application/vnd.google-apps.presentation' || /presentation|powerpoint/.test(mime) || /\.pptx?$/i.test(name)) return [m.mdiFilePresentationBox, '#f4b400'];
  if (mime === 'application/vnd.google-apps.form') return [m.mdiFormSelect, '#7248b9'];
  if (mime === 'application/vnd.google-apps.drawing') return [m.mdiDraw, '#db4437'];
  if (mime === 'application/pdf') return [m.mdiFilePdfBox, '#ea4335'];
  if (mime.startsWith('image/')) return [m.mdiImage, '#d93025'];
  if (mime.startsWith('video/')) return [m.mdiFilmstripBox, '#d93025'];
  if (mime.startsWith('audio/')) return [m.mdiMusicBox, '#d93025'];
  if (/zip|compressed|tar|rar/.test(mime)) return [m.mdiFolderZip, '#5f6368'];
  if (mime.startsWith('text/')) return [m.mdiFileDocumentOutline, '#5f6368'];
  return [m.mdiFile, '#5f6368'];
}
