// AskUserQuestion UI rendering: native Discord components for a parked question.

/** Marketplace installs each plugin folder alone; the parametric contract test keeps these local
 * state-projection helpers aligned without making an installed plugin reach outside its payload. */
export function parseQuestionReply(text, question) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  const options = question.options ?? [];
  const parts = value.split(',').map((part) => part.trim());
  if (parts.every((part) => /^\d+$/.test(part))) {
    const numbers = parts.map(Number);
    const inRange = numbers.every((number) => number >= 1 && number <= options.length);
    if (inRange && (question.multiSelect === true || numbers.length === 1)) {
      return { kind: 'picks', labels: [...new Set(numbers.map((number) => options[number - 1].label))] };
    }
  }
  if (question.custom !== false) return { kind: 'other', text: value };
  return null;
}

export function collectQuestionAnswers(questions, selected = {}, other = {}) {
  const answers = questions.map((question, index) => {
    const picks = Array.isArray(selected?.[index]) ? selected[index].filter((value) => typeof value === 'string' && value.trim()) : [];
    const custom = typeof other?.[index] === 'string' ? other[index].trim() : '';
    return { header: question.header, selected: picks, ...(custom ? { other: custom } : {}) };
  });
  return { answers, next: answers.findIndex((answer) => answer.selected.length === 0 && !answer.other) };
}

/** How much of an ask Discord can actually render. Both numbers are the platform's hard caps, not a
 *  preference: a message carries at most 5 action rows and the footer row takes one, and a string select
 *  carries at most 25 options. They are deliberately NOT aligned with the other platforms' numbers —
 *  a cross-platform limit would either break Discord's API or crop a card that had room to spare. What
 *  IS uniform is that a cut is never silent: see `askTruncationNote`. */
export const ASK_MAX_QUESTIONS = 4;
export const ASK_MAX_SELECT_OPTIONS = 25;

/** The line telling the reader that the ask did not fit, or '' when all of it did.
 *
 *  The embed describes every question the agent asked, but only the first `ASK_MAX_QUESTIONS` get
 *  components — so without this note a question is printed with no way on earth to answer it, and the
 *  turn parks until the core's timeout with the user certain they already replied. An ugly question is
 *  recoverable; an invisible one is not. */
export function askTruncationNote(questions, { cs = false } = {}) {
  const list = Array.isArray(questions) ? questions : [];
  const notes = [];
  if (list.length > ASK_MAX_QUESTIONS) {
    notes.push(cs
      ? `Zobrazeny první ${ASK_MAX_QUESTIONS} z ${list.length} otázek — Discord jich v jedné zprávě více nezobrazí.`
      : `Showing the first ${ASK_MAX_QUESTIONS} of ${list.length} questions — Discord cannot show more in one message.`);
  }
  for (const q of list.slice(0, ASK_MAX_QUESTIONS)) {
    const total = q?.options?.length ?? 0;
    if (askUsesButtons(q) || total <= ASK_MAX_SELECT_OPTIONS) continue;
    notes.push(cs
      ? `„${q.header}“: zobrazeno prvních ${ASK_MAX_SELECT_OPTIONS} z ${total} možností.`
      : `"${q.header}": showing the first ${ASK_MAX_SELECT_OPTIONS} of ${total} options.`);
  }
  return notes.join('\n');
}

/** True when a question renders as a button row: single-select with few options — a click IS the pick.
 *  MultiSelect or >5 options need a string select (Discord caps 5 buttons per action row). */
function askUsesButtons(q) {
  const n = q.options?.length ?? 0;
  return q.multiSelect !== true && n >= 1 && n <= 5;
}

/** Build the component rows for a parked AskUserQuestion message. Pure — exported for tests.
 *  Per question: a row of ≤5 buttons (single-select, `ask:<id>:<qi>:<oi>`; picked = green) or one
 *  string select (`ask:<id>:<qi>`, multi-capable, ≤25 options). Footer row: Submit — skipped for a
 *  single button-question where a click answers instantly — plus a free-text "Other" button for the
 *  first unanswered question that permits custom input. */
export function buildAskComponents(id, questions, { cs = false, selected = {}, other = {} } = {}) {
  const qs = questions.slice(0, ASK_MAX_QUESTIONS);
  const rows = qs.map((q, qi) => {
    if (askUsesButtons(q)) {
      return {
        type: 1,
        components: q.options.slice(0, 5).map((op, oi) => ({
          type: 2,
          style: (selected[qi] ?? []).includes(op.label) ? 3 : 2, // green when picked, grey otherwise
          custom_id: `ask:${id}:${qi}:${oi}`,
          label: String(op.label).slice(0, 80),
        })),
      };
    }
    return {
      type: 1,
      components: [{
        type: 3,
        custom_id: `ask:${id}:${qi}`,
        placeholder: (q.multiSelect ? (cs ? `${q.header} — vyber jednu či víc` : `${q.header} — pick one or more`) : q.header).slice(0, 150),
        min_values: q.multiSelect ? 0 : 1,
        max_values: q.multiSelect ? Math.min(q.options.length, 25) : 1,
        options: q.options.slice(0, ASK_MAX_SELECT_OPTIONS).map((op, oi) => ({
          label: String(op.label).slice(0, 100),
          value: String(oi),
          description: op.description ? String(op.description).slice(0, 100) : undefined,
        })),
      }],
    };
  });
  const instant = qs.length === 1 && askUsesButtons(qs[0]); // a button click answers by itself
  const footer = [];
  if (!instant) footer.push({ type: 2, style: 3, custom_id: `ask:${id}:submit`, label: cs ? 'Odeslat' : 'Submit' });
  const { next } = collectQuestionAnswers(qs, selected, other);
  if (next >= 0 && qs[next]?.custom !== false) {
    footer.push({ type: 2, style: 2, custom_id: qs.length === 1 ? `ask:${id}:other` : `ask:${id}:other:${next}`, label: cs ? '✏️ Jiné' : '✏️ Other' });
  }
  if (footer.length) rows.push({ type: 1, components: footer });
  return rows;
}
