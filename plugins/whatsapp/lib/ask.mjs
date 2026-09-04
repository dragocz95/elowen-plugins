// AskUserQuestion reply parsing (numbered text menus — see the buttons caveat in index.mjs).
/** Marketplace installs each plugin folder alone; the parametric contract test keeps these local
 * state-projection helpers aligned without making an installed plugin reach outside its payload. */
export function parseAskReply(text, question) {
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
