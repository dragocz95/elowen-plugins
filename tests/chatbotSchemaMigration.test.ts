// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PluginDb, PluginDbMigrationStep } from 'elowen/plugin-api';
import { migrate } from '../plugins/chatbot/src/db.js';
import { pluginDbFor } from './helpers/pluginDb.js';

describe('migration 13 reserves receipt rows', () => {
  it('preserves completed receipts from schema 12 and accepts incomplete reservations', () => {
    const db = pluginDbFor(`chatbot-receipts-${randomUUID()}`)('chatbot');
    migrate({ ...db, migrate: (steps: PluginDbMigrationStep[]) => db.migrate(steps.filter((step) => step.version <= 12)) } as PluginDb);
    const receipt = JSON.stringify({ path: '/guest/photo.png', name: 'photo.png' });
    db.prepare(`INSERT INTO p_chatbot_upload_receipts
      (id, chatbot_user_id, visitor_id, client_turn_id, receipt_json, name, created_at, expires_at)
      VALUES ('old', 12, 'visitor', 'turn', ?, 'photo.png', '2026-09-24', '2026-09-25')`).run(receipt);
    migrate(db);
    expect(db.appliedVersion()).toBe(13);
    expect(db.prepare('SELECT receipt_json, name FROM p_chatbot_upload_receipts WHERE id = ?').get('old'))
      .toEqual({ receipt_json: receipt, name: 'photo.png' });
    db.prepare(`INSERT INTO p_chatbot_upload_receipts
      (id, chatbot_user_id, visitor_id, client_turn_id, name, created_at, expires_at)
      VALUES ('new', 12, 'visitor', 'next', 'photo.png', '2026-09-24', '2026-09-25')`).run();
    expect(db.prepare('SELECT receipt_json FROM p_chatbot_upload_receipts WHERE id = ?').get('new'))
      .toEqual({ receipt_json: null });
  });
});

describe('migration 11 removes unused columns', () => {
  it('keeps bot, action and budget data from a version 10 database', () => {
    const db = pluginDbFor(`chatbot-schema-${randomUUID()}`)('chatbot');
    migrate({ ...db, migrate: (steps: PluginDbMigrationStep[]) => db.migrate(steps.filter((step) => step.version <= 10)) } as PluginDb);
    db.prepare(`INSERT INTO p_chatbot_bots
      (chatbot_user_id, public_id, customer_user_id, display_name, status, created_at, updated_at)
      VALUES (12, 'bot-12', 99, 'Example', 'draft', '2026-09-24', '2026-09-24')`).run();
    db.prepare(`INSERT INTO p_chatbot_budget_days
      (chatbot_user_id, day, admitted_turns, in_flight, updated_at)
      VALUES (12, '2026-09-24', 3, 1, '2026-09-24')`).run();
    db.prepare(`INSERT INTO p_chatbot_actions
      (id, turn_id, snapshot_id, action, target_id, request_json, status, requires_confirmation, created_at, expires_at)
      VALUES ('a1', 't1', 's1', 'click', 'e1', '{"schemaVersion":1,"kind":"click","targetId":"e1","value":null}', 'done', 0, '2026-09-24', '2026-09-25')`).run();

    migrate(db);
    expect(db.appliedVersion()).toBe(13);
    expect(db.prepare('SELECT chatbot_user_id, display_name FROM p_chatbot_bots').all())
      .toEqual([{ chatbot_user_id: 12, display_name: 'Example' }]);
    expect(db.prepare('SELECT chatbot_user_id, day, admitted_turns FROM p_chatbot_budget_days').all())
      .toEqual([{ chatbot_user_id: 12, day: '2026-09-24', admitted_turns: 3 }]);
    expect(db.prepare('SELECT id, action, request_json FROM p_chatbot_actions').all())
      .toEqual([{ id: 'a1', action: 'click', request_json: '{"schemaVersion":1,"kind":"click","targetId":"e1","value":null}' }]);
    for (const [table, removed] of [
      ['p_chatbot_bots', 'customer_user_id'],
      ['p_chatbot_actions', 'snapshot_id'],
      ['p_chatbot_actions', 'target_id'],
      ['p_chatbot_budget_days', 'in_flight'],
    ]) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      expect(columns.map((column) => column.name)).not.toContain(removed);
    }
  });
});
