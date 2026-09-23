/** Shared limits for the server tool and the untrusted public frame reader. */
export const OFFER_LIMITS = {
  choices: 6, links: 3, cards: 4, label: 40, reply: 200,
  title: 60, subtitle: 120, price: 24, meta: 40, url: 4096,
} as const;

export interface Offer {
  choices?: { label: string; reply?: string }[];
  links?: { label: string; url: string }[];
  cards?: {
    title: string; subtitle?: string; price?: string; meta?: string; imageUrl?: string;
    action?: { label: string; reply: string } | { label: string; url: string };
  }[];
}

/** Exact origin match, no credentials and no navigations through a non-HTTP scheme. */
export function allowedOfferUrl(value: string, origins: readonly string[]): boolean {
  if (value.length > OFFER_LIMITS.url) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && url.username === '' && url.password === ''
      && origins.includes(url.origin);
  } catch {
    return false;
  }
}

/** Read a public frame without trusting the server's JSON shape. A malformed part rejects the whole set. */
export function readOffer(value: unknown, origins: readonly string[]): Offer | null {
  if (!object(value, ['choices', 'links', 'cards'])) return null;
  const offer: Offer = {};
  for (const key of ['choices', 'links', 'cards'] as const) {
    const items = value[key];
    if (items === undefined) continue;
    if (!Array.isArray(items) || items.length > OFFER_LIMITS[key]) return null;
    if (key === 'choices') {
      const choices: NonNullable<Offer['choices']> = [];
      for (const item of items) {
        if (!object(item, ['label', 'reply']) || !short(item.label, OFFER_LIMITS.label)
          || (item.reply !== undefined && !short(item.reply, OFFER_LIMITS.reply))) return null;
        choices.push({ label: item.label, ...(item.reply === undefined ? {} : { reply: item.reply }) });
      }
      offer.choices = choices;
    } else if (key === 'links') {
      const links: NonNullable<Offer['links']> = [];
      for (const item of items) {
        if (!object(item, ['label', 'url']) || !short(item.label, OFFER_LIMITS.label)
          || typeof item.url !== 'string' || !allowedOfferUrl(item.url, origins)) return null;
        links.push({ label: item.label, url: item.url });
      }
      offer.links = links;
    } else {
      const cards: NonNullable<Offer['cards']> = [];
      for (const item of items) {
        if (!object(item, ['title', 'subtitle', 'price', 'meta', 'imageUrl', 'action'])
          || !short(item.title, OFFER_LIMITS.title)
          || !optional(item.subtitle, OFFER_LIMITS.subtitle)
          || !optional(item.price, OFFER_LIMITS.price)
          || !optional(item.meta, OFFER_LIMITS.meta)
          || (item.imageUrl !== undefined && (typeof item.imageUrl !== 'string' || !allowedOfferUrl(item.imageUrl, origins)))) return null;
        let action: NonNullable<NonNullable<Offer['cards']>[number]['action']> | undefined;
        if (item.action !== undefined) {
          if (!object(item.action, ['label', 'reply', 'url']) || !short(item.action.label, OFFER_LIMITS.label)
            || (typeof item.action.reply === 'string') === (typeof item.action.url === 'string')
            || (typeof item.action.reply === 'string'
              ? !short(item.action.reply, OFFER_LIMITS.reply)
              : !allowedOfferUrl(item.action.url as string, origins))) return null;
          action = typeof item.action.reply === 'string'
            ? { label: item.action.label, reply: item.action.reply }
            : { label: item.action.label, url: item.action.url as string };
        }
        cards.push({
          title: item.title,
          ...(typeof item.subtitle === 'string' ? { subtitle: item.subtitle } : {}),
          ...(typeof item.price === 'string' ? { price: item.price } : {}),
          ...(typeof item.meta === 'string' ? { meta: item.meta } : {}),
          ...(typeof item.imageUrl === 'string' ? { imageUrl: item.imageUrl } : {}),
          ...(action === undefined ? {} : { action }),
        });
      }
      offer.cards = cards;
    }
  }
  return Object.values(offer).some((items) => items?.length) ? offer : null;
}
function object(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key));
}
function short(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= max;
}
function optional(value: unknown, max: number): boolean {
  return value === undefined || short(value, max);
}
