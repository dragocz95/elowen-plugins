// Adaptive Cards for the interactive surfaces: AskUserQuestion choice cards and the local pickers
// (/model, /reasoning, /display, /context). Action.Submit payloads arrive back as `message` activities
// whose `value` carries the compact data objects built here:
//   { ea: <token>, q, o }   ask option tap        { ea: <token>, s: 1 }  ask submit
//   { ea: <token>, ot: 1 }  ask "Other" (with the `other` Input.Text merged in)
//   { ep: <kind>, v }       picker choice          { ep: <kind>, p }      picker page turn
// Interactive cards stay on schema 1.4. The table renderer opts into 1.5, the first schema with Table,
// without changing approval, picker, or settled-card rendering. Teams measures the entire message as UTF-16
// against an approximate 100 KB limit and recommends staying under 80 KB, so tables cap rows and payload size.

const LABEL_MAX = 60;
const PICKER_PAGE_SIZE = 8;
/** How many choices one ask question renders. Adaptive Cards impose no such cap — this is the payload
 *  and readability budget, deliberately NOT aligned with Discord's numbers (whose caps are dictated by
 *  its API). What is uniform across the platforms is that a cut is stated in the card, never silent. */
export const ASK_MAX_CHOICES = 12;
const TABLE_SCHEMA_VERSION = '1.5';
const TABLE_MAX_COLUMNS = 3;
const TABLE_MAX_ROWS = 20;
const TABLE_CELL_MAX = 120;
const TABLE_PAYLOAD_MAX_UTF16_BYTES = 80 * 1024;

/** Marketplace installs each plugin folder alone; the parametric contract test keeps this local
 * state projection aligned with the other chat adapters without reaching outside the plugin payload. */
export function collectQuestionAnswers(questions, selected = {}, other = {}) {
  const answers = questions.map((question, index) => {
    const picks = Array.isArray(selected?.[index]) ? selected[index].filter((value) => typeof value === 'string' && value.trim()) : [];
    const custom = typeof other?.[index] === 'string' ? other[index].trim() : '';
    return { header: question.header, selected: picks, ...(custom ? { other: custom } : {}) };
  });
  return { answers, next: answers.findIndex((answer) => answer.selected.length === 0 && !answer.other) };
}

const clamp = (s, max = LABEL_MAX) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const card = (body, actions = [], version = '1.4') => ({
  contentType: 'application/vnd.microsoft.card.adaptive',
  content: {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version,
    body,
    ...(actions.length ? { actions } : {}),
  },
});

const tableCell = (text, header = false) => ({
  type: 'TableCell',
  items: [{ type: 'TextBlock', text, wrap: true, ...(header ? { weight: 'Bolder' } : {}) }],
  ...(header ? { style: 'emphasis' } : {}),
});

const fallbackRows = (columns, rows) => ({
  type: 'Container',
  items: rows.map((row, index) => ({
    type: 'Container',
    separator: index > 0,
    spacing: index ? 'Medium' : 'None',
    items: [{
      type: 'FactSet',
      facts: columns.map((column) => ({ title: `${column.label}:`, value: row[column.key] })),
    }],
  })),
});

const tableBody = (title, columns, rows, totalRows, { cs, narrow }) => {
  const fallback = fallbackRows(columns, rows);
  const body = [
    { type: 'TextBlock', text: title, wrap: true, weight: 'Bolder', size: 'Medium' },
    ...(narrow ? [fallback] : [{
      type: 'Table',
      columns: columns.map((column) => ({ width: column.width })),
      firstRowAsHeader: true,
      showGridLines: true,
      rows: [
        { type: 'TableRow', cells: columns.map((column) => tableCell(column.label, true)) },
        ...rows.map((row) => ({ type: 'TableRow', cells: columns.map((column) => tableCell(row[column.key])) })),
      ],
      fallback,
    }]),
  ];
  if (rows.length < totalRows) {
    body.push({
      type: 'TextBlock',
      text: cs ? `Zobrazeno prvních ${rows.length} z ${totalRows} řádků.` : `Showing the first ${rows.length} of ${totalRows} rows.`,
      wrap: true,
      isSubtle: true,
      spacing: 'Small',
    });
  }
  return body;
};

/** Render structured tabular command output. Teams recommends at most three columns on narrow cards; callers
 *  provide stable column keys instead of preformatted strings. `narrow` uses the same stacked FactSet layout
 *  that is attached as the native Table element's schema fallback. */
export function buildTableCard(title, columns, rows, { cs = false, narrow = false } = {}) {
  if (!Array.isArray(columns) || columns.length === 0 || columns.length > TABLE_MAX_COLUMNS) {
    throw new TypeError(`Teams tables require between 1 and ${TABLE_MAX_COLUMNS} columns.`);
  }
  const seen = new Set();
  const normalizedColumns = columns.map((column) => {
    const key = String(column?.key ?? '').trim();
    if (!key || seen.has(key)) throw new TypeError('Teams table column keys must be non-empty and unique.');
    seen.add(key);
    return {
      key,
      label: clamp(column?.label, 80),
      width: Number.isFinite(column?.width) && column.width > 0 ? column.width : 1,
    };
  });
  if (!Array.isArray(rows)) throw new TypeError('Teams table rows must be an array.');
  const normalizedRows = rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('Each Teams table row must be an object.');
    return Object.fromEntries(normalizedColumns.map((column) => [column.key, clamp(row[column.key], TABLE_CELL_MAX)]));
  });
  const safeTitle = clamp(title, 200);
  let visibleRows = normalizedRows.slice(0, TABLE_MAX_ROWS);
  let attachment = card(tableBody(safeTitle, normalizedColumns, visibleRows, normalizedRows.length, { cs, narrow }), [], TABLE_SCHEMA_VERSION);
  while (visibleRows.length && JSON.stringify(attachment).length * 2 > TABLE_PAYLOAD_MAX_UTF16_BYTES) {
    visibleRows = visibleRows.slice(0, -1);
    attachment = card(tableBody(safeTitle, normalizedColumns, visibleRows, normalizedRows.length, { cs, narrow }), [], TABLE_SCHEMA_VERSION);
  }
  if (JSON.stringify(attachment).length * 2 > TABLE_PAYLOAD_MAX_UTF16_BYTES) {
    throw new RangeError('Teams table card exceeds the safe 80 KB UTF-16 payload budget without any data rows.');
  }
  return attachment;
}

