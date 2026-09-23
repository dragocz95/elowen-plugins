import { appearanceInk, appearanceRamp, appearanceShade, type ChatbotAppearance } from '../src/appearanceContract.js';

export function gradient(start: string, end: string | null): string {
  return end === null ? start : `linear-gradient(135deg, ${start}, ${end})`;
}

export function gradientInk(start: string, end: string | null): string {
  if (end === null) return appearanceInk(start);
  const mix = (a: number, b: number) => Math.round((a + b) / 2).toString(16).padStart(2, '0');
  return appearanceInk(`#${[1, 3, 5].map(i => mix(Number.parseInt(start.slice(i, i + 2), 16), Number.parseInt(end.slice(i, i + 2), 16))).join('')}`);
}

function rgba(hex: string, opacity: number): string {
  const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
  return `rgba(${channels.join(',')},${opacity / 100})`;
}

/** Shared by the visitor panel and its live administrator preview. */
export function effectsCss(appearance: ChatbotAppearance): string {
  const ramp = appearanceRamp(appearance);
  const { effects, colors } = appearance;
  return `
@supports (backdrop-filter: blur(1px)) {
  ${effects.glass ? `.panel { background: ${rgba(colors.panel, effects.glassOpacity)}; backdrop-filter: blur(${effects.glassBlur}px); }
  .header { background: ${appearance.colors.headerEnd === null ? rgba(ramp.header, effects.glassOpacity) : `linear-gradient(135deg, ${rgba(ramp.header, effects.glassOpacity)}, ${rgba(appearance.colors.headerEnd, effects.glassOpacity)})`}; backdrop-filter: blur(${effects.glassBlur}px); }
  .messages { background: transparent; }` : ''}
}
.launcher-ring { position: absolute; inset: -5px; pointer-events: none; border: 2px solid ${colors.launcher}; border-radius: 999px; animation: cb-ring 2.6s ease-out infinite; }
@keyframes cb-ring { 0% { transform: scale(.92); opacity: .8; } 85%, 100% { transform: scale(1.35); opacity: 0; } }
.launcher-nudge-bounce { animation: cb-bounce .7s ease-in-out; }
.launcher-nudge-wiggle { animation: cb-wiggle .65s ease-in-out; }
@keyframes cb-bounce { 50% { transform: translateY(-11px); } }
@keyframes cb-wiggle { 25%, 75% { transform: rotate(-9deg); } 50% { transform: rotate(9deg); } }
@media (prefers-reduced-motion: reduce) { .launcher-ring, .launcher-nudge-bounce, .launcher-nudge-wiggle { animation: none !important; } }
`;
}

/** Native deep-chat button state styles, not CSS overrides of its internals. */
export function buttonStyles(appearance: ChatbotAppearance): { hover: Record<string, string>; click: Record<string, string> } {
  const ramp = appearanceRamp(appearance);
  const intensity = appearance.effects.buttonIntensity / 100;
  const options: Record<ChatbotAppearance['effects']['buttonHover'], Record<string, string>> = {
    lift: { transform: `translateY(-${(3 * intensity).toFixed(2)}px)`, boxShadow: `0 ${Math.round(7 * intensity)}px ${Math.round(18 * intensity)}px rgb(0 0 0 / .22)` },
    fill: { background: appearanceShade(ramp.raised, ramp.foreground === '#ffffff' ? 'lighter' : 'darker', .08 + .18 * intensity) },
    shine: { filter: `brightness(${(1 + .35 * intensity).toFixed(2)})` },
    glow: { boxShadow: `0 0 ${Math.round(18 * intensity)}px ${Math.round(5 * intensity)}px ${appearance.colors.sendButton}` },
  };
  return { hover: options[appearance.effects.buttonHover], click: { transform: 'translateY(1px) scale(.98)' } };
}

export function chatEffectsCss(appearance: ChatbotAppearance): string {
  const { effects, colors } = appearance;
  return `
${effects.buttonHover === 'shine' ? `.cb-quick-item:hover, .cb-quick-item:focus-visible { animation: cb-shine .5s ease-out; }
@keyframes cb-shine { from { filter: brightness(1); } 50% { filter: brightness(${1 + .45 * effects.buttonIntensity / 100}); } to { filter: brightness(1); } }` : ''}
.cb-quick-item:focus-visible { outline: 2px solid ${colors.sendButton}; outline-offset: 2px; }
${effects.messageEntrance === 'none' ? '' : `@keyframes cb-message-in { from { opacity: 0; transform: translateY(${effects.messageEntrance === 'slide' ? '10px' : '0'}); } to { opacity: 1; transform: translateY(0); } }
.message-bubble { animation: cb-message-in .26s ease-out both; }`}
@media (max-width: 360px) { .name.start-item-position { display: none !important; } }
@media (prefers-reduced-motion: reduce) {
  .cb-quick-item:hover, .cb-quick-item:focus-visible, .message-bubble { animation: none !important; transform: none !important; filter: none !important; }
}
`;
}
