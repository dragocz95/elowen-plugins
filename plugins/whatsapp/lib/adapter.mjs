// The WhatsApp adapter: Baileys connection/pairing management, the inbound message pipeline,
// text commands, numbered menus/asks and outbound sending.
import {
  makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers,
  downloadMediaMessage, jidNormalizedUser,
} from 'baileys';
import QRCode from 'qrcode';
import { rmSync, mkdirSync } from 'node:fs';
import { parseModelExec, buildReplyContext, splitContent, stripThinking, withoutFooter } from './format.mjs';
import { parseAskReply } from './ask.mjs';
import { sameId, isGroup, isSupportedChat, numberOf, toJid, senderIsAdmin, matchPolicy } from './jid.mjs';
import { MESSAGES } from './messages.mjs';
import { LiveMessage } from './stream.mjs';
import { controlCommandsFrom, localCommandsFrom, runControlCommand } from 'elowen-plugin-shared/chatCommands';
import { lifecycleText } from 'elowen-plugin-shared/lifecycle';
import { runTurn } from 'elowen-plugin-shared/turnRunner';
import { buildRoleAccess, applyVisionModel } from 'elowen-plugin-shared/access';
import { fileMimeType, resolveImageFiles, resolveSharedFiles } from 'elowen-plugin-shared/images';
import { createConversationOrderTracker } from 'elowen-plugin-shared/liveMessage';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // default: larger inbound images are noted, not downloaded (cfg: maxImageBytes)
const MAX_IMAGES = 4;                    // default vision cap per message (cfg: maxImages)
// Default lifetime of a parked prompt — a pending ask AND a pending numbered menu, which are the same
// thing from the user's side: an interactive question this chat still owes an answer to. One `askTimeoutMs`
// governs both, so raising it for a slow chat cannot leave the menu expiring six minutes in.
const ASK_TTL_MS = 6 * 60_000;           // default: drop a parked prompt after this (cfg: askTimeoutMs; > the core 5-min timeout)
const MENU_PAGE = 18;                     // numbered-menu options per page (leaves room for nav rows)
const CONTEXT_MAX = 200;                  // upper bound of own conversations the /context picker pages over
const MAX_UPLOAD_IMAGES = 4;             // default generated-image uploads per reply (cfg: maxUploadImages)
const MAX_UPLOAD_FILES = 4;              // shared files (ShareFile) uploaded per reply — no config key: the agent
                                         // chooses what to share, so this is a transport bound, not a preference

/** Token-list settings arrive as arrays from current core and comma/newline strings from older installs. */
export function splitList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

/** Read a numeric config field, clamped to [min,max], falling back to `def` when unset/invalid. */
function cfgNum(cfg, key, def, min, max) {
  return Math.min(Math.max(Number(cfg?.[key]) || def, min), max);
}

/** A minimal pino-shaped logger Baileys accepts, forwarding only warn/error to Elowen's logger (trace/
 *  debug/info are dropped — Baileys is extremely chatty). Baileys calls `child()` and pino-style
 *  `(obj, msg)` signatures, so both are tolerated. */
function pinoShim(log) {
  const fmt = (args) => args.map((x) => {
    try { return typeof x === 'string' ? x : (x?.message ?? JSON.stringify(x)); } catch { return String(x); }
  }).join(' ');
  const shim = {
    level: 'warn',
    child: () => shim,
    trace: () => {}, debug: () => {}, info: () => {},
    warn: (...a) => log.warn?.(`baileys: ${fmt(a)}`),
    error: (...a) => log.error?.(`baileys: ${fmt(a)}`),
    fatal: (...a) => log.error?.(`baileys: ${fmt(a)}`),
  };
  return shim;
}

// ── test seam ──────────────────────────────────────────────────────────────────────────────────────
// Baileys speaks an encrypted Noise-protocol WebSocket with Signal E2E encryption and QR/multi-device
// pairing, so it cannot be faked at the wire. To let the E2E suite exercise the adapter's REAL inbound
// pipeline and outbound send path, `WHATSAPP_E2E_SOCKET_MODULE` may point at a module exporting
// `createFakeSocket(options)` — an in-process fake connected socket (its own EventEmitter for
// creds.update/connection.update/messages.upsert plus sendMessage/sendPresenceUpdate/… ). When the var is
// unset (always, in production) the real `makeWASocket` is used — a strict no-op. Resolved once, cached.
let socketFactory;
async function resolveSocketFactory() {
  if (socketFactory !== undefined) return socketFactory;
  const modPath = process.env.WHATSAPP_E2E_SOCKET_MODULE;
  socketFactory = modPath ? (await import(modPath)).createFakeSocket : null;
  return socketFactory;
}

