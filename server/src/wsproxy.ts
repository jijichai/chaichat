/**
 * Same-origin WebSocket proxy for the freeq IRC server.
 *
 * The Circles iOS in-app webview drops CROSS-origin WebSocket connections
 * (app at chaichat.attps.workers.dev → wss://irc.wumblr.com/irc fails with
 * code=1006 "network connection was lost"). Routing the WS through the Worker
 * makes it same-origin (wss://chaichat.attps.workers.dev/irc), which webviews
 * allow — the Worker then relays bytes to the real freeq server.
 */

// Fetch the upstream WS over https:// (the Workers runtime upgrades it via the
// Upgrade header). wss:// here yields a 502.
const UPSTREAM_WS = 'https://irc.wumblr.com/irc';

export async function handleIrcProxy(request: Request): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  // Open the upstream WebSocket to the real freeq server.
  let upstream: WebSocket | null;
  try {
    const upstreamResp = await fetch(UPSTREAM_WS, {
      headers: { Upgrade: 'websocket' },
    });
    upstream = upstreamResp.webSocket;
    if (!upstream) {
      console.log(
        JSON.stringify({
          level: 'error',
          message: 'irc proxy: upstream returned no webSocket',
          status: upstreamResp.status,
        }),
      );
      return new Response('Upstream did not return a WebSocket', { status: 502 });
    }
  } catch (err) {
    console.log(
      JSON.stringify({ level: 'error', message: 'irc proxy upstream connect failed', err: String(err) }),
    );
    return new Response('Upstream connect failed', { status: 502 });
  }

  // Create the client-facing side of the pair.
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];

  // Half-open so we coordinate close on each side independently.
  server.accept();
  upstream.accept();

  // client → upstream
  server.addEventListener('message', (event) => {
    try {
      upstream!.send(event.data);
    } catch {
      // upstream gone; close client
      try {
        server.close(1011, 'upstream send failed');
      } catch {
        /* ignore */
      }
    }
  });
  server.addEventListener('close', (event) => {
    try {
      upstream!.close(event.code || 1000, event.reason);
    } catch {
      /* ignore */
    }
  });
  server.addEventListener('error', () => {
    try {
      upstream!.close(1011, 'client error');
    } catch {
      /* ignore */
    }
  });

  // upstream → client
  upstream.addEventListener('message', (event) => {
    try {
      server.send(event.data);
    } catch {
      try {
        upstream!.close(1011, 'client send failed');
      } catch {
        /* ignore */
      }
    }
  });
  upstream.addEventListener('close', (event) => {
    try {
      server.close(event.code || 1000, event.reason);
    } catch {
      /* ignore */
    }
  });
  upstream.addEventListener('error', () => {
    try {
      server.close(1011, 'upstream error');
    } catch {
      /* ignore */
    }
  });

  return new Response(null, { status: 101, webSocket: client });
}
