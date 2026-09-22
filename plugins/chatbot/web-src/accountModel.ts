import { apiJson, chatbotApi, runtime } from './runtime';

/** WHICH MODEL ANSWERS THIS CHATBOT'S VISITORS — read from core, never stored here.
 *
 *  A chatbot runs AS an Elowen account, and the model belongs to that account: core keeps the account's
 *  own model in `users.default_exec`, bounded by `users.allowed_execs`, and an account that has none of
 *  its own answers on the instance default.
 *
 *  Core publishes none of that to a plugin. `ctx.host.stores().usersRead` carries the account's identity
 *  and its exec whitelist, and this plugin's own admin routes read the account only through that seam —
 *  so the value is READ LIVE from the host's own account directory here, exactly as the creation dialog
 *  already reads the account's grants from `/users`. A copy kept on the plugin's row, or a model column
 *  of its own, would be a second answer to a question core owns, and it would go stale the moment an
 *  administrator changed the model in the account.
 *
 *  Nothing here writes. The model of an account is set in that account's own settings, which is where the
 *  row's action sends the administrator. */

/** One account as core's own directory answers it (`GET /users`, admin-only), narrowed to the field this
 *  page reads. The directory is the host's: what an account IS belongs to core, and this page reports it. */
interface DirectoryAccount {
  id: number;
  default_exec?: unknown;
}

/** What the account itself says about its model.
 *
 *  `unknown` is a state of its own rather than a softer `inherited`: a directory read that has not landed,
 *  one that no longer lists the account, or one whose row carries no model field this bundle can read, says
 *  NOTHING about what the chatbot answers on — and reporting it as "inherits the instance default" would be
 *  a confident claim about a fact nobody read. */
export type AccountModel =
  | { kind: 'unknown' }
  | { kind: 'own'; model: string }
  | { kind: 'inherited' };

/** One account's own model, from core's directory. An empty value is core's own statement that the
 *  instance default is inherited, which is a stored fact and not a missing read — while a row that carries
 *  no readable value at all leaves the question open rather than answering it with a default. */
export function accountModelOf(accounts: readonly DirectoryAccount[] | undefined, chatbotUserId: number): AccountModel {
  const own = accounts?.find((candidate) => candidate.id === chatbotUserId)?.default_exec;
  if (typeof own !== 'string') return { kind: 'unknown' };
  const model = own.trim();
  return model === '' ? { kind: 'inherited' } : { kind: 'own', model };
}

/** The instance default model, from the host's own configuration — the value an account with no model of
 *  its own answers on. Null when the instance configures none, which is not the same as an exec of "". */
export function instanceDefaultOf(config: { defaults?: { exec?: unknown } } | undefined): string | null {
  const exec = config?.defaults?.exec;
  return typeof exec === 'string' && exec.trim() !== '' ? exec.trim() : null;
}

/** The HOST's own query key for its account directory, and deliberately not a second key of this
 *  plugin's: the row and the host's Users screen then read one answer, and a write on either side
 *  invalidates the one entry instead of leaving a stale copy behind. */
const ACCOUNT_DIRECTORY_KEY = ['users'] as const;

export interface AccountModelFact {
  model: AccountModel;
  /** The instance default, named only when it is what the account answers on — an account with a model of
   *  its own inherits nothing, so the instance default is not part of what this row states. */
  instanceDefault: string | null;
}

/** The row's two facts, both live: whose model it is (the account's own, or the instance default), and —
 *  when it is the latter — which model that is. */
export function useAccountModel(chatbotUserId: number): AccountModelFact {
  const { hooks } = runtime();
  const directory = hooks.useQuery<DirectoryAccount[]>({
    queryKey: ACCOUNT_DIRECTORY_KEY,
    queryFn: () => apiJson<DirectoryAccount[]>(chatbotApi.accountDirectory()),
  });
  const config = hooks.useConfig();
  const model = accountModelOf(directory.data, chatbotUserId);
  return { model, instanceDefault: model.kind === 'inherited' ? instanceDefaultOf(config.data) : null };
}
