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
    `<button type="button" class="cb-quick-item" data-cb-text="${escapeHtml(reply ?? label)}"${disabled}>${escapeHtml(label)}</button>`).join('');
  const link = (label: string, url: string): string => allowedOfferUrl(url, origins)
    ? `<button type="button" class="cb-quick-item" data-cb-url="${escapeHtml(url)}"${disabled}>${escapeHtml(label)}</button>`
    : '';
  const links = (offer.links ?? []).map(({ label, url }) => link(label, url)).join('');
  const cards = (offer.cards ?? []).map((card) => {
    const action = card.action
      ? 'reply' in card.action
        ? `<button type="button" class="cb-quick-item" data-cb-text="${escapeHtml(card.action.reply)}"${disabled}>${escapeHtml(card.action.label)}</button>`
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

type ButtonLook = { default: Record<string, string>; hover: Record<string, string>; click: Record<string, string> };

function declarations(style: Record<string, string>): string {
  return Object.entries(style).map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value};`).join(' ');
}

/** `quickButton` is the greeting's quick-button look, so an offer inside an answer matches it exactly. */
export function offerStyles(quickButton: ButtonLook): string {
  return `
.cb-offer { display:grid; gap:8px; box-sizing:border-box; margin-top:10px; }
.cb-offer-actions { display:flex; flex-wrap:wrap; gap:6px; justify-content:center; }
.cb-offer .cb-quick-item, .cb-shared-file-chip { ${declarations(quickButton.default)} box-sizing:border-box; max-width:100%; }
.cb-offer .cb-quick-item:hover, .cb-shared-file-chip:hover { ${declarations(quickButton.hover)} }
.cb-offer .cb-quick-item:active, .cb-shared-file-chip:active { ${declarations(quickButton.click)} }
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
