# CoWrite

CoWrite is a real-time collaborative workspace in the spirit of Google Docs. It covers rich documents, slide decks, whiteboards, kanban boards and spreadsheets. Its merge engine is a **CRDT written from scratch**; it uses no Yjs, Automerge or other collaboration library. Because every character and object carries its full history, CoWrite can do things a conventional editor can't:
- compare any two moments;
- undo one person's edits;
- branch and merge documents;
- sync peer-to-peer when the server is down.

**Live demo:** https://cowrite-uwpc.onrender.com

## Features

**Documents that look designed**
- **True rich-text editor** (ProseMirror view bound to our CRDT):
  - bold, italic, underline and strikethrough, fonts, sizes, colours and highlights;
  - alignment, headings, lists, checklists, quotes, callouts and code;
  - no Markdown symbols shown, although Markdown shortcuts work.
- **Notebook and diary paper.** Ruled, college, dotted or grid pages with a red margin line, a dated header, handwriting and dyslexia-friendly fonts, and cream, kraft, blueprint or night paper.
- **A gallery of 50 designed templates**, each with a live preview:
  - documents: diary, Cornell notes, bullet journal, resume, proposal, invoice, research paper and others;
  - slide decks: pitch, class, portfolio, tech talk;
  - whiteboards: brainstorm, retrospective, SWOT, mind map, flowchart;
  - kanban boards and spreadsheets: budget, grades, sales.
- **Page setup:**
  - A4, Letter, wide or full width;
  - margins, headers, footers and page numbers;
  - page breaks and print-ready CSS.
- **Media:**
  - images: paste, drop or upload, then resize, crop, align and caption, with AI descriptions;
  - free stock photos (Openverse);
  - link preview cards;
  - embeds: YouTube, Vimeo, Loom, Maps, Figma, CodePen, Gists, Spotify and X;
  - voice notes, inline drawings, LaTeX maths, Mermaid diagrams and code highlighting;
  - file attachments.
- **Slash commands** (`/`), **emoji** (`:`), **@mentions**, an icon library, a live table of contents and summary cards.
- **Brand kit.** Save your logo, accent colour, font and deck theme once, then apply them to any document or presentation in one click.

**Slides, whiteboards, boards and sheets**
- **Presentations:**
  - eight layouts and 12 designed themes (gradients, decorations, logo and footer);
  - text, images, shapes, alignment guides, speaker notes;
  - full-screen presenter with notes and a timer;
  - export to editable **PowerPoint (.pptx)**, PDF or PNG.
- **Infinite whiteboard:**
  - pen and highlighter, sticky notes, shapes, connectors that follow their shapes, and frames;
  - pan and zoom, with everyone's live cursors;
  - PNG export and an AI summary of the notes.
- **Kanban:**
  - lists and cards with drag and drop;
  - assignees, due dates, labels, priorities, checklists, covers and work-in-progress limits;
  - filters and CSV export.
- **Spreadsheets:**
  - a formula engine with 30+ functions (SUM, AVERAGE, IF, COUNTIF, SUMIF, IFERROR and more), with cycle and error detection;
  - formatting, number formats, sort, fill down, resizable columns and a frozen header row;
  - bar, line and pie charts;
  - CSV import and export, and paste from Excel or Google Sheets.

**Only possible with a CRDT**
- **Compare any two moments.** Additions in green, deletions in red, between any two checkpoints.
- **Paragraph history.** Every edit ever made to one paragraph, including text that was later deleted.
- **Undo one person's edits** since a time, without touching anyone else's.
- **Time-lapse replay**, including **solo playback** of one author and **video export** (WebM).
- **Branch explorer.** Fork, view the family tree, compare a fork with its original side by side, and merge or pull with no conflicts.
- **Private drafts.** Write a section only you can see, then reveal it in one go.
- **Locked sections.** Locks are enforced by the server: an edit inside someone else's lock is refused, and the client reloads the authoritative state.
- **Peer-to-peer sync over WebRTC data channels.** Edits flow browser to browser and survive a server outage. Devices can also be paired with copy-paste codes, with no server at all.
- **Conflict heatmap** showing where several people edited at the same moment.
- **End-to-end encryption (optional).** The server merges ciphertext it cannot read.
- **Offline-first PWA.** The app keeps working offline and syncs when the connection returns.

