/** Everything the widget says, in the languages a visitor of a Czech or Slovak office site may read.
 *
 *  The copy lives here rather than in the panel so that no module invents a sentence of its own, and it
 *  ships INSIDE the bundle rather than in the plugin's `i18n/` files: those are the administrator's
 *  translations, loaded by the host application, while this runs on a third party's website where the
 *  host app is not present and one extra request would be one request too many. */

const WIDGET_LOCALES = ['cs', 'sk', 'en'] as const;
export type WidgetLocale = (typeof WIDGET_LOCALES)[number];

export interface WidgetStrings {
  /** Accessible label of the button that opens the panel. */
  launcher: string;
  /** The panel's heading when the chatbot has no display name. */
  title: string;
  close: string;
  teaserClose: string;
  mute: string;
  unmute: string;
  stop: string;
  /** The empty input's hint. */
  placeholder: string;
  /** The greeting the panel opens with, when the chatbot is configured with none of its own. */
  intro: string;
  /** Accessible label of the group of quick buttons under the greeting. Their own text is the chatbot's. */
  quickButtons: string;
  offerOptions: string;
  feedbackGroup: string;
  feedbackUp: string;
  feedbackDown: string;
  feedbackComment: string;
  feedbackSend: string;
  feedbackSkip: string;
  feedbackError: string;
  /** Shown while the answer keeps failing to arrive. */
  reconnecting: string;
  /** A turn that failed on the server after the visitor submitted it. */
  errorTurn: string;
  errorUnavailable: string;
  errorTooLong: string;
  /** A question the visitor answers themselves before anything irreversible happens. */
  confirmTitle: string;
  confirmBody: string;
  confirmSubmit: string;
  confirmCancel: string;
  confirmDeclined: string;
  confirmUnavailable: string;
  /** One page action that could not be carried out, without naming what the page contains. */
  actionFailed: string;
  actionStale: string;
  navigating: string;
  navigationFailed: string;
}

