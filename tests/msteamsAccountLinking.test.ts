// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { TeamsAccountLinking } from '../plugins/msteams/lib/accountLinking.mjs';

const TENANT = '5d321ea3-359c-40a8-b0c6-2314101886df';
const OBJECT_ID = '11111111-2222-3333-4444-555555555555';
const cfg = {
  appId: 'app-id',
  appPassword: 'secret',
  tenantId: TENANT,
  accountLinking: true,
  oauthConnectionName: 'Chetty delegated access',
};

function token(claims: Record<string, unknown> = {}) {
  const encoded = Buffer.from(JSON.stringify({ tid: TENANT, oid: OBJECT_ID, ...claims })).toString('base64url');
  return `header.${encoded}.signature`;
}

function activity(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'msteams',
    serviceUrl: 'https://smba.trafficmanager.net/emea/',
    from: { id: '29:teams-user', aadObjectId: OBJECT_ID },
    conversation: { id: '19:conversation', conversationType: 'personal', tenantId: TENANT },
    ...overrides,
  };
}

function harness(options: {
  accessToken?: string | null;
  profile?: Record<string, unknown>;
  graphOk?: boolean;
  graphJsonError?: boolean;
} = {}) {
  const tokenClient = {
    getUserToken: vi.fn(async () => options.accessToken === undefined ? { token: token() } : (options.accessToken ? { token: options.accessToken } : null)),
    getSignInResource: vi.fn(async () => ({ signInLink: 'https://token.botframework.com/signin' })),
  };
  const fetch = vi.fn(async () => ({
    ok: options.graphOk ?? true,
    json: async () => {
      if (options.graphJsonError) throw new SyntaxError('invalid JSON');
      return options.profile ?? {
        id: OBJECT_ID,
        displayName: 'Alex Example',
        userPrincipalName: 'alex@chetty.ai',
        mail: 'alex@chetty.ai',
        accountEnabled: true,
        userType: 'Member',
      };
    },
  }));
  const externalUsers = {
    linkOrProvision: vi.fn(() => ({ user: { id: 7, username: 'alex', isAdmin: false }, created: true })),
  };
  const linking = new TeamsAccountLinking(cfg, externalUsers, { info() {}, warn() {}, error() {} }, { tokenClient, fetch });
  return { linking, tokenClient, fetch, externalUsers };
}

describe('TeamsAccountLinking', () => {
  it('verifies a tenant member through Graph and provisions only bounded identity data', async () => {
    const { linking, tokenClient, fetch, externalUsers } = harness();

    await expect(linking.authenticate(activity())).resolves.toEqual({
      status: 'authorized',
      user: { id: 7, username: 'alex', isAdmin: false },
      created: true,
    });
    expect(tokenClient.getUserToken).toHaveBeenCalledWith('29:teams-user', cfg.oauthConnectionName, 'msteams', undefined);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/me?'), expect.objectContaining({
      headers: { authorization: expect.stringMatching(/^Bearer /), accept: 'application/json' },
    }));
    expect(externalUsers.linkOrProvision).toHaveBeenCalledWith({
      provider: 'msteams', tenantId: TENANT, subjectId: OBJECT_ID,
      preferredUsername: 'alex', name: 'Alex Example', email: 'alex@chetty.ai',
    });
    expect(JSON.stringify(externalUsers.linkOrProvision.mock.calls)).not.toContain('signature');
  });

  it('returns a sign-in requirement without calling Graph or provisioning', async () => {
    const { linking, fetch, externalUsers } = harness({ accessToken: null });
    await expect(linking.authenticate(activity())).resolves.toEqual({ status: 'sign_in_required' });
    expect(fetch).not.toHaveBeenCalled();
    expect(externalUsers.linkOrProvision).not.toHaveBeenCalled();
  });

  it.each([
    ['activity tenant', activity({ conversation: { id: '19:conversation', tenantId: 'other' } }), token(), 'wrong_tenant'],
    ['token tenant', activity(), token({ tid: 'other' }), 'wrong_tenant'],
    ['missing token subject', activity(), token({ oid: undefined }), 'identity_mismatch'],
    ['token subject', activity(), token({ oid: 'other' }), 'identity_mismatch'],
  ])('rejects a mismatched %s', async (_label, incoming, accessToken, code) => {
    const { linking, externalUsers } = harness({ accessToken });
    await expect(linking.authenticate(incoming)).rejects.toMatchObject({ code });
    expect(externalUsers.linkOrProvision).not.toHaveBeenCalled();
  });

  it.each([
    ['Graph subject', { id: 'other', userType: 'Member', accountEnabled: true }, 'identity_mismatch'],
    ['guest account', { id: OBJECT_ID, userType: 'Guest', accountEnabled: true }, 'not_member'],
    ['disabled account', { id: OBJECT_ID, userType: 'Member', accountEnabled: false }, 'disabled'],
  ])('rejects a mismatched %s', async (_label, profile, code) => {
    const { linking, externalUsers } = harness({ profile });
    await expect(linking.authenticate(activity())).rejects.toMatchObject({ code });
    expect(externalUsers.linkOrProvision).not.toHaveBeenCalled();
  });

  it('sanitizes failed and malformed Graph responses', async () => {
    const failed = harness({ graphOk: false });
    await expect(failed.linking.authenticate(activity())).rejects.toMatchObject({ code: 'graph_rejected' });
    const malformed = harness({ graphJsonError: true });
    await expect(malformed.linking.authenticate(activity())).rejects.toMatchObject({ code: 'graph_rejected' });
  });

  it('builds an OAuth card from Token Service without exposing credentials', async () => {
    const { linking, tokenClient } = harness({ accessToken: null });
    const card = await linking.signInActivity(activity(), 'Sign in to continue.', 'Sign in');
    expect(tokenClient.getSignInResource).toHaveBeenCalledWith(cfg.oauthConnectionName, expect.objectContaining({ channelId: 'msteams' }));
    expect(card).toEqual(expect.objectContaining({
      type: 'message',
      attachments: [expect.objectContaining({
        contentType: 'application/vnd.microsoft.card.oauth',
        content: expect.objectContaining({
          connectionName: cfg.oauthConnectionName,
          buttons: [{ type: 'signin', title: 'Sign in', value: 'https://token.botframework.com/signin' }],
        }),
      })],
    }));
    expect(card).not.toHaveProperty('text');
    expect(JSON.stringify(card)).not.toContain(cfg.appPassword);
  });
});