**AI built in (Claude, optional)**
- **Live co-writer.** Claude joins with its own cursor. It can continue, summarize, rewrite, fix grammar, shorten, expand, change the tone, or follow a custom instruction. Each result can be kept or undone in one click.
- **Document → slides.** Builds a themed presentation with speaker notes.
- **Images to text.** Describes photos, or transcribes a photo of a whiteboard or notebook into notes.
- **Live translation.** A linked copy that re-translates the paragraphs that changed in the original.
- **Meeting mode.** Dictate a meeting; Claude writes the summary, decisions and action items.
- **AI reviewer.** Leaves editor-style comments anchored to exact sentences.
- **Ask your documents.** Answers questions across your library, with links to its sources.

**Collaboration and teams**
- **Presence.** Live cursors and selections, typing, idle and away status, and follow mode.
- **Voice and video calls** inside any document (WebRTC mesh).
- **Comments, suggestions and reactions.** Threaded comments with @mentions, tracked-change suggestions, and emoji reactions on paragraphs.
- **Approval workflow:**
  - draft → in review → approved or changes requested;
  - reviewer notes and notifications;
  - a drawn **e-signature** block.
- **Tasks, calendar and reminders:**
  - assign checklist items with due dates;
  - an "Assigned to me" view and a month calendar;
  - reminders and due-today notifications.
- **Workspaces and teams.** Shared spaces where members can open every document, plus **team templates**.
- **Sharing and publishing:**
  - invite links with roles and expiry;
  - public blog pages that keep the document's design, with reading time, a progress bar and comments.

**Personal and accessible**
- **Themes.** Dark, sepia and light themes, plus the OpenDyslexic font with extra spacing. Your choice is saved to your account.
- **Reading.** Read aloud with word-by-word highlighting, and a distraction-free reading mode.
- **Goals.** Writing streaks, a daily word goal ring, and a six-month writing calendar.
- **Writing tools.** Focus and typewriter modes, voice typing, and a Ctrl/⌘+K command palette.
- **Library.** Folders, tags, full-text search, named versions, trash, and export to PDF, Word and Markdown.

## How the CRDT works

The engine in [`shared/crdt.ts`](shared/crdt.ts) has no dependencies, and the browser and server run the same code.

1. **Sequence (RGA).**
   - Every character gets an id `[site, Lamport clock]`.
   - An insert goes right after its origin, skipping neighbours with a greater id, so every replica orders concurrent typing the same way.
   - Deleted characters stay as tombstones.
2. **Rich text as a flat token stream.**
   - Characters carry inline marks.
   - A `\n` token carries its paragraph's block attributes.
   - A `￼` token is an embedded object (image, table, drawing…).
   - Each attribute is a **last-writer-wins register**, stamped with the id of the operation that set it, so concurrent formatting converges.
3. **Objects.** Slides, shapes, sticky notes, cards and cells are entries in a last-writer-wins **map**. Order is kept with fractional index keys, so concurrent moves never conflict.
4. **Causal buffering and state vectors.** Operations wait until their dependencies arrive. `missingFor(vector)` returns exactly what another replica lacks. That one call powers reconnecting, offline catch-up, peer-to-peer sync and fork merging.
5. **History is data.** Because ids and tombstones are kept, the document can be viewed at any vector (`viewAt`). Two moments can be compared (`compare`), and one site's edits can be listed (`editsBy`). The time machine, replay and selective undo are built on these calls.

## Architecture

