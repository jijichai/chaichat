import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';

/** Circles v2 Base Group factory on Gnosis (from @aboutcircles/sdk-utils circlesConfig[100]). */
export const BASE_GROUP_FACTORY = '0xD0B5Bd9962197BEaC4cbA24244ec3587f19Bd06d' as const;
const PROFILE_PIN_URL = 'https://rpc.aboutcircles.com/profiles/pin';
/** Circles convention: max uint96 expiry = indefinite trust. */
const INDEFINITE_EXPIRY = (1n << 96n) - 1n;

const factoryAbi = [
  {
    type: 'function',
    name: 'createBaseGroup',
    inputs: [
      { name: '_owner', type: 'address' },
      { name: '_service', type: 'address' },
      { name: '_feeCollection', type: 'address' },
      { name: '_initialConditions', type: 'address[]' },
      { name: '_name', type: 'string' },
      { name: '_symbol', type: 'string' },
      { name: '_metadataDigest', type: 'bytes32' },
    ],
    outputs: [
      { name: 'group', type: 'address' },
      { name: 'mintHandler', type: 'address' },
      { name: 'treasury', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'BaseGroupCreated',
    inputs: [
      { name: 'group', type: 'address', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'mintHandler', type: 'address', indexed: true },
      { name: 'treasury', type: 'address', indexed: false },
    ],
    anonymous: false,
  },
] as const;

const baseGroupAbi = [
  {
    type: 'function',
    name: 'trust',
    inputs: [
      { name: '_trustReceiver', type: 'address' },
      { name: '_expiry', type: 'uint96' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

function clients(env: Env) {
  const account = privateKeyToAccount(env.OPERATOR_PRIVATE_KEY as Hex);
  const transport = http(env.GNOSIS_RPC_URL);
  return {
    account,
    publicClient: createPublicClient({ chain: gnosis, transport }),
    walletClient: createWalletClient({ chain: gnosis, transport, account }),
  };
}

export function operatorAddress(env: Env): string {
  return privateKeyToAccount(env.OPERATOR_PRIVATE_KEY as Hex).address;
}

// ── CIDv0 → bytes32 (inline base58 decode; CIDv0 = base58(0x12 0x20 || digest)) ──

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(s: string): Uint8Array {
  const bytes: number[] = [0];
  for (const ch of s) {
    const val = B58.indexOf(ch);
    if (val < 0) throw new Error('bad base58');
    let carry = val;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of s) {
    if (ch !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

function cidV0ToBytes32(cid: string): Hex {
  const raw = base58Decode(cid);
  if (raw.length !== 34 || raw[0] !== 0x12 || raw[1] !== 0x20) {
    throw new Error('not a CIDv0 sha256 multihash');
  }
  return `0x${[...raw.slice(2)].map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

/** Pin the group profile to the Circles profile service; zero digest on failure. */
async function pinProfile(name: string, description: string | null): Promise<Hex> {
  try {
    const res = await fetch(PROFILE_PIN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        description: description ?? '',
        previewImageUrl: '',
        imageUrl: '',
      }),
    });
    if (!res.ok) throw new Error(`pin failed: ${res.status}`);
    const { cid } = (await res.json()) as { cid: string };
    return cidV0ToBytes32(cid);
  } catch {
    return `0x${'0'.repeat(64)}` as Hex;
  }
}

export interface RegisterGroupParams {
  owner: string;
  name: string; // on-chain limit: ≤ 19 chars
  symbol: string;
  description: string | null;
}

/** Deploy a Base Group; resolves to the new group address. */
export async function registerBaseGroup(
  env: Env,
  params: RegisterGroupParams,
): Promise<string> {
  const { account, publicClient, walletClient } = clients(env);
  const metadataDigest = await pinProfile(params.name, params.description);
  const service = account.address; // chaichat operator manages member trust

  const { request } = await publicClient.simulateContract({
    account,
    address: BASE_GROUP_FACTORY,
    abi: factoryAbi,
    functionName: 'createBaseGroup',
    args: [
      params.owner as Hex,
      service,
      account.address,
      [],
      params.name.slice(0, 19),
      params.symbol,
      metadataDigest,
    ],
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== 'success') throw new Error(`createBaseGroup reverted: ${hash}`);

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === 'BaseGroupCreated') {
        return decoded.args.group;
      }
    } catch {
      continue;
    }
  }
  throw new Error('BaseGroupCreated event not found in receipt');
}

/** Trust a member's Safe into the group (indefinite expiry). Service-only call. */
export async function trustMember(
  env: Env,
  groupAddress: string,
  memberAddress: string,
): Promise<void> {
  const { account, publicClient, walletClient } = clients(env);
  const { request } = await publicClient.simulateContract({
    account,
    address: groupAddress as Hex,
    abi: baseGroupAbi,
    functionName: 'trust',
    args: [memberAddress as Hex, INDEFINITE_EXPIRY],
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== 'success') throw new Error(`trust reverted: ${hash}`);
}