export class WhatsAppAdapter {
  name = 'whatsapp';
  constructor(cfg, logger, state, listModels, imageDirs, authDir, qrPngPath, answerQuestion, chatCommands = () => [], chatFilesDir = '') {
    this.cfg = cfg;
    this.log = logger;
    this.plog = pinoShim(logger); // pino-shaped logger for Baileys internals
    this.state = state;
    this.listModels = listModels;
    this.imageDirs = imageDirs;
    this.chatFilesDir = chatFilesDir; // where the daemon stores files the agent shared (ShareFile)
    this.authDir = authDir;
    this.qrPngPath = qrPngPath;
    this.answerQuestion = answerQuestion;
    this.chatCommands = chatCommands;
    this.handler = null;
    this.ctl = null;
    this.sock = null;
    this.stopped = false;
    this.meId = null;        // our normalized JID (for self-message + mention detection)
    this.authState = null;
    this.saveCreds = null;
    this.pairingRequested = false;
    this.reconnectTimer = null;
    this.backoffMs = 2000;   // reconnect backoff, grows to a ceiling and resets on a clean open
    this.lastQr = null;      // most recent pairing QR string
    this.lastQrDataUrl = null; // …rendered to a PNG data URL for the Pair modal
    this.lastPairingCode = null; // most recent phone pairing code (phoneNumber flow)
    this.lastQrLogAt = 0;    // throttle the ASCII-QR log line
    this.sentStore = new Map(); // messageId → sent proto message (for getMessage retries + edits)
    this.pendingAsks = new Map(); // askId → { jid, askerJid, questions, selected, awaitingText, key, createdAt }
    this.pendingMenus = new Map(); // jid → { kind:'model'|'thinking'|'context', title, options, entries, page, createdAt }
    this.conversationOrder = createConversationOrderTracker();
    this.msg = MESSAGES[cfg.language] ?? MESSAGES.en;
  }

  listen(onMessage) { this.handler = onMessage; }
  control(api) { this.ctl = api; }

  /** The chat conversation reference for commands: same identity onMessage reports (chat id folded
   *  with the /new generation), so a command targets the exact session a message would. */
  chatRef(jid) { return { platform: 'whatsapp', channelId: `${jid}#${this.state.get(jid).gen ?? 0}` }; }

  /** True when a `/slash` invocation names a plugin prompt macro (kind:'prompt') — the gate that routes it
   *  RAW to the brain (so PI expands the macro; a control/picker/help command is handled locally instead). */
  isPromptCommand(text) {
    if (!text.startsWith('/')) return false;
    const name = text.slice(1).trim().split(/\s+/)[0]?.toLowerCase();
    return !!name && this.chatCommands().some((c) => c.name === name && c.kind === 'prompt');
  }

  /** Resolve the model whose per-chat override will drive the next turn. Without an override use the
   *  exact daemon-resolved default marker; catalog ordering is presentation-only. */
  async modelForChat(jid) {
    const models = await this.listModels().catch(() => []);
    const chosen = this.state.get(jid).model;
    const active = chosen
      ? models.find((m) => m.provider === chosen.provider && m.model === chosen.model)
      : (models.find((m) => m.default === true) ?? models[0]);
    return { models, active };
  }

  /** Live pairing snapshot for the Pair modal: the current QR (as a PNG data URL), the phone pairing
   *  code, and whether the device is already linked. Read by GET /plugins/whatsapp/pairing. */
  getPairing() {
    return { qrImage: this.meId ? null : (this.lastQrDataUrl ?? null), code: this.meId ? null : (this.lastPairingCode ?? null), connected: !!this.meId };
  }

  /** Force a fresh pairing attempt (the Pair button): wipe any stale/half-written credentials so Baileys
   *  mints a brand-new QR (and phone pairing code) instead of hanging trying to resume a dead session,
   *  then re-open the socket. A no-op once the device is already linked. */
  async startPairing() {
    if (this.meId) return { connected: true };
    // Reset the auth state to empty BEFORE reconnecting, so the reconnect starts a clean pairing.
    try { rmSync(this.authDir, { recursive: true, force: true }); mkdirSync(this.authDir, { recursive: true }); } catch { /* best-effort */ }
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    this.authState = state; this.saveCreds = saveCreds;
    this.pairingRequested = false; // let onQr mint a fresh phone pairing code
    this.lastPairingCode = null; this.lastQr = null; this.lastQrDataUrl = null;
    this.backoffMs = 2000;
    // With a fresh authState in place, the 'close' handler's reconnect (or a direct start) yields a new QR.
    if (this.sock) { try { this.sock.end(undefined); } catch { /* 'close' handler reconnects */ } }
    else { await this.startSocket(); }
    return { connected: false };
  }

  /** Unlink the device (the red "Unpair" button): log out on WhatsApp's side so the phone drops the
   *  linked device, wipe the local credentials, and drop back to the unpaired state (a fresh QR can then
   *  be requested via startPairing). */
  async unpair() {
    try { await this.sock?.logout(); } catch { /* may already be unlinked/offline */ }
    try { rmSync(this.authDir, { recursive: true, force: true }); mkdirSync(this.authDir, { recursive: true }); } catch { /* best-effort */ }
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    this.authState = state; this.saveCreds = saveCreds;
    this.meId = null; this.pairingRequested = false;
    this.lastQr = null; this.lastQrDataUrl = null; this.lastPairingCode = null;
    try { this.sock?.end?.(undefined); } catch { /* logout() may have already closed it */ }
    return { connected: false };
  }

  async connect() {
    this.stopped = false;
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    this.authState = state;
    this.saveCreds = saveCreds;
    await this.startSocket();
  }

  /** Build (or rebuild) the Baileys socket and wire its events. Reused on every reconnect with the same
   *  persisted auth state, so a reconnect never re-pairs. */
  async startSocket() {
    if (this.stopped) return;
    const factory = (await resolveSocketFactory()) ?? makeWASocket; // test seam; makeWASocket in production
    const sock = factory({
      auth: this.authState,
      logger: this.plog,
      browser: Browsers.ubuntu('Elowen'),
      markOnlineOnConnect: false, // don't suppress the phone's own notifications
      getMessage: async (key) => this.sentStore.get(key.id) ?? undefined,
    });
    this.sock = sock;
    sock.ev.on('creds.update', this.saveCreds);
    sock.ev.on('connection.update', (u) => void this.onConnectionUpdate(u).catch((e) => this.log.error(`connection update failed: ${e?.message ?? e}`)));
    sock.ev.on('messages.upsert', (up) => void this.onUpsert(up).catch((e) => this.log.error(`message handling failed: ${e?.message ?? e}`)));
  }

