// @vitest-environment node
/** The daily budget: what a chatbot may spend in one UTC day, and what happens when it has spent it.
 *
 *  Two sources and nothing else decide it — the turns this plugin ADMITTED, counted in its own table, and the
 *  tokens and money core recorded per (day, account, origin) in `usage_by_origin`. Every test below writes one
 *  of those two and watches which way the next message goes, because "the ceiling held" and "the ceiling read
 *  a number" are the same claim only when the second one is observable. */
import { describe, expect, it, beforeEach } from 'vitest';
import { microUsd, secondsUntilNextUtcDay, utcDay } from '../plugins/chatbot/src/budget.js';
import {
  CHATBOT_SITE as SITE,
  CLIENT_TURN_ID as UUID,
  NOW_MS,
  createChatbotHost,
  issueToken,
  postRequest,
  registerBot,
  settledTurn,
  type ChatbotHost,
} from './helpers/chatbotHost.js';

/** The UTC day every test here counts in, taken from the fixture's own instant. */
const DAY = utcDay(NOW_MS);

let host: ChatbotHost;
beforeEach(async () => {
  host = createChatbotHost();
  registerBot(host);
  await host.adapter.connect();
});

/** One day's spend, as core would have rolled it up: writing the bucket again states what it now holds.
 *  `costUsd` and `costedTurns` are separate on purpose — "nothing was priced" and "this much was spent" are
 *  different facts, and core keeps them apart. */
function spend(input: {
  userId?: number;
  day?: string;
  origin?: string;
  turns: number;
  tokens?: number;
  costUsd?: number | null;
  costedTurns?: number;
}): void {
  host.db.prepare(`INSERT INTO usage_by_origin
                     (day, user_id, origin, origin_kind, trusted, turns, input, output, cache_read, cache_write,
                      total, cost, costed_turns, first_at, last_at)
                   VALUES (?, ?, ?, 'platform', 1, ?, 0, ?, 0, 0, ?, ?, ?, ?, ?)
                   ON CONFLICT (day, user_id, origin) DO UPDATE SET
                     turns = excluded.turns, total = excluded.total,
                     cost = excluded.cost, costed_turns = excluded.costed_turns`)
    .run(
      input.day ?? DAY,
      input.userId ?? 12,
      input.origin ?? 'platform:chatbot',
      input.turns,
      input.tokens ?? 0,
      input.tokens ?? 0,
      input.costUsd === undefined ? null : input.costUsd,
      input.costedTurns ?? (input.costUsd === undefined || input.costUsd === null ? 0 : input.turns),
      NOW_MS,
      NOW_MS,
    );
}

const submit = (token: string, clientTurnId: string) => host.handler(postRequest({
  path: 'turns',
  headers: { origin: SITE, authorization: `ChatbotVisitor ${token}` },
  body: { schemaVersion: 2, clientTurnId, message: 'ahoj' },
}));

const day = () => host.store.budgetDay(12, DAY);

