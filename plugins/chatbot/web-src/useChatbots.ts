import { apiJson, chatbotApi, runtime } from './runtime';
import type { ChatbotBotView, ChatbotsAnswer } from './types';

/** THE REGISTER, read once for all five sections.
 *
 *  Each section is mounted on its own by the host — they are five addresses inside one deck, not
 *  five separate registers — so a register loaded inside a section would be loaded
 *  five times over and each copy would answer differently the moment a chatbot is saved.
 *
 *  This reads it through the HOST's react-query client, which every section reaches through the same
 *  runtime. One key, one request, one answer; a section that saves a chatbot writes it into that answer
 *  and every other section is looking at the write. */

const CHATBOTS_KEY = ['plugin', 'chatbot', 'bots'] as const;

export interface ChatbotRegister {
  answer: ChatbotsAnswer | undefined;
  bots: ChatbotBotView[];
  requiredTools: string[];
  isLoading: boolean;
  /** The server's own message where there is one, and this plugin's sentence where there is not. */
  loadError: string | null;
  reload(): void;
  /** A saved chatbot replaces the row it came from; a newly created one JOINS the register. */
  upsert(bot: ChatbotBotView): void;
}

export function useChatbots(): ChatbotRegister {
  const { hooks, utils } = runtime();
  const s = hooks.usePluginStrings('chatbot');
  const client = hooks.useQueryClient();
  const query = hooks.useQuery<ChatbotsAnswer>({
    queryKey: CHATBOTS_KEY,
    refetchInterval: 30_000,
    queryFn: () => apiJson<ChatbotsAnswer>(chatbotApi.bots()),
  });

  return {
    answer: query.data,
    bots: query.data?.bots ?? [],
    requiredTools: query.data?.requiredTools ?? [],
    isLoading: query.isLoading,
    loadError: query.isError ? (utils.apiErrorMessage(query.error) || s.botsLoadError) : null,
    reload: () => { query.refetch(); },
    upsert: (updated) => {
      client.setQueryData<ChatbotsAnswer>(CHATBOTS_KEY, (current) => {
        if (current === undefined) return current;
        const known = current.bots.some((candidate) => candidate.chatbotUserId === updated.chatbotUserId);
        return {
          ...current,
          bots: known
            ? current.bots.map((candidate) => candidate.chatbotUserId === updated.chatbotUserId ? updated : candidate)
            : [...current.bots, updated],
        };
      });
    },
  };
}
