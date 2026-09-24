import { FEEDBACK_COMMENT_MAX_CHARS, FEEDBACK_RATINGS, type FeedbackRating, type FeedbackSelection } from '../src/publicContract.js';
import { escapeHtml } from './offer.js';
import { appearanceIconSvg } from '../src/appearanceContract.js';
import type { WidgetStrings } from './strings.js';

export function readFeedback(value: unknown): FeedbackSelection | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.rating !== 'string' || !(FEEDBACK_RATINGS as readonly string[]).includes(entry.rating)) return null;
  if (entry.comment !== null && (typeof entry.comment !== 'string' || entry.comment.length > FEEDBACK_COMMENT_MAX_CHARS)) return null;
  return { rating: entry.rating as FeedbackRating, comment: entry.comment };
}

export function feedbackHtml(input: {
  turnId: string; selection: FeedbackSelection | null; commentOpen: boolean; strings: WidgetStrings;
}): string {
  const { turnId, selection, commentOpen, strings } = input;
  const votes = (['up', 'down'] as const).map((rating) => {
    const label = rating === 'up' ? strings.feedbackUp : strings.feedbackDown;
    return `<button type="button" class="cb-feedback-thumb" data-cb-rating="${rating}"
      aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" aria-pressed="${selection?.rating === rating}">${appearanceIconSvg(rating === 'up' ? 'thumb-up' : 'thumb-down')}</button>`;
  }).join('');
  return `<div class="cb-feedback" data-cb-feedback-turn="${escapeHtml(turnId)}" role="group"
      aria-label="${escapeHtml(strings.feedbackGroup)}">
    <div class="cb-feedback-votes">${votes}</div>
    ${commentOpen ? `<div class="cb-feedback-comment">
      <textarea maxlength="${FEEDBACK_COMMENT_MAX_CHARS}" aria-label="${escapeHtml(strings.feedbackComment)}"
        placeholder="${escapeHtml(strings.feedbackComment)}">${escapeHtml(selection?.comment ?? '')}</textarea>
      <div><button type="button" class="cb-quick-item cb-feedback-send">${escapeHtml(strings.feedbackSend)}</button>
      <button type="button" class="cb-quick-item cb-feedback-skip">${escapeHtml(strings.feedbackSkip)}</button></div>
    </div>` : ''}
  </div>`;
}

export function feedbackStyles(): string {
  return `
.text-message:has(.cb-attachments) { position:relative; overflow:visible; }
.cb-attachments { box-sizing:border-box; width:100%; }
.cb-feedback-votes {
  position:absolute; bottom:-16px; right:-8px; z-index:1; display:flex; padding:1px; border:1px solid var(--cb-attachment-border);
  border-radius:999px; background:var(--cb-attachment-surface); box-shadow:0 2px 7px rgb(0 0 0 / .12);
  opacity:0; transition:opacity .15s ease;
}
.outer-message-container:hover .cb-feedback-votes,
.outer-message-container:focus-within .cb-feedback-votes,
.cb-feedback-votes:has([aria-pressed="true"]) { opacity:1; }
@media (hover:none) { .cb-feedback-votes { opacity:1; } }
.cb-feedback-thumb {
  box-sizing:border-box; display:flex; align-items:center; justify-content:center; width:32px; height:32px;
  padding:0; border:0; border-radius:999px; color:inherit; background:transparent; cursor:pointer;
}
.cb-feedback-thumb:hover, .cb-feedback-thumb:focus-visible { color:var(--cb-feedback-accent); background:var(--cb-attachment-hover); }
.cb-feedback-thumb:focus-visible { outline:2px solid var(--cb-feedback-accent); outline-offset:1px; }
.cb-feedback-thumb svg { width:14px; height:14px; }
.cb-feedback:not(.cb-feedback-editing) .cb-feedback-votes:has([aria-pressed="true"]) .cb-feedback-thumb[aria-pressed="false"] { display:none; }
.cb-feedback-thumb[aria-pressed="true"] { color:var(--cb-feedback-accent); background:var(--cb-attachment-hover); }
.cb-feedback-thumb[aria-pressed="true"] svg { fill:color-mix(in srgb, currentColor 18%, transparent); }
.cb-feedback-comment { display:flex; align-items:flex-end; gap:5px; width:min(340px,100%); margin-top:6px; }
.cb-feedback-comment textarea { box-sizing:border-box; flex:1 1 auto; min-width:0; height:34px; min-height:34px; resize:vertical; border:1px solid var(--cb-attachment-border); border-radius:8px; padding:6px; font:inherit; font-size:12px; color:inherit; background:var(--cb-attachment-surface); }
.cb-feedback-comment > div { display:flex; flex:0 0 auto; gap:4px; }
.cb-feedback-comment button { border:1px solid var(--cb-attachment-border); border-radius:7px; padding:7px 5px; font:inherit; font-size:11px; color:inherit; background:var(--cb-attachment-surface); cursor:pointer; }
.cb-feedback-comment button:hover { background:var(--cb-attachment-hover); }
.cb-feedback-comment button:focus-visible { outline:2px solid var(--cb-feedback-accent); }
@media (max-width:360px) {
  .cb-feedback-comment { flex-wrap:wrap; }
  .cb-feedback-comment textarea { flex-basis:100%; }
  .cb-feedback-comment > div { width:100%; justify-content:flex-end; }
}
@media (prefers-reduced-motion:reduce) { .cb-feedback-votes { transition:none; } }
`;
}