describe('turns admitted today', () => {
  it('refuses the turn over the daily ceiling, with the wait until the day it counts in is over', async () => {
    host.setLimits(12, { dailyTurnLimit: 2 });
    const first = await issueToken(host);
    const second = await issueToken(host);
    const third = await issueToken(host);
    for (const [index, issued] of [first, second].entries()) {
      expect((await submit(issued.body.token as string, index === 0 ? UUID : '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c50')).status).toBe(202);
    }
    expect(day().admitted_turns).toBe(2);

    const callsBefore = host.calls.length;
    const over = await submit(third.body.token as string, '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c51');
    expect(over).toMatchObject({ status: 429, body: { error: 'budget_exhausted' } });
    // The budget is a DAY, not a window: the wait is until the next UTC midnight, and it is the real one.
    expect((over.headers as Record<string, string>)['retry-after']).toBe(String(secondsUntilNextUtcDay(NOW_MS)));
    expect(Number((over.headers as Record<string, string>)['retry-after'])).toBeLessThanOrEqual(86_400);
    // Refused before anything was written, queued or sent to a model.
    expect(host.store.turnByClientId(12, third.body.visitorId as string, '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c51')).toBeNull();
    expect(host.calls).toHaveLength(callsBefore);
    expect(day().admitted_turns).toBe(2);
  });

  it('starts again on the next UTC day', async () => {
    host.setLimits(12, { dailyTurnLimit: 1 });
    const issued = await issueToken(host);
    expect((await submit(issued.body.token as string, UUID)).status).toBe(202);
    expect((await submit(issued.body.token as string, '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c52'))).toMatchObject({ status: 429 });

    // Tomorrow is a DIFFERENT row with its own count: the day is the grain, so yesterday's admissions are not
    // carried into today and today starts from zero.
    const tomorrow = utcDay(NOW_MS + 86_400_000);
    expect(tomorrow).not.toBe(DAY);
    host.setNow(NOW_MS + 86_400_000);
    expect(host.store.budgetDay(12, tomorrow).admitted_turns).toBe(0);
    expect((await submit(issued.body.token as string, '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c53')).status).toBe(202);
    expect(host.store.budgetDay(12, tomorrow).admitted_turns).toBe(1);
    expect(host.store.budgetDay(12, DAY).admitted_turns).toBe(1);
  });

  it('lets two simultaneous admissions admit exactly one turn when only one is left', async () => {
    host.setLimits(12, { dailyTurnLimit: 1 });
    const first = await issueToken(host);
    const second = await issueToken(host);
    // Two different conversations, submitted together: the counter is the only thing that can decide this.
    const [a, b] = await Promise.all([
      submit(first.body.token as string, UUID),
      submit(second.body.token as string, '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c54'),
    ]);
    expect([a.status, b.status].sort()).toEqual([202, 429]);
    expect(day().admitted_turns).toBe(1);
    expect(host.calls.length).toBeLessThanOrEqual(1);
  });

  it('counts a retried message once', async () => {
    host.setLimits(12, { dailyTurnLimit: 5 });
    const issued = await issueToken(host);
    const token = issued.body.token as string;
    const first = await submit(token, UUID);
    const retry = await submit(token, UUID);
    expect(retry.body).toEqual(first.body);
    // A retry is the same turn: it costs neither an admission nor a model call.
    expect(day().admitted_turns).toBe(1);
    await settledTurn(host, (first.body as { turnId: string }).turnId);
    expect(host.calls).toHaveLength(1);
  });

  it('releases the in-flight count when a turn settles', async () => {
    let release: ((reply: string) => void) | null = null;
    host.handleTurn = () => new Promise<string | undefined>((resolve) => { release = resolve; });
    const issued = await issueToken(host);
    const accepted = await submit(issued.body.token as string, UUID);
    expect(day().in_flight).toBe(1);
    release!('Dobrý den.');
    await settledTurn(host, (accepted.body as { turnId: string }).turnId);
    expect(day().in_flight).toBe(0);
    expect(day().admitted_turns).toBe(1);
  });
});