/** The AskUserQuestion choice card. Selected options carry a ✅ prefix; a single single-select question
 *  submits on tap (no Submit row), everything else toggles and submits explicitly. Every question that
 *  permits custom input gets a native Input.Text included in the same submitted card value. */
export function buildAskCard(token, questions, { cs = false, selected = [], other = [], missing = -1 } = {}) {
  const body = [];
  const actions = [];
  const single = questions.length === 1 && questions[0]?.multiSelect !== true;
  questions.forEach((q, qi) => {
    body.push({ type: 'TextBlock', text: `**${clamp(q.header ?? '', 80)}** — ${clamp(q.question ?? '', 400)}`, wrap: true });
    const picks = new Set(selected[qi] ?? []);
    const options = q.options ?? [];
    const buttons = options.slice(0, ASK_MAX_CHOICES).map((option, oi) => ({
      type: 'Action.Submit',
      title: `${picks.has(option.label) ? '✅ ' : ''}${clamp(option.label)}`,
      data: { ea: token, q: qi, o: oi },
    }));
    if (buttons.length) body.push({ type: 'ActionSet', actions: buttons });
    // A cut choice used to just vanish: the card rendered twelve buttons and the thirteenth option was
    // never mentioned anywhere, so the one person who needed it waited out the turn instead of
    // answering it. Same wording the table renderer uses for a cropped result — state the cut, never
    // imply it.
    if (options.length > ASK_MAX_CHOICES) {
      body.push({
        type: 'TextBlock',
        text: cs
          ? `Zobrazeno prvních ${ASK_MAX_CHOICES} z ${options.length} možností.`
          : `Showing the first ${ASK_MAX_CHOICES} of ${options.length} options.`,
        wrap: true,
        isSubtle: true,
        spacing: 'Small',
      });
    }
    if (q.custom !== false) {
      body.push({
        type: 'Input.Text',
        id: questions.length === 1 ? 'other' : `other${qi}`,
        value: other[qi] || undefined,
        placeholder: cs ? 'Vlastní odpověď…' : 'Your own answer…',
      });
    }
    if (missing === qi) {
      body.push({
        type: 'TextBlock',
        text: cs ? 'Tato odpověď je povinná.' : 'This answer is required.',
        color: 'Attention',
        wrap: true,
        spacing: 'Small',
      });
    }
  });
  if (!single) actions.push({ type: 'Action.Submit', title: cs ? 'Odeslat' : 'Submit', data: { ea: token, s: 1 } });
  if (questions.length === 1 && questions[0]?.custom !== false) {
    // Submits the free-text box above it, so it has to read as an ACTION. "Other" looked like one more
    // choice: people tapped it expecting another option, then waited for a send button that never came.
    // It also stays distinct from the plain Submit a multi-select question renders alongside it — two
    // buttons both reading "Odeslat" would be worse than the original wording.
    actions.push({ type: 'Action.Submit', title: cs ? '➤ Odeslat vlastní odpověď' : '➤ Send custom answer', data: { ea: token, ot: 1 } });
  }
  return card(body, actions);
}

/** A paged list picker (models, conversations, reasoning levels…). `options` is the FULL set; the page
 *  window renders one button per option (current pick marked ✅) plus prev/next when needed. */
export function buildPickerCard(kind, title, options, { cs = false, page = 0, current } = {}) {
  const pages = Math.max(1, Math.ceil(options.length / PICKER_PAGE_SIZE));
  const at = Math.min(Math.max(page, 0), pages - 1);
  const window = options.slice(at * PICKER_PAGE_SIZE, (at + 1) * PICKER_PAGE_SIZE);
  const body = [
    { type: 'TextBlock', text: clamp(title, 200), wrap: true },
    { type: 'ActionSet', actions: window.map((option) => ({
      type: 'Action.Submit',
      title: `${current !== undefined && option.value === current ? '✅ ' : ''}${clamp(option.label)}`,
      data: { ep: kind, v: option.value },
    })) },
  ];
  const actions = [];
  if (pages > 1) {
    if (at > 0) actions.push({ type: 'Action.Submit', title: cs ? '‹ Předchozí' : '‹ Prev', data: { ep: kind, p: at - 1 } });
    actions.push({ type: 'Action.Submit', title: `${at + 1}/${pages}`, data: { ep: kind, p: at } });
    if (at < pages - 1) actions.push({ type: 'Action.Submit', title: cs ? 'Další ›' : 'Next ›', data: { ep: kind, p: at + 1 } });
  }
  return card(body, actions);
}

/** A settled (answered/expired) card: a plain one-liner replacing the interactive body. */
export function settledCard(text) {
  return card([{ type: 'TextBlock', text: clamp(text, 400), wrap: true }]);
}
