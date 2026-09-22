// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { publicHttpTransport } from 'elowen/dist/plugins/publicHttp.js';
import {
  AVATAR_CACHE_CONTROL,
  AVATAR_MAX_BYTES,
  createAvatarFetcher,
  fetchAvatarBytes,
  type AvatarFetch,
  type AvatarUpstream,
  type AvatarUpstreamResponse,
} from '../plugins/chatbot/src/avatarProxy.js';
import { selectAppearanceTemplate, type AppearanceOverrides, type StoredAppearance } from '../plugins/chatbot/src/appearanceContract.js';
import {
  AVATAR_BYTES,
  CHATBOT_SITE as SITE,
  createChatbotHost,
  postRequest,
  publicRequest,
  registerBot,
  type ChatbotHost,
} from './helpers/chatbotHost.js';

/** The chatbot's own avatar, as the widget's page receives it.
 *
 *  Two things are under test and they are deliberately separate. The ADDRESS half is the host's: this plugin
 *  hands the address the owner typed to the platform's validated public transport, which resolves it, refuses
 *  anything that is not a public unicast address and pins the address it validated into the socket. What the
 *  plugin owns is the REQUEST half — `https:` only, no redirect followed, nothing of ours sent, a bounded
 *  wait, and a body whose size and media type are read rather than believed — and that is what most of this
 *  file drives, against a fixture transport rather than a socket: a suite that opens outbound connections is
 *  a suite that depends on somebody else's network. */

/** One answer from an image host: its status, its media type and the bytes it streams. `contentType: null`
 *  is a host that named no media type at all, which is a different thing from naming one we refuse. */
function answer(input: {
  status?: number;
  contentType?: string | null;
  headers?: Record<string, string>;
  chunks?: Uint8Array[];
  onCancel?: () => void;
} = {}): AvatarUpstreamResponse {
  const chunks = input.chunks ?? [AVATAR_BYTES];
  const contentType = input.contentType === undefined ? 'image/png' : input.contentType;
  return {
    status: input.status ?? 200,
    headers: { ...(contentType === null ? {} : { 'content-type': contentType }), ...input.headers },
    body: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
      },
    },
    cancel: () => input.onCancel?.(),
  };
}

/** An image host that answers with what the test says, recording every address the deployment was made to
 *  reach and the options it was called with. */
function imageHost(reply: (url: string) => AvatarUpstreamResponse | Promise<AvatarUpstreamResponse>): {
  upstream: AvatarUpstream;
  calls: { url: string; options: { signal?: AbortSignal } | undefined }[];
} {
  const calls: { url: string; options: { signal?: AbortSignal } | undefined }[] = [];
  return {
    calls,
    upstream: {
      request: (url, options) => {
        calls.push({ url, options });
        return Promise.resolve(reply(url));
      },
    },
  };
}