describe('what the chatbot spent', () => {
  it('admits a cheap cache-heavy turn regardless of its token volume', async () => {
    spend({ turns: 9, tokens: 1_090_000, costUsd: 0.0737 });
    host.db.prepare('UPDATE usage_by_origin SET cache_read = total, output = 0 WHERE day = ? AND user_id = 12').run(DAY);
    const issued = await issueToken(host);
    expect((await submit(issued.body.token as string, UUID)).status).toBe(202);
  });

  it('refuses the turn once the day has cost its ceiling, in the unit the ceiling is stated in', async () => {
    spend({ turns: 1, costUsd: 0.0015 });
    // 0.0015 USD is 1500 micro-USD — as an integer, so the comparison is between two whole numbers in one unit
    // rather than between a float and the number it is supposed to mean.
    expect(microUsd(0.0015)).toBe(1_500);

    // A ceiling one micro-USD above what was spent still admits a turn...
    host.setLimits(12, { dailyCostMicrousd: 1_501 });
    const issued = await issueToken(host);
    expect((await submit(issued.body.token as string, UUID)).status).toBe(202);

    // ...and a ceiling the day has REACHED does not.
    spend({ turns: 2, costUsd: 0.002 });
    host.setLimits(12, { dailyCostMicrousd: 2_000 });
    expect(await submit(issued.body.token as string, '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c57'))
      .toMatchObject({ status: 429, body: { error: 'budget_exhausted' } });
  });

  it('refuses rather than guesses when part of the day could not be priced', async () => {
    host.setLimits(12, { dailyCostMicrousd: 1_000_000 });
    // Four turns, one of them priced: the total is not "a little", it is UNKNOWN, and an unknown total must
    // never be read as a small one.
    spend({ turns: 4, costUsd: 0.001, costedTurns: 1 });
    const issued = await issueToken(host);
    const answer = await submit(issued.body.token as string, UUID);
    expect(answer).toMatchObject({ status: 429, body: { error: 'budget_unverifiable' } });
    // No Retry-After: retrying is exactly what will not help.
    expect((answer.headers as Record<string, string>)['retry-after']).toBeUndefined();
    expect(host.calls).toHaveLength(0);
  });

  it('treats a bucket whose turns reported no price at all as unverifiable, not as free', async () => {
    host.setLimits(12, { dailyCostMicrousd: 1_000_000 });
    spend({ turns: 2, costUsd: null, costedTurns: 0 });
    const issued = await issueToken(host);
    expect(await submit(issued.body.token as string, UUID)).toMatchObject({ status: 429, body: { error: 'budget_unverifiable' } });
  });

  it('accepts an empty day as nothing spent, which is a fact rather than a guess', async () => {
    host.setLimits(12, { dailyCostMicrousd: 1_000_000 });
    const issued = await issueToken(host);
    expect((await submit(issued.body.token as string, UUID)).status).toBe(202);
  });

  it('counts the chatbot\'s own origin only', async () => {
    host.setLimits(12, { dailyCostMicrousd: 1_000_000 });
    // Spend of the SAME account, attributed to somewhere else: it is not this chatbot's traffic, and reading
    // it as such would charge a website for somebody else's turns.
    spend({ turns: 5, tokens: 5_000, costUsd: 10, origin: 'ip' });
    spend({ turns: 5, tokens: 5_000, costUsd: 10, userId: 99, origin: 'platform:chatbot' });
    const issued = await issueToken(host);
    expect((await submit(issued.body.token as string, UUID)).status).toBe(202);
  });

  it('refuses rather than serves when the spend row cannot be read', async () => {
    host.setLimits(12, { dailyCostMicrousd: 1_000_000 });
    // A hand-edited row, or a core whose column changed shape: this plugin does not know what it means, and a
    // number it cannot read must not become a budget it can pass.
    spend({ turns: 1, tokens: 500 });
    host.db.prepare('UPDATE usage_by_origin SET cost = ? WHERE day = ? AND user_id = 12').run('many', DAY);
    const issued = await issueToken(host);
    expect(await submit(issued.body.token as string, UUID)).toMatchObject({ status: 429, body: { error: 'budget_unverifiable' } });
  });

  it('reads the day from core\'s own rollup and from nothing else', async () => {
    spend({ turns: 7, tokens: 7, costUsd: 0.5 });
    expect(host.store.usageFor(12, DAY)).toEqual({ turns: 7, tokens: 7, costUsd: 0.5, costedTurns: 7 });
    // The SAME account's other days are other days: the plugin never sums a rolling window.
    spend({ day: utcDay(NOW_MS - 86_400_000), turns: 900, tokens: 900 });
    expect(host.store.usageFor(12, DAY)).toMatchObject({ turns: 7, tokens: 7 });
    // A chatbot that has never spent anything has no row at all, and that reads as nothing rather than as an
    // error: it is the ordinary state of a freshly enabled chatbot.
    expect(host.store.usageFor(77, DAY)).toEqual({ turns: 0, tokens: 0, costUsd: null, costedTurns: 0 });
  });
});