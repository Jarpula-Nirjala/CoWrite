import express from 'express';
import type { AppCtx } from './context.ts';
import { HttpError, requireUser, str } from './http.ts';

const DAY = 86_400_000;
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function meRoutes(ctx: AppCtx) {
  const r = express.Router();
  const { db, notifier } = ctx;

  // ------------------------------------------------------- notifications

  r.get('/notifications', async (_req, res) => {
    const user = requireUser(res);
    const { items, unread } = await notifier.list(user.id);
    res.json({
      unread,
      notifications: items.map((n) => ({ id: n.id, kind: n.kind, docId: n.doc_id, actorName: n.actor_name, body: n.body, read: n.read, createdAt: n.created_at })),
    });
  });

  r.post('/notifications/read', async (req, res) => {
    const user = requireUser(res);
    await notifier.markRead(user.id, str(req.body?.id, 20) || undefined);
    res.json({ ok: true });
  });

  // ----------------------------------------------------------- activity

  r.get('/activity', async (_req, res) => {
    const user = requireUser(res);
    const since = dayKey(Date.now() - 29 * DAY);
    // Documents the user owns or has joined.
    const scope = `(select id from documents where owner_id = $1 and deleted_at is null
                    union select doc_id from doc_members where user_id = $1)`;
    const [daily, mine, collaborators, topDocs, totals] = await Promise.all([
      db.query<{ day: string; edits: number }>(
        `select day, sum(inserts + deletes)::int as edits from activity where doc_id in ${scope} and day >= $2 group by day`,
        [user.id, since],
      ),
      db.query<{ day: string; inserts: number; deletes: number }>(
        `select day, sum(inserts)::int as inserts, sum(deletes)::int as deletes from activity where user_id = $1 and day >= $2 group by day`,
        [user.id, since],
      ),
      db.query<{ name: string; edits: number }>(
        `select name, sum(inserts + deletes)::int as edits from activity where doc_id in ${scope} and day >= $2
         group by name order by edits desc limit 6`,
        [user.id, since],
      ),
      db.query<{ id: string; title: string; edits: number }>(
        `select d.id, d.title, sum(a.inserts + a.deletes)::int as edits from activity a join documents d on d.id = a.doc_id
         where a.doc_id in ${scope} and a.day >= $2 and d.deleted_at is null group by d.id, d.title order by edits desc limit 6`,
        [user.id, since],
      ),
      db.query<{ owned: number; shared: number; comments: number; written: number }>(
        `select
           (select count(*)::int from documents where owner_id = $1 and deleted_at is null) as owned,
           (select count(*)::int from doc_members where user_id = $1) as shared,
           (select count(*)::int from comments where author_id = $1) as comments,
           (select coalesce(sum(inserts), 0)::int from activity where user_id = $1) as written`,
        [user.id],
      ),
    ]);

    const days: { day: string; edits: number; mine: number }[] = [];
    const byDay = new Map(daily.map((d) => [d.day, d.edits]));
    const mineByDay = new Map(mine.map((d) => [d.day, d.inserts + d.deletes]));
    for (let i = 29; i >= 0; i--) {
      const day = dayKey(Date.now() - i * DAY);
      days.push({ day, edits: byDay.get(day) ?? 0, mine: mineByDay.get(day) ?? 0 });
    }
    // Writing streak: consecutive days (ending today or yesterday) with something typed.
    const year = await db.query<{ day: string; chars: number }>(
      'select day, sum(inserts)::int as chars from activity where user_id = $1 and day >= $2 group by day',
      [user.id, dayKey(Date.now() - 370 * DAY)],
    );
    const chars = new Map(year.map((d) => [d.day, d.chars]));
    const wrote = (i: number) => (chars.get(dayKey(Date.now() - i * DAY)) ?? 0) > 0;
    let streak = 0;
    for (let i = wrote(0) ? 0 : 1; i < 370 && wrote(i); i++) streak++;
    let longest = 0;
    let run = 0;
    for (let i = 369; i >= 0; i--) {
      run = wrote(i) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    const calendar: { day: string; chars: number }[] = [];
    for (let i = 181; i >= 0; i--) {
      const day = dayKey(Date.now() - i * DAY);
      calendar.push({ day, chars: chars.get(day) ?? 0 });
    }
    res.json({ days, collaborators, topDocs, totals: totals[0], writing: { today: chars.get(dayKey(Date.now())) ?? 0, streak, longest, calendar } });
  });

  // ----------------------------------------------------- public profile

  r.get('/users/:username', async (req, res) => {
    const user = await ctx.auth.byUsername(String(req.params.username));
    if (!user) throw new HttpError(404, 'No one by that name here.');
    const [published, stats] = await Promise.all([
      db.query<{ id: string; title: string; updated_at: number; content_text: string }>(
        'select id, title, updated_at, content_text from documents where owner_id = $1 and published and deleted_at is null order by updated_at desc',
        [user.id],
      ),
      db.query<{ documents: number; written: number }>(
        `select (select count(*)::int from documents where owner_id = $1 and deleted_at is null) as documents,
                (select coalesce(sum(inserts), 0)::int from activity where user_id = $1) as written`,
        [user.id],
      ),
    ]);
    res.json({
      profile: { name: user.name, username: user.username, bio: user.bio, avatar: user.avatar, createdAt: user.created_at },
      stats: stats[0],
      published: published.map((d) => ({ id: d.id, title: d.title, updatedAt: d.updated_at, excerpt: d.content_text.slice(0, 220) })),
    });
  });

  /** Read-only public page for a published document. */
  r.get('/public/:id', async (req, res) => {
    const [d] = await db.query<{ title: string; content_text: string; updated_at: number; name: string; username: string; avatar: string | null }>(
      `select d.title, d.content_text, d.updated_at, u.name, u.username, u.avatar from documents d join users u on u.id = d.owner_id
       where d.id = $1 and d.published and d.deleted_at is null`,
      [String(req.params.id)],
    );
    if (!d) throw new HttpError(404, 'This page is not published.');
    // The live room has the newest content, with formatting and images.
    const room = await ctx.rooms.open(String(req.params.id));
    const ok = room && !room.encrypted;
    res.json({
      title: d.title,
      text: ok ? room.doc.text() : d.content_text,
      tokens: ok ? room.doc.tokens() : null,
      settings: ok ? room.doc.getObject('settings') : null,
      readMinutes: Math.max(1, Math.round((ok ? room.doc.text() : d.content_text).split(/\s+/).length / 220)),
      updatedAt: d.updated_at,
      author: { name: d.name, username: d.username, avatar: d.avatar },
    });
  });

  return r;
}
