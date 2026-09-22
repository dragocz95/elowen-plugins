import { apiJson, chatbotApi, jsonRequest } from './runtime';

/** HANDING AN ADMINISTRATOR TO THE CHATBOT'S OWN ACCOUNT — the host's existing switch, triggered here.
 *
 *  Some settings belong to the account rather than to the chatbot: its model, its grants, the personality
 *  its turns speak with. This page reports them and hands the reader over rather than keeping a second
 *  editor — and handing over an ACCOUNT means switching to it, exactly as the host's Users screen does.
 *
 *  The switch itself is the host's own route: core decides who may enter which account, and the browser
 *  only asks. What travels with it is the host's identity-transition protocol (`web/lib/token.ts`), which
 *  every account-scoped surface on the page listens for. It has two phases, and both are load-bearing:
 *  `start` makes every open tab tear its previous account's state down BEFORE the session cookie changes,
 *  and `commit`/`rollback` makes it load the identity the cookie now holds. Announcing the switch without
 *  them would leave a tab rendering the administrator's data under the chatbot's cookie, and announcing a
 *  `start` with no terminal phase would leave every sibling tab on the host's transition skeleton.
 *
 *  A plugin bundle imports nothing from the host application, so the protocol is spoken here with the same
 *  event name, the same two phases and the same storage ping. That is the ONE thing in this file the host
 *  owns and this bundle restates. */

export const AUTH_TRANSITION_EVENT = 'elowen:auth-transition';
const AUTH_TRANSITION_STORAGE_KEY = 'elowen:auth-transition';

export type AuthTransitionPhase = 'start' | 'commit' | 'rollback';

/** Tell this tab and every sibling tab where the identity is in the exchange. The local event reaches the
 *  page itself and the storage value exists only to make the browser emit a cross-tab `storage` event; it
 *  carries no identity and is removed immediately. */
function publishTransition(id: string, phase: AuthTransitionPhase): void {
  try {
    window.dispatchEvent(new CustomEvent(AUTH_TRANSITION_EVENT, { detail: { id, phase } }));
    localStorage.setItem(AUTH_TRANSITION_STORAGE_KEY, JSON.stringify({ id, phase, nonce: Math.random() }));
    localStorage.removeItem(AUTH_TRANSITION_STORAGE_KEY);
  } catch { /* no storage in this context: the tab that initiated the switch still transitions */ }
}

function transitionId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Enter `userId`'s own account, where its settings are the reader's to change.
 *
 *  Throws when the host refused the switch, having rolled the transition back first, so every tab keeps the
 *  account it had and the page can say the switch failed. On success the host owns what happens next. */
export async function switchToAccount(userId: number): Promise<void> {
  const id = transitionId();
  publishTransition(id, 'start');
  try {
    await apiJson(chatbotApi.impersonate(), jsonRequest('POST', { userId }));
  } catch (error) {
    publishTransition(id, 'rollback');
    throw error;
  }
  publishTransition(id, 'commit');
}
