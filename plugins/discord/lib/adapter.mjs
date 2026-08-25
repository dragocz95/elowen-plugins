// The Discord adapter: gateway connection management, the inbound message pipeline,
// slash-command/component interactions, voice (STT/TTS) and outbound posting.
import { memberIsAdmin, matchPolicy, displayNameOf, resolveMentions, buildReplyContext, parseModelExec, stripForSpeech, withoutFooter } from './format.mjs';
import { buildAskComponents, askTruncationNote } from './ask.mjs';
import { MESSAGES } from './messages.mjs';
import { LiveMessage, postWithImages } from './stream.mjs';
import { resolveDisplaySettings, updateDisplayOverrides, observesLiveEvents } from './display.mjs';
import { buildRoleAccess, applyVisionModel } from 'elowen-plugin-shared/access';
import { resolveImageFiles, imageMimeType, resolveSharedFiles, fileMimeType } from 'elowen-plugin-shared/images';
import { voiceCreds, transcribeBuffer } from 'elowen-plugin-shared/voice';
import { controlCommandsFrom, localCommandsFrom, runControlCommand } from 'elowen-plugin-shared/chatCommands';
import { lifecycleText } from 'elowen-plugin-shared/lifecycle';
import { runTurn } from 'elowen-plugin-shared/turnRunner';
import { createConversationOrderTracker } from 'elowen-plugin-shared/liveMessage';

const API = 'https://discord.com/api/v10';
const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
// GUILDS + GUILD_MESSAGES + MESSAGE_CONTENT
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // default: larger images are noted, not downloaded (cfg: maxImageBytes)
const MAX_IMAGES = 4;                    // default vision cap per message (cfg: maxImages)
const MAX_FILE_BYTES = 25 * 1024 * 1024; // default: a larger document is noted, not downloaded (cfg: maxFileBytes)
const MAX_FILES = 5;                     // default general-file uploads accepted per message (cfg: maxFiles)
const MAX_UPLOAD_IMAGES = 4;             // default generated-image uploads per outgoing message (cfg: maxUploadImages)
const MAX_UPLOAD_FILES = 4;              // shared files (ShareFile) uploaded per outgoing message — no config key: the
                                         // agent chooses what to share, so this is a transport bound, not a preference
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // Whisper's per-file limit — larger clips are just noted
const TTS_MAX_CHARS = 4000;              // cap the spoken text (OpenAI TTS input limit is 4096)
const SELECT_PAGE = 25;                  // Discord StringSelect hard cap — the /model + /context picker page size
const CONTEXT_MAX = 200;                 // upper bound of own conversations the /context picker pages over

/** The commands this adapter runs end to end against its own per-channel state. Core DECLARES them
 *  (`execution: 'adapter-state'`), which is what reserves the names so a plugin macro can never shadow
 *  them, but deliberately does not PUBLISH them: this adapter appends them to its own bulk registration,
 *  and the same name twice in one payload is a 400 that drops EVERY slash command for the guild. The
 *  catalog therefore cannot answer for these two, so they are stated here — once, for the registration
 *  payload, /help and the dispatch gate alike. `help` is the lowercase wording renderHelpLines falls back
 *  to; `menu` is the description Discord shows; `options` is the transport's own option schema. */
const ADAPTER_STATE_COMMANDS = [
  {
    name: 'voice',
    help: 'toggle spoken audio replies here',
    menu: 'Toggle spoken audio replies in this channel',
    options: [
      { name: 'state', description: 'on or off (omit to toggle)', type: 3, required: false, choices: [
        { name: 'on', value: 'on' }, { name: 'off', value: 'off' },
      ] },
    ],
  },
  {
    name: 'display',
    help: 'configure live tools and answer delivery here',
    menu: 'Configure live tools and answer delivery in this channel',
    options: [
      { name: 'tools', description: 'Tool activity shown while the agent works', type: 3, required: false, choices: [
        { name: 'global default', value: 'default' }, { name: 'off', value: 'off' }, { name: 'status', value: 'status' }, { name: 'live output', value: 'live' },
      ] },
      { name: 'answer', description: 'When the agent answer is posted', type: 3, required: false, choices: [
        { name: 'global default', value: 'default' }, { name: 'final only', value: 'final' }, { name: 'stream live', value: 'live' },
      ] },
      { name: 'output', description: 'How much tool output is shown', type: 3, required: false, choices: [
        { name: 'global default', value: 'default' }, { name: 'hidden', value: 'hidden' }, { name: 'summary', value: 'summary' }, { name: 'rolling tail', value: 'tail' },
      ] },
      { name: 'layout', description: 'How tool activity is grouped into messages', type: 3, required: false, choices: [
        { name: 'global default', value: 'default' }, { name: 'one message', value: 'single' }, { name: 'one message per tool', value: 'per_tool' },
      ] },
    ],
  },
];

/** Read a numeric config field, clamped to [min,max], falling back to `def` when unset/invalid. */
function cfgNum(cfg, key, def, min, max) {
  return Math.min(Math.max(Number(cfg?.[key]) || def, min), max);
}

function isDirectChannel(meta) {
  return meta?.type === 1; // Discord channel type 1 is a 1:1 DM; unknown types fail closed as shared.
}

/** The role ids of a GUILD MEMBER, or null when the payload carries no member at all.
 *
 *  The two are not the same thing and the difference is a privilege boundary. A guild member holding no
 *  roles arrives as an EMPTY list — `member.roles` omits @everyone — and a `*` policy is meant to cover
 *  exactly those people, so `matchPolicy` matches a wildcard before it looks at the ids. A payload with
 *  no member describes somebody who is not in the guild at all: an interaction sent from a DM, where
 *  `i.member` is undefined. Reading that as "a member with no roles" is what let a stranger's DM
 *  interaction resolve through a wildcard admin policy and answer every operator gate with true. */
function guildRoleIds(member) {
  return Array.isArray(member?.roles) ? member.roles : null;
}

/** Split a message's attachments into vision-ready images (downloaded + base64, capped), audio for the
 *  STT path, and general FILES the host writes into the sender's project.
 *
 *  A document used to become the textual note `[Attachment: x.pdf (…)]` — the agent was told a file
 *  existed and given no way to open it, while the same file dropped into the web chat became a real path.
 *  It is downloaded here and handed over as bytes; the host sanitizes the name and decides where it goes,
 *  so nothing the sender chose is trusted to describe a destination. A note remains for exactly the cases
 *  where there are no bytes to hand over: too big for this transport, or the download failed.
 *
 *  Attachment URLs are public CDN links; no auth header is needed. */
