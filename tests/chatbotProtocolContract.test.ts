// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { actionDecisionBody, actionResultBody, turnRequestBody } from '../plugins/chatbot/embed-src/protocol.js';
import { validateActionDecision, validateActionResult, validateTurnSubmission } from '../plugins/chatbot/src/validation.js';
import { ACTION_NONCE_MIN_CHARS, FEEDBACK_COMMENT_MAX_CHARS } from '../plugins/chatbot/src/publicContract.js';
import { createChatbotHost, registerBot, TURN_PAGE } from './helpers/chatbotHost.js';

describe('the widget and server share the public contract', () => {
  it('accepts the exact visitor, decision and result bodies the widget constructs', () => {
    expect(validateTurnSubmission(turnRequestBody(
      '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c34', 'Hello', TURN_PAGE,
    )).ok).toBe(true);
    expect(validateActionDecision(actionDecisionBody('confirm', 'a'.repeat(ACTION_NONCE_MIN_CHARS))).ok).toBe(true);
    expect(validateActionResult(actionResultBody('done')).ok).toBe(true);
  });

  it('keeps the feedback database bound aligned with the public limit', () => {
    const host = createChatbotHost();
    registerBot(host);
    const turn = host.store.createTurn({
      turnId: 'feedback-contract', chatbotUserId: 12, visitorId: 'visitor-contract',
      clientTurnId: '2f1a4c3e-9b7d-4f6a-8c2e-1d5b7a9f0c34', message: 'Hello',
      page: TURN_PAGE, now: '2026-09-24T00:00:00.000Z',
    });
    host.store.markTurnRunning(turn.turn_id, '2026-09-24T00:00:00.000Z');
    host.store.finishTurn({ turnId: turn.turn_id, status: 'done', coreSessionId: null, errorCode: null, now: '2026-09-24T00:00:00.000Z' });
    const save = (length: number) => host.store.saveFeedback({
      turnId: turn.turn_id, chatbotUserId: 12, visitorId: 'visitor-contract',
      rating: 'up', comment: 'a'.repeat(length), now: '2026-09-24T00:00:00.000Z',
    });
    expect(save(FEEDBACK_COMMENT_MAX_CHARS)?.comment).toHaveLength(FEEDBACK_COMMENT_MAX_CHARS);
    expect(() => save(FEEDBACK_COMMENT_MAX_CHARS + 1)).toThrow();
  });
});
