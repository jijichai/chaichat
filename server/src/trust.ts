/**
 * Circles trust-graph queries via the Circles RPC.
 *
 * Trust in Circles v2 is directional: `truster` trusts `trustee` until
 * `expiryTime`. "Mutual trust" between A and B means BOTH directions exist and
 * are unexpired: (A→B) and (B→A).
 */

const CIRCLES_RPC = 'https://rpc.aboutcircles.com/';

interface QueryResult {
  result?: { columns: string[]; rows: unknown[][] };
}

/** Does `truster` currently (unexpired) trust `trustee`? */
async function trusts(truster: string, trustee: string): Promise<boolean> {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'circles_query',
    params: [
      {
        Namespace: 'V_CrcV2',
        Table: 'TrustRelations',
        Columns: ['truster', 'trustee', 'expiryTime'],
        Filter: [
          {
            Type: 'Conjunction',
            ConjunctionType: 'And',
            Predicates: [
              {
                Type: 'FilterPredicate',
                FilterType: 'Equals',
                Column: 'truster',
                Value: truster.toLowerCase(),
              },
              {
                Type: 'FilterPredicate',
                FilterType: 'Equals',
                Column: 'trustee',
                Value: trustee.toLowerCase(),
              },
            ],
          },
        ],
        Limit: 5,
      },
    ],
  };

  const res = await fetch(CIRCLES_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Circles RPC ${res.status}`);
  const data = (await res.json()) as QueryResult;
  const rows = data.result?.rows ?? [];
  if (rows.length === 0) return false;

  // expiryTime is the last column we requested; check at least one is unexpired.
  const cols = data.result!.columns;
  const expiryIdx = cols.indexOf('expiryTime');
  const nowSec = Math.floor(Date.now() / 1000);
  return rows.some((r) => {
    const exp = expiryIdx >= 0 ? Number(r[expiryIdx]) : 0;
    return exp > nowSec;
  });
}

/**
 * True iff `a` and `b` mutually trust each other on the Circles graph.
 * Both directional checks run in parallel.
 */
export async function isMutualTrust(a: string, b: string): Promise<boolean> {
  if (a.toLowerCase() === b.toLowerCase()) return true; // self
  const [aTrustsB, bTrustsA] = await Promise.all([trusts(a, b), trusts(b, a)]);
  return aTrustsB && bTrustsA;
}
