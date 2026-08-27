import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { WINDOW_MS, openStore } from './store.mjs';

const REQUEST_TIMEOUT_MS = 30_000;

/** E.164: a plus, a non-zero country digit, then 7-14 more. The one guard that catches a mistyped
 *  number before it reaches a stranger's phone, and it costs nothing. */
const E164 = /^\+[1-9]\d{7,14}$/;

/** Long enough for a real briefing, short enough that a runaway context cannot be posted to a third
 *  party as spoken instructions. */
const MAX_PROMPT = 4000;

/** Response bodies are echoed back to the agent so a failure can be diagnosed; this is how much. */
const EXCERPT = 200;

const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });
const fail = (message) => ok(`Error: ${message}`);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** The configured token must never leave the daemon in a tool result, an error or a log line. The
 *  request body is under our control, but the RESPONSE is not — a service that echoes the credential
 *  back in an error would otherwise publish it into the transcript. */
export function redact(value, token) {
  if (!value || !token) return value ?? '';
  return String(value).split(token).join('***');
}

function minutesUntil(freeAt, now) {
  return Math.max(1, Math.ceil((freeAt - now) / 60_000));
}

export function registerVoiceCall(ctx, db) {
  const apiUrl = text(ctx.config.apiUrl).replace(/\/+$/, '');
  const apiToken = text(ctx.config.apiToken);
  if (!apiUrl || !apiToken) {
    ctx.logger.warn('enabled but the call endpoint or token is not configured — VoiceCall not registered');
    return;
  }

  const store = openStore(db);
  const rawLimit = Number(ctx.config.maxCallsPerHour);
  const maxCallsPerHour = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.floor(rawLimit) : 10;
  const defaultInitMessage = text(ctx.config.defaultInitMessage);

  ctx.registerTool(defineTool({
    name: 'VoiceCall',
    label: 'Place a phone call',
    description: [
      'Place a REAL outbound telephone call to a REAL person and hand the conversation to an automated',
      'voice agent, which speaks on your behalf and follows the prompt you supply. The person\'s phone',
      'rings within seconds. A call CANNOT be cancelled, recalled or undone once this tool returns, and',
      'the callee has no way of knowing it was a mistake other than by answering it.',
      'Only call a number the user has given you in this conversation, or one you have read from a record',
      'they pointed you at. If there is ANY doubt about whose number it is, or whether a call is what they',
      'wanted, ask them first and quote the number back to them before dialling. Never guess a number,',
      'never reconstruct one from memory, and never call the same person again just because the first',
      'attempt reported an error.',
      'The prompt is spoken instructions for the voice agent, not a message read aloud: describe what it',
      'should find out or convey, in the language the callee speaks, and say how it should behave.',
    ].join(' '),
    parameters: Type.Object({
      phone_number: Type.String({
        description: 'The number to dial, in full international E.164 form, e.g. +420721909701. No spaces or dashes.',
      }),
      prompt: Type.String({
        description: 'Instructions for the voice agent: what to accomplish on the call and how to behave. Written in the language the person being called speaks.',
      }),
      init_message: Type.Optional(Type.String({
        description: 'The opening sentence the person hears when they pick up. Omit to use the configured default.',
      })),
    }),
    execute: async (_id, params) => {
      const phone = text(params?.phone_number);
      if (!phone) return fail('phone_number is required.');
      if (!E164.test(phone)) {
        return fail(`"${phone}" is not a valid phone number. Use full international E.164 form: a leading +, the country code, then the national number, digits only (for example +420721909701).`);
      }

      const prompt = text(params?.prompt);
      if (!prompt) return fail('prompt is required: describe what the voice agent should accomplish on the call.');
      if (prompt.length > MAX_PROMPT) {
        return fail(`prompt is ${prompt.length} characters, which is longer than the ${MAX_PROMPT} allowed. Summarise what the voice agent needs to know.`);
      }

      const initMessage = text(params?.init_message) || defaultInitMessage;

      const now = Date.now();
      const windowStart = now - WINDOW_MS;
      const placed = store.countSince(windowStart);
      if (placed >= maxCallsPerHour) {
        const oldest = store.oldestSince(windowStart);
        const free = oldest ? ` The limit frees up in about ${minutesUntil(oldest + WINDOW_MS, now)} minute(s).` : '';
        return fail(`Call rate limit reached: ${placed} of ${maxCallsPerHour} calls allowed per hour have already been placed.${free} No call was made.`);
      }

      const body = { phone_number: phone, prompt };
      if (initMessage) body.init_message = initMessage;

      const rowId = store.record({
        now,
        phone,
        prompt,
        initMessage: initMessage || null,
        userId: ctx.currentIdentity?.()?.elowenUserId ?? null,
        sessionId: ctx.currentSessionId?.() ?? null,
      });

      let response;
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        // A timeout is NOT a failure: the request may well have reached the service and the phone may
        // already be ringing. Reporting it as failed is what would invite a redial.
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        store.settle(rowId, { status: timedOut ? 'unknown' : 'failed' });
        if (timedOut) {
          return ok(`UNKNOWN: the call service did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds. The call may or may not have been placed — do NOT retry automatically. Ask the user to check before dialling again. (call record #${rowId})`);
        }
        const reason = redact(error instanceof Error ? error.message : String(error), apiToken);
        return fail(`Could not reach the call service: ${reason}. No call was placed. (call record #${rowId})`);
      }

      const raw = redact(await response.text().catch(() => ''), apiToken);

      if (!response.ok) {
        store.settle(rowId, { status: 'failed', httpStatus: response.status, response: raw });
        const excerpt = raw ? ` Response: ${raw.slice(0, EXCERPT)}` : '';
        return fail(`The call service refused the request with HTTP ${response.status}.${excerpt} No call was placed. (call record #${rowId})`);
      }

      // remote_call_id stays null until the service's real response shape is known — the column is here
      // so identifying a call later costs no migration, not because a key has been guessed.
      store.settle(rowId, { status: 'accepted', httpStatus: response.status, response: raw });
      const detail = raw ? ` Service replied: ${raw.slice(0, EXCERPT)}` : '';
      return ok(`Call to ${phone} accepted by the voice service (HTTP ${response.status}).${detail} (call record #${rowId})`);
    },
  }));
}
