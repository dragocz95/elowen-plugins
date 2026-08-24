// @vitest-environment node
/** A parked question that does not fit must SAY so, on every platform that can crop one.
 *
 *  Both adapters used to drop silently: Discord rendered components for the first four questions while
 *  its embed still described all of them, and Teams rendered twelve choice buttons and never mentioned
 *  the thirteenth. In both cases the reader is shown something they cannot act on — the turn then parks
 *  until the core's timeout while the person is certain they already answered. An ugly question is
 *  recoverable; an invisible one is not.
 *
 *  The limits themselves stay per-platform ON PURPOSE and this file does not try to unify them: Discord's
 *  are hard API caps (5 action rows per message, one spent on the footer; 25 options per string select),
 *  while Teams' is a payload/readability budget on a card format with no such cap. A single shared number
 *  would either break Discord's API or crop a card that had room to spare. What is uniform — and what is
 *  pinned here — is that a cut is always stated.
 */
import { describe, it, expect } from 'vitest';
import { buildAskCard, ASK_MAX_CHOICES } from '../plugins/msteams/lib/cards.mjs';
import { askTruncationNote, buildAskComponents, ASK_MAX_QUESTIONS, ASK_MAX_SELECT_OPTIONS } from '../plugins/discord/lib/ask.mjs';

const question = (header: string, options: number) => ({
  header,
  question: `pick for ${header}`,
  multiSelect: true, // forces Discord's string-select branch, where the option cap applies
  options: Array.from({ length: options }, (_, i) => ({ label: `option ${i + 1}` })),
});

/** Every TextBlock text in a Teams card body, flattened. */
const cardTexts = (card: { content: { body: Array<{ type: string; text?: string }> } }) =>
  card.content.body.filter((b) => b.type === 'TextBlock').map((b) => b.text ?? '');

describe('discord ask truncation is visible', () => {
  it('says nothing when the whole ask fits', () => {
    const qs = Array.from({ length: ASK_MAX_QUESTIONS }, (_, i) => question(`q${i}`, 3));
    expect(askTruncationNote(qs)).toBe('');
    expect(askTruncationNote([])).toBe('');
  });

  it('names how many questions were dropped', () => {
    const qs = Array.from({ length: ASK_MAX_QUESTIONS + 2 }, (_, i) => question(`q${i}`, 3));
    // Only the first ASK_MAX_QUESTIONS get components — without the note the rest are undismissable text.
    expect(buildAskComponents('id', qs).filter((row) => row.components?.[0]?.custom_id?.startsWith('ask:id:'))).toHaveLength(ASK_MAX_QUESTIONS + 1);
    const note = askTruncationNote(qs);
    expect(note).toContain(String(ASK_MAX_QUESTIONS));
    expect(note).toContain(String(ASK_MAX_QUESTIONS + 2));
    expect(askTruncationNote(qs, { cs: true })).toContain('otázek');
  });

  it('names how many options were dropped from a select', () => {
    const qs = [question('big', ASK_MAX_SELECT_OPTIONS + 7)];
    const note = askTruncationNote(qs);
    expect(note).toContain('big');
    expect(note).toContain(String(ASK_MAX_SELECT_OPTIONS));
    expect(note).toContain(String(ASK_MAX_SELECT_OPTIONS + 7));
  });

  it('stays quiet about a button question, which is never cropped', () => {
    // askUsesButtons only accepts 1-5 options, so its slice can never drop one.
    expect(askTruncationNote([{ header: 'small', question: 'q', options: [{ label: 'a' }, { label: 'b' }] }])).toBe('');
  });
});

describe('msteams ask truncation is visible', () => {
  it('says nothing when every choice fits', () => {
    const card = buildAskCard('t', [question('q', ASK_MAX_CHOICES)]) as never;
    expect(cardTexts(card).some((t) => t.includes('options'))).toBe(false);
  });

  it('names how many choices were dropped', () => {
    const total = ASK_MAX_CHOICES + 5;
    const card = buildAskCard('t', [question('q', total)]) as never;
    const actionSets = (card as { content: { body: Array<{ type: string; actions?: unknown[] }> } }).content.body
      .filter((b) => b.type === 'ActionSet');
    expect(actionSets[0]?.actions).toHaveLength(ASK_MAX_CHOICES);
    const note = cardTexts(card).find((t) => t.includes(String(total)));
    expect(note).toBeDefined();
    expect(note).toContain(String(ASK_MAX_CHOICES));
  });

  it('says it in Czech when the plugin runs in Czech', () => {
    const card = buildAskCard('t', [question('q', ASK_MAX_CHOICES + 1)], { cs: true }) as never;
    expect(cardTexts(card).some((t) => t.includes('možností'))).toBe(true);
  });
});
