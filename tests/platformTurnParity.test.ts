// @vitest-environment node
/** One turn sequence for every platform adapter.
 *
 *  Five copies of the same block used to live here — Discord twice (the inbound message turn and the
 *  slash-command turn), Teams, Telegram and WhatsApp — and they had drifted in ways nobody chose: only
 *  Teams logged a failed turn, only Teams waited for the "seen" reaction to land before removing it, only
 *  WhatsApp cleared its typing state. `elowen-plugin-shared/turnRunner` now owns the sequence and each
 *  adapter supplies only its platform verbs, so a fix lands once instead of five times.
 *
 *  Two invariants keep breaking in this area specifically, and the engine's own tests cannot prove them
 *  for a registry adapter — the WIRING is what fails, not the engine. So they are driven here through
 *  each adapter's real inbound entry point:
 *
 *    1. AskUserQuestion still renders and retires with live streaming DISABLED. An adapter that forwards
 *       nothing parks the room until the core's timeout; one that forwards only `ask` leaves an expired
 *       question with live buttons forever. Both were real, on every platform.
 *    2. A STEERED turn gets no completion marker. The message was injected into a turn that was already
 *       running, so the running turn's own message owns the outcome; a checkmark here claims a completion
 *       that has not happened.
 *
 *  The last section is the derived source check that stops a sixth copy from appearing, and it discovers
 *  the platform plugins the same way `platformPolicyParity.test.ts` does rather than listing them.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pluginsDir = join(repoRoot, 'plugins');
const log = { info() {}, warn() {}, error() {}, debug() {} };

/** What one driven turn observed, in the order the adapter did it. */
type Turn = {
  /** ids of questions the adapter was asked to RENDER while streaming was off */
  asked: string[];
  /** ids of questions the adapter was asked to RETIRE */
  retired: string[];
  /** every status marker, `+value` for an add and `-value` for a removal */
  marks: string[];
  /** text delivered to the chat */
  sent: string[];
};

/** A brain turn that parks a question, sees it settled, and then returns `reply`. `''` is the steer
 *  sentinel — a message folded into a turn that was already running. */
const brainThat = (reply: string) =>
  async (_src: unknown, _text: string, onEvent: (e: Record<string, unknown>) => void) => {
    onEvent({ type: 'ask', id: 'q1', questions: [{ header: 'Where', options: [{ label: 'here' }] }] });
    onEvent({ type: 'token', text: 'ignored with no stream' });
    onEvent({ type: 'ask_resolved', id: 'q1', reason: 'timeout' });
    return reply;
  };

class MemoryState {
  data: Record<string, Record<string, unknown>> = {};
  all() { return this.data; }
  get(id: string) { return this.data[id] ?? {}; }
  patch(id: string, fields: Record<string, unknown>) { this.data[id] = { ...this.data[id], ...fields }; }
}

/** A policy every platform's matcher accepts: `*` is uniform since Phase G. */
const POLICIES = [{ roleId: '*', projectIds: [1] }];

type Driver = (reply: string) => Promise<Turn>;

const discordTurn: Driver = async (reply) => {
  const { DiscordAdapter } = await import(join(pluginsDir, 'discord/lib/adapter.mjs')) as { DiscordAdapter: new (...a: unknown[]) => Record<string, any> };
  const t: Turn = { asked: [], retired: [], marks: [], sent: [] };
  const a = new DiscordAdapter(
    { botToken: 'tok', rolePolicies: POLICIES, streaming: false }, log, new MemoryState(), async () => [],
  );
  a.botId = 'BOT';
  a.rest = async (_method: string, path: string) => (path === '/channels/100' ? { id: '100', name: 'general', type: 0 } : {});
  a.postAsk = async (_c: string, _r: string, _a: string, id: string) => { t.asked.push(id); };
  a.resolveAsk = async (_c: string, id: string) => { t.retired.push(id); };
  a.react = async (_c: string, _m: string, emoji: string) => { t.marks.push(`+${emoji}`); };
  a.unreact = async (_c: string, _m: string, emoji: string) => { t.marks.push(`-${emoji}`); };
  a.reply = async (_c: string, text: string) => { t.sent.push(text); };
  a.listen(brainThat(reply));
  await a.onMessage({
    type: 0, guild_id: 'G', channel_id: '100', id: 'MSG',
    author: { id: 'U1', username: 'anna' }, member: { roles: ['R1'] }, content: 'ahoj',
  });
  return t;
};

