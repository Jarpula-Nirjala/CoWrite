import type { Db } from './db.ts';
import { newId } from './docs.ts';

export type NotificationKind = 'mention' | 'comment' | 'reply' | 'suggestion' | 'joined' | 'merge' | 'shared' | 'review' | 'task' | 'reminder';

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  doc_id: string | null;
  actor_name: string;
  body: string;
  read: boolean;
  created_at: number;
}

/** In-app notifications (the bell in the header). */
export class Notifier {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async add(userId: string, kind: NotificationKind, docId: string | null, actorName: string, body: string): Promise<void> {
    await this.db.query(
      'insert into notifications (id, user_id, kind, doc_id, actor_name, body, created_at) values ($1, $2, $3, $4, $5, $6, $7)',
      [newId(), userId, kind, docId, actorName.slice(0, 60), body.slice(0, 280), Date.now()],
    );
  }

  async list(userId: string): Promise<{ items: NotificationRow[]; unread: number }> {
    const items = await this.db.query<NotificationRow>(
      'select id, kind, doc_id, actor_name, body, read, created_at from notifications where user_id = $1 order by created_at desc limit 40',
      [userId],
    );
    const [c] = await this.db.query<{ n: number }>('select count(*)::int as n from notifications where user_id = $1 and not read', [userId]);
    return { items, unread: c?.n ?? 0 };
  }

  async markRead(userId: string, id?: string): Promise<void> {
    if (id) await this.db.query('update notifications set read = true where user_id = $1 and id = $2', [userId, id]);
    else await this.db.query('update notifications set read = true where user_id = $1', [userId]);
  }

  /** Usernames mentioned as @handle in `text`. */
  static mentions(text: string): string[] {
    return [...new Set([...text.matchAll(/(?:^|[^\w@])@([a-z0-9][a-z0-9-]{1,28}[a-z0-9])\b/gi)].map((m) => m[1].toLowerCase()))].slice(0, 10);
  }
}