/** Substitutions are spelled out rather than hidden in a template so a translation cannot silently drop a
 *  value the sentence needs. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

const CS: WidgetStrings = {
  launcher: 'Otevřít chat',
  title: 'Chat',
  close: 'Zavřít',
  teaserClose: 'Zavřít nabídku',
  mute: 'Vypnout zvuk',
  unmute: 'Zapnout zvuk',
  stop: 'Zastavit příjem odpovědi',
  placeholder: 'Napište zprávu',
  intro: 'Dobrý den. Pomohu vám s vyplněním formuláře na této stránce.',
  quickButtons: 'Rychlé dotazy',
  offerOptions: 'Nabídnuté možnosti',
  feedbackGroup: 'Hodnocení odpovědi',
  feedbackUp: 'Odpověď pomohla',
  feedbackDown: 'Odpověď nepomohla',
  feedbackComment: 'Doplňující komentář',
  feedbackSend: 'Odeslat',
  feedbackSkip: 'Přeskočit',
  feedbackError: 'Hodnocení se nepodařilo uložit. Zkuste to prosím znovu.',
  reconnecting: 'Spojení se přerušilo, zkouším se znovu připojit.',
  errorTurn: 'Odpověď se nepodařilo dokončit. Zkuste to prosím znovu.',
  errorUnavailable: 'Chatbot teď není dostupný. Zkuste to prosím později.',
  errorTooLong: 'Zpráva je příliš dlouhá. Zkraťte ji prosím.',
  confirmTitle: 'Odeslat formulář {form}?',
  confirmBody: 'Zkontrolujte prosím vyplněné údaje. Odeslání potvrzujete vy, chatbot ho neprovede sám.',
  confirmSubmit: 'Potvrdit odeslání',
  confirmCancel: 'Zpět',
  confirmDeclined: 'Odeslání bylo zrušeno.',
  confirmUnavailable: 'Potvrzení se nepodařilo odeslat, proto se formulář neodeslal. Zkuste to prosím znovu.',
  actionFailed: 'Akci na stránce se nepodařilo provést.',
  actionStale: 'Původní stránka již není aktuální. Akce na ní nebyla provedena.',
  navigating: 'Otevírám stránku. Konverzace bude pokračovat po načtení.',
  navigationFailed: 'Stránku nebo konverzaci se nepodařilo obnovit. Otevřete prosím původní stránku.',
};

const SK: WidgetStrings = {
  launcher: 'Otvoriť chat',
  title: 'Chat',
  close: 'Zavrieť',
  teaserClose: 'Zavrieť ponuku',
  mute: 'Vypnúť zvuk',
  unmute: 'Zapnúť zvuk',
  stop: 'Zastaviť príjem odpovede',
  placeholder: 'Napíšte správu',
  intro: 'Dobrý deň. Pomôžem vám s vyplnením formulára na tejto stránke.',
  quickButtons: 'Rýchle otázky',
  offerOptions: 'Ponúkané možnosti',
  feedbackGroup: 'Hodnotenie odpovede',
  feedbackUp: 'Odpoveď pomohla',
  feedbackDown: 'Odpoveď nepomohla',
  feedbackComment: 'Doplňujúci komentár',
  feedbackSend: 'Odoslať',
  feedbackSkip: 'Preskočiť',
  feedbackError: 'Hodnotenie sa nepodarilo uložiť. Skúste to prosím znova.',
  reconnecting: 'Spojenie sa prerušilo, skúšam sa znova pripojiť.',
  errorTurn: 'Odpoveď sa nepodarilo dokončiť. Skúste to prosím znova.',
  errorUnavailable: 'Chatbot teraz nie je dostupný. Skúste to prosím neskôr.',
  errorTooLong: 'Správa je príliš dlhá. Skráťte ju prosím.',
  confirmTitle: 'Odoslať formulár {form}?',
  confirmBody: 'Skontrolujte prosím vyplnené údaje. Odoslanie potvrdzujete vy, chatbot ho nevykoná sám.',
  confirmSubmit: 'Potvrdiť odoslanie',
  confirmCancel: 'Späť',
  confirmDeclined: 'Odoslanie bolo zrušené.',
  confirmUnavailable: 'Potvrdenie sa nepodarilo odoslať, preto sa formulár neodoslal. Skúste to prosím znova.',
  actionFailed: 'Akciu na stránke sa nepodarilo vykonať.',
  actionStale: 'Pôvodná stránka už nie je aktuálna. Akcia na nej nebola vykonaná.',
  navigating: 'Otváram stránku. Konverzácia bude pokračovať po načítaní.',
  navigationFailed: 'Stránku alebo konverzáciu sa nepodarilo obnoviť. Otvorte prosím pôvodnú stránku.',
};

const EN: WidgetStrings = {
  launcher: 'Open chat',
  title: 'Chat',
  close: 'Close',
  teaserClose: 'Close invitation',
  mute: 'Mute sound',
  unmute: 'Unmute sound',
  stop: 'Stop receiving the answer',
  placeholder: 'Write a message',
  intro: 'Hello. I can help you fill in the form on this page.',
  quickButtons: 'Quick questions',
  offerOptions: 'Suggested options',
  feedbackGroup: 'Rate this answer',
  feedbackUp: 'Helpful answer',
  feedbackDown: 'Unhelpful answer',
  feedbackComment: 'Optional comment',
  feedbackSend: 'Send',
  feedbackSkip: 'Skip',
  feedbackError: 'Your feedback could not be saved. Please try again.',
  reconnecting: 'The connection dropped. Reconnecting.',
  errorTurn: 'The answer could not be finished. Please try again.',
  errorUnavailable: 'The chatbot is not available right now. Please try again later.',
  errorTooLong: 'The message is too long. Please shorten it.',
  confirmTitle: 'Send form {form}?',
  confirmBody: 'Please check the details you filled in. You are the one sending it; the chatbot never submits on its own.',
  confirmSubmit: 'Confirm sending',
  confirmCancel: 'Back',
  confirmDeclined: 'Sending was cancelled.',
  confirmUnavailable: 'The confirmation could not be delivered, so the form was not sent. Please try again.',
  actionFailed: 'That action could not be performed on the page.',
  actionStale: 'The original page is no longer current. The action was not performed on it.',
  navigating: 'Opening the page. The conversation will continue after loading.',
  navigationFailed: 'The page or conversation could not be restored. Please open the original page.',
};

const BY_LOCALE: Record<WidgetLocale, WidgetStrings> = { cs: CS, sk: SK, en: EN };

/** The language the panel speaks. The page's own `lang` is the most specific statement available — a
 *  Czech site's English-language subsection says `lang="en"` — and the browser's preference is the
 *  fallback. Anything that is not Czech or Slovak is answered in English rather than in a language the
 *  visitor may not read. */
export function detectLocale(...candidates: (string | null | undefined)[]): WidgetLocale {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const base = candidate.trim().toLowerCase().split(/[-_]/)[0] ?? '';
    if ((WIDGET_LOCALES as readonly string[]).includes(base)) return base as WidgetLocale;
  }
  return 'en';
}

export function widgetStrings(locale: WidgetLocale): WidgetStrings {
  return BY_LOCALE[locale];
}