describe('the address this route is willing to fetch', () => {
  it('refuses anything that is not https before it asks for a connection', async () => {
    const host = imageHost(() => answer());
    // The appearance contract accepts plain http so an owner can name a local test page, and an owner's own
    // browser may well load one. A visitor's panel is not helped by it, and an avatar is not worth an answer
    // nobody can vouch for.
    expect(await fetchAvatarBytes('http://www.example.cz/logo.png', host.upstream)).toEqual({ ok: false, reason: 'insecure_source' });
    // The refusal happened BEFORE anything was reached: no connection was ever asked for.
    expect(host.calls).toEqual([]);
  });

  it('refuses an address that resolves to something internal, through the host transport that owns that rule', async () => {
    // The plugin does not resolve names and does not decide what is reachable: it hands the address to the
    // host's transport, which is the one place that can refuse an address AND pin the one it accepted. This
    // drives the plugin's own fetcher with that real transport, so what is asserted is that the plugin's only
    // outbound path goes through it. A literal address needs no DNS, so nothing here touches a network.
    const fetchAvatar = createAvatarFetcher(() => publicHttpTransport);
    for (const source of [
      'https://127.0.0.1/logo.png',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/logo.png',
      'https://10.1.2.3/logo.png',
      'https://192.168.0.10/logo.png',
      'https://0.0.0.0/logo.png',
    ]) {
      expect(await fetchAvatar(source), source).toEqual({ ok: false, reason: 'unreachable' });
    }
    // The rule itself, named: this is core's, and it is why the loop above answers nothing.
    await expect(publicHttpTransport.validate('https://127.0.0.1/logo.png')).rejects.toThrow(/non-global/);
    // A public address is not refused by that rule, so the loop above is about the address rather than about
    // the transport refusing everything.
    await expect(publicHttpTransport.validate('https://elowen.run/favicon.ico')).resolves.toBe('https://elowen.run/favicon.ico');
  });

  it('never follows a redirect', async () => {
    const host = imageHost(() => answer({ status: 302, headers: { location: 'https://127.0.0.1/elsewhere.png' } }));
    expect(await fetchAvatarBytes('https://www.example.cz/logo.png', host.upstream)).toEqual({ ok: false, reason: 'upstream_refused' });
    // One connection and no second: an answer that points somewhere else is a refusal rather than a fresh
    // request to a name nobody validated.
    expect(host.calls).toHaveLength(1);
  });

  it('sends nothing of ours to the image host', async () => {
    const host = imageHost(() => answer());
    await fetchAvatarBytes('https://www.example.cz/logo.png', host.upstream);
    // No headers argument at all: nothing carries a cookie, an authorization, a referer or a user agent, and
    // the only thing passed is the wait the deployment is willing to spend.
    expect(host.calls).toHaveLength(1);
    expect(Object.keys(host.calls[0]!.options!)).toEqual(['signal']);
    expect(host.calls[0]!.options!.signal).toBeInstanceOf(AbortSignal);
    expect(host.calls[0]!.url).toBe('https://www.example.cz/logo.png');
  });

  it('gives up on an image host that never answers', async () => {
    let asked: AbortSignal | undefined;
    const upstream: AvatarUpstream = {
      // Answers only when it is told to stop, which is what a host that accepts a connection and then says
      // nothing looks like.
      request: (_url, options) => new Promise((_resolve, reject) => {
        asked = options?.signal;
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    };
    const started = Date.now();
    expect(await fetchAvatarBytes('https://www.example.cz/logo.png', upstream, { timeoutMs: 20, maxBytes: AVATAR_MAX_BYTES }))
      .toEqual({ ok: false, reason: 'unreachable' });
    expect(asked?.aborted).toBe(true);
    // Bounded rather than merely eventual: a panel waiting on this is a panel a visitor cannot use.
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('what this route is willing to read', () => {
  it('passes an image through with the media type its own host served', async () => {
    let released = 0;
    const host = imageHost(() => answer({ headers: { 'content-type': 'image/x-icon; charset=binary' }, onCancel: () => { released += 1; } }));
    const fetched = await fetchAvatarBytes('https://elowen.run/favicon.ico', host.upstream);
    expect(fetched).toEqual({ ok: true, contentType: 'image/x-icon', bytes: AVATAR_BYTES });
    // The socket is released whether the body was read or refused.
    expect(released).toBe(1);
  });

  it('refuses an answer that is not an image', async () => {
    for (const contentType of ['text/html; charset=utf-8', 'application/json', '', null]) {
      const host = imageHost(() => answer({ contentType }));
      expect(await fetchAvatarBytes('https://www.example.cz/logo.png', host.upstream), String(contentType))
        .toEqual({ ok: false, reason: 'not_an_image' });
    }
    // An empty body is not an image either, however it is labelled.
    const empty = imageHost(() => answer({ chunks: [] }));
    expect(await fetchAvatarBytes('https://www.example.cz/logo.png', empty.upstream)).toEqual({ ok: false, reason: 'not_an_image' });
  });

  it('stops reading a body that passes the ceiling, and does not believe a declared length instead', async () => {
    const chunk = new Uint8Array(64 * 1024);
    let released = 0;
    // Nine chunks of 64 KiB is 576 KiB against a 512 KiB ceiling: over, whatever `content-length` would have
    // claimed. What arrives is what is measured.
    const oversized = imageHost(() => answer({
      chunks: Array.from({ length: 9 }, () => chunk),
      headers: { 'content-length': '64' },
      onCancel: () => { released += 1; },
    }));
    expect(await fetchAvatarBytes('https://www.example.cz/logo.png', oversized.upstream)).toEqual({ ok: false, reason: 'too_large' });
    // Cut short rather than read to its end: the socket goes back as soon as the ceiling is passed.
    expect(released).toBe(1);

    // The ceiling itself is a pass, so the refusal above is about the byte past it.
    const exact = imageHost(() => answer({ chunks: Array.from({ length: AVATAR_MAX_BYTES / chunk.byteLength }, () => chunk) }));
    const fetched = await fetchAvatarBytes('https://www.example.cz/logo.png', exact.upstream);
    expect(fetched.ok).toBe(true);
    expect(fetched.ok && fetched.bytes.byteLength).toBe(AVATAR_MAX_BYTES);
  });
});

/** The route as a visitor's widget reaches it. */
describe('the avatar a visitor\'s widget reads', () => {
  const storedOf = (overrides: AppearanceOverrides): StoredAppearance => ({ ...selectAppearanceTemplate('elowen'), overrides });

  let host: ChatbotHost;
  beforeEach(() => { host = createChatbotHost(); });

  /** One live visitor, exactly as the widget gets one: the adapter has to be connected and the bot enabled
   *  before the hook will issue a token at all. */
  const liveVisitor = async (): Promise<string> => {
    await host.adapter.connect();
    const issued = await host.handler(postRequest({
      path: 'visitors',
      headers: { origin: SITE },
      body: { schemaVersion: 2, bot: host.store.listBots()[0]!.public_id },
    }));
    expect(issued.status).toBe(200);
    return (issued.body as { token: string }).token;
  };

  const withToken = (token: string) => publicRequest({
    method: 'GET',
    path: 'avatar',
    headers: { origin: SITE, authorization: `ChatbotVisitor ${token}` },
  });

  /** The avatar an owner has configured on the registered chatbot, written the way the administrator's own
   *  route writes it. */
  const setAvatar = (avatarUrl: string): void => {
    const bot = host.store.listBots()[0]!;
    host.store.updateAppearance({
      chatbotUserId: bot.chatbot_user_id,
      expectedUpdatedAt: bot.updated_at,
      displayName: 'Městský úřad',
      appearance: JSON.stringify(storedOf({ avatarUrl })),
      now: '2026-09-22T12:00:00.000Z',
    });
  };

  /** One registered chatbot whose owner has set an avatar. */
  const botWithAvatar = (avatarUrl: string): void => {
    registerBot(host);
    setAvatar(avatarUrl);
  };

  it('answers the owner\'s image as bytes, over the visitor\'s own authorized connection', async () => {
    botWithAvatar('https://elowen.run/favicon.ico');
    const answer = await host.handler(withToken(await liveVisitor()));

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(AVATAR_BYTES);
    // The upstream's own media type travels on, so the browser and the panel both see what the owner's host
    // actually served.
    expect(answer.headers?.['content-type']).toBe('image/png');
    // Short, because the owner can change the image at any time; private, because the answer is gated by one
    // visitor's token and an intermediary has no business holding it for another visitor of another chatbot.
    expect(answer.headers?.['cache-control']).toBe(AVATAR_CACHE_CONTROL);
    // The grant travels with the answer like every other one a widget can trigger: without it the browser
    // would report a CORS failure on the customer's own page instead of delivering the image.
    expect(answer.headers?.['access-control-allow-origin']).toBe(SITE);
    // The address the deployment was made to reach is the one the owner typed, unrewritten.
    expect(host.avatarRequests).toEqual(['https://elowen.run/favicon.ico']);
  });

  it('is refused by every gate the appearance route has', async () => {
    botWithAvatar('https://elowen.run/favicon.ico');
    const token = await liveVisitor();
    // No credential at all.
    expect((await host.handler(publicRequest({ method: 'GET', path: 'avatar', headers: { origin: SITE } }))).status).toBe(401);
    expect((await host.handler(withToken('not-a-token'))).status).toBe(401);
    // A site this chatbot does not answer on.
    expect((await host.handler(publicRequest({
      method: 'GET',
      path: 'avatar',
      headers: { origin: 'https://www.nekdo-jiny.cz', authorization: `ChatbotVisitor ${token}` },
    }))).status).toBe(403);
    // Disabled while its visitor still holds a live token: the same refusal a message would meet.
    host.store.setBotStatus({ chatbotUserId: 12, status: 'disabled', now: '2026-09-22T12:00:01.000Z' });
    expect((await host.handler(withToken(token))).status).toBe(404);
    // Nothing above reached the owner's image host: a refused caller cannot make this deployment fetch.
    expect(host.avatarRequests).toEqual([]);
  });

  it('fetches nothing when there is no address to fetch', async () => {
    // A chatbot nobody has configured: the widget draws its own built-in look, and there is no image to carry.
    registerBot(host);
    const token = await liveVisitor();
    expect((await host.handler(withToken(token))).status).toBe(404);
    // An image that already carries its own bytes needs no route: the widget draws it exactly as it stands.
    setAvatar('data:image/png;base64,iVBORw0KGgo=');
    expect((await host.handler(withToken(token))).status).toBe(404);
    expect(host.avatarRequests).toEqual([]);
  });

  it('answers no_avatar, with the grant, when the deployment cannot serve the image', async () => {
    host = createChatbotHost({ avatar: () => Promise.resolve({ ok: false, reason: 'upstream_refused' } satisfies AvatarFetch) });
    botWithAvatar('https://www.example.cz/logo.png');
    const token = await liveVisitor();
    const answer = await host.handler(withToken(token));

    // A refusal the widget does not have to interpret: an avatar is chrome, and a panel without one works.
    expect(answer.status).toBe(404);
    expect((answer.body as { error: string }).error).toBe('no_avatar');
    expect(answer.headers?.['access-control-allow-origin']).toBe(SITE);
    // The operator gets the reason, the visitor gets nothing: which ceiling answered is not a fact a page
    // can act on.
    expect(host.warnings.some((warning) => warning.includes('could not serve its avatar (upstream_refused)'))).toBe(true);
  });

  it('answers no_avatar for a row it can no longer read, without repeating the appearance route\'s refusal', async () => {
    registerBot(host);
    const bot = host.store.listBots()[0]!;
    const token = await liveVisitor();
    host.db.prepare('UPDATE p_chatbot_bots SET appearance = ? WHERE chatbot_user_id = ?').run('{"schemaVersion":9}', bot.chatbot_user_id);
    const answer = await host.handler(withToken(token));
    // The look is what the widget cannot draw without, and that refusal is the appearance route's to report.
    // Here there is simply no avatar, and nothing was fetched for one.
    expect(answer.status).toBe(404);
    expect(host.avatarRequests).toEqual([]);
  });
});
