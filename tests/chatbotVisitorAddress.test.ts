// @vitest-environment node
/** Migration 9: the visitor's last address lives on the conversation row. Rows written before it carry no
 *  address at all, and the step must not invent one for them. */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PluginDb, PluginDbMigrationStep } from 'elowen/plugin-api';
import { migrate } from '../plugins/chatbot/src/db.js';
import { pluginDbFor } from './helpers/pluginDb.js';

describe('migration 9 adds the visitor address to the conversation', () => {
  it('leaves every existing conversation without an address', () => {
    const db = pluginDbFor(`chatbot-visitor-address-${randomUUID()}`)('chatbot');
    migrate({ ...db, migrate: (steps: PluginDbMigrationStep[]) => db.migrate(steps.filter((step) => step.version < 9)) } as PluginDb);
    db.prepare(`INSERT INTO p_chatbot_conversations (id, chatbot_user_id, visitor_id, session_id, created_at, last_activity_at, delete_after)
                VALUES ('c1', 12, ?, NULL, '2026-09-20T08:00:00.000Z', '2026-09-20T08:00:00.000Z', '2026-10-20T08:00:00.000Z')`)
      .run('a'.repeat(32));

    migrate(db);

    expect(db.appliedVersion()).toBe(13);
    expect(db.prepare('SELECT visitor_id, last_ip FROM p_chatbot_conversations').all())
      .toEqual([{ visitor_id: 'a'.repeat(32), last_ip: null }]);
  });
});
