// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PluginApiAuth, PluginDb } from 'elowen/plugin-api';
import { createAdminApi } from '../plugins/chatbot/src/adminApi.js';
import { DEFAULT_LIMITS, LIMIT_FIELDS, readBotLimits } from '../plugins/chatbot/src/limits.js';
import { decideBudget, knownCost, NO_USAGE, utcDay } from '../plugins/chatbot/src/budget.js';
import { migrate } from '../plugins/chatbot/src/db.js';
import { validateBotPatch } from '../plugins/chatbot/src/validation.js';
import { pluginDbFor } from './helpers/pluginDb.js';
import { createChatbotHost, registerBot, NOW_MS } from './helpers/chatbotHost.js';

const day = utcDay(NOW_MS);
const admin = { admin: true, userId: 1 } as PluginApiAuth;
/** These cases only ever read the budget. Erasing from here would mean the route under test called
 *  something it has no business calling, so the stub fails instead of quietly returning a count. */
const noErase = (): never => { throw new Error('erase is not part of this test'); };

describe('daily budget read model', () => {
  it.each([
    { admitted: 0, cost: 0, turns: 0, priced: 0, verdict: { ok: true } },
    { admitted: 4, cost: 0.0737, turns: 4, priced: 4, verdict: { ok: true } },
    { admitted: 500, cost: 0.1, turns: 4, priced: 4, verdict: { ok: false, reason: 'budget_exhausted', ceiling: 'turns' } },
    { admitted: 4, cost: 10, turns: 4, priced: 4, verdict: { ok: false, reason: 'budget_exhausted', ceiling: 'cost' } },
    { admitted: 4, cost: 0.1, turns: 4, priced: 1, verdict: { ok: false, reason: 'budget_unverifiable', ceiling: 'cost' } },
  ])('reports exactly the admission verdict: $verdict', async ({ admitted, cost, turns, priced, verdict }) => {
    const host = createChatbotHost();
    registerBot(host);
    host.db.prepare('INSERT INTO p_chatbot_budget_days VALUES (?, ?, ?, ?)').run(12, day, admitted, new Date(NOW_MS).toISOString());
    host.db.prepare(`INSERT INTO usage_by_origin
      (day,user_id,origin,origin_kind,trusted,turns,input,output,cache_read,cache_write,total,cost,costed_turns,first_at,last_at)
      VALUES (?,12,'platform:chatbot','platform',1,?,0,0,1090000,0,1090000,?,?,?,?)`)
      .run(day, turns, cost, priced, NOW_MS, NOW_MS);
    const api = createAdminApi({ store: host.store, stores: host.stores, publicBaseUrl: () => null, now: () => new Date(NOW_MS), erase: noErase });
    const response = await api.list(admin);
    const budget = (response.body as { bots: { budget: unknown }[] }).bots[0]!.budget;
    expect(budget).toMatchObject({ day, admittedTurns: admitted, usage: { tokens: 1_090_000 }, verdict });
    expect(host.store.dailyBudget(12, readBotLimits(host.store.botByUserId(12)), day).verdict).toEqual(verdict);
    expect((await api.list({ admin: false, userId: 2 } as PluginApiAuth)).status).toBe(403);
  });

  it('reads only the chosen account and origin, including spend on days without plugin turns', async () => {
    const host = createChatbotHost();
    registerBot(host);
    const insert = host.db.prepare(`INSERT INTO usage_by_origin
      (day,user_id,origin,origin_kind,trusted,turns,input,output,cache_read,cache_write,total,cost,costed_turns,first_at,last_at)
      VALUES (?,?,?,'platform',1,2,0,0,1000000,0,1000000,?,2,?,?)`);
    for (const [id, origin, cost] of [[12, 'platform:chatbot', 0.0737], [12, 'platform:discord', 80], [99, 'platform:chatbot', 90]] as const) {
      insert.run(day, id, origin, cost, NOW_MS, NOW_MS);
    }
    const api = createAdminApi({ store: host.store, stores: host.stores, publicBaseUrl: () => null, now: () => new Date(NOW_MS), erase: noErase });
    const before = utcDay(NOW_MS - 86400000);
    const response = await api.stats(admin, { chatbotUserId: '12', from: before, to: day });
    expect(response.body).toMatchObject({ days: [], spend: [
      { day: before, usage: NO_USAGE }, { day, usage: { tokens: 1000000, costUsd: 0.0737 } },
    ] });
    const current = host.store.dailyBudget(12, readBotLimits(host.store.botByUserId(12)), day);
    expect(current.admittedTurns).toBe(0);
  });

  it('does not turn unknown pricing into free spend or let informational tokens refuse', () => {
    expect(knownCost(NO_USAGE)).toBe(0);
    expect(knownCost(null)).toBeNull();
    expect(knownCost({ turns: 2, tokens: 0, costUsd: 0.1, costedTurns: 1 })).toBeNull();
    expect(decideBudget({ limits: DEFAULT_LIMITS, admittedTurns: 0, usage: { turns: 1, tokens: null, costUsd: 0.1, costedTurns: 1 } })).toEqual({ ok: true });
  });
});

describe('removed token ceiling', () => {
  it('rejects the retired payload field', () => {
    expect(LIMIT_FIELDS).not.toContain('dailyTokenLimit');
    expect(validateBotPatch({ chatbotUserId: 12, expectedUpdatedAt: '2026-09-01', limits: { dailyTokenLimit: 1 } }).ok).toBe(false);
  });

  it('migrates a populated v5 row once and preserves its other settings', () => {
    const db = pluginDbFor('chatbot-daily-usage-migration')('chatbot');
    let migrations: Parameters<PluginDb['migrate']>[0] = [];
    migrate({ ...db, migrate: (steps) => { migrations = steps; } });
    db.migrate(migrations.filter((step) => step.version <= 5));
    db.prepare(`INSERT INTO p_chatbot_bots (chatbot_user_id,public_id,display_name,created_at,updated_at,daily_token_limit,daily_cost_microusd)
      VALUES (12,'cbt_old','Keep me','2026-01-01','2026-01-01',1000000,12000000)`).run();
    migrate(db);
    migrate(db);
    const row = db.prepare('SELECT * FROM p_chatbot_bots WHERE chatbot_user_id = 12').get();
    expect(row).toMatchObject({ display_name: 'Keep me', daily_cost_microusd: 12000000 });
    expect(row).not.toHaveProperty('daily_token_limit');
  });
});
