// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';
import {
  CHATBOT_SITE as SITE,
  CLIENT_TURN_ID,
  createChatbotHost,
  issueToken,
  postRequest,
  publicRequest,
  registerBot,
  settledTurn,
  type ChatbotHost,
  type TurnInput,
} from './helpers/chatbotHost.js';

/** The seam this suite is about: the answer of a multi-step turn is assembled from the text of EVERY step,
 *  and the relay delivers each step's text as its own run of deltas. The whitespace BETWEEN two assistant
 *  messages belongs to neither of them, so two runs that met on a non-space character on both sides reached
 *  the visitor glued together — the live "…balayage.Otevřel jsem stránku s rezervací.". What is checked here
 *  is that JOIN in both directions: pieces that would collide get exactly one separator, and a seam the model
 *  spaced itself — or a seam INSIDE one step's own deltas — is left exactly as the model wrote it. */

/** The steps of the live multi-step turn the owner read. `SECOND_STEP` is deliberately emitted in two deltas
 *  that meet in the middle of a URL: those are one step's own chunks, not a seam, and no separator may land
 *  between them. `THIRD_STEP` is what core returns as the turn's reply — the LAST assistant message only. */
const FIRST_STEP = 'Jasně, stránku otevřu a nabídku shrnu do tří bodů. Rezervaci vytvářet nebudu 😊';
const SECOND_STEP = 'V tomhle sdíleném chatu není dostupný ovládaný prohlížeč, takže ceník načtu bezpečně jako veřejnou stránku https://www.sarah-hair.cz/cenik a ověřím jeho obsah.';
const THIRD_STEP = 'Nabídka Sarah Hair ve třech bodech ✨\n\n- ✂️ **Střihy a úpravy:** střih s foukanou od 900 Kč.';

/** A turn the way the live relay runs one: every step writes its own reasoning and then its own text as a
 *  run of deltas, and the tool call that ends a step (every step but the last) sits BETWEEN two runs. */
function multiStepTurn(steps: string[][], reply: string): (input: TurnInput) => Promise<string | undefined> {
  return async ({ observer }) => {
    observer?.onEvent({ type: 'session', sessionId: 'brain-ch-chatbot-session' });
    steps.forEach((chunks, index) => {
      observer?.onEvent({ type: 'reasoning', delta: `Krok ${index + 1}: rozmyslím si odpověď.` });
      for (const chunk of chunks) observer?.onEvent({ type: 'text', delta: chunk });
      if (index === steps.length - 1) return;
      observer?.onEvent({ type: 'tool_authoring', name: 'exec' });
      observer?.onEvent({ type: 'tool', name: 'exec' });
      observer?.onEvent({ type: 'tool_end' });
    });
    return reply;
  };
}

async function submitTurn(host: ChatbotHost, token: string, clientTurnId = CLIENT_TURN_ID): Promise<string> {
  const answer = await host.handler(postRequest({
    path: 'turns',
    headers: { origin: SITE, authorization: `ChatbotVisitor ${token}` },
    body: { schemaVersion: 2, clientTurnId, message: 'ahoj' },
  }));
  expect(answer.status).toBe(202);
  return (answer.body as Record<string, string>).turnId!;
}

/** The terminal frame's text: what a widget overwrites its streamed answer with. */
function terminalText(host: ChatbotHost, turnId: string): string {
  const done = host.store.events(turnId).find((event) => event.type === 'done');
  return (JSON.parse(done!.data) as { text: string }).text;
}

/** Every public text delta, concatenated the way a widget that only ever appends would render them. */
function deltaText(host: ChatbotHost, turnId: string): string {
  return host.store.events(turnId)
    .filter((event) => event.type === 'text_delta')
    .map((event) => (JSON.parse(event.data) as { text: string }).text)
    .join('');
}

/** The answer the visitor's own conversation reports to a page that reloaded. */
async function conversationReply(host: ChatbotHost, token: string): Promise<string> {
  const answer = await host.handler(publicRequest({
    method: 'GET',
    path: 'conversation',
    headers: { origin: SITE, authorization: `ChatbotVisitor ${token}` },
  }));
  return (answer.body as { turns: { reply: string }[] }).turns[0]!.reply;
}

let host: ChatbotHost;
let token: string;

beforeEach(async () => {
  host = createChatbotHost();
  registerBot(host);
  await host.adapter.connect();
  const issued = await issueToken(host);
  expect(issued.status).toBe(200);
  token = issued.body.token as string;
});

describe('assembling one answer from several steps', () => {
  it('separates two steps that would otherwise collide, and leaves one step\u2019s own deltas alone', async () => {
    host.handleTurn = multiStepTurn(
      [
        [FIRST_STEP],
        ['V tomhle sdíleném chatu není dostupný ovládaný prohlížeč, takže ceník načtu bezpečně jako veřejnou stránku https://www.sarah', '-hair.cz/cenik a ověřím jeho obsah.'],
        [THIRD_STEP],
      ],
      THIRD_STEP,
    );
    const turnId = await submitTurn(host, token);
    expect(await settledTurn(host, turnId)).toBe('done');

    const answer = terminalText(host, turnId);
    // Exactly one separator at each seam, and none of the model's own characters touched.
    expect(answer).toBe(`${FIRST_STEP} ${SECOND_STEP} ${THIRD_STEP}`);
    expect(answer).toContain('😊 V tomhle');
    expect(answer).not.toContain('😊V');
    expect(answer).toContain('obsah. Nabídka');
    // The two deltas of the second step meet inside a URL: that is one step's own chunking, not a seam.
    expect(answer).toContain('https://www.sarah-hair.cz/cenik');
    // A widget renders the deltas and then overwrites with the terminal frame: the two must agree, and the
    // conversation a reloading page rebuilds must be the same answer again.
    expect(deltaText(host, turnId)).toBe(answer);
    expect(await conversationReply(host, token)).toBe(answer);
  });

  it('changes nothing at a seam the model already spaced itself', async () => {
    host.handleTurn = multiStepTurn(
      [['Zjistím otevírací dobu…\n\n'], ['**Otevírací doba**\n\n- Pondělí: 9–17']],
      '**Otevírací doba**\n\n- Pondělí: 9–17',
    );
    const turnId = await submitTurn(host, token);
    expect(await settledTurn(host, turnId)).toBe('done');

    const answer = terminalText(host, turnId);
    expect(answer).toBe('Zjistím otevírací dobu…\n\n**Otevírací doba**\n\n- Pondělí: 9–17');
    expect(deltaText(host, turnId)).toBe(answer);
  });

  it('adds nothing for a step that wrote no text, and nothing to a one-step answer', async () => {
    host.handleTurn = multiStepTurn([['Dobrý den.'], [], ['S čím pomohu?']], 'S čím pomohu?');
    const withSilentStep = await submitTurn(host, token);
    expect(await settledTurn(host, withSilentStep)).toBe('done');
    expect(terminalText(host, withSilentStep)).toBe('Dobrý den. S čím pomohu?');

    host.handleTurn = multiStepTurn([['Dobrý den, s čím pomohu?']], 'Dobrý den, s čím pomohu?');
    const single = await submitTurn(host, token, '7c9e1d20-5a44-4f13-9f60-2b8d5e6a1c77');
    expect(await settledTurn(host, single)).toBe('done');
    expect(terminalText(host, single)).toBe('Dobrý den, s čím pomohu?');
  });
});
