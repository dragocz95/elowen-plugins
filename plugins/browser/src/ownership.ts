import type { PluginApiAuth, PluginContext } from 'elowen/plugin-api';

export class BrowserAccessError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
    this.name = 'BrowserAccessError';
  }
}

export interface BrowserToolOwner {
  userId: number;
  conversationId: string;
}

export function requireBrowserToolOwner(ctx: Pick<PluginContext, 'currentIdentity' | 'currentSessionId' | 'currentContributionUserId'>): BrowserToolOwner {
  const identity = ctx.currentIdentity();
  if (!identity || !Number.isSafeInteger(identity.elowenUserId)) {
    throw new BrowserAccessError('Browser tools require a linked Elowen account.');
  }
  if (identity.conversation === 'shared') {
    throw new BrowserAccessError('Browser tools are not available in shared rooms.');
  }
  if (identity.conversation === 'delegated' || ctx.currentContributionUserId() !== identity.elowenUserId) {
    throw new BrowserAccessError('Browser tools are not available to delegated child agents.');
  }
  if (identity.conversation !== 'own' && identity.conversation !== 'direct') {
    throw new BrowserAccessError('Browser tools require a private conversation.');
  }
  const conversationId = ctx.currentSessionId();
  if (!conversationId) throw new BrowserAccessError('Browser tools require an active conversation.');
  return { userId: identity.elowenUserId, conversationId };
}

export function requireApiUser(auth: PluginApiAuth): number {
  if (!Number.isSafeInteger(auth.userId)) throw new BrowserAccessError('An authenticated account is required.', 401);
  return auth.userId as number;
}
