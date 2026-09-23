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
    return `<button type="button" class="cb-quick-item cb-feedback-thumb" data-cb-rating="${rating}"
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
.outer-message-container:has(.cb-feedback) .name { display:none; }
.cb-feedback { display:grid; gap:6px; }
.cb-feedback-votes { display:flex; gap:6px; }
.cb-feedback-thumb { min-width:44px; min-height:44px; justify-content:center; }
.cb-feedback-thumb svg { width:24px; height:24px; }
.cb-feedback-thumb[aria-pressed="true"] { border-color:var(--cb-feedback-accent) !important; color:var(--cb-feedback-ink) !important; background:var(--cb-feedback-accent) !important; }
.cb-feedback-thumb[aria-pressed="true"] svg { fill:color-mix(in srgb, currentColor 20%, transparent); }
.cb-feedback-comment { display:grid; gap:6px; width:min(240px,100%); }
.cb-feedback-comment textarea { box-sizing:border-box; width:100%; min-height:58px; resize:vertical; border:1px solid currentColor; border-radius:8px; padding:7px; font:inherit; color:inherit; background:transparent; }
.cb-feedback-comment > div { display:flex; flex-wrap:wrap; gap:6px; }
`;
}
