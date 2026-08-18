import botframeworkConnector from 'botframework-connector';
import userTokenClientModule from 'botframework-connector/lib/auth/userTokenClientImpl.js';

const { MicrosoftAppCredentials } = botframeworkConnector;
const { UserTokenClientImpl } = userTokenClientModule;

const GRAPH_ME = 'https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName,mail,accountEnabled,userType';
const PROVIDER = 'msteams';
const CHANNEL = 'msteams';

export class TeamsAccountError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TeamsAccountError';
    this.code = code;
  }
}

const normalized = (value) => String(value ?? '').trim().toLowerCase();

function claimsOf(token) {
  try {
    const payload = String(token).split('.')[1];
    if (!payload) throw new Error('missing payload');
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new TeamsAccountError('invalid_token', 'Microsoft returned an invalid access token.');
  }
}

function preferredUsername(profile) {
  const principal = String(profile.userPrincipalName || profile.mail || '').trim();
  return principal.includes('@') ? principal.slice(0, principal.indexOf('@')) : (principal || profile.displayName || profile.id);
}

/**
 * Delegated Microsoft authentication isolated from the Teams transport. Bot Framework Token Service owns
 * access and refresh tokens; this module holds a delegated token only for the duration of one request,
 * checks the immutable Entra object id against both the activity and Graph, then hands only identity data
 * to the core account seam.
 */
export class TeamsAccountLinking {
  constructor(cfg, externalUsers, logger, deps = {}) {
    this.cfg = cfg;
    this.externalUsers = externalUsers;
    this.log = logger;
    this.fetch = deps.fetch ?? globalThis.fetch;
    if (deps.tokenClient) {
      this.tokens = deps.tokenClient;
    } else {
      const credentials = new MicrosoftAppCredentials(cfg.appId, cfg.appPassword, cfg.tenantId);
      this.tokens = new UserTokenClientImpl(cfg.appId, credentials, deps.tokenServiceEndpoint ?? 'https://api.botframework.com');
    }
  }

  get enabled() { return this.cfg.accountLinking === true; }

  validateActivity(activity) {
    const tenantId = normalized(activity?.conversation?.tenantId || activity?.channelData?.tenant?.id);
    const configuredTenant = normalized(this.cfg.tenantId);
    if (!tenantId || tenantId !== configuredTenant) {
      throw new TeamsAccountError('wrong_tenant', 'This Microsoft account does not belong to the configured organisation.');
    }
    const teamsUserId = String(activity?.from?.id ?? '').trim();
    const objectId = normalized(activity?.from?.aadObjectId);
    if (!teamsUserId || !objectId) {
      throw new TeamsAccountError('missing_identity', 'Microsoft Teams did not provide a verifiable Entra identity.');
    }
    return { tenantId: configuredTenant, teamsUserId, objectId };
  }

  async tokenFor(activity, magicCode) {
    const { teamsUserId } = this.validateActivity(activity);
    const response = await this.tokens.getUserToken(
      teamsUserId,
      String(this.cfg.oauthConnectionName),
      CHANNEL,
      magicCode ? String(magicCode) : undefined,
    );
    return typeof response?.token === 'string' && response.token ? response.token : null;
  }

  async authenticate(activity, { magicCode } = {}) {
    const identity = this.validateActivity(activity);
    const token = await this.tokenFor(activity, magicCode);
    if (!token) return { status: 'sign_in_required' };

    const claims = claimsOf(token);
    if (normalized(claims.tid) !== identity.tenantId) {
      throw new TeamsAccountError('wrong_tenant', 'This Microsoft account does not belong to the configured organisation.');
    }
    if (!claims.oid || normalized(claims.oid) !== identity.objectId) {
      throw new TeamsAccountError('identity_mismatch', 'The signed-in Microsoft account does not match the Teams sender.');
    }

    let response;
    try {
      response = await this.fetch(GRAPH_ME, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new TeamsAccountError('graph_unavailable', 'Microsoft could not verify this account. Please try again.');
    }
    if (!response?.ok) {
      throw new TeamsAccountError('graph_rejected', 'Microsoft could not verify this account. Please sign in again.');
    }
    let profile;
    try {
      profile = await response.json();
    } catch {
      throw new TeamsAccountError('graph_rejected', 'Microsoft could not verify this account. Please sign in again.');
    }
    if (normalized(profile?.id) !== identity.objectId) {
      throw new TeamsAccountError('identity_mismatch', 'The signed-in Microsoft account does not match the Teams sender.');
    }
    if (String(profile?.userType ?? '').toLowerCase() !== 'member') {
      throw new TeamsAccountError('not_member', 'Guest and external Microsoft accounts cannot use this service.');
    }
    if (profile?.accountEnabled !== true) {
      throw new TeamsAccountError('disabled', 'This Microsoft account is disabled.');
    }

    const result = this.externalUsers.linkOrProvision({
      provider: PROVIDER,
      tenantId: identity.tenantId,
      subjectId: identity.objectId,
      preferredUsername: preferredUsername(profile),
      name: String(profile.displayName ?? '').trim(),
      email: String(profile.mail || profile.userPrincipalName || '').trim(),
    });
    return { status: 'authorized', user: result.user, created: result.created };
  }

  async signInActivity(activity, text, buttonTitle) {
    this.validateActivity(activity);
    const resource = await this.tokens.getSignInResource(String(this.cfg.oauthConnectionName), activity);
    if (!resource?.signInLink) throw new TeamsAccountError('sign_in_unavailable', 'Microsoft sign-in is temporarily unavailable.');
    return {
      type: 'message',
      text,
      attachments: [{
        contentType: 'application/vnd.microsoft.card.oauth',
        content: {
          text,
          connectionName: String(this.cfg.oauthConnectionName),
          buttons: [{ type: 'signin', title: buttonTitle, value: resource.signInLink }],
          ...(resource.tokenExchangeResource ? { tokenExchangeResource: resource.tokenExchangeResource } : {}),
        },
      }],
    };
  }
}
