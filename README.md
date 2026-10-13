# CoWrite

A real-time collaborative text editor, like a minimal Google Docs, built on a **sequence CRDT written from scratch**. It doesn't use Yjs, Automerge or any other collaboration library.

**Live demo:** _coming soon_

- **Conflict-free merging.** Concurrent edits from any number of people converge to the same text, whatever the latency or delivery order.
- **Offline editing.** Keep typing without a connection. Edits are queued and merged when you reconnect.
- **Live cursors and presence.** You see where everyone else is typing, with names and selections.
- **Interactive playground.** Three replicas run in one page over a simulated unreliable network, with adjustable latency, jitter, offline switches and a view of the CRDT's internal state.
- **Shareable rooms.** `/d/<id>` is a live document; send the link to anyone.

## How the CRDT works

The core is an **RGA (Replicated Growable Array)** in [`shared/crdt.ts`](shared/crdt.ts), about 300 lines with no dependencies. The browser and the server run the same code.

1. **Unique ids.** Every inserted character gets an id `[site, clock]`: the author's random site id plus a Lamport clock. Positions are named by id ("after `bob:12`"), never by index, so they stay valid under concurrent edits.
2. **Deterministic ordering.** An insert is placed right after its *origin*, skipping any neighbours whose id is greater. Ids are totally ordered, and a causal successor always has a larger clock, so every replica makes the same decision. Words typed at the same spot never interleave.
3. **Tombstones.** Deletes only mark characters as deleted, so a concurrent insert that references a deleted character still finds it.
4. **Causal buffering.** An op whose origin hasn't arrived yet is buffered and applied once its dependency shows up.
5. **State vectors.** Each replica records the highest clock it has seen from every site. `missingFor(vector)` returns exactly the ops another replica lacks, which handles reconnect, catch-up and persistence.

The operations commute, are idempotent and tolerate reordering, so the server never has to resolve conflicts. It relays ops and stores snapshots.

## Architecture

```
Browser (React)                      Node server
┌───────────────────────┐   ops    ┌─────────────────────────┐
│ textarea ─diff─► Doc  │ ───────► │ Room: Doc replica       │
│   ▲              │    │ ◄─────── │  • relays ops & cursors │
│   └─ anchors ◄───┘    │ ack/ops  │  • state-vector catch-up│
│ outbox (offline queue)│   (ws)   │  • JSON snapshots       │
└───────────────────────┘          └─────────────────────────┘
```

| Path | What it contains |
| --- | --- |
| `shared/crdt.ts` | The RGA CRDT: local edits, remote integration, sync, anchors |
| `shared/protocol.ts` | WebSocket message types and strict validation of untrusted input |
| `shared/sync-client.ts` | Client sync: outbox, acks, reconnect with backoff, presence |
| `server/` | Express + `ws` server: rooms, relaying, persistence, heartbeats |
| `client/src/components/CollabEditor.tsx` | Textarea ↔ CRDT binding, with a backdrop layer for remote cursors |
| `client/src/sim.ts` | Simulated peer-to-peer network for the playground |
| `test/` | CRDT unit and fuzz tests, server integration tests |

**Editor binding.** On each input event the editor diffs the old and new text, using the caret to break ties between repeated characters, and turns the change into CRDT ops. Your own selection is stored as CRDT anchors, so a remote edit never makes your caret jump. Remote cursors are drawn on a transparent backdrop that mirrors the textarea's text layout.

**Sync protocol.**

1. The client sends `hello { site, vector }`.
2. The server replies `welcome { ops it is missing, server vector, peers }`.
3. The client resends any unacknowledged ops.

After that, ops flow both ways and the server acks each batch. Ops are idempotent, so resending is always safe.

**Hardening.** Every message is validated. A client can only author ops under its own site id. Payloads, batches, document size and room count are all capped. Snapshots are written atomically.

## Run locally

Requires Node 22.18+ (Node runs the TypeScript directly, so the server has no build step).

```bash
npm install
npm run dev:server   # terminal 1: API + WebSocket on :3000
npm run dev:client   # terminal 2: Vite on :5173 (proxies /ws)
```

Production build: `npm run build && npm start`, then open http://localhost:3000.

## Tests

```bash
npm test          # 77 tests: CRDT unit + 60 randomized fuzz seeds + server integration
npm run typecheck
```

The fuzz suite runs 2–4 replicas through random concurrent inserts and deletes, delivering ops in random order, partially, and with duplicates. It then checks that every replica converges to identical text.

## Deploy on Render

The repo includes a [`render.yaml`](render.yaml) blueprint. In Render choose **New → Blueprint**, select this repo, and deploy. It builds with `npm run build` and serves the app and WebSocket from one free web service.

On the free plan the disk is temporary, so documents last until the service restarts or sleeps. Point `DATA_DIR` at a persistent disk to keep them.

## Limitations and next steps

- Position lookups are O(n) in document size; a balanced tree or skip list over runs would make them O(log n).
- Tombstones are never garbage-collected.
- Plain text only. Rich text would need formatting marks as another CRDT layer.
