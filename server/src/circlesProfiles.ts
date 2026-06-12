/**
 * Resolve Circles profiles (username + avatar) by Safe address.
 *
 * Two-step: search-by-address → { name, CID }, then get-by-CID → the full
 * profile whose `previewImageUrl` is a base64 data: URI (no external image
 * host, so it's CSP/webview friendly).
 */

const PROFILE_BASE = 'https://rpc.aboutcircles.com/profiles';

export interface CirclesProfile {
  name: string | null;
  /** data: URI (base64) or null. */
  avatar: string | null;
}

interface SearchResult {
  name?: string;
  address?: string;
  CID?: string;
}

interface ProfileBlob {
  name?: string;
  previewImageUrl?: string;
  imageUrl?: string;
}

/** Fetch a Circles profile for one Safe address. Returns null on any failure. */
export async function fetchCirclesProfile(address: string): Promise<CirclesProfile | null> {
  try {
    const searchRes = await fetch(
      `${PROFILE_BASE}/search?address=${encodeURIComponent(address)}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!searchRes.ok) return null;
    const results = (await searchRes.json()) as SearchResult[];
    const hit = results.find((r) => r.address?.toLowerCase() === address.toLowerCase());
    if (!hit) return null;

    let avatar: string | null = null;
    if (hit.CID) {
      try {
        const blobRes = await fetch(`${PROFILE_BASE}/get?cid=${encodeURIComponent(hit.CID)}`, {
          signal: AbortSignal.timeout(4000),
        });
        if (blobRes.ok) {
          const blob = (await blobRes.json()) as ProfileBlob;
          avatar = blob.previewImageUrl || blob.imageUrl || null;
          // Only data: URIs are safe to relay to the webview under our CSP.
          if (avatar && !avatar.startsWith('data:')) avatar = null;
        }
      } catch {
        // avatar optional
      }
    }

    return { name: hit.name ?? null, avatar };
  } catch {
    return null;
  }
}