async function collectAttachments(list, maxImageBytes, maxImages, maxFileBytes, maxFiles) {
  const images = [];
  const audio = [];
  const files = [];
  const notes = [];
  for (const a of Array.isArray(list) ? list : []) {
    const type = String(a?.content_type ?? '');
    const name = String(a?.filename ?? 'file');
    const note = `[Attachment: ${name} (${type || 'unknown'})]`;
    const download = async () => {
      const res = await fetch(a.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    };
    if (type.startsWith('image/') && (a.size ?? 0) <= maxImageBytes && images.length < maxImages) {
      try {
        images.push({ data: (await download()).toString('base64'), mimeType: type });
      } catch {
        notes.push(note); // download failed → degrade to a textual note
      }
    } else if (type.startsWith('audio/')) {
      // Voice messages / audio uploads: classify but never note here — onMessage either transcribes
      // them (Whisper) or falls back to a note, depending on the STT config.
      audio.push({ url: a.url, name, type, size: a?.size ?? 0 });
    } else if ((a.size ?? 0) <= maxFileBytes && files.length < maxFiles) {
      try {
        files.push({ name, data: (await download()).toString('base64'), ...(type ? { mimeType: type } : {}) });
      } catch {
        notes.push(note);
      }
    } else {
      notes.push(note); // over this transport's byte ceiling, or over the per-message cap
    }
  }
  return { images, audio, files, notes };
}

export class DiscordAdapter {
  name = 'discord';
  constructor(cfg, logger, state, listModels, imageDirs = [], resolveProvider = () => null, answerQuestion = () => false, chatCommands = () => [], chatFilesDir = '') {
    this.cfg = cfg;
    this.log = logger;
    this.state = state;
    this.listModels = listModels;
    this.resolveProvider = resolveProvider; // central brain-provider key resolver (voice STT/TTS)
    this.imageDirs = imageDirs; // where the image-gen/image-edit plugins store their generated files
    this.chatFilesDir = chatFilesDir; // where the daemon stores files the agent shared (ShareFile)
    this.answerQuestion = answerQuestion; // deliver a parked AskUserQuestion answer back to the turn
    this.chatCommands = chatCommands; // () => core names/descriptions/kind — presentation/dispatch is local
    this.pendingAsks = new Map(); // id → { channelId, messageId, questions, askerId, selected, awaitingText }
    this.conversationOrder = createConversationOrderTracker();
    this.handler = null;
    this.ctl = null; // host channel-control surface (stop/status/compact/restart), wired via control()
    this.ws = null;
    this.botId = null;
    this.appId = null;
    this.stopped = false;
    this.seq = null;
    this.backoffMs = 1000;
    this.sessionId = null;    // gateway session for RESUME
    this.resumeUrl = null;    // gateway host to RESUME against
    this.awaitingAck = false; // heartbeat sent, ACK (op 11) not yet seen → zombie detection
    this.channelMeta = new Map(); // channel id → { name, topic, type }; metadata changes rarely, never invalidated
    this.msg = MESSAGES[cfg.language] ?? MESSAGES.en; // gateway service texts
    // Testability seam: point REST + gateway at a local fake when configured (the E2E suite injects a fake
    // Discord API here). Pure passthrough — unset means the real discord.com endpoints, so production is
    // unchanged. Kept OUT of configSchema (internal-only).
    this.api = typeof cfg.apiBase === 'string' && cfg.apiBase.trim() ? cfg.apiBase.trim().replace(/\/+$/, '') : API;
    this.gateway = typeof cfg.gatewayUrl === 'string' && cfg.gatewayUrl.trim() ? cfg.gatewayUrl.trim() : GATEWAY;
  }

  listen(onMessage) { this.handler = onMessage; }
  /** Host wires the channel-control surface here (stop/status/compact/restart) right after listen(). */
  control(api) { this.ctl = api; }

  /** The channel conversation reference for slash commands: same identity onMessage reports (channel id
   *  folded with the /new generation), so a command targets the exact session a message would. */
  channelRef(channelId) { return { platform: 'discord', channelId: `${channelId}#${this.state.get(channelId).gen ?? 0}` }; }

  /** The ordered command list for /help: the daemon's chat-command catalog (built-ins + plugin prompt
   *  commands) plus this adapter's own voice/display. renderHelpLines localizes the built-ins/voice/display
   *  and falls back to a plugin command's own English description, so /help can never drift from what is
   *  registered. */
  helpCommands() {
    return [
      ...this.chatCommands(),
      ...ADAPTER_STATE_COMMANDS.map((c) => ({ name: c.name, description: c.help })),
    ];
  }

  /** The daemon chat-command definition for a slash name IFF it is a plugin prompt macro (kind:'prompt'),
   *  else undefined — the gate that routes a `/name` interaction RAW to the brain for PI to expand. */
  promptCommand(name) {
    return this.chatCommands().find((c) => c.name === name && c.kind === 'prompt');
  }

  /** StringSelect option rows for the FULL model catalog (no truncation — pagination handles the 25-row
   *  cap), marking the channel's current pick (or the daemon default) as selected. */
  modelOptions(channelId, models) {
    const current = this.state.get(channelId).model;
    return models.map((mo) => ({
      label: `${mo.providerLabel} / ${mo.model}`.slice(0, 100),
      value: `${mo.provider}::${mo.model}`.slice(0, 100),
      description: `${mo.provider}/${mo.model}`.slice(0, 100),
      default: current ? current.provider === mo.provider && current.model === mo.model : mo.default === true,
    }));
  }

  /** StringSelect option rows for the /context picker — one per bindable conversation (value = its
   *  session id, description = the model it runs on). */
  contextOptions(items) {
    return items.map((s) => {
      const desc = String(s.model ?? '').slice(0, 100);
      return {
        label: (s.title || 'Untitled').slice(0, 100),
        value: String(s.id).slice(0, 100),
        ...(desc ? { description: desc } : {}),
      };
    });
  }

  /** A paged StringSelect: the `page`-th window of ≤25 options (custom_id = `prefix`) plus, when there is
   *  more than one page, a nav row of prev/next buttons (`${prefix}_page:<n>`, disabled at the ends) and a
   *  page indicator. Shared by /model and /context so neither ever truncates its catalog. */
  buildPagedSelect(options, page, prefix, placeholder) {
    const pages = Math.max(1, Math.ceil(options.length / SELECT_PAGE));
    const p = Math.min(Math.max(Number(page) || 0, 0), pages - 1);
    const slice = options.slice(p * SELECT_PAGE, p * SELECT_PAGE + SELECT_PAGE);
    const rows = [{ type: 1, components: [{ type: 3, custom_id: prefix, options: slice, placeholder }] }];
    if (pages > 1) {
      rows.push({ type: 1, components: [
        { type: 2, style: 2, custom_id: `${prefix}_page:${p - 1}`, label: '◀', disabled: p === 0 },
        { type: 2, style: 2, custom_id: `${prefix}_page:cur`, label: `${p + 1}/${pages}`, disabled: true },
        { type: 2, style: 2, custom_id: `${prefix}_page:${p + 1}`, label: '▶', disabled: p >= pages - 1 },
      ] });
    }
    return rows;
  }

  /** Resolve the model that will drive the next turn. The catalog marks the daemon's real resolved
   *  default; catalog ordering is presentation-only and must not silently choose a different model. */
  modelForChannel(channelId, models) {
    const chosen = this.state.get(channelId).model;
    return chosen
      ? models.find((m) => m.provider === chosen.provider && m.model === chosen.model)
      : (models.find((m) => m.default === true) ?? models[0]);
  }

  async connect() {
    // Validate the token up front so a bad config fails loudly at startup, not silently in the gateway.
    const me = await this.rest('GET', '/users/@me');
    this.botId = me.id;
    const app = await this.rest('GET', '/oauth2/applications/@me').catch(() => null);
    this.appId = app?.id ?? me.id;
    await this.registerCommands().catch((e) => this.log.error(`slash command registration failed: ${e?.message ?? e}`));
    this.openGateway();
  }

  disconnect() {
    this.stopped = true;
    clearInterval(this.heartbeat);
    try { this.ws?.close(); } catch { /* already closed */ }
  }

  /** Register the bot's slash commands. Guild-scoped when a guildId is set (instant), else global.
   *  Fingerprint the payload so an unchanged set skips the PUT — avoids needless syncs + rate limits. */
  async registerCommands() {
    // Single source of truth: the daemon's command registry for this surface (slashCommands.ts →
    // ctx.chatCommands('discord')) is the command LIST. We only attach the Discord-specific option
    // schemas (by name) and append the two adapter-LOCAL commands (voice, display) that aren't daemon
    // commands — so adding/removing a daemon command reflects on Discord automatically, no parallel
    // hardcoded list to drift out of sync. Discord slash names must be lowercase single tokens, which
    // every daemon command name already is.
    const DISCORD_OPTIONS = {
      fast: [
        { name: 'state', description: 'on or off (omit to toggle)', type: 3, required: false, choices: [
          { name: 'on', value: 'on' }, { name: 'off', value: 'off' },
        ] },
      ],
    };
    // A plugin prompt-command (kind:'prompt') takes a single generic optional string option so a user can
    // pass `$ARGUMENTS`; built-ins keep their bespoke DISCORD_OPTIONS (or none).
    const PROMPT_ARGS = [{ name: 'args', description: 'arguments', type: 3, required: false }];
    const daemonCommands = this.chatCommands().map((c) => ({
      // Discord requires a 1–100 char description; a plugin command with an empty or over-long one would
      // 400 the whole bulk registration and drop EVERY slash command. Clamp defensively (name as fallback).
      name: c.name, description: (c.description || c.name).slice(0, 100), type: 1,
      ...(DISCORD_OPTIONS[c.name] ? { options: DISCORD_OPTIONS[c.name] } : c.kind === 'prompt' ? { options: PROMPT_ARGS } : {}),
    }));
    const localCommands = ADAPTER_STATE_COMMANDS.map((c) => ({ name: c.name, description: c.menu, type: 1, options: c.options }));
    const commands = [...daemonCommands, ...localCommands];
    const globalPath = `/applications/${this.appId}/commands`;
    const path = this.cfg.guildId ? `/applications/${this.appId}/guilds/${this.cfg.guildId}/commands` : globalPath;
    const meta = this.state.get('__meta');
    // A guild-scoped bot must NOT also carry a GLOBAL command set — Discord merges global + guild commands
    // inside a guild, so any leftover global registration (e.g. from before a guildId was configured) shows
    // every command TWICE. Clear the global set on EVERY guild-mode startup: it is idempotent (clearing an
    // already-empty set is a harmless no-op PUT), so a stale global set always self-heals. This deliberately
    // does NOT gate behind a one-shot flag — a best-effort clear that failed once (rate limit, transient)
    // must not latch "cleared" forever and leave the duplicates in place.
    if (this.cfg.guildId) {
      await this.rest('PUT', globalPath, []).catch(() => { /* best-effort — retried on the next startup */ });
    }
    const fingerprint = `${this.appId}:${this.cfg.guildId ?? 'global'}:${JSON.stringify(commands)}`;
    if (meta.commandFingerprint === fingerprint) return; // unchanged → skip
    await this.rest('PUT', path, commands);
    this.state.patch('__meta', { commandFingerprint: fingerprint });
  }

  openGateway() {
    if (this.stopped) return;
    const ws = new WebSocket(this.sessionId && this.resumeUrl ? `${this.resumeUrl}?v=10&encoding=json` : this.gateway);
    this.ws = ws;
    ws.onmessage = (ev) => this.onFrame(JSON.parse(String(ev.data)));
    ws.onclose = () => {
      clearInterval(this.heartbeat);
      if (this.stopped) return;
      setTimeout(() => this.openGateway(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    };
    ws.onerror = () => { /* onclose follows and handles the retry */ };
  }

  onFrame(frame) {
    if (frame.s) this.seq = frame.s;
    if (frame.op === 10) {
      clearInterval(this.heartbeat);
      this.awaitingAck = false;
      this.heartbeat = setInterval(() => {
        if (this.awaitingAck) { try { this.ws?.close(); } catch { /* onclose reconnects */ } return; }
        this.awaitingAck = true;
        this.send({ op: 1, d: this.seq });
      }, frame.d.heartbeat_interval);
      if (this.sessionId) this.send({ op: 6, d: { token: this.cfg.botToken, session_id: this.sessionId, seq: this.seq } });
      else this.send({ op: 2, d: { token: this.cfg.botToken, intents: INTENTS, properties: { os: 'linux', browser: 'elowen', device: 'elowen' } } });
      return;
    }
    if (frame.op === 11) { this.awaitingAck = false; return; }
    if (frame.op === 0 && frame.t === 'READY') {
      this.backoffMs = 1000;
      this.sessionId = frame.d.session_id ?? null;
      this.resumeUrl = frame.d.resume_gateway_url ?? null;
      this.log.info('discord gateway ready');
      return;
    }
    if (frame.op === 0 && frame.t === 'RESUMED') { this.backoffMs = 1000; return; }
    if (frame.op === 0 && frame.t === 'MESSAGE_CREATE') void this.onMessage(frame.d).catch((e) => this.log.error(`message handling failed: ${e?.message ?? e}`));
    if (frame.op === 0 && frame.t === 'INTERACTION_CREATE') void this.onInteraction(frame.d).catch((e) => this.log.error(`interaction failed: ${e?.message ?? e}`));
    if (frame.op === 7) { try { this.ws?.close(); } catch { /* reconnect via onclose */ } }
    if (frame.op === 9) {
      if (!frame.d) { this.sessionId = null; this.resumeUrl = null; this.seq = null; }
      try { this.ws?.close(); } catch { /* reconnect via onclose */ }
    }
  }

  send(obj) { try { this.ws?.send(JSON.stringify(obj)); } catch { /* gateway down; reconnect handles it */ } }

  /** Whether the member holds a role mapped as `admin: true` — the operator's own role. Gates the
   *  model/reasoning pickers so a shared channel's settings can't be changed by an ordinary member.
   *  A payload with no guild member resolves nothing and is never an operator. */
  isAdminMember(member) {
    const roleIds = guildRoleIds(member);
    return roleIds !== null && memberIsAdmin(roleIds, this.cfg.rolePolicies);
  }

  /** Resolve a Discord message's sender to an access descriptor (role → projects/prompt + channel model). */
  accessFor(m, channelId) {
    const roleIds = guildRoleIds(m.member);
    if (roleIds === null) return { roleIds: [], access: undefined };
    const match = matchPolicy(roleIds, this.cfg.rolePolicies);
    if (!match) return { roleIds, access: undefined };
    return { roleIds, access: buildRoleAccess(match, this.state.get(channelId)) };
  }

  /** Recent channel history for a BRAND-NEW brain conversation. The API returns newest-first; core receives
   *  bounded chronological message objects and persists each under its original conversational role. */
  async fetchHistory(channelId, beforeMessageId) {
    const limit = Math.min(Math.max(Number(this.cfg.historyLimit) || 0, 0), 100);
    if (!limit) return [];
    const msgs = await this.rest('GET', `/channels/${channelId}/messages?before=${beforeMessageId}&limit=${limit}`).catch(() => []);
    if (!Array.isArray(msgs) || msgs.length === 0) return [];
    const messages = [];
    let chars = 0;
    for (const m of [...msgs]) { // newest-first while applying the latest-message character budget
      const raw = String(m.content ?? '');
      const body = (m.author?.id === this.botId ? withoutFooter(raw) : raw).trim();
      const attachments = (Array.isArray(m.attachments) ? m.attachments : []).slice(0, 8).map((attachment) => ({
        name: String(attachment?.filename ?? '').slice(0, 200),
        mimeType: String(attachment?.content_type ?? '').slice(0, 120),
        kind: String(attachment?.content_type ?? '').startsWith('image/') ? 'image' : 'file',
      }));
      const text = body ? (body.length > 400 ? `${body.slice(0, 400)}…` : body) : (attachments.length ? '[Attachment]' : '');
      if (!text || chars + text.length > 6000) continue;
      chars += text.length;
      messages.push({
        id: String(m.id ?? ''),
        role: m.author?.bot ? 'assistant' : 'user',
        author: { id: String(m.author?.id ?? ''), name: displayNameOf(m) },
        text,
        ...(m.timestamp ? { timestamp: String(m.timestamp) } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
    }
    return messages.reverse();
  }

  /** Channel metadata (name/topic/type) via REST, cached forever — metadata changes rarely; a stale entry
   *  self-heals on daemon restart. A thread carries no topic, so its parent lends name + topic. */
  async channelInfo(channelId) {
    const cached = this.channelMeta.get(channelId);
    if (cached) return cached;
    const ch = await this.rest('GET', `/channels/${channelId}`);
    let name = ch?.name ?? '';
    let topic = typeof ch?.topic === 'string' ? ch.topic : '';
    if ([10, 11, 12].includes(ch?.type) && ch?.parent_id) { // announcement/public/private thread
      const parent = await this.rest('GET', `/channels/${ch.parent_id}`).catch(() => null);
      if (parent?.name) name = `${parent.name} › ${name}`;
      if (!topic && typeof parent?.topic === 'string') topic = parent.topic;
    }
    const meta = { name, topic, type: Number.isInteger(ch?.type) ? ch.type : undefined };
    this.channelMeta.set(channelId, meta);
    return meta;
  }

  async onMessage(m) {
    if (!this.handler || m.author?.bot) return;
    if (m.type !== 0 && m.type !== 19) return; // ignore Discord system messages (channel renames, pins, joins, boosts) — only DEFAULT(0) and REPLY(19) are real user turns
    if (!m.guild_id) return; // DMs carry no member roles → no policy can ever match; ignore them
    if (this.cfg.guildId && m.guild_id !== this.cfg.guildId) return;
    const orderMarker = this.conversationOrder.mark(m.channel_id);

    // Free-text answer to a parked AskUserQuestion ("✏️ Other"): if this channel has a pending ask
    // awaiting text from THIS sender, consume the message as that answer — not as a new brain turn.
    // There is no staleness check here any more: the core owns the one timeout that decides when a
    // question stops being answerable, and it announces every exit as `ask_resolved` → resolveAsk below,
    // which removes the entry. A second clock here could only disagree with it.
    for (const [id, pend] of this.pendingAsks) {
      if (!pend.awaitingText || pend.channelId !== m.channel_id || pend.askerId !== m.author.id) continue;
      const other = String(m.content ?? '').trim();
      const q0 = pend.questions[0];
      const settled = this.answerQuestion(id, [{ header: q0.header, selected: pend.selected[0] ?? [], other: other || undefined }]);
      this.pendingAsks.delete(id);
      if (!settled) break; // already timed out server-side → fall through and treat the message as a normal turn
      if (pend.messageId) {
        const cs = this.cfg.language === 'cs';
        void this.rest('PATCH', `/channels/${pend.channelId}/messages/${pend.messageId}`, {
          embeds: [{ title: cs ? '✅ Odpovězeno' : '✅ Answered', description: `**${q0.header}:** ${other || '—'}`, color: 0x2ECC71 }],
          components: [],
        }).catch(() => {});
      }
      return; // this message was the answer
    }
    // Thread allowlist: when configured, the bot only speaks inside these threads. A thread message's
    // channel_id IS the thread id, so we gate on it. Empty/unset = respond everywhere else allowed.
    const threadIds = new Set(String(this.cfg.threadIds ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    if (threadIds.size > 0 && !threadIds.has(m.channel_id)) return;
    // Iris-style free response is the default; flipping the toggle makes the bot mention-only.
    const mentioned = (m.mentions ?? []).some((u) => u.id === this.botId);
    if (this.cfg.respondWithoutMention === false && !mentioned) return;

    const { roleIds, access } = this.accessFor(m, m.channel_id);
    if (!access) return; // unmapped sender → stay silent (checked early: no REST/CDN work for strangers)

    // Strip the bot's own mention entirely, THEN resolve the remaining mention tokens to names.
    let text = String(m.content ?? '').replaceAll(`<@${this.botId}>`, '').replaceAll(`<@!${this.botId}>`, '').trim();
    const meta = await this.channelInfo(m.channel_id).catch(() => null);
    const channelNames = new Map([...this.channelMeta].map(([id, c]) => [id, c.name]).filter(([, n]) => n));
    text = resolveMentions(text, m.mentions ?? [], this.cfg.rolePolicies, channelNames);
    const { images, audio, files, notes } = await collectAttachments(
      m.attachments,
      cfgNum(this.cfg, 'maxImageBytes', MAX_IMAGE_BYTES, 1048576, 20971520),
      cfgNum(this.cfg, 'maxImages', MAX_IMAGES, 1, 10),
      cfgNum(this.cfg, 'maxFileBytes', MAX_FILE_BYTES, 1048576, 26214400),
      cfgNum(this.cfg, 'maxFiles', MAX_FILES, 1, 10),
    );
    if (notes.length) text = [text, ...notes].filter(Boolean).join('\n');
    // Voice messages / audio uploads: transcribe with Whisper when STT is enabled + keyed, else note.
    for (const clip of audio) {
      const transcript = (this.cfg.stt && this.voiceCreds())
        ? await this.transcribe(clip).catch((e) => { this.log.error(`STT failed: ${e?.message ?? e}`); return null; })
        : null;
      const line = transcript ? `[🎙️ Voice message: "${transcript}"]` : `[Attachment: ${clip.name} (${clip.type})]`;
      text = [text, line].filter(Boolean).join('\n');
    }
    if (!text && images.length) text = '[The user sent an image]'; // an image-only turn must not be empty
    // A file with no words is still a turn: the host writes it into the sender's project and the agent
    // is told where it is, which is exactly what the web surface does with a bare drag-and-drop.
    if (!text && files.length) text = '[The user sent a file]';
    if (!text) return;

    // Quoted-reply context stays in the clean sender words; author attribution travels structurally.
    const replyCtx = buildReplyContext(m.referenced_message, this.botId);
    const cleanText = `${replyCtx ? `${replyCtx}\n` : ''}${text}`;

    // The conversation key folds in the /new "generation" so a reset yields a clean session.
    const gen = this.state.get(m.channel_id).gen ?? 0;
    const convoKey = `${m.channel_id}#${gen}`;

    const display = resolveDisplaySettings(this.cfg, this.state.get(m.channel_id));
    const stream = observesLiveEvents(display, this.cfg)
      ? new LiveMessage(this, m.channel_id, m.id, m.author.id, display, { collapseStillOrdered: () => this.conversationOrder.isCurrent(orderMarker) })
      : null;

    await runTurn({
      // Resolved INSIDE the turn so the typing indicator and the "seen" marker are already up while the
      // vision detour asks the host for its model list: an image turn otherwise looks ignored for as long
      // as that round trip takes.
      run: async (onEvent) => {
        const vision = images.length ? parseModelExec(this.cfg.visionModel) : null;
        const turnAccess = vision ? applyVisionModel(access, vision, await this.listModels().catch(() => [])) : access;
        return this.handler(
          {
            platform: 'discord', userId: m.author.id, userName: displayNameOf(m), roleIds, channelId: convoKey, access: turnAccess,
            direct: isDirectChannel(meta),
            channelName: meta?.name || undefined, channelTopic: meta?.topic || undefined,
            images: images.length ? images : undefined,
            attachments: files.length ? files : undefined,
            history: () => this.fetchHistory(m.channel_id, m.id),
          },
          cleanText,
          onEvent,
        );
      },
      stream,
      ask: {
        post: (e) => this.postAsk(m.channel_id, m.id, m.author.id, e.id, e.questions),
        resolve: (e) => this.resolveAsk(m.channel_id, e.id, e.reason),
      },
      typing: { poke: () => this.rest('POST', `/channels/${m.channel_id}/typing`, {}) },
      // Discord keeps every reaction it is given, so the "seen" eyes have to be taken off explicitly.
      reactions: this.cfg.reactions !== false ? {
        seen: '👀', done: '✅', failed: '❌',
        add: (emoji) => this.react(m.channel_id, m.id, emoji),
        remove: (emoji) => this.unreact(m.channel_id, m.id, emoji),
      } : null,
      send: (reply) => this.reply(m.channel_id, reply, m.id),
      sendError: (text) => this.reply(m.channel_id, text),
      errorText: (e) => this.msg.error(e?.message ?? e),
      // Spoken reply (per-channel /voice, default cfg.tts): attach an MP3 of the answer. Best-effort —
      // a TTS failure never blocks the text reply that already went out.
      afterReply: (reply) => ((this.voiceEnabled(m.channel_id) && this.voiceCreds())
        ? this.speakReply(m.channel_id, reply, m.id).catch((e) => this.log.error(`TTS failed: ${e?.message ?? e}`))
        : undefined),
      log: (detail) => this.log.error(`discord turn failed in ${m.channel_id}: ${detail}`),
    });
  }

  /** Run a plugin prompt-command triggered by a slash INTERACTION (no triggering message): ACK the
   *  interaction ephemerally, then run the turn and post the answer as a normal channel message — the SAME
   *  brain path onMessage uses, with the ingress text the RAW `/name args` so PI expands the macro. */
  async dispatchSlashPrompt(i, promptText) {
    const channelId = i.channel_id;
    const { roleIds, access } = this.accessFor({ member: i.member }, channelId);
    if (!access) return this.respond(i, 4, { content: this.msg.controlForbidden, flags: 64 });
    // ACK ephemerally so Discord resolves the interaction; the real answer posts into the channel.
    await this.respond(i, 4, { content: this.msg.commandRunning(promptText), flags: 64 });
    const meta = await this.channelInfo(channelId).catch(() => null);
    const gen = this.state.get(channelId).gen ?? 0;
    const convoKey = `${channelId}#${gen}`;
    const author = i.member?.user ?? i.user ?? {};
    const display = resolveDisplaySettings(this.cfg, this.state.get(channelId));
    const stream = observesLiveEvents(display, this.cfg) ? new LiveMessage(this, channelId, undefined, author.id, display) : null;
    await runTurn({
      run: (onEvent) => this.handler(
        { platform: 'discord', userId: author.id, userName: displayNameOf({ member: i.member, author }), roleIds, channelId: convoKey, access,
          promptCommand: true, direct: isDirectChannel(meta),
          channelName: meta?.name || undefined, channelTopic: meta?.topic || undefined },
        promptText,
        onEvent,
      ),
      stream,
      ask: {
        post: (e) => this.postAsk(channelId, undefined, author.id, e.id, e.questions),
        resolve: (e) => this.resolveAsk(channelId, e.id, e.reason),
      },
      typing: { poke: () => this.rest('POST', `/channels/${channelId}/typing`, {}) },
      // A slash invocation builds no message in the channel, so there is nothing to decorate.
      reactions: null,
      send: (reply) => this.reply(channelId, reply),
      sendError: (text) => this.reply(channelId, text),
      errorText: (e) => this.msg.error(e?.message ?? e),
      log: (detail) => this.log.error(`discord slash turn failed in ${channelId}: ${detail}`),
    });
  }

  react(channelId, messageId, emoji) {
    return this.rest('PUT', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, {});
  }
  unreact(channelId, messageId, emoji) {
    return this.rest('DELETE', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, {});
  }

  async onInteraction(i) {
    // The same origin guards onMessage applies, for the same reason: a turn is only served to a real
    // member of the guild this bot was configured for. An interaction had none of them, so a DM one —
    // no `guild_id`, no `member` — reached every `isAdminMember(i.member)` and `accessFor` below.
    if (!i.guild_id || !i.member) return;                               // DM (or any memberless payload)
    if (this.cfg.guildId && i.guild_id !== this.cfg.guildId) return;    // another server
    if (i.member.user?.bot) return;                                     // bots and webhooks are not senders
    // ACK-and-respond for slash commands (type 2) and component interactions (type 3).
    if (i.type === 2) {
      const name = i.data?.name;
      // A plugin prompt-command (kind:'prompt', registered with a generic `args` option): route it RAW to
      // the brain so PI expands the macro natively (it only expands a message that STARTS with the slash).
      if (this.promptCommand(name)) {
        const args = String((i.data?.options ?? []).find((o) => o.name === 'args')?.value ?? '').trim();
        return this.dispatchSlashPrompt(i, `/${name}${args ? ` ${args}` : ''}`);
      }
      // Control commands share one transport-agnostic core. WHICH names those are is the daemon's answer,
      // not ours: controlCommandsFrom reads `execution` off the catalog we already receive. What runs is
      // the INTERSECTION of that with what the core implements — an unhandled name returns false and drops
      // to the local chain below rather than being swallowed here, so a newer daemon may publish a control
      // command this adapter cannot run. Discord must ACK within 3s; /compact runs an LLM summary, so defer
      // (type 5) and let the core edit the deferred reply — everything else answers immediately (ephemeral
      // type 4). The pickers below stay local because their StringSelect UI is Discord-specific.
      if (controlCommandsFrom(this.chatCommands()).has(name)) {
        // Defer only when /compact will actually run its LLM summary — i.e. an admin with a live session.
        // A forbidden/no-session /compact answers immediately (type 4), matching the pre-extraction flow.
        const deferred = name === 'compact' && !!this.ctl && this.isAdminMember(i.member);
        if (deferred) await this.respond(i, 5, { flags: 64 });
        const reply = deferred
          ? (content) => this.editOriginal(i, { content })
          : (content) => this.respond(i, 4, { content, flags: 64 });
        const handled = await runControlCommand(name, {
          msg: this.msg, reply, isAdmin: () => this.isAdminMember(i.member),
          arg: name === 'fast' ? (i.data?.options ?? []).find((o) => o.name === 'state')?.value : undefined,
          state: this.state, stateId: i.channel_id, ctl: this.ctl, ref: this.channelRef(i.channel_id),
          activeModel: async () => this.modelForChannel(i.channel_id, await this.listModels().catch(() => [])),
        });
        if (handled) return;
      }
      // …and the same question for the half the daemon does NOT run: the StringSelect pickers, /help and
      // this adapter's own voice/display below run only because the catalog published this surface at all.
      // localCommandsFrom claims the published `surface-local` names plus the `session-control` pickers,
      // and takes voice/display from ADAPTER_STATE_COMMANDS because the catalog declares those without
      // publishing them. Against an empty projection it claims nothing and the interaction goes
      // unanswered, which is what Discord already does for a command this bot never registered.
      //
      // /help moved BELOW this gate (it used to answer first, before even the prompt-macro check). It is
      // an ordinary `surface-local` catalog entry, so nothing else would be gating it — and the menu it
      // renders comes from the very projection that would be missing.
      if (!localCommandsFrom(this.chatCommands(), ADAPTER_STATE_COMMANDS.map((c) => c.name)).has(name)) return;
      if (name === 'help') return this.respond(i, 4, { content: this.msg.help(this.cfg.agentName || 'Elowen', this.helpCommands()), flags: 64 });
      if (name === 'model') {
        // Only the operator (a role mapped admin:true) may switch the model — the choice is shared by
        // everyone talking in this channel/thread, so a stranger must not repoint it.
        if (!this.isAdminMember(i.member)) return this.respond(i, 4, { content: this.msg.modelForbidden, flags: 64 });
        const models = await this.listModels().catch(() => []);
        if (models.length === 0) return this.respond(i, 4, { content: this.msg.noModels, flags: 64 });
        // The FULL catalog is paged (StringSelect caps at 25), so a model past the 26th is reachable via the
        // nav row instead of being silently dropped.
        return this.respond(i, 4, {
          content: this.msg.pickModel,
          flags: 64,
          components: this.buildPagedSelect(this.modelOptions(i.channel_id, models), 0, 'pick_model', this.msg.modelPlaceholder),
        });
      }
      if (name === 'context') {
        // Operator-gated like /model (the channel is shared). Ownership is the real boundary: the picker only
        // ever offers the invoking sender's OWN conversations (identity-scoped, bare default excluded), and
        // bindContext re-checks server-side. Binding exposes the chosen history to everyone here.
        if (!this.isAdminMember(i.member)) return this.respond(i, 4, { content: this.msg.controlForbidden, flags: 64 });
        const senderId = i.member?.user?.id ?? i.user?.id;
        const listing = this.ctl?.listContext?.(this.channelRef(i.channel_id), senderId, { offset: 0, limit: CONTEXT_MAX }) ?? null;
        if (!listing || listing.items.length === 0) return this.respond(i, 4, { content: this.msg.noContextSessions, flags: 64 });
        return this.respond(i, 4, {
          content: this.msg.pickContext,
          flags: 64,
          components: this.buildPagedSelect(this.contextOptions(listing.items), 0, 'pick_context', this.msg.contextPlaceholder),
        });
      }
      if (name === 'reasoning') {
        // Same operator-only gate as /model — reasoning effort is a shared per-channel setting.
        if (!this.isAdminMember(i.member)) return this.respond(i, 4, { content: this.msg.modelForbidden, flags: 64 });
        const models = await this.listModels().catch(() => []);
        if (!models.length) return this.respond(i, 4, { content: this.msg.noModels, flags: 64 });
        const active = this.modelForChannel(i.channel_id, models);
        const levels = Array.isArray(active?.reasoningLevels) ? active.reasoningLevels : [];
        if (!levels.length) return this.respond(i, 4, { content: this.msg.reasoningUnavailable, flags: 64 });
        const current = this.state.get(i.channel_id).thinkingLevel ?? '';
        const options = [
          { label: this.msg.reasoningDefault, value: 'default', default: current === '' || !levels.includes(current) },
          ...levels.map((level) => ({
            label: String(active.reasoningLabels?.[level] ?? level).slice(0, 100),
            value: level.slice(0, 100),
            default: current === level,
          })),
        ];
        return this.respond(i, 4, {
          content: this.msg.pickThinking,
          flags: 64,
          components: [{ type: 1, components: [{ type: 3, custom_id: 'pick_reasoning', options, placeholder: this.msg.reasoningPlaceholder }] }],
        });
      }
      if (name === 'voice') {
        // Spoken replies are a shared per-channel setting → operator-only, same gate as /model.
        if (!this.isAdminMember(i.member)) return this.respond(i, 4, { content: this.msg.modelForbidden, flags: 64 });
        const opt = (i.data?.options ?? []).find((o) => o.name === 'state')?.value;
        const next = opt === 'on' ? true : opt === 'off' ? false : !this.voiceEnabled(i.channel_id); // no arg = toggle
        this.state.patch(i.channel_id, { voice: next });
        const note = next && !this.voiceCreds() ? `\n${this.msg.voiceNeedsKey}` : '';
        return this.respond(i, 4, { content: `${this.msg.voiceSet(next)}${note}`, flags: 64 });
      }
      if (name === 'display') {
        // Presentation is shared by everyone in this channel, so changing it is operator-only like /model.
        if (!this.isAdminMember(i.member)) return this.respond(i, 4, { content: this.msg.controlForbidden, flags: 64 });
        const options = Object.fromEntries((i.data?.options ?? []).map((o) => [o.name, String(o.value)]));
        const values = {
          ...(options.tools ? { toolActivity: options.tools } : {}),
          ...(options.answer ? { answerMode: options.answer } : {}),
          ...(options.output ? { toolOutput: options.output } : {}),
          ...(options.layout ? { toolMessageMode: options.layout } : {}),
        };
        const state = this.state.get(i.channel_id);
        if (Object.keys(values).length) this.state.patch(i.channel_id, { display: updateDisplayOverrides(state.display, values) });
        const resolved = resolveDisplaySettings(this.cfg, this.state.get(i.channel_id));
        return this.respond(i, 4, { content: this.msg.displaySet(resolved), flags: 64 });
      }
    }
    // AskUserQuestion components (select menus + Submit/Other buttons) resolve a parked turn.
    if (i.type === 3 && typeof i.data?.custom_id === 'string' && i.data.custom_id.startsWith('ask:')) {
      return this.onAskInteraction(i);
    }
    // Paged-picker nav (`pick_model_page:<n>` / `pick_context_page:<n>`): re-fetch the list, rebuild page
    // <n> and update the message in place (type 7). Operator-gated, like the pickers themselves.
    if (i.type === 3 && typeof i.data?.custom_id === 'string' && i.data.custom_id.includes('_page:')) {
      const idx = i.data.custom_id.indexOf('_page:');
      const prefix = i.data.custom_id.slice(0, idx);
      const page = Number(i.data.custom_id.slice(idx + '_page:'.length));
      if (!Number.isInteger(page)) return this.respond(i, 6, {}); // the disabled indicator button — ack, no change
      if (!this.isAdminMember(i.member)) return this.respond(i, 7, { content: this.msg.modelForbidden, components: [] });
      if (prefix === 'pick_model') {
        const models = await this.listModels().catch(() => []);
        if (!models.length) return this.respond(i, 7, { content: this.msg.noModels, components: [] });
        return this.respond(i, 7, { content: this.msg.pickModel, components: this.buildPagedSelect(this.modelOptions(i.channel_id, models), page, 'pick_model', this.msg.modelPlaceholder) });
      }
      if (prefix === 'pick_context') {
        const senderId = i.member?.user?.id ?? i.user?.id;
        const listing = this.ctl?.listContext?.(this.channelRef(i.channel_id), senderId, { offset: 0, limit: CONTEXT_MAX }) ?? null;
        if (!listing || listing.items.length === 0) return this.respond(i, 7, { content: this.msg.noContextSessions, components: [] });
        return this.respond(i, 7, { content: this.msg.pickContext, components: this.buildPagedSelect(this.contextOptions(listing.items), page, 'pick_context', this.msg.contextPlaceholder) });
      }
      return this.respond(i, 6, {});
    }
    if (i.type === 3 && i.data?.custom_id === 'pick_context') {
      // Re-check the operator gate on submit (the component round-trips independently). The MOVE is
      // dispatched through the host control surface; ownership is re-verified server-side.
      if (!this.isAdminMember(i.member)) return this.respond(i, 7, { content: this.msg.controlForbidden, components: [] });
      if (!this.ctl?.bindContext) return this.respond(i, 7, { content: this.msg.noSession, components: [] });
      const senderId = i.member?.user?.id ?? i.user?.id;
      const sessionId = String(i.data.values?.[0] ?? '');
      if (!sessionId) return this.respond(i, 7, { content: this.msg.contextError('no conversation selected'), components: [] });
      try {
        const { title } = await this.ctl.bindContext(this.channelRef(i.channel_id), senderId, sessionId);
        return this.respond(i, 7, { content: this.msg.contextBound(title), components: [] });
      } catch (e) {
        return this.respond(i, 7, { content: this.msg.contextError(e?.message ?? e), components: [] });
      }
    }
    if (i.type === 3 && i.data?.custom_id === 'pick_reasoning') {
      // Re-resolve capabilities on submit: the channel model or provider catalog may have changed while
      // the picker was open, and component values are user-controlled Discord payloads.
      if (!this.isAdminMember(i.member)) return this.respond(i, 7, { content: this.msg.modelForbidden, components: [] });
      const models = await this.listModels().catch(() => []);
      const active = this.modelForChannel(i.channel_id, models);
      const levels = Array.isArray(active?.reasoningLevels) ? active.reasoningLevels : [];
      if (!levels.length) return this.respond(i, 7, { content: this.msg.reasoningUnavailable, components: [] });
      const value = String(i.data.values?.[0] ?? '');
      if (value !== 'default' && !levels.includes(value)) {
        return this.respond(i, 7, { content: this.msg.reasoningUnavailable, components: [] });
      }
      const level = value === 'default' ? '' : value;
      this.state.patch(i.channel_id, { thinkingLevel: level });
      const displayLevel = level ? String(active.reasoningLabels?.[level] ?? level) : this.msg.reasoningDefaultValue;
      return this.respond(i, 7, { content: this.msg.thinkingSet(displayLevel), components: [] });
    }
    if (i.type === 3 && i.data?.custom_id === 'pick_model') {
      // Re-check on submit: the select menu was admin-gated, but the component round-trips independently.
      if (!this.isAdminMember(i.member)) return this.respond(i, 7, { content: this.msg.modelForbidden, components: [] });
      const [provider, model] = String(i.data.values?.[0] ?? '').split('::');
      if (provider && model) {
        const models = await this.listModels().catch(() => []);
        const selected = models.find((entry) => entry.provider === provider && entry.model === model);
        // Fast is a provider capability, not a portable channel preference. Clear it when leaving the
        // OpenAI OAuth descriptor so the next turn cannot send priority service_tier to another API.
        this.state.patch(i.channel_id, { model: { provider, model }, ...(!selected?.fastAvailable ? { fast: false } : {}) });
      }
      return this.respond(i, 7, { content: this.msg.modelSet(provider && model ? `${provider}/${model}` : model), components: [] });
    }
  }

  /** Send an interaction callback (type 4 = message, 5 = defer, 7 = update the component message). */
  async respond(i, type, data) {
    await this.rest('POST', `/interactions/${i.id}/${i.token}/callback`, { type, data });
  }

  /** Edit the original (deferred) interaction reply — used after a type-5 defer for slow work. */
  async editOriginal(i, data) {
    await this.rest('PATCH', `/webhooks/${this.appId}/${i.token}/messages/@original`, data);
  }

  /** Render a parked AskUserQuestion (from the brain's `ask` event) as an orange embed plus native
   *  components — option buttons for small single-select questions, string selects otherwise (see
   *  buildAskComponents). Registers a pending entry the interaction/text handlers resolve. */
  async postAsk(channelId, replyToId, askerId, id, questions) {
    const cs = this.cfg.language === 'cs';
    const title = `❓ ${this.cfg.agentName || 'Elowen'} ${cs ? 'potřebuje tvůj vstup' : 'needs your input'}`;
    const note = askTruncationNote(questions, { cs });
    const desc = [questions.map((q) => `**${q.header}** — ${q.question}`).join('\n\n'), note && `-# ${note.replaceAll('\n', '\n-# ')}`]
      .filter(Boolean).join('\n\n');
    const res = await this.rest('POST', `/channels/${channelId}/messages`, {
      ...(replyToId ? { message_reference: { message_id: replyToId, fail_if_not_exists: false } } : {}),
      embeds: [{ title, description: desc, color: 0xE67E22 }],
      components: buildAskComponents(id, questions, { cs }),
    }).catch((e) => { this.log.error(`postAsk failed: ${e?.message ?? e}`); return null; });
    this.pendingAsks.set(id, { channelId, messageId: res?.id ?? null, questions, askerId, selected: {}, awaitingText: false, title, desc });
  }

  /** The core settled this question — by an answer, its own timeout, an abort, or a newer question
   *  superseding it. Retire the posted message so nobody is left clicking buttons that can no longer
   *  reach anything: a room used to keep an expired question live forever, and a click on it was a
   *  confusing dead end. An `answered` resolution needs no edit here — whichever surface answered has
   *  already replaced the message with its own summary. */
  async resolveAsk(channelId, id, reason) {
    const pend = this.pendingAsks.get(id);
    if (!pend) return;
    this.pendingAsks.delete(id);
    if (reason === 'answered' || !pend.messageId) return;
    const cs = this.cfg.language === 'cs';
    const title = reason === 'timeout'
      ? (cs ? '⏱ Otázka vypršela' : '⏱ Question expired')
      : (cs ? '✖️ Otázka zrušena' : '✖️ Question cancelled');
    await this.rest('PATCH', `/channels/${pend.channelId ?? channelId}/messages/${pend.messageId}`, {
      embeds: [{ title, description: pend.desc, color: 0x95A5A6 }],
      components: [],
    }).catch(() => {});
  }

  /** Deliver every collected pick of a pending ask to the parked turn and close out the message. */
  async settleAsk(i, id, pend, cs) {
    const answers = pend.questions.map((q, qi) => ({ header: q.header, selected: pend.selected[qi] ?? [] }));
    const settled = this.answerQuestion(id, answers);
    this.pendingAsks.delete(id);
    if (!settled) return this.respond(i, 7, { embeds: [{ title: cs ? '⏱ Otázka vypršela' : '⏱ Question expired', color: 0x95A5A6 }], components: [] });
    const summary = answers.map((a) => `**${a.header}:** ${a.selected.join(', ') || '—'}`).join('\n');
    return this.respond(i, 7, { embeds: [{ title: cs ? '✅ Odpovězeno' : '✅ Answered', description: summary, color: 0x2ECC71 }], components: [] });
  }

  /** Resolve an `ask:*` component interaction: an option button (`ask:<id>:<qi>:<oi>`) records that
   *  question's pick — and answers instantly on a single-question ask; a select stores its picks;
   *  Submit delivers all answers to the parked turn; Other flips to free-text capture (the next
   *  channel message answers). */
  async onAskInteraction(i) {
    const cs = this.cfg.language === 'cs';
    const [, id, part, sub] = String(i.data.custom_id).split(':');
    const pend = this.pendingAsks.get(id);
    if (!pend) return this.respond(i, 7, { components: [] }); // expired → just strip the stale components
    // Only the person the question was posed to (or the operator) may answer it.
    const clickerId = i.member?.user?.id ?? i.user?.id;
    if (clickerId && clickerId !== pend.askerId && !this.isAdminMember(i.member)) {
      return this.respond(i, 4, { content: cs ? 'Na tuhle otázku odpovídá někdo jiný.' : 'This question is for someone else.', flags: 64 });
    }
    if (part === 'submit') return this.settleAsk(i, id, pend, cs);
    if (part === 'other') {
      pend.awaitingText = true;
      const note = cs ? '✏️ Napiš odpověď do tohohle kanálu.' : '✏️ Type your answer in this channel.';
      return this.respond(i, 7, { embeds: [{ title: pend.title, description: `${pend.desc}\n\n${note}`, color: 0x3498DB }], components: [] });
    }
    const qi = Number(part);
    const q = pend.questions[qi];
    if (!q) return this.respond(i, 6, {});
    // Option button → record the pick; a single-question ask answers right away, a multi-question one
    // re-renders so the green button shows the pick and Submit delivers later.
    if (sub !== undefined) {
      const label = q.options[Number(sub)]?.label;
      if (label) pend.selected[qi] = [label];
      if (pend.questions.length === 1) return this.settleAsk(i, id, pend, cs);
      return this.respond(i, 7, { components: buildAskComponents(id, pend.questions, { cs, selected: pend.selected }) });
    }
    // Otherwise a string select → record that question's selected labels (the client shows them).
    pend.selected[qi] = (i.data.values ?? []).map((v) => q.options[Number(v)]?.label).filter(Boolean);
    return this.respond(i, 6, {}); // DEFERRED_UPDATE: ack without changing the message
  }

  async reply(channelId, text, replyToId) {
    await postWithImages(this, channelId, text, replyToId);
  }

  /** Load up to the configured cap (default MAX_UPLOAD_IMAGES) of generated images by validated name
   *  from the image plugins' data dirs. A missing/unreadable file is skipped silently — the text still
   *  goes out without it. */
  resolveImageFiles(names) {
    return resolveImageFiles(this.imageDirs, names, cfgNum(this.cfg, 'maxUploadImages', MAX_UPLOAD_IMAGES, 1, 10));
  }

  /** Load the bytes behind the `file` events of this turn — the counterpart of resolveImageFiles for a
   *  file the agent shared on purpose (ShareFile). Its `ref` is a relative daemon URL, dead text on
   *  Discord, so the bytes are uploaded instead. Without a configured dir there is nothing to read and
   *  the answer text goes out alone (bare test fakes construct the adapter without one). */
  resolveSharedFiles(refs) {
    if (!this.chatFilesDir) return [];
    return resolveSharedFiles(this.chatFilesDir, refs, MAX_UPLOAD_FILES);
  }

  /** Multipart message post: text + attached files, with `mimeFor` deciding each part's declared type.
   *  Same auth + 429 retry discipline as rest(). */
  async uploadAttachments(channelId, content, files, mimeFor, attempt = 0, extra = {}) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content, ...extra }));
    files.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.data], { type: mimeFor(f.name) }), f.name));
    const res = await fetch(`${this.api}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bot ${this.cfg.botToken}` }, // content-type: fetch sets the multipart boundary
      body: form,
    });
    if (await this.retryAfter(res, attempt)) return this.uploadAttachments(channelId, content, files, mimeFor, attempt + 1, extra);
    if (!res.ok) throw new Error(`discord API POST /channels/${channelId}/messages (upload) → HTTP ${res.status}`);
    return res.json();
  }

  /** Attach generated/shared IMAGES (Discord renders uploads; a relative daemon link would be dead text). */
  uploadImages(channelId, content, files, attempt = 0, extra = {}) {
    return this.uploadAttachments(channelId, content, files, imageMimeType, attempt, extra);
  }

  /** Attach general shared FILES. Same transport as an image upload — the only thing that differs is the
   *  declared content type, which is what decides whether Discord previews a PDF or offers a download. */
  uploadFiles(channelId, content, files, attempt = 0, extra = {}) {
    return this.uploadAttachments(channelId, content, files, fileMimeType, attempt, extra);
  }

  /** The voice provider's credentials for this plugin's config, or null when unset/keyless. */
  voiceCreds() {
    return voiceCreds(this.cfg, this.resolveProvider);
  }

  /** Transcribe one audio attachment via Whisper — download the CDN clip, then hand it to the shared
   *  transcriber. Returns the trimmed text, or null when empty/keyless; throws when oversized. */
  async transcribe(clip) {
    const creds = this.voiceCreds();
    if (!creds) return null;
    if ((clip.size ?? 0) > MAX_AUDIO_BYTES) throw new Error('audio over Whisper size limit');
    const dl = await fetch(clip.url);
    if (!dl.ok) throw new Error(`download HTTP ${dl.status}`);
    const buf = Buffer.from(await dl.arrayBuffer());
    return transcribeBuffer(creds, buf, { name: clip.name, type: clip.type, model: this.cfg.sttModel });
  }

  /** Whether spoken replies are on for a channel: the per-channel /voice toggle wins, else cfg.tts. */
  voiceEnabled(channelId) {
    const s = this.state.get(channelId).voice;
    return typeof s === 'boolean' ? s : this.cfg.tts === true;
  }

  /** Synthesize the reply text (markdown-stripped) with the provider's TTS and attach it as an MP3. */
  async speakReply(channelId, text, replyToId) {
    const creds = this.voiceCreds();
    if (!creds) return;
    const input = stripForSpeech(text).slice(0, TTS_MAX_CHARS);
    if (!input) return;
    const res = await fetch(`${creds.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${creds.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: String(this.cfg.ttsModel || 'gpt-4o-mini-tts'), voice: String(this.cfg.ttsVoice || 'alloy'), input, response_format: 'mp3' }),
    });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await this.uploadAudio(channelId, '', [{ name: 'reply.mp3', data: buf }], replyToId ? { message_reference: { message_id: replyToId } } : {});
  }

  /** Multipart message post carrying MP3 audio attachments (mirrors uploadImages; distinct mime). */
  async uploadAudio(channelId, content, files, extra = {}, attempt = 0) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content, ...extra }));
    files.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.data], { type: 'audio/mpeg' }), f.name));
    const res = await fetch(`${this.api}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bot ${this.cfg.botToken}` }, // fetch sets the multipart boundary
      body: form,
    });
    if (await this.retryAfter(res, attempt)) return this.uploadAudio(channelId, content, files, extra, attempt + 1);
    if (!res.ok) throw new Error(`discord API POST /channels/${channelId}/messages (audio) → HTTP ${res.status}`);
    return res.json();
  }

  /** Host-initiated push (cron/tick echoes) → the configured notification channel. No-op without one.
   *  A `notice` marks one of the daemon's standing announcements, which we say in the configured
   *  language; free-form text arrives without one and is delivered as written. */
  async notify(text, channelId, notice) {
    const target = (typeof channelId === 'string' && channelId.trim())
      || (typeof this.cfg.notifyChannelId === 'string' ? this.cfg.notifyChannelId.trim() : '');
    if (!target) return;
    await this.reply(target, lifecycleText(this.cfg.language, notice, text));
  }

  /** The one 429 discipline every Discord call shares (rest + both multipart posters): on a rate-limited
   *  response with retries left, wait out `retry-after` and report that the caller should try again. */
  async retryAfter(res, attempt) {
    if (res.status !== 429 || attempt >= 3) return false;
    const wait = (Number(res.headers.get('retry-after')) || 1) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return true;
  }

  async rest(method, path, body, attempt = 0) {
    const res = await fetch(`${this.api}${path}`, {
      method,
      headers: { authorization: `Bot ${this.cfg.botToken}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (await this.retryAfter(res, attempt)) return this.rest(method, path, body, attempt + 1);
    if (!res.ok) throw new Error(`discord API ${method} ${path} → HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  }
}