/** Discord's OTHER copy: a slash-command turn, which builds no message and so decorates nothing. */
const discordSlashTurn: Driver = async (reply) => {
  const { DiscordAdapter } = await import(join(pluginsDir, 'discord/lib/adapter.mjs')) as { DiscordAdapter: new (...a: unknown[]) => Record<string, any> };
  const t: Turn = { asked: [], retired: [], marks: [], sent: [] };
  const a = new DiscordAdapter(
    { botToken: 'tok', rolePolicies: POLICIES, streaming: false }, log, new MemoryState(), async () => [],
  );
  a.rest = async (_method: string, path: string) => (path === '/channels/100' ? { id: '100', name: 'general', type: 0 } : {});
  a.respond = async () => undefined;
  a.postAsk = async (_c: string, _r: string, _a: string, id: string) => { t.asked.push(id); };
  a.resolveAsk = async (_c: string, id: string) => { t.retired.push(id); };
  a.react = async (_c: string, _m: string, emoji: string) => { t.marks.push(`+${emoji}`); };
  a.unreact = async (_c: string, _m: string, emoji: string) => { t.marks.push(`-${emoji}`); };
  a.reply = async (_c: string, text: string) => { t.sent.push(text); };
  a.listen(brainThat(reply));
  await a.dispatchSlashPrompt(
    { id: 'i-1', application_id: 'app', token: 'tok', channel_id: '100', guild_id: 'G', member: { user: { id: 'U1', username: 'anna' }, roles: ['R1'] } },
    '/test',
  );
  return t;
};

const telegramTurn: Driver = async (reply) => {
  const { TelegramAdapter } = await import(join(pluginsDir, 'telegram/lib/adapter.mjs')) as { TelegramAdapter: new (...a: unknown[]) => Record<string, any> };
  const t: Turn = { asked: [], retired: [], marks: [], sent: [] };
  const a = new TelegramAdapter(
    { rolePolicies: POLICIES, streaming: false }, log, new MemoryState(), async () => [],
  );
  a.bot = { api: { sendChatAction: async () => {} } };
  a.postAsk = async (_c: number, _r: number, _a: number, id: string) => { t.asked.push(id); };
  a.resolveAsk = async (_c: number, id: string) => { t.retired.push(id); };
  a.react = async (_c: number, _m: number, emoji: string) => { t.marks.push(`+${emoji}`); };
  a.reply = async (_c: number, text: string) => { t.sent.push(text); };
  a.listen(brainThat(reply));
  await a.onMessage({
    message: { message_id: 7, chat: { id: 5, type: 'private' }, from: { id: 42, username: 'anna' }, text: 'ahoj' },
  });
  return t;
};

const whatsappTurn: Driver = async (reply) => {
  const { WhatsAppAdapter } = await import(join(pluginsDir, 'whatsapp/lib/adapter.mjs')) as { WhatsAppAdapter: new (...a: unknown[]) => Record<string, any> };
  const t: Turn = { asked: [], retired: [], marks: [], sent: [] };
  const a = new WhatsAppAdapter(
    { senderPolicies: POLICIES, streaming: false }, log, new MemoryState(), async () => [], [], '', '', () => false,
  );
  a.sock = { sendPresenceUpdate: async () => {} };
  a.postAsk = async (_c: string, _q: unknown, _a: string, id: string) => { t.asked.push(id); };
  a.resolveAsk = async (_c: string, id: string) => { t.retired.push(id); };
  a.react = async (_key: unknown, emoji: string) => { t.marks.push(`+${emoji}`); };
  a.sendText = async (_c: string, text: string) => { t.sent.push(text); };
  a.listen(brainThat(reply));
  await a.onMessage({
    key: { remoteJid: '420111222333@s.whatsapp.net', id: 'M1', fromMe: false },
    message: { conversation: 'ahoj' },
    pushName: 'Anna',
  });
  return t;
};

