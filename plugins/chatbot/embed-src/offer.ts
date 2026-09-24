import { allowedOfferUrl, type Offer } from '../src/offerContract.js';
import type { WidgetStrings } from './strings.js';

/** Fixed markup only; every value supplied by the agent is escaped before deep-chat receives it. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]!));
}

export function offerHtml(offer: Offer, origins: readonly string[], strings: WidgetStrings, active = true): string {
  const disabled = active ? '' : ' disabled';
  const choice = (offer.choices ?? []).map(({ label, reply }) =>
    `<button type="button" class="cb-quick-item cb-offer-button" data-cb-text="${escapeHtml(reply ?? label)}"${disabled}>${escapeHtml(label)}</button>`).join('');
  const link = (label: string, url: string): string => allowedOfferUrl(url, origins)
    ? `<button type="button" class="cb-quick-item cb-offer-link" data-cb-url="${escapeHtml(url)}"${disabled}>${escapeHtml(label)}</button>`
    : '';
  const links = (offer.links ?? []).map(({ label, url }) => link(label, url)).join('');
  const cards = (offer.cards ?? []).map((card) => {
    const action = card.action
      ? 'reply' in card.action
        ? `<button type="button" class="cb-quick-item cb-offer-button" data-cb-text="${escapeHtml(card.action.reply)}"${disabled}>${escapeHtml(card.action.label)}</button>`
        : link(card.action.label, card.action.url)
      : '';
    return `<article class="cb-offer-card">${card.imageUrl && allowedOfferUrl(card.imageUrl, origins)
      ? `<img src="${escapeHtml(card.imageUrl)}" alt="" loading="lazy">` : ''}
      <div class="cb-offer-content"><strong>${escapeHtml(card.title)}</strong>
      ${card.subtitle ? `<span>${escapeHtml(card.subtitle)}</span>` : ''}
      ${card.price ? `<b>${escapeHtml(card.price)}</b>` : ''}
      ${card.meta ? `<small>${escapeHtml(card.meta)}</small>` : ''}
      ${action}</div></article>`;
  }).join('');
  return `<div class="cb-offer" role="group" aria-label="${escapeHtml(strings.offerOptions)}">
    ${choice || links ? `<div class="cb-offer-actions">${choice}${links}</div>` : ''}${cards}
  </div>`;
}

export function disableOffers(root: ShadowRoot | null): void {
  root?.querySelectorAll<HTMLButtonElement>('.cb-offer button:not(:disabled)').forEach((button) => { button.disabled = true; });
}

export function offerStyles(): string {
  return `
.outer-message-container:has(.cb-attachments) .inner-message-container { max-width:min(100%, 340px); }
.cb-offer { display:grid; gap:8px; width:min(100%, 340px); box-sizing:border-box; margin-top:12px; }
.cb-offer-actions { display:flex; flex-wrap:wrap; gap:6px; }
.cb-offer .cb-quick-item {
  display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; min-height:32px; max-width:100%;
  padding:5px 9px; border:1px solid var(--cb-attachment-border); border-radius:8px;
  color:var(--cb-attachment-ink); background:var(--cb-attachment-surface);
  font:inherit; font-size:12px; text-align:left; cursor:pointer;
}
.cb-offer .cb-quick-item:hover { background:var(--cb-attachment-hover); }
.cb-offer .cb-quick-item:focus-visible { outline:2px solid var(--cb-feedback-accent); outline-offset:2px; }
.cb-offer-card { display:flex; flex-direction:column; overflow:hidden; border:1px solid var(--cb-attachment-border); border-radius:10px; background:var(--cb-attachment-surface); }
.cb-offer-card img { display:block; width:100%; max-height:130px; object-fit:cover; }
.cb-offer-content { display:flex; flex-direction:column; gap:4px; padding:10px; min-width:0; overflow-wrap:anywhere; }
.cb-offer-content strong { font-size:14px; }
.cb-offer-content span, .cb-offer-content small { font-size:12px; }
.cb-offer-content b { font-size:13px; }
.cb-offer-content button { align-self:flex-start; }
.cb-offer button:disabled { opacity:.48; cursor:default; pointer-events:none; }
`;
}