  async onConnectionUpdate(u) {
    const { connection, lastDisconnect, qr } = u;
    if (qr) await this.onQr(qr);
    if (connection === 'open') {
      this.meId = this.sock.user?.id ? jidNormalizedUser(this.sock.user.id) : null;
      this.lastQr = null; this.lastQrDataUrl = null; this.lastPairingCode = null; // paired — nothing to show
      this.backoffMs = 2000;
      this.log.info(`whatsapp connected as ${this.sock.user?.id ?? '?'}`);
    }
    if (connection === 'close') {
      if (this.stopped) return;
      const code = lastDisconnect?.error?.output?.statusCode;
      // `loggedOut` (401) BEFORE we ever registered just means the pairing window lapsed — DON'T wipe
      // creds or spam a new pairing code; back off and retry. Only a logout on an already-registered
      // device is a genuine unlink that must clear the dead credentials.
      const wasRegistered = !!this.authState?.creds?.registered;
      if (code === DisconnectReason.loggedOut && wasRegistered) {
        this.log.warn('whatsapp logged out — clearing credentials, re-pair required');
        try { rmSync(this.authDir, { recursive: true, force: true }); mkdirSync(this.authDir, { recursive: true }); } catch { /* best-effort */ }
        const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
        this.authState = state; this.saveCreds = saveCreds;
        this.pairingRequested = false; // allow a fresh pairing code on the next attempt
        this.backoffMs = 2000;
      }
      // Reconnect with exponential backoff (capped) so an unpaired socket can't hammer the API.
      const delay = this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => void this.startSocket().catch((e) => this.log.error(`reconnect failed: ${e?.message ?? e}`)), delay);
    }
  }

  /** Surface a pairing QR: stash it for the Pair modal, drop a PNG in the data dir, and log a scannable
   *  ASCII copy (throttled). A pairing code (phone-number flow) is requested ONCE per plugin run — never
   *  a fresh code on every reconnect, which is what previously hammered the logs/API. */
  async onQr(qr) {
    this.lastQr = qr;
    try { await QRCode.toFile(this.qrPngPath, qr, { width: 512 }); } catch { /* ignore */ }
    try { this.lastQrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 }); } catch { /* ignore */ }
    if (this.cfg.phoneNumber && !this.authState?.creds?.registered && !this.pairingRequested) {
      this.pairingRequested = true;
      const num = String(this.cfg.phoneNumber).replace(/[^0-9]/g, '');
      try {
        const codeStr = await this.sock.requestPairingCode(num);
        this.lastPairingCode = codeStr;
        this.log.info(`whatsapp pairing code for +${num}: ${codeStr}  → WhatsApp → Linked devices → Link with phone number`);
      } catch (e) {
        this.log.error(`pairing code request failed, use the QR instead: ${e?.message ?? e}`);
      }
      return;
    }
    const now = Date.now();
    if (now - this.lastQrLogAt > 25_000) {
      this.lastQrLogAt = now;
      try {
        const ascii = await QRCode.toString(qr, { type: 'terminal', small: true });
        this.log.info(`whatsapp pairing QR — scan it in WhatsApp → Linked devices:\n${ascii}`);
      } catch { /* ignore ASCII render failure */ }
    }
  }

  disconnect() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    try { this.sock?.end?.(undefined); } catch { /* already closed */ }
  }

  // ── access resolution ──

  /** The identifiers a sender is known by, for policy matching: their personal number/JID plus (in a
   *  group) the group JID — so a policy can grant a whole group at once. */
  senderIds(senderJid, chatJid) {
    const ids = [senderJid, numberOf(senderJid)];
    if (isGroup(chatJid)) ids.push(chatJid);
    return ids.filter(Boolean);
  }

  /** Resolve a sender to an access descriptor (policy → projects/prompt + per-chat model). Returns
   *  `access: undefined` for an unmapped sender → the turn is dropped silently. */
  accessFor(senderJid, chatJid) {
    const ids = this.senderIds(senderJid, chatJid);
    const match = matchPolicy(ids, this.cfg.senderPolicies);
    if (!match) return { ids, access: undefined };
    return { ids, access: buildRoleAccess(match, this.state.get(chatJid)) };
  }

  // ── inbound ──

  visibleMessageIdentity(m) {
    if (!this.handler || !m.message || m.key?.fromMe) return null;
    const chatJid = m.key.remoteJid;
    if (!isSupportedChat(chatJid)) return null;
    const group = isGroup(chatJid);
    // Baileys 7 LID addressing: `remoteJid`/`participant` may be an internal `…@lid` id, with the real
    // phone-number JID in the `…Alt` field. Prefer the phone-number JID so sender policies (written as
    // phone numbers) match, and so the sender identity is stable.
    const lidSender = group ? (m.key.participant || m.participant || '') : chatJid;
    const pnSender = group ? (m.key.participantAlt || '') : (m.key.remoteJidAlt || '');
    const senderJid = pnSender || lidSender;
    return senderJid ? { chatJid, group, senderJid } : null;
  }

  async onUpsert(up) {
    if (up.type !== 'notify') return; // 'append' = history sync; only act on genuinely new messages
    // Baileys may put several newly arrived messages in one upsert. Mark the whole visible batch before
    // awaiting the first turn, otherwise a later message in the same batch would look older than its reply.
    const batch = (up.messages ?? []).map((m) => {
      const identity = this.visibleMessageIdentity(m);
      return { m, identity, orderMarker: identity ? this.conversationOrder.mark(identity.chatJid) : null };
    });
    for (const item of batch) {
      await this.onMessage(item.m, item.identity, item.orderMarker).catch((e) => this.log.error(`message failed: ${e?.message ?? e}`));
    }
  }

  async onMessage(m, ingressIdentity = null, ingressMarker = null) {
    const identity = ingressIdentity ?? this.visibleMessageIdentity(m);
    if (!identity) return;
    const { chatJid, group, senderJid } = identity;
    const orderMarker = ingressMarker ?? this.conversationOrder.mark(chatJid);
    if (m.message) this.sentStore.set(m.key.id, m.message); // cache for getMessage retries

    const rawText = this.extractText(m.message);

    // Free-text answer to a parked AskUserQuestion ("other"), or a numbered reply to a pending menu.
    if (await this.handleTextReply(chatJid, senderJid, rawText, m)) return;

    // Group allowlist: when configured, only respond inside these groups.
    if (group) {
      const allowed = new Set(splitList(this.cfg.groupIds));
      if (allowed.size > 0 && !allowed.has(chatJid)) return;
    }

    const { access } = this.accessFor(senderJid, chatJid);
    if (!access) return; // unmapped sender → stay silent

    // Group mention gate: unless configured to answer freely, respond only on @mention or a reply to us.
    if (group && this.cfg.respondWithoutMention === false && !this.isForMe(m)) return;

    let text = this.stripMention(rawText);
    const { images, notes } = await this.collectMedia(m);
    if (notes.length) text = [text, ...notes].filter(Boolean).join('\n');
    if (!text && images.length) text = '[The user sent an image]';
    if (!text) return;

    // A slash command targets the bot's controls, not the brain.
    if (text.startsWith('/') && await this.handleCommand(chatJid, senderJid, text)) return;
    // A recognized plugin prompt-command falls through handleCommand (it owns only control/picker/help):
    // capture its RAW `/name args` so it reaches the brain starting with the slash (PI expands the macro),
    // bypassing the `[sender]` prefix an ordinary message gets below.
    const promptSlash = this.isPromptCommand(text) ? text : null;

    const senderName = m.pushName || numberOf(senderJid);
    const replyCtx = buildReplyContext(this.quotedName(m), this.quotedText(m));
    const cleanText = `${replyCtx ? `${replyCtx}\n` : ''}${text}`;

    const gen = this.state.get(chatJid).gen ?? 0;
    const convoKey = `${chatJid}#${gen}`;

    const stream = this.cfg.streaming !== false
      ? new LiveMessage(this, chatJid, m, senderJid, { collapseStillOrdered: () => this.conversationOrder.isCurrent(orderMarker) })
      : null;

    await runTurn({
      // Resolved INSIDE the turn so the presence update and the "seen" marker are already up while the
      // vision detour asks the host for its model list.
      run: async (onEvent) => {
        const vision = images.length ? parseModelExec(this.cfg.visionModel) : null;
        const turnAccess = vision ? applyVisionModel(access, vision, await this.listModels().catch(() => [])) : access;
        return this.handler(
          {
            platform: 'whatsapp', userId: senderJid, userName: senderName, roleIds: [senderJid],
            channelId: convoKey, access: turnAccess,
            ...(promptSlash ? { promptCommand: true } : {}),
            // A non-group WhatsApp chat is a conversation with exactly one number. The host uses this to
            // decide whether the conversation may carry its sender's personal skills and receive their
            // scheduled jobs, so it must stay strictly "only this one person can read it".
            direct: !group,
            channelName: group ? await this.groupSubject(chatJid) : undefined,
            images: images.length ? images : undefined,
          },
          promptSlash ?? cleanText,
          onEvent,
        );
      },
      stream,
      ask: {
        post: (e) => this.postAsk(chatJid, m, senderJid, e.id, e.questions),
        resolve: (e) => this.resolveAsk(chatJid, e.id, e.reason),
      },
      // WhatsApp presence does NOT expire on its own: leave it composing and the chat shows the bot typing
      // forever, so this is the one surface that has to clear it.
      typing: {
        poke: () => this.sock.sendPresenceUpdate('composing', chatJid),
        stop: () => this.sock.sendPresenceUpdate('paused', chatJid),
      },
      // WhatsApp keeps one reaction per sender per message, so the terminal one replaces the eyes.
      reactions: this.cfg.reactions !== false ? {
        seen: '👀', done: '✅', failed: '❌',
        add: (emoji) => this.react(m.key, emoji),
      } : null,
      send: (reply) => this.sendText(chatJid, stripThinking(reply), m),
      sendError: (text) => this.sendText(chatJid, text, m),
      errorText: (e) => this.msg.error(e?.message ?? e),
      log: (detail) => this.log.error(`whatsapp turn failed in ${chatJid}: ${detail}`),
    });
  }

  /** Extract display text from a message content union (plain, extended, or a media caption). */
  extractText(content) {
    return (
      content?.conversation
      ?? content?.extendedTextMessage?.text
      ?? content?.imageMessage?.caption
      ?? content?.videoMessage?.caption
      ?? content?.documentMessage?.caption
      ?? ''
    ).trim();
  }

  /** Whether a group message is addressed to the bot: an @mention of us, or a reply to one of our
   *  messages. Only consulted when respondWithoutMention is off. */
  isForMe(m) {
    if (!this.meId) return true; // not yet known → don't drop
    const ctx = m.message?.extendedTextMessage?.contextInfo;
    const mentioned = (ctx?.mentionedJid ?? []).some((j) => sameId(j, this.meId));
    const repliedToMe = ctx?.participant ? sameId(ctx.participant, this.meId) : false;
    return mentioned || repliedToMe;
  }

  /** Remove a leading/embedded @<ournumber> mention token from the text. */
  stripMention(text) {
    if (!this.meId) return text;
    const num = numberOf(this.meId);
    return String(text ?? '').replaceAll(`@${num}`, '').replace(/\s+/g, ' ').trim();
  }

  quotedName(m) {
    const ctx = m.message?.extendedTextMessage?.contextInfo;
    if (!ctx?.quotedMessage) return '';
    return ctx.participant ? numberOf(ctx.participant) : '';
  }
  quotedText(m) {
    const ctx = m.message?.extendedTextMessage?.contextInfo;
    if (!ctx?.quotedMessage) return '';
    const text = this.extractText(ctx.quotedMessage);
    // Quoting one of OUR messages must not carry the runtime footer back into the prompt: shown that line
    // as the house style, the model starts forging it itself, with a model name it never ran on. Someone
    // else's trailing italic line is their text and stays.
    return sameId(ctx.participant, this.meId) ? withoutFooter(text) : text;
  }

  /** Download an inbound image (base64, capped) for vision; other media becomes a textual note. */
  async collectMedia(m) {
    const images = [];
    const notes = [];
    const img = m.message?.imageMessage;
    if (img) {
      const size = Number(img.fileLength ?? 0);
      const maxImageBytes = cfgNum(this.cfg, 'maxImageBytes', MAX_IMAGE_BYTES, 1048576, 20971520);
      const maxImages = cfgNum(this.cfg, 'maxImages', MAX_IMAGES, 1, 10);
      if (size && size > maxImageBytes) {
        notes.push('[Attachment: image (too large to read)]');
      } else if (images.length < maxImages) {
        try {
          const buf = await downloadMediaMessage(m, 'buffer', {}, { logger: this.plog, reuploadRequest: this.sock.updateMediaMessage });
          images.push({ data: Buffer.from(buf).toString('base64'), mimeType: img.mimetype || 'image/jpeg' });
        } catch (e) { notes.push('[Attachment: image (download failed)]'); this.log.error(`image download failed: ${e?.message ?? e}`); }
      }
    }
    if (m.message?.audioMessage) notes.push('[Attachment: voice message (audio — not transcribed)]');
    if (m.message?.documentMessage) notes.push(`[Attachment: ${m.message.documentMessage.fileName ?? 'document'}]`);
    if (m.message?.videoMessage && !m.message.videoMessage.caption) notes.push('[Attachment: video]');
    return { images, notes };
  }

  // ── pending menus & prompts (all text-driven — WhatsApp native buttons are unreliable on personal
  //    accounts, so pickers are numbered text menus the user replies to with a number) ──

  /** Apply a numbered-menu pick id (`model:*`, `think:*`, `context:*`) — resolved from a numeric text reply. */
  async handleSelection(chatJid, senderJid, id, m) {
    if (id.startsWith('context:')) {
      const ids = this.senderIds(senderJid, chatJid);
      if (!senderIsAdmin(ids, this.cfg.senderPolicies)) { await this.sendText(chatJid, this.msg.controlForbidden, m); return true; }
      const sessionId = id.slice('context:'.length);
      this.pendingMenus.delete(chatJid);
      if (!this.ctl?.bindContext) { await this.sendText(chatJid, this.msg.noSession, m); return true; }
      // The MOVE is dispatched through the host control surface; ownership is re-verified server-side.
      try {
        const { title } = await this.ctl.bindContext(this.chatRef(chatJid), senderJid, sessionId);
        await this.sendText(chatJid, this.msg.contextBound(title), m);
      } catch (e) {
        await this.sendText(chatJid, this.msg.contextError(e?.message ?? e), m);
      }
      return true;
    }
    if (id.startsWith('model:')) {
      const ids = this.senderIds(senderJid, chatJid);
      if (!senderIsAdmin(ids, this.cfg.senderPolicies)) { await this.sendText(chatJid, this.msg.modelForbidden, m); return true; }
      const [, provider] = id.split(':');
      const [prov, mod] = [provider, id.slice(`model:${provider}:`.length)];
      if (prov && mod) {
        this.state.patch(chatJid, { model: { provider: prov, model: mod } });
        await this.sendText(chatJid, this.msg.modelSet(mod), m);
      }
      this.pendingMenus.delete(chatJid);
      return true;
    }
    if (id.startsWith('think:')) {
      const ids = this.senderIds(senderJid, chatJid);
      if (!senderIsAdmin(ids, this.cfg.senderPolicies)) { await this.sendText(chatJid, this.msg.modelForbidden, m); return true; }
      // Re-resolve capabilities when the numeric reply arrives: the selected model/provider catalog can
      // change while the menu is open, and only values the active descriptor advertises are accepted.
      const { models, active } = await this.modelForChat(chatJid);
      if (!models.length) {
        this.pendingMenus.delete(chatJid);
        await this.sendText(chatJid, this.msg.noModels, m);
        return true;
      }
      const levels = Array.isArray(active?.reasoningLevels) ? active.reasoningLevels : [];
      const value = id.slice('think:'.length);
      if (!levels.length || (value !== 'default' && !levels.includes(value))) {
        this.pendingMenus.delete(chatJid);
        await this.sendText(chatJid, this.msg.reasoningUnavailable, m);
        return true;
      }
      const level = value === 'default' ? '' : value;
      this.state.patch(chatJid, { thinkingLevel: level });
      const displayLevel = level ? String(active.reasoningLabels?.[level] ?? level) : this.msg.reasoningDefaultValue;
      await this.sendText(chatJid, this.msg.thinkingSet(displayLevel), m);
      this.pendingMenus.delete(chatJid);
      return true;
    }
    return false;
  }

  /** How long a parked prompt (ask or numbered menu) stays answerable. */
  askTtlMs() { return cfgNum(this.cfg, 'askTimeoutMs', ASK_TTL_MS, 30000, 1800000); }

  /** Resolve a text reply against a pending prompt: a numeric pick on a model/thinking menu, or an
   *  answer to a parked ask (a number picks that option on a single-question ask; `submit` delivers;
   *  anything else is a free-form answer). Returns true when the message was consumed. */
  async handleTextReply(chatJid, senderJid, text, m) {
    const t = String(text ?? '').trim();
    // Parked AskUserQuestion from this sender.
    for (const [id, pend] of this.pendingAsks) {
      if (Date.now() - pend.createdAt > this.askTtlMs()) { this.pendingAsks.delete(id); continue; }
      if (pend.jid !== chatJid || !sameId(pend.askerJid, senderJid)) continue;
      if (/^submit$/i.test(t)) { await this.submitAsk(id, m); return true; }
      // A single-question ask answers from one reply: a number (or a comma list on multiSelect) picks
      // and submits; anything else is a free-text answer when the question allows it. An unusable
      // reply (options-only question, no valid number) re-prompts instead of being swallowed.
      if (pend.questions.length === 1) {
        const q0 = pend.questions[0];
        const parsed = parseAskReply(t, q0);
        if (parsed?.kind === 'picks') {
          pend.selected[0] = parsed.labels;
          await this.submitAsk(id, m);
          return true;
        }
        if (parsed?.kind === 'other') {
          const settled = this.answerQuestion(id, [{ header: q0.header, selected: pend.selected[0] ?? [], other: parsed.text }]);
          this.pendingAsks.delete(id);
          if (settled) return true; // answer delivered — the model's reply is the acknowledgement, no ack line
          continue; // already timed out server-side → fall through and treat the message as a normal turn
        }
        const hint = q0.multiSelect ? this.msg.replyWithNumbers((q0.options ?? []).length) : this.msg.replyWithNumber((q0.options ?? []).length);
        await this.sendText(pend.jid, hint, m);
        return true;
      }
      // Multi-question asks collect a free-text answer for the first question that allows it, or `submit`.
      if (t && pend.questions[0]?.custom !== false) {
        const q0 = pend.questions[0];
        const settled = this.answerQuestion(id, [{ header: q0.header, selected: pend.selected[0] ?? [], other: t }]);
        this.pendingAsks.delete(id);
        if (settled) return true; // answer delivered — the model's reply is the acknowledgement, no ack line
      }
    }
    // Numeric reply to a pending model/thinking/context menu, resolved against the CURRENT page's entries
    // (a "nav" entry re-renders another page; a "pick" entry selects).
    const menu = this.pendingMenus.get(chatJid);
    if (menu) {
      if (Date.now() - menu.createdAt > this.askTtlMs()) { this.pendingMenus.delete(chatJid); return false; }
      const entries = menu.entries ?? [];
      const n = Number(t);
      if (Number.isInteger(n) && n >= 1 && n <= entries.length) {
        const e = entries[n - 1];
        if (e.type === 'nav') { await this.sendMenu(chatJid, menu.kind, menu.title, menu.options, m, e.page); return true; }
        return this.handleSelection(chatJid, senderJid, e.id, m);
      }
    }
    return false;
  }

  /** Render a numbered text menu the user replies to with a number, and register a pending entry so the
   *  reply resolves. `options`: [{ id, label, description? }]. The FULL option list is paged (no truncation):
   *  each page shows ≤MENU_PAGE numbered picks plus, when there is more than one page, numbered nav entries
   *  ("Previous/Next page") the user selects like any other row. The stored `entries` mirror exactly what is
   *  rendered, so a numeric reply resolves against the current page. */
  async sendMenu(chatJid, kind, title, options, quoted, page = 0) {
    const pages = Math.max(1, Math.ceil(options.length / MENU_PAGE));
    const p = Math.min(Math.max(Number(page) || 0, 0), pages - 1);
    const entries = options.slice(p * MENU_PAGE, p * MENU_PAGE + MENU_PAGE)
      .map((o) => ({ type: 'pick', id: o.id, label: o.label, description: o.description }));
    if (p > 0) entries.push({ type: 'nav', page: p - 1, label: this.msg.pagePrev });
    if (p < pages - 1) entries.push({ type: 'nav', page: p + 1, label: this.msg.pageNext });
    const lines = entries.map((e, i) => `${i + 1}. *${e.label}*${e.type === 'pick' && e.description ? ` — ${e.description}` : ''}`);
    const heading = pages > 1 ? `${title} (${p + 1}/${pages})` : title;
    const body = `${heading}\n\n${lines.join('\n')}\n\n_${this.msg.replyWithNumber(entries.length)}_`;
    this.pendingMenus.set(chatJid, { kind, title, options, entries, page: p, createdAt: Date.now() });
    await this.sendText(chatJid, body, quoted);
  }

  // ── AskUserQuestion ──

  /** Render a parked AskUserQuestion (brain `ask` event) as a numbered text prompt
   *  ("1. label — description"). On a single-question ask the user replies with a number (a comma list
   *  on multiSelect), or free text unless the question sets `custom: false`; multi-question asks collect
   *  a free-text answer or `submit`. Answers are delivered from handleTextReply. */
  async postAsk(chatJid, quoted, askerJid, id, questions) {
    const qs = questions.slice(0, 4);
    const blocks = qs.map((q) => {
      const opts = (q.options ?? []).slice(0, 25).map((op, oi) => `  ${oi + 1}. ${op.label}${op.description ? ` — ${op.description}` : ''}`);
      return `*${q.header}* — ${q.question}\n${opts.join('\n')}`;
    });
    const single = qs.length === 1;
    let hint = this.msg.submitHint;
    if (single) {
      const q0 = qs[0];
      const n = (q0.options ?? []).length;
      hint = q0.multiSelect ? this.msg.replyWithNumbers(n) : this.msg.replyWithNumber(n);
      if (q0.custom !== false) hint += ` ${this.msg.otherHint}`;
    }
    const body = `❓ ${blocks.join('\n\n')}\n\n_${hint}_`;
    this.pendingAsks.set(id, { jid: chatJid, askerJid, questions: qs, selected: {}, createdAt: Date.now() });
    const key = await this.sendText(chatJid, body, quoted);
    const pend = this.pendingAsks.get(id);
    if (pend) pend.key = key;
  }

  /** The core settled this question — by an answer, its own timeout, an abort, or a newer question
   *  superseding it. Retire the posted prompt so a number typed into the chat is no longer read as an
   *  answer to something that can no longer receive one; without this the entry sat in the map until the
   *  local sweep noticed, and the prompt itself never changed. An `answered` resolution needs no edit:
   *  whichever surface answered has already acknowledged it.
   *
   *  The local `askTtlMs` sweep stays — it bounds the map when no `ask_resolved` ever arrives (a restart
   *  mid-question) and it also governs the numbered PICKER menus the core knows nothing about. It is not a
   *  second authority: at six minutes it is deliberately longer than the core's five. */
  async resolveAsk(chatJid, id, reason) {
    const pend = this.pendingAsks.get(id);
    if (!pend) return;
    this.pendingAsks.delete(id);
    if (reason === 'answered' || !pend.key) return;
    const text = reason === 'timeout' ? this.msg.expired : this.msg.cancelled;
    await this.sock.sendMessage(pend.jid ?? chatJid, { text, edit: pend.key }).catch(() => {});
  }

  async submitAsk(id, m) {
    const pend = this.pendingAsks.get(id);
    if (!pend) return;
    const answers = pend.questions.map((q, qi) => ({ header: q.header, selected: pend.selected[qi] ?? [] }));
    const settled = this.answerQuestion(id, answers);
    this.pendingAsks.delete(id);
    if (!settled) await this.sendText(pend.jid, this.msg.expired, m); // only warn if it timed out; success needs no ack
  }

  // ── commands ──

  /** Handle a `/command`. Returns true when the text was a (recognized) command. */
  async handleCommand(chatJid, senderJid, text) {
    const [cmd, ...argParts] = text.slice(1).trim().split(/\s+/);
    const command = cmd.toLowerCase();
    // Join the REST of the tokens, not just the first — mirrors Telegram, so `/fast on` (and any future
    // multi-word command argument) is passed whole instead of silently truncated to one word.
    const arg = argParts.join(' ');
    const admin = () => senderIsAdmin(this.senderIds(senderJid, chatJid), this.cfg.senderPolicies);
    // Control commands share one transport-agnostic core. WHICH names those are is the daemon's answer,
    // not ours: controlCommandsFrom reads `execution` off the catalog we already receive. What runs is the
    // INTERSECTION of that with what the core implements — an unhandled name falls through to the switch
    // below and out as an unknown /word, so a newer daemon may publish a control command this adapter
    // cannot run. Only the pickers stay local, because their numbered-menu UI is WhatsApp-specific.
    if (controlCommandsFrom(this.chatCommands()).has(command)) {
      const handled = await runControlCommand(command, {
        msg: this.msg, reply: (t) => this.sendText(chatJid, t), isAdmin: admin, arg,
        senderPlatformId: senderJid,
        state: this.state, stateId: chatJid, ctl: this.ctl, ref: this.chatRef(chatJid),
        activeModel: async () => (await this.modelForChat(chatJid)).active,
      });
      if (handled) return true;
    }
    // …and the same question for the half the daemon does NOT run: the pickers and /help below exist only
    // because the catalog published them for this surface, so localCommandsFrom is what decides they may
    // run at all. Without it a name removed from the projection stayed typeable here, and an adapter with
    // no catalog answered its hardcoded four as if it had one. This adapter passes no `adapterOwned`
    // names: `voice` and `display` are reserved globally, but there is no STT/TTS and no display module
    // on this transport, so it dispatches neither.
    if (!localCommandsFrom(this.chatCommands()).has(command)) return false;
    switch (command) {
      case 'help':
        // The catalog ALONE — unlike Discord and Telegram, nothing adapter-local is appended, for the same
        // reason nothing is gated in above: advertising a command that does nothing is exactly the drift
        // we remove.
        await this.sendText(chatJid, this.msg.help('Elowen', this.chatCommands()));
        return true;
      case 'model': {
        if (!admin()) { await this.sendText(chatJid, this.msg.modelForbidden); return true; }
        const models = await this.listModels().catch(() => []);
        if (!models.length) { await this.sendText(chatJid, this.msg.noModels); return true; }
        // The FULL catalog is paged by sendMenu (no truncation) — a model past the first page is reachable
        // via the numbered nav rows.
        const options = models.map((mo) => ({ id: `model:${mo.provider}:${mo.model}`, label: mo.model, description: mo.providerLabel }));
        await this.sendMenu(chatJid, 'model', this.msg.pickModel, options);
        return true;
      }
      case 'context': {
        // Operator-gated like /model; ownership is enforced server-side (only the invoking sender's OWN
        // conversations are offered, and binding re-checks). Binding exposes the chosen history to this chat.
        if (!admin()) { await this.sendText(chatJid, this.msg.controlForbidden); return true; }
        const listing = this.ctl?.listContext?.(this.chatRef(chatJid), senderJid, { offset: 0, limit: CONTEXT_MAX }) ?? null;
        if (!listing || !listing.items.length) { await this.sendText(chatJid, this.msg.noContextSessions); return true; }
        const options = listing.items.map((s) => ({ id: `context:${s.id}`, label: s.title || 'Untitled', description: s.model || undefined }));
        await this.sendMenu(chatJid, 'context', this.msg.pickContext, options);
        return true;
      }
      case 'reasoning': {
        if (!admin()) { await this.sendText(chatJid, this.msg.modelForbidden); return true; }
        const { models, active } = await this.modelForChat(chatJid);
        if (!models.length) { await this.sendText(chatJid, this.msg.noModels); return true; }
        const levels = Array.isArray(active?.reasoningLevels) ? active.reasoningLevels : [];
        if (!levels.length) { await this.sendText(chatJid, this.msg.reasoningUnavailable); return true; }
        const options = [
          { id: 'think:default', label: this.msg.reasoningDefaultValue, description: this.msg.reasoningDefault },
          ...levels.map((level) => ({ id: `think:${level}`, label: active.reasoningLabels?.[level] ?? level })),
        ];
        await this.sendMenu(chatJid, 'thinking', this.msg.pickThinking, options);
        return true;
      }
      default:
        return false; // unknown /word → treat as a normal message
    }
  }

  // ── outbound helpers ──

  /** Send text, split into ≤CHUNK pieces (fence-safe); the first piece quotes `quoted` when given. */
  async sendText(chatJid, text, quoted) {
    const pieces = splitContent(text);
    let firstKey = null;
    for (let i = 0; i < pieces.length; i++) {
      const sent = await this.sock.sendMessage(chatJid, { text: pieces[i] }, i === 0 && quoted ? { quoted } : {});
      if (i === 0) firstKey = sent?.key ?? null;
      if (sent?.key && sent.message) this.sentStore.set(sent.key.id, sent.message);
    }
    return firstKey;
  }

  /** Send generated images as image messages (the first optionally quoting the trigger). */
  async sendImages(chatJid, files, quoted) {
    for (let i = 0; i < files.length; i++) {
      await this.sock.sendMessage(chatJid, { image: files[i].data }, i === 0 && quoted ? { quoted } : {}).catch(() => {});
    }
  }

  react(key, emoji) { return this.sock.sendMessage(key.remoteJid, { react: { text: emoji, key } }); }

  /** Send files the agent shared as document messages (the first optionally quoting the trigger). A
   *  document keeps its file name and its bytes, which an image message would not — WhatsApp re-encodes a
   *  picture, and a shared PDF or spreadsheet is exactly the thing that must survive intact. */
  async sendDocuments(chatJid, files, quoted) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      await this.sock.sendMessage(
        chatJid,
        { document: f.data, fileName: f.name, mimetype: fileMimeType(f.name) },
        i === 0 && quoted ? { quoted } : {},
      ).catch((e) => this.log.error(`sendDocument failed: ${e?.message ?? e}`));
    }
  }

  /** Load up to the configured cap (default MAX_UPLOAD_IMAGES) of generated images by validated name
   *  from the image plugins' data dirs. */
  resolveImageFiles(names) {
    return resolveImageFiles(this.imageDirs, names, cfgNum(this.cfg, 'maxUploadImages', MAX_UPLOAD_IMAGES, 1, 10));
  }

  /** Load the bytes behind this turn's `file` events — the counterpart of resolveImageFiles for a file the
   *  agent shared on purpose (ShareFile), whose `ref` is a relative daemon URL and therefore dead text in a
   *  WhatsApp chat. Without a configured dir there is nothing to read and the answer text goes out alone. */
  resolveSharedFiles(refs) {
    if (!this.chatFilesDir) return [];
    return resolveSharedFiles(this.chatFilesDir, refs, MAX_UPLOAD_FILES);
  }

  async groupSubject(jid) {
    try { return (await this.sock.groupMetadata(jid))?.subject || undefined; } catch { return undefined; }
  }

  /** Host-initiated push (cron/tick echoes) → the configured notification chat. No-op without one.
   *  A `notice` marks one of the daemon's standing announcements, which we say in the configured
   *  language; free-form text arrives without one and is delivered as written. */
  async notify(text, chatId, notice) {
    const target = (typeof chatId === 'string' && chatId.trim()) || (typeof this.cfg.notifyChat === 'string' ? this.cfg.notifyChat.trim() : '');
    if (!target || !this.sock) return;
    await this.sendText(toJid(target), lifecycleText(this.cfg.language, notice, text));
  }

  /** The live socket, or a thrown error when not yet connected — used by the Whatsapp* tools. */
  requireSock() {
    if (!this.sock || !this.meId) throw new Error('WhatsApp is not connected yet — pair the device first (see the plugin logs for the QR / pairing code)');
    return this.sock;
  }
}