```
Browser (React + ProseMirror)                    Node.js server
┌────────────────────────────────┐  ops/ws  ┌────────────────────────────────┐
│ editor ─diff─► CRDT Doc          │ ───────► │ Room: CRDT replica               │
│ slides · board · kanban · sheet  │ ◄─────── │ roles · locks · presence · chat  │
│ AES-GCM (optional) · IndexedDB   │          │ AI co-writer (Claude) as a peer  │
│ WebRTC: P2P sync + calls  ◄──────┼─signal──►│ checkpoints · tasks · reminders  │
└────────────────────────────────┘   REST   └──────────────┬─────────────────┘
                                                            │
                                         PostgreSQL (Neon) or PGlite locally
```

| Path | What it contains |
| --- | --- |
| `shared/crdt.ts` | The CRDT: sequence, attribute registers, object map, sync, history, compare |
| `shared/rich.ts` | Rich-text blocks, Markdown import and export, task extraction |
| `shared/protocol.ts`, `shared/sync-client.ts` | Wire protocol, validation, the sync client (outbox, acks, reconnect, encryption hooks) |
| `server/rooms.ts` | Rooms, roles, lock enforcement, broadcasting |
| `server/routes-*.ts` | Documents, sharing, comments, media, AI, team features (locks, workflow, tasks, workspaces…) |
| `client/src/rich/` | ProseMirror schema, CRDT bridge (`convert.ts`), commands, node views, toolbar |
| `client/src/kinds/` | Slides, whiteboard, kanban and spreadsheet editors (`sheet/formula.ts` is the formula engine) |
| `client/src/editor/` | Document page modules: panels, time machine, review, calls and P2P (`rtc.ts`), undo |

## Run locally

Requires Node 22.18 or later. Node runs the TypeScript directly, so the server has no build step.

```bash
npm install
npm run dev:server   # API + WebSocket on :3000 (PGlite database in ./data)
npm run dev:client   # Vite on :5173
```

For a production build: `npm run build && npm start`, then open http://localhost:3000.

## Configuration

Every setting is optional locally. Each feature switches on when its variable is set.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (for example Neon). Without it, an embedded PGlite database is used. |
| `PUBLIC_URL` | Public base URL, used for OAuth redirects and reset links |
| `ANTHROPIC_API_KEY` | Enables every AI feature (co-writer, slides, translation, reviewer, meeting mode, ask) |
| `RESEND_API_KEY`, `MAIL_FROM` | Sends password-reset emails. Without them, links are printed to the server log. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Continue with Google". Redirect URI: `<PUBLIC_URL>/api/auth/oauth/google/callback` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | "Continue with GitHub". Redirect URI: `<PUBLIC_URL>/api/auth/oauth/github/callback` |

Notes:
- **Calls and peer-to-peer sync** use public STUN servers. They work on most home and office networks. Very strict corporate networks would need a TURN server, which is not included.
- **Uploaded files** are stored in Postgres, with a quota of 60 MB per user.

## Tests

```bash
npm test          # 166 tests
npm run typecheck
```

The suite covers:
- **CRDT:** unit tests, rich-text and object tests, and 40 fuzz seeds (replicas receiving random concurrent edits out of order, partially and twice, and still converging).
- **Editor logic:** the ProseMirror ↔ CRDT bridge and selective undo.
- **Spreadsheet formula engine.**
- **Time machine:** compare, paragraph history, heatmap, and undoing one person's edits.
- **Server integration:**
  - sync, roles and sharing;
  - fork, merge and encryption;
  - locks, approvals, reactions and tasks;
  - workspaces, drafts, public pages, brand kit;
  - the SSRF guard.

## Deploy on Render

The repo includes a [`render.yaml`](render.yaml) blueprint that runs on Render's free plan. Set `DATABASE_URL` to a free Neon Postgres database so accounts and documents persist across restarts. The other variables are optional.
