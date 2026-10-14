# CoWrite

CoWrite is a real-time collaborative document editor in the spirit of Google Docs. Its merge engine is a **sequence CRDT written from scratch**; it uses no Yjs, Automerge or other collaboration library. On top of that engine sits a complete product: accounts, sharing, comments, suggestions, version history, time-travel replay, branching, end-to-end encryption, offline editing and an AI co-writer.

**Live demo:** https://cowrite-uwpc.onrender.com

## Features

**Built on the merge engine**
- **Real-time collaboration** with live, named cursors and selections.
- **Time-travel replay:** a slider plays back how a document was written, keystroke by keystroke. Every character carries a Lamport clock, so history can be replayed in causal order.
- **Who wrote what:** text can be coloured by author, with each person's share of the document.
- **Branch and merge:** fork a document, edit the copy, and merge it back. The fork keeps the original's character ids, so the CRDT merges it without conflicts. You can also pull the original's newer changes into the fork.
- **End-to-end encryption (optional):** the AES-256-GCM key lives in the link's `#fragment` and never reaches the server. The server stores and merges ciphertext by character id.
- **Offline-first PWA:** the app is installable and the app shell is cached. Each document is stored in IndexedDB together with its unsent edits, and a Web Lock per document ensures two tabs never write under the same site id.

**Collaboration**
- **Comments and threads.** Comments are anchored to character ids, so they stay attached to their passage as the text changes. They support replies, resolving, and @mentions.
- **Suggestion mode.** Edits become tracked changes (insertions underlined, deletions struck through) that an editor accepts or rejects.
- **Document chat**, with @mentions that trigger in-app notifications.
- **Presence:** typing, idle and away status, plus a follow mode that scrolls along with a collaborator.
- **Sharing.** Invite links can grant viewer, commenter or editor access, with optional expiry. Links can be revoked, members are listed with their last-seen time, and documents can be published to a public page.
- **AI co-writer.** Claude joins the room as a collaborator with its own cursor and streams its text in as CRDT operations. It can continue writing, summarize, rewrite, fix grammar, shorten, expand, or follow a custom instruction. Every result can be kept or undone.

**Writing tools**
- **Markdown formatting** from a toolbar and keyboard shortcuts.
- **Live preview** (edit, split or preview views) and a clickable **outline**.
- **Statistics:** word goal, reading time, Flesch reading ease, words written this session, and contribution per author.
- **Focus mode** and **typewriter scrolling.**
- **Voice typing** (Web Speech API) and seven **templates.**
- **Command palette** (Ctrl/⌘+K).
- **Selective undo.** Ctrl+Z reverts only your own changes, as new operations, and never touches anyone else's edits.

**Organisation and platform**
- **Library:** folders, tags, stars, recent documents, "shared with me", and a trash that deletes items for good after 30 days.
- **Full-text search** across document contents, with highlighted snippets.
- **Named versions,** with preview and one-click restore. Restores use a Myers diff, so unchanged text keeps its identity.
- **Export** to PDF, Word (.docx), Markdown or plain text, and **import** from .md or .txt.
- **Activity dashboard:** edits per day, top collaborators and most active documents.
- **Accounts:** email and password (scrypt), Google and GitHub OAuth, password reset by email, avatars, usernames and public profiles.

## How the CRDT works

The core is an **RGA (Replicated Growable Array)** in [`shared/crdt.ts`](shared/crdt.ts). It has no dependencies, and the browser and the server run the same code.

1. **Unique ids.** Every inserted character gets an id `[site, clock]`, made of the author's random site id and a Lamport clock. Positions are named by id ("after `bob:12`"), never by index.
2. **Deterministic ordering.** An insert goes right after its origin, skipping any neighbours with a greater id. Ids are totally ordered, so every replica makes the same choice, and words typed at the same spot never interleave.
3. **Tombstones.** A deleted character is only marked as deleted, so a concurrent insert that references it still finds its place.
4. **Causal buffering.** An operation whose dependency hasn't arrived yet waits in a buffer until the dependency shows up.
5. **State vectors.** Each replica records the highest clock it has seen from every site. `missingFor(vector)` returns exactly the operations another replica lacks. That one call powers reconnecting, offline catch-up, merging forks, and persistence.

The server holds a replica too. It never resolves conflicts and never needs to read the text, which is why encrypted documents work at all.

## Architecture

```
Browser (React)                                 Node.js server
┌──────────────────────────────┐   ops/ws    ┌───────────────────────────────┐
│ textarea ─diff─► CRDT Doc     │ ──────────► │ Room: CRDT replica             │
│ anchors · undo · suggestions  │ ◄────────── │ roles · presence · chat        │
│ AES-GCM (optional)            │  ack/ops    │ AI co-writer (Claude) as peer  │
│ IndexedDB copy + outbox       │             │ fork/merge via state vectors   │
└──────────────────────────────┘    REST     └──────────────┬────────────────┘
                                                             │
                                          PostgreSQL (Neon) or PGlite locally
```

| Path | What it contains |
| --- | --- |
| `shared/crdt.ts` | The RGA CRDT: editing, integration, sync, anchors, history, authorship runs |
| `shared/protocol.ts` | WebSocket message types, roles, and validation of untrusted input |
| `shared/sync-client.ts` | Client sync: outbox, acks, reconnect, presence, chat, encryption hooks, latency simulation |
| `server/app.ts` | HTTP and WebSocket server, room hooks, sessions on the socket upgrade |
| `server/rooms.ts` | Rooms, roles, broadcasting, server-authored edits |
| `server/db.ts` | Postgres (`pg`) or PGlite, plus migrations |
| `server/auth.ts`, `server/oauth.ts`, `server/mail.ts` | Accounts, sessions, password reset, OAuth |
| `server/docs.ts`, `server/routes-*.ts` | Documents, access roles, sharing, comments, suggestions, versions, activity |
| `server/ai.ts` | The AI co-writer (Anthropic SDK, streaming) |
| `client/src/editor/` | Editor page modules: session, panels, history, sharing, palette, undo, formatting |
| `client/src/lib/` | End-to-end encryption, offline storage, Markdown, diff, export, templates |

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
| `DATABASE_URL` | Postgres connection string (e.g. Neon). Without it, an embedded PGlite database is used. |
| `PUBLIC_URL` | Public base URL, used for OAuth redirects and reset links |
| `ANTHROPIC_API_KEY` | Enables the AI co-writer |
| `RESEND_API_KEY`, `MAIL_FROM` | Sends password-reset emails. Without them, links are printed to the server log. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Continue with Google". Redirect URI: `<PUBLIC_URL>/api/auth/oauth/google/callback` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | "Continue with GitHub". Redirect URI: `<PUBLIC_URL>/api/auth/oauth/github/callback` |

## Tests

```bash
npm test          # 93 tests: CRDT unit + 60 fuzz seeds, editor logic, server/API integration
npm run typecheck
```

- **CRDT fuzz suite.** It runs 2–4 replicas through random concurrent edits, delivered out of order, partially and twice, and checks that every replica converges to the same text.
- **Integration tests.** These cover sync, offline merging, roles enforced over HTTP and WebSocket, sharing, fork and merge, encrypted rooms, persistence across restarts, and activity tracking.

## Deploy on Render

The repo includes a [`render.yaml`](render.yaml) blueprint. Set `DATABASE_URL` to a free Neon Postgres database so accounts and documents persist across restarts. The other variables are optional.
