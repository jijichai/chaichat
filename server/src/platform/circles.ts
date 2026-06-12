import { createPublicClient, getAddress, http, isAddress } from 'viem';
import { gnosis } from 'viem/chains';
import type { Storage } from '../storage/types';
import {
  ProofError,
  buildLoginMessage,
  type CirclesProofBody,
  type VerifiedIdentity,
} from './types';

const NONCE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Verify a Circles-host proof: a server-issued nonce signed by the user's
 * Safe via the host's signMessage(message, 'erc1271').
 *
 * viem's verifyMessage hashes with the EIP-191 prefix and calls the Safe's
 * isValidSignature (EIP-1271, with ERC-6492 support for counterfactual
 * accounts) — matching the host's 'erc1271' signature type.
 */
export async function verifyCirclesProof(
  env: Env,
  store: Storage,
  body: CirclesProofBody,
): Promise<VerifiedIdentity> {
  // Lenient on checksum casing (hosts vary); normalize once, use everywhere.
  if (typeof body.address !== 'string' || !isAddress(body.address, { strict: false })) {
    throw new ProofError('InvalidProof', 'bad address');
  }
  const address = getAddress(body.address.toLowerCase());
  if (typeof body.signature !== 'string' || typeof body.nonce !== 'string') {
    throw new ProofError('InvalidProof');
  }

  const consumed = await store.consumeNonce(body.nonce, NONCE_MAX_AGE_MS, Date.now());
  if (!consumed || consumed.platform !== 'circles') throw new ProofError('InvalidNonce');
  if (consumed.address !== address.toLowerCase()) {
    throw new ProofError('InvalidNonce', 'nonce was issued for a different address');
  }

  // The client signs the message exactly as returned by /api/auth/nonce,
  // which embeds the address as it was sent (pre-normalization).
  const message = buildLoginMessage(env.APP_DOMAIN, body.address, body.nonce);

  // Dev-only escape hatch for the host simulator (tools/circles-host-sim.html).
  if (env.DEV_FAKE_AUTH === '1' && body.signature === '0xDEVSIG') {
    return { platform: 'circles', platformUserId: address.toLowerCase() };
  }

  const client = createPublicClient({ chain: gnosis, transport: http(env.GNOSIS_RPC_URL) });
  let valid = false;
  try {
    valid = await client.verifyMessage({
      address,
      message,
      signature: body.signature as `0x${string}`,
    });
  } catch (err) {
    throw new ProofError(
      'InvalidSignature',
      err instanceof Error ? err.message : 'signature check failed',
    );
  }
  if (!valid) throw new ProofError('InvalidSignature');

  return { platform: 'circles', platformUserId: address.toLowerCase() };
}
