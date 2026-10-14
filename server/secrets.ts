import crypto from 'node:crypto';
import type { Db } from './db.ts';

/**
 * Encrypts small secrets (people's own AI keys) at rest with AES-256-GCM.
 * The key comes from APP_SECRET, or is generated once and kept in the database.
 */
export class Vault {
  private key: Buffer | null = null;
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  private async getKey(): Promise<Buffer> {
    if (this.key) return this.key;
    if (process.env.APP_SECRET) return (this.key = crypto.createHash('sha256').update(process.env.APP_SECRET).digest());
    const [row] = await this.db.query<{ value: string }>("select value from server_secrets where name = 'vault'");
    if (row) return (this.key = Buffer.from(row.value, 'base64'));
    const fresh = crypto.randomBytes(32);
    await this.db.query("insert into server_secrets (name, value) values ('vault', $1) on conflict (name) do nothing", [fresh.toString('base64')]);
    const [again] = await this.db.query<{ value: string }>("select value from server_secrets where name = 'vault'");
    return (this.key = Buffer.from(again.value, 'base64'));
  }

  async seal(plain: string): Promise<string> {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', await this.getKey(), iv);
    const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${body.toString('base64')}`;
  }

  async open(sealed: string): Promise<string | null> {
    const [v, iv, tag, body] = sealed.split('.');
    if (v !== 'v1' || !body) return null;
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', await this.getKey(), Buffer.from(iv, 'base64'));
      d.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}
