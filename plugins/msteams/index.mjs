// Microsoft Teams platform plugin: an Azure Bot Framework bot. Inbound activities arrive on the daemon
// webhook /hooks/msteams/messages (Microsoft's JWT is validated there); replies, typing indicators and
// media go out through the Bot Connector REST API with an Entra client-credentials token. Each sender —
// an Entra object ID, a UPN/email, or a whole conversation id — resolves via this plugin's rolePolicies
// to the Elowen projects they may touch plus an optional role prompt. Unmapped senders are ignored.
import { join } from 'node:path';
import { StateStore } from './lib/state.mjs';
import { MsTeamsAdapter } from './lib/adapter.mjs';
import { PeopleDirectory } from './lib/directory.mjs';
import { registerTools } from './lib/tools.mjs';
import { platformImageDirs } from 'elowen-plugin-shared/images';

export { matchesId, senderIds, senderIsAdmin, displayNameOf } from './lib/ids.mjs';
export { splitContent, footerLine, CHUNK } from './lib/format.mjs';
export { makeTokenVerifier } from './lib/auth.mjs';
export { ConnectorClient } from './lib/connector.mjs';

/** Browser-safe projection of the learned Teams directory. Routing details stay daemon-only. */
export function peopleForUi(people, profilePhotos = false) {
  return people.map((person) => ({
    key: String(person.key),
    name: typeof person.name === 'string' ? person.name : '',
    upn: typeof person.upn === 'string' ? person.upn : '',
    aadObjectId: typeof person.aad === 'string' ? person.aad : '',
    teamsId: typeof person.id === 'string' ? person.id : '',
    teamsAvatarUrl: profilePhotos && person.aad ? `/api/plugins/msteams/people/${encodeURIComponent(String(person.aad))}/avatar` : '',
    hasPersonalChat: Boolean(person.conv),
    lastSeenAt: Number(person.at) || null,
  })).sort((a, b) => a.name.localeCompare(b.name) || a.upn.localeCompare(b.upn));
}

export function register(ctx) {
  // The sideloadable app package (manifest + icons) an admin uploads to the org's Teams app catalog,
  // built by the live adapter from the current config. Registered UP FRONT and reporting 503 while no
  // adapter exists — precisely what this answered as a core route, which looked the adapter up among
  // the registered platforms and 503'd when it found none. Registering it after the credential check
  // would turn that into a 404 on an enabled-but-unconfigured instance.
  let adapter = null;
  const dataDir = ctx.dataDir();
  const state = new StateStore(join(dataDir, 'channel-state.json'));
  const people = new PeopleDirectory(state, ctx.logger);
  const agentName = typeof ctx.config.agentName === 'string' && ctx.config.agentName.trim()
    ? ctx.config.agentName.trim()
    : 'Elowen';
  const productName = typeof ctx.config.productName === 'string' && ctx.config.productName.trim()
    ? ctx.config.productName.trim()
    : agentName;
  const fileStem = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'elowen';
  ctx.registerApiRoute({
    rootMount: '/plugins/msteams/app-package', path: '', method: 'GET', access: 'admin',
    handler: async (req) => {
      if (req.path !== '') return { status: 404, body: { error: 'not found' } };
      if (!adapter?.appPackage) return { status: 503, body: { error: 'msteams plugin not enabled' } };
      return {
        body: new Uint8Array(adapter.appPackage()),
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${fileStem}-teams-app.zip"`,
        },
      };
    },
  });
  ctx.registerApiRoute({
    rootMount: '/plugins/msteams/people', path: '', method: 'GET', access: 'admin',
    handler: async (req) => {
      if (req.path !== '') return { status: 404, body: { error: 'not found' } };
      return { body: { active: adapter !== null, people: peopleForUi(people.list(), Boolean(adapter?.graph)) } };
    },
  });
  ctx.registerApiRoute({
    rootMount: '/plugins/msteams/people/:id/avatar', path: '', method: 'GET', access: 'admin',
    handler: async (req) => {
      if (req.path !== '' || !adapter) return { status: 404, body: { error: 'not found' } };
      const photo = await adapter.personPhoto(req.params.id).catch((error) => {
        ctx.logger.warn(`msteams profile photo: ${error?.message ?? error}`);
        return null;
      });
      if (!photo) return { status: 404, body: { error: 'not found' } };
      return { body: photo.body, headers: { 'content-type': photo.contentType, 'cache-control': 'private, max-age=300' } };
    },
  });

  const appId = typeof ctx.config.appId === 'string' ? ctx.config.appId.trim() : '';
  const appPassword = typeof ctx.config.appPassword === 'string' ? ctx.config.appPassword.trim() : '';
  const tenantId = typeof ctx.config.tenantId === 'string' ? ctx.config.tenantId.trim() : '';
  if (!appId || !appPassword || !tenantId) {
    ctx.logger.warn('enabled but appId/appPassword/tenantId are not all configured — not connecting');
    return;
  }
  const imageDirs = platformImageDirs(dataDir);
  // chatCommands passes LAZILY (a function) so a plugin registered after msteams — or a live reload —
  // is always reflected in /help and dispatch.
  adapter = new MsTeamsAdapter(
    { ...ctx.config, appId, appPassword, tenantId, agentName, productName },
    ctx.logger, state, ctx.listModels, imageDirs, ctx.resolveProvider, ctx.answerQuestion,
    () => ctx.chatCommands('msteams'),
    // Accounts a rolePolicy may name in `elowenUser`, so a Teams sender can act as their own Elowen
    // user. Read live: an account added after startup must be nameable without restarting the plugin.
    () => ctx.host.stores().usersRead.list(),
  );
  ctx.registerHttpRoute({ path: 'messages', handler: (req) => adapter.handleWebhook(req) });
  ctx.registerPlatform(adapter);
  registerTools(ctx, adapter);
  ctx.logger.info('msteams platform registered (webhook /hooks/msteams/messages + chat tools)');
}
