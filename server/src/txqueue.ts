import { DurableObject } from 'cloudflare:workers';
import { D1Storage } from './storage/d1';
import { registerBaseGroup, trustMember } from './groups';

interface RegisterGroupJob {
  kind: 'register-group';
  circleId: string;
  owner: string;
  name: string;
  symbol: string;
  description: string | null;
}

interface TrustJob {
  kind: 'trust';
  circleId: string;
  identityId: string;
  groupAddress: string;
  memberAddress: string;
}

type Job = RegisterGroupJob | TrustJob;

interface JobRow {
  [key: string]: SqlStorageValue;
  id: number;
  payload: string;
  attempts: number;
}

const MAX_ATTEMPTS = 8;
const BASE_RETRY_MS = 5_000;

/**
 * Serializes every operator-EOA transaction on Gnosis. One named instance
 * ('operator') owns the wallet nonce by construction: jobs run one at a time,
 * each waiting for its receipt before the next starts. Alarms drive retries
 * with exponential backoff; results land in D1.
 */
export class TxQueue extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS jobs (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          payload    TEXT NOT NULL,
          attempts   INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )
      `);
    });
  }

  async enqueueRegisterGroup(job: Omit<RegisterGroupJob, 'kind'>): Promise<void> {
    await this.enqueue({ kind: 'register-group', ...job });
  }

  async enqueueTrust(job: Omit<TrustJob, 'kind'>): Promise<void> {
    await this.enqueue({ kind: 'trust', ...job });
  }

  async pending(): Promise<number> {
    const row = this.ctx.storage.sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM jobs')
      .one();
    return row.n;
  }

  private async enqueue(job: Job): Promise<void> {
    this.ctx.storage.sql.exec(
      'INSERT INTO jobs (payload, created_at) VALUES (?, ?)',
      JSON.stringify(job),
      Date.now(),
    );
    // Run soon; an already-set alarm just gets pulled earlier.
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > Date.now() + 100) {
      await this.ctx.storage.setAlarm(Date.now() + 100);
    }
  }

  async alarm(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<JobRow>('SELECT id, payload, attempts FROM jobs ORDER BY id LIMIT 1')
      .toArray()[0];
    if (!next) return;

    const job = JSON.parse(next.payload) as Job;
    try {
      await this.execute(job);
      this.ctx.storage.sql.exec('DELETE FROM jobs WHERE id = ?', next.id);
    } catch (err) {
      const attempts = next.attempts + 1;
      console.log(
        JSON.stringify({
          level: 'warn',
          message: 'txqueue job failed',
          kind: job.kind,
          attempts,
          error: err instanceof Error ? err.message.slice(0, 300) : 'unknown',
        }),
      );
      if (attempts >= MAX_ATTEMPTS) {
        // Dead-letter: drop the job; the circle keeps group_address NULL and
        // the UI keeps showing "registering…" — re-creation can be manual.
        this.ctx.storage.sql.exec('DELETE FROM jobs WHERE id = ?', next.id);
        console.log(
          JSON.stringify({ level: 'error', message: 'txqueue job dead-lettered', kind: job.kind }),
        );
      } else {
        this.ctx.storage.sql.exec('UPDATE jobs SET attempts = ? WHERE id = ?', attempts, next.id);
        await this.ctx.storage.setAlarm(Date.now() + BASE_RETRY_MS * 2 ** attempts);
        return;
      }
    }

    // More work queued? Keep draining.
    const remaining = await this.pending();
    if (remaining > 0) await this.ctx.storage.setAlarm(Date.now() + 100);
  }

  private async execute(job: Job): Promise<void> {
    const store = new D1Storage(this.env.DB);

    if (this.env.DEV_FAKE_CHAIN === '1') {
      if (job.kind === 'register-group') {
        const fake = `0xdev${job.circleId.replace(/-/g, '').slice(0, 36)}`.padEnd(42, '0');
        await store.setCircleGroupAddress(job.circleId, fake);
        await this.backfillTrust(job.circleId, fake);
      } else {
        await store.setMemberTrusted(job.circleId, job.identityId, Date.now());
      }
      return;
    }

    if (job.kind === 'register-group') {
      const groupAddress = await registerBaseGroup(this.env, {
        owner: job.owner,
        name: job.name,
        symbol: job.symbol,
        description: job.description,
      });
      await store.setCircleGroupAddress(job.circleId, groupAddress);
      console.log(
        JSON.stringify({ level: 'info', message: 'group registered', circleId: job.circleId, groupAddress }),
      );
      await this.backfillTrust(job.circleId, groupAddress);
    } else {
      await trustMember(this.env, job.groupAddress, job.memberAddress);
      await store.setMemberTrusted(job.circleId, job.identityId, Date.now());
      console.log(
        JSON.stringify({ level: 'info', message: 'member trusted', circleId: job.circleId, member: job.memberAddress }),
      );
    }
  }

  /** After a group lands on-chain, queue trust for members who joined early. */
  private async backfillTrust(circleId: string, groupAddress: string): Promise<void> {
    const store = new D1Storage(this.env.DB);
    const members = await store.listUntrustedSafeMembers(circleId);
    for (const m of members) {
      await this.enqueue({
        kind: 'trust',
        circleId,
        identityId: m.identityId,
        groupAddress,
        memberAddress: m.safeAddress,
      });
    }
  }
}