const msteamsTurn: Driver = async (reply) => {
  const { MsTeamsAdapter } = await import(join(pluginsDir, 'msteams/lib/adapter.mjs')) as { MsTeamsAdapter: new (...a: unknown[]) => Record<string, any> };
  const t: Turn = { asked: [], retired: [], marks: [], sent: [] };
  const a = new MsTeamsAdapter(
    { appId: 'app-guid', appPassword: 's3cret', tenantId: 'tenant-guid', rolePolicies: POLICIES, streaming: false },
    log, new MemoryState(), async () => [], [], () => null, () => true, () => [], null,
  );
  Object.assign(a.connector, {
    typing: async () => {},
    reply: async () => 'act-1',
    send: async () => 'act-2',
    update: async () => {},
    remove: async () => {},
    addReaction: async (_u: string, _c: string, _m: string, type: string) => { t.marks.push(`+${type}`); },
    deleteReaction: async (_u: string, _c: string, _m: string, type: string) => { t.marks.push(`-${type}`); },
    member: async () => ({ userPrincipalName: 'alex@contoso.com' }),
    token: async () => 'tok',
  });
  a.postAsk = async (_c: string, _r: string, _a: string, id: string) => { t.asked.push(id); };
  a.resolveAsk = async (_c: string, id: string) => { t.retired.push(id); };
  a.tmSend = async (_c: string, text: string) => { t.sent.push(text); return 'act-3'; };
  a.listen(brainThat(reply));
  await a.onActivity({
    type: 'message', id: 'in-1', serviceUrl: 'https://smba.test/emea',
    from: { id: '29:enc', aadObjectId: 'aad-1', name: 'Alex Rivera' },
    recipient: { id: '28:bot', name: 'Elowen' },
    conversation: { id: 'a:conv1', conversationType: 'personal', tenantId: 'tenant-guid' },
    text: 'ahoj',
  });
  return t;
};

/** Every turn the registry runs through the shared engine. Discord contributes two: its slash-command
 *  turn is a separate call site with its own descriptor, and it was a separate copy. */
const drivers: Array<[string, Driver, { decorates: boolean }]> = [
  ['discord message', discordTurn, { decorates: true }],
  ['discord slash', discordSlashTurn, { decorates: false }],
  ['telegram', telegramTurn, { decorates: true }],
  ['whatsapp', whatsappTurn, { decorates: true }],
  ['msteams', msteamsTurn, { decorates: true }],
];

describe('platform turn wiring — AskUserQuestion with live streaming OFF', () => {
  for (const [name, drive] of drivers) {
    it(`${name} renders a parked question and retires it again`, async () => {
      const turn = await drive('the answer');
      // Rendering without retiring is the half-fix that shipped once already: the choices appear and then
      // sit there with live buttons long after the core has given up on them.
      expect(turn.asked, `${name} rendered the question`).toEqual(['q1']);
      expect(turn.retired, `${name} retired the question`).toEqual(['q1']);
      expect(turn.sent, `${name} delivered the answer`).toEqual(['the answer']);
    });
  }
});

