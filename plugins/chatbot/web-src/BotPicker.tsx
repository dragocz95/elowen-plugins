import { runtime } from './runtime';
import type { ChatbotBotView } from './types';

/** WHICH CHATBOT a read-only section is about.
 *
 *  Conversations and statistics are per-chatbot reads — every admin route they call names the chatbot it
 *  must answer for — so a section of them has to say which one it is showing before it shows anything.
 *  This is that control, and it is a picker over the register rather than a typed id: the set of
 *  chatbots is known, small and already loaded. */
export function BotPicker({ bots, value, onChange, label, disabled }: {
  bots: ChatbotBotView[];
  value: number;
  onChange(chatbotUserId: number): void;
  label: string;
  disabled?: boolean;
}) {
  const { components: C, hooks } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  return (
    <C.SelectMenu
      label={label}
      variant="line"
      disabled={disabled}
      value={String(value)}
      onChange={(next: string) => onChange(Number(next))}
      options={bots.map((bot) => ({ value: String(bot.chatbotUserId), label: bot.displayName || s.botFallback }))}
    />
  );
}
