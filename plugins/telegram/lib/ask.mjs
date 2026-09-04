// AskUserQuestion UI rendering: native Telegram inline-keyboard buttons for a parked question.
// Buttons carry a compact callback payload `a:<token>:<qi>:<oi>` (plus `:submit` / `:other`) — the
// adapter maps the short token back to the real ask id, keeping every payload well under Telegram's
// 64-byte callback_data limit even for long brain ask ids.

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

/** True when a question is answered by a single button click: single-select (not multiSelect). A click
 *  on a single-question single-select ask answers instantly; multiSelect / multi-question asks need Submit. */
function askUsesButtons(q) {
  const n = q.options?.length ?? 0;
  return q.multiSelect !== true && n >= 1;
}

/** Build the inline-keyboard rows for a parked AskUserQuestion. Pure — exported for tests. Per question:
 *  a grid of option buttons (`a:<token>:<qi>:<oi>`; a picked option is prefixed ✅). Footer: Submit
 *  (skipped for a single single-select question where a click answers instantly) plus a free-text "Other"
 *  button for the first unanswered question that permits custom input. */
export function buildAskKeyboard(token, questions, { cs = false, selected = {}, other = {} } = {}) {
  const qs = questions.slice(0, 4);
  const rows = [];
  qs.forEach((q, qi) => {
    const picks = selected[qi] ?? [];
    let row = [];
    (q.options ?? []).slice(0, 20).forEach((op, oi) => {
      const on = picks.includes(op.label);
      row.push({ text: `${on ? '✅ ' : ''}${String(op.label).slice(0, 60)}`, callback_data: `a:${token}:${qi}:${oi}` });
      if (row.length === 2) { rows.push(row); row = []; } // two buttons per row keeps labels readable
    });
    if (row.length) rows.push(row);
  });
  const instant = qs.length === 1 && askUsesButtons(qs[0]); // a single-select button click answers by itself
  const footer = [];
  if (!instant) footer.push({ text: cs ? 'Odeslat' : 'Submit', callback_data: `a:${token}:submit` });
  const { next } = collectQuestionAnswers(qs, selected, other);
  if (next >= 0 && qs[next]?.custom !== false) {
    footer.push({ text: cs ? '✏️ Jiné' : '✏️ Other', callback_data: qs.length === 1 ? `a:${token}:other` : `a:${token}:other:${next}` });
  }
  if (footer.length) rows.push(footer);
  return rows;
}
