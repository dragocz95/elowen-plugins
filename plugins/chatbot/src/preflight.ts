import type { ChatbotAccountView, ChatbotProjectView, ChatbotStores } from './coreSeams.js';

/** The single rule that decides whether a chatbot account may run a turn, applied on BOTH sides: before
 *  the public hook admits a visitor and before an administrator enables the chatbot. Two implementations
 *  would drift, and the one that drifted would be the one guarding the public endpoint. */

export interface AccountFacts {
  account: ChatbotAccountView | null;
  /** Active managed Projects the account can use, from the host's own tenancy decision. */
  projects: ChatbotProjectView[];
}

/** Why a chatbot cannot run right now. Every code is a fact an administrator can act on; none of them is
 *  a permission the plugin grants itself. */
export type ChatbotBlocker =
  | 'account_unknown'
  | 'account_not_chatbot'
  | 'account_admin'
  | 'no_project'
  | 'several_projects'
  | 'project_being_deleted';

export function inspectAccount(stores: ChatbotStores, chatbotUserId: number): { facts: AccountFacts; blockers: ChatbotBlocker[] } {
  const account = stores.usersRead.list().find((candidate) => candidate.id === chatbotUserId) ?? null;
  const blockers: ChatbotBlocker[] = [];
  if (!account) {
    return { facts: { account: null, projects: [] }, blockers: ['account_unknown'] };
  }
  // A missing kind means a daemon whose user contract does not carry one. Fail closed: "not known to be a
  // chatbot" is not "is a chatbot".
  if (account.type !== 'chatbot') blockers.push('account_not_chatbot');
  // An administrator account sees every Project, so "exactly one usable Project" would be a lie about
  // what the turn could reach; and it must never be reachable from an anonymous website.
  if (account.isAdmin) blockers.push('account_admin');

  const projects = stores.projects.list().filter((project) => stores.userProjects.canAccess(chatbotUserId, project.id));
  const usable = projects.filter((project) => project.executionKind === 'managed');
  const deleting = usable.filter((project) => project.lifecycle === 'deleting');
  if (deleting.length > 0) blockers.push('project_being_deleted');
  const active = usable.filter((project) => project.lifecycle !== 'deleting');
  // Core's own fallback would create or adopt a project for an unbound account, which is the one outcome
  // this rule exists to prevent: an anonymous website must never decide which container a turn lands in.
  if (active.length === 0) blockers.push('no_project');
  else if (active.length > 1) blockers.push('several_projects');

  return { facts: { account, projects: active }, blockers };
}