describe('platform turn wiring — a steered turn earns no completion marker', () => {
  for (const [name, drive, { decorates }] of drivers) {
    it(`${name} adds no terminal marker and delivers nothing for a steered message`, async () => {
      const answered = await drive('the answer');
      const steered = await drive('');

      // Nothing is delivered for a steered message: the turn it was folded into carries the reply.
      expect(steered.sent, `${name} delivered nothing`).toEqual([]);

      if (!decorates) {
        expect(answered.marks, `${name} decorates nothing at all`).toEqual([]);
        expect(steered.marks, `${name} decorates nothing at all`).toEqual([]);
        return;
      }
      // The answered turn ends by ADDING its terminal marker; the steered turn is that same sequence
      // minus exactly that add, with the "seen" marker still retired either way.
      const terminal = answered.marks.at(-1)!;
      expect(terminal.startsWith('+'), `${name} terminal marker is an add`).toBe(true);
      expect(steered.marks, `${name} steered marks`).toEqual(answered.marks.slice(0, -1));
      expect(steered.marks, `${name} no terminal marker`).not.toContain(terminal);
      expect(steered.marks.length, `${name} still marked the message seen`).toBeGreaterThan(0);
    });
  }
});

/** Every .mjs file a plugin owns (excluding any vendored dependency tree). */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (entry.endsWith('.mjs')) out.push(path);
  }
  return out;
}

/** A platform adapter is a plugin that turns a matched policy into the shared access descriptor — the same
 *  discovery `platformPolicyParity.test.ts` uses, so a fifth platform is covered the day it lands. */
const platformPlugins = readdirSync(pluginsDir)
  .filter((name) => statSync(join(pluginsDir, name)).isDirectory())
  .filter((name) => sourceFiles(join(pluginsDir, name)).some((f) => readFileSync(f, 'utf8').includes('buildRoleAccess(')))
  .sort();

describe('no adapter keeps its own copy of the turn sequence', () => {
  // Derived from the INSTALLED engine, not from a hand-kept list: the event kinds it routes and the live
  // stream verbs it drives are exactly the things an adapter must no longer touch. A kind added to the
  // engine tomorrow starts being forbidden in the adapters on the same day.
  const runnerSrc = readFileSync(join(repoRoot, 'node_modules/elowen-plugin-shared/turnRunner.mjs'), 'utf8');
  const routedKinds = [...new Set([...runnerSrc.matchAll(/e\.type === '([a-z_]+)'/g)].map((m) => m[1]!))];
  const streamVerbs = [...new Set([...runnerSrc.matchAll(/\bstream\.([A-Za-z]+)\s*\(/g)].map((m) => m[1]!))];

  const kinds = routedKinds.join('|');
  const verbs = streamVerbs.join('|');

  /** The shapes a private turn sequence takes, matched against a STATEMENT rather than a line.
   *
   *  Comments are removed and whitespace collapsed first, so a call split across lines cannot hide and
   *  prose describing the engine is not mistaken for a copy of it. Each pattern is then bounded by `;` so
   *  it cannot pair a fragment of one statement with a fragment of a later one.
   *
   *  The three rules that matter are written so the obvious rewrites do not help. The event-kind rule
   *  matches the bare LITERAL rather than a comparison — routing an event means naming its kind, so a
   *  renamed local, a `switch`, an `includes()` and a `for` loop over an array of kinds all trip it. The
   *  stream rule covers the dotted call and the computed-member form of it. The last two are a secondary
   *  tripwire for the verbatim typing loop that used to sit in all five copies; being bounded to ONE
   *  statement they can be written around by hoisting the poke into a named function, which is why they
   *  are not what this suite rests on. */
  const OWN_SEQUENCE = [
    new RegExp(`['"\`](${kinds})['"\`]`),                               // routing a brain event by kind
    new RegExp(`\\.\\s*(${verbs})\\s*\\(`),                             // driving the live stream directly
    new RegExp(`\\[\\s*['"\`](${verbs})['"\`]\\s*\\]`),                 // ...through a computed member
    /\bisSteered\b|elowen-plugin-shared\/turnResult/,                   // re-deciding the completion marker
    /\b(setInterval|setTimeout)\b[^;]{0,240}\b(typing|composing|sendChatAction|sendPresenceUpdate)\b/, // a private typing loop
    /\b(typing|composing|sendChatAction|sendPresenceUpdate)\b[^;]{0,240}\b(setInterval|setTimeout)\b/,
  ];
  /** Strip comments, then collapse and split. The `//` guard keeps `https://` inside a string intact —
   *  chopping a statement there would silently shorten what the patterns get to look at. */
  const statements = (text: string) => text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\\])\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .split(';');

  it('routes the turn only through the shared engine', () => {
    const offenders: string[] = [];
    for (const name of platformPlugins) {
      for (const file of sourceFiles(join(pluginsDir, name))) {
        for (const statement of statements(readFileSync(file, 'utf8'))) {
          if (OWN_SEQUENCE.some((re) => re.test(statement))) offenders.push(`${file.slice(repoRoot.length)}: ${statement.trim().slice(0, 140)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every platform adapter actually calls the shared engine', () => {
    // The scan above is a NEGATIVE check and would pass just as happily on a plugin that runs no turn at
    // all. This is the positive half: the sequence has to come from somewhere, and this is where.
    for (const name of platformPlugins) {
      const sources = sourceFiles(join(pluginsDir, name)).map((f) => readFileSync(f, 'utf8')).join('\n');
      expect(sources, `${name} imports the shared turn runner`).toContain("from 'elowen-plugin-shared/turnRunner'");
      expect(sources.includes('runTurn({'), `${name} runs its turn through it`).toBe(true);
    }
  });

  it('the scan recognises the shapes it claims to, and leaves legitimate code alone', () => {
    // A source scan passes trivially if its patterns match nothing, so these are the rewrites that would
    // otherwise slip past: a renamed local, a call split across lines, a hand-rolled loop, a switch, and a
    // computed member access. Plus the code that MUST stay allowed — including the comments that merely
    // TALK about the engine, which is what the stripping step exists for.
    const forbidden = [
      "const onEvent = (e) => { if (e.type === 'ask') void this.postAsk(e.id, e.questions); };",
      "const kind = event.type;\nif (kind === 'ask_resolved') void this.resolveAsk(event.id);",
      "for (const k of ['ask', 'ask_resolved']) if (event.kind === k) this.render(event);",
      "switch (e.type) {\n  case 'ask':\n    return this.postAsk(e);\n}",
      'if (live) await live\n  .finalize(reply);',
      "await live['fail'](errorMessage);",
      'if (reactions && !isSteered(reply)) void this.react(m.key, "OK");',
      "import { isSteered } from 'elowen-plugin-shared/turnResult';",
      "const t = setInterval(() => void this.bot.api.sendChatAction(chatId, 'typing').catch(() => {}), 5000);",
    ];
    const allowed = [
      "typing: { poke: () => this.bot.api.sendChatAction(chatId, 'typing'), intervalMs: 5000 },",
      'reactions: this.cfg.reactions !== false ? { seen: "S", add: (e) => this.react(m.key, e) } : null,',
      'try { await this.rest(path); } catch (e) { return fail(e); }',
      'this.heartbeat = setInterval(() => { this.send({ op: 1, d: this.seq }); }, interval);',
      "await runTurn({ run: (onEvent) => this.handler(src, text, onEvent), stream, send: (r) => this.reply(id, r) });",
      "/** Render a parked AskUserQuestion (from the brain's `ask` event) as an inline keyboard. */",
      "// The core settled this question, so the posted prompt is retired and `stream.finalize` is not ours.",
      "const base = 'https://discord.com/api/v10';",
    ];
    for (const sample of forbidden) {
      expect(statements(sample).some((s) => OWN_SEQUENCE.some((re) => re.test(s))), sample).toBe(true);
    }
    for (const sample of allowed) {
      expect(statements(sample).some((s) => OWN_SEQUENCE.some((re) => re.test(s))), sample).toBe(false);
    }
  });
});
