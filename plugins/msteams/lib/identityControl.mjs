import { DelegatedGraphClient } from './delegatedGraph.mjs';

const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const GRAPH_BASE = `${GRAPH_ORIGIN}/v1.0`;

/** The only Graph surface this control hands out. Everything else — mail, calendar, chats, the directory —
 *  stays unreachable, so a consumer holding the client cannot widen its own reach even though the delegated
 *  token behind it carries the tenant's full set of consented scopes. */
const DRIVE_PATHS = [
  /^\/me\/drive(\/|:|$)/,
  /^\/drives\/[^/]+(\/|:|$)/,
];

/** Normalize a caller-supplied Graph path and prove it stays inside the drive namespace.
 *
 *  The normalization is deliberately NOT trusted to the caller and NOT deferred to the underlying client:
 *  `/me/drive/../me/messages` collapses to `/me/messages`, so a prefix test on the raw string would pass a
 *  path that then resolves somewhere else entirely. Resolving through `URL` first and testing the RESULT is
 *  what makes the allow-list an actual boundary rather than a naming convention. */
export function driveScopedPath(value) {
  const raw = String(value ?? '').trim();
  if (!raw.startsWith('/') || raw.includes('://')) throw new TypeError('Microsoft Graph path must be relative.');
  const parsed = new URL(`${GRAPH_BASE}${raw}`);
  if (parsed.origin !== GRAPH_ORIGIN || !parsed.pathname.startsWith('/v1.0/')) {
    throw new TypeError('Microsoft Graph path escaped the v1.0 API.');
  }
  const pathname = parsed.pathname.slice('/v1.0'.length);
  if (!DRIVE_PATHS.some((allowed) => allowed.test(pathname))) {
    throw new TypeError(`Microsoft Graph path "${pathname}" is outside the drive namespace this client may use.`);
  }
  return `${pathname}${parsed.search}`;
}

/** The delegated client, narrowed. Same three methods and same signatures as {@link DelegatedGraphClient},
 *  so a consumer needs no second dialect — the only difference is that the path is checked first and the
 *  access token is never reachable from the outside. */
class DriveScopedGraph {
  constructor(client) {
    this.client = client;
  }

  // `async` matters: the underlying client reports every failure as a REJECTION, so a refused path has to
  // arrive the same way. A synchronous throw would slip past the caller's `.catch()` and past any
  // `Promise.all` fan-out, turning a denied path into a different failure mode from a denied request.
  async request(method, path, options) { return this.client.request(method, driveScopedPath(path), options); }
  async json(method, path, options) { return this.client.json(method, driveScopedPath(path), options); }
  async binary(path, options) { return this.client.binary(driveScopedPath(path), options); }
}

/** Publish "who is this account in Microsoft, and may I act on their drive" for other plugins.
 *
 *  Both methods name the account EXPLICITLY instead of reading an ambient turn scope, because the callers
 *  are background workers and HTTP routes — neither has one. Chat tools use the same durable account
 *  binding through `sessionForIdentity`, so one verified Elowen account gets the same Microsoft identity
 *  on every surface. This shared control remains narrower: what it returns is restricted to drive paths.
 *
 *  No token is stored anywhere by this control or by its consumers. Azure Bot Service holds the refresh
 *  token for the configured OAuth connection (which is why `offline_access` on that connection is not
 *  optional), and each call mints a fresh access token that lives only for the duration of the work. */
export function createMicrosoftIdentityRuntime({ linking, people, logger }) {
  /** The Teams person behind an Elowen account, or null. Walks the directory rather than querying by
   *  account id because the durable binding is stored the other way round — subject id to account — and the
   *  directory is the tenant's handful of known people, not a table that grows with usage. */
  const personFor = (elowenUserId) => {
    if (!Number.isSafeInteger(elowenUserId)) return null;
    for (const person of people.list()) {
      if (!person.aad || !person.id) continue;
      const bound = linking.bindingFor(person.aad);
      if (bound?.user?.id === elowenUserId) return person;
    }
    return null;
  };

  const sessionForAccountIdentity = async (identity) => {
    if (!Number.isSafeInteger(identity?.elowenUserId) || identity.elowenUserId <= 0) {
      throw new Error('Microsoft access requires a verified Elowen account.');
    }
    const person = personFor(identity.elowenUserId);
    if (!person) throw new Error('This Elowen account has no linked Microsoft identity.');
    return linking.delegatedSessionForPerson(person, identity.elowenUserId);
  };

  const control = {
    identityFor: (elowenUserId) => {
      const person = personFor(elowenUserId);
      if (!person) return { linked: false };
      return {
        linked: true,
        ...(person.upn ? { upn: person.upn } : {}),
        ...(person.name ? { displayName: person.name } : {}),
      };
    },

    driveGraphFor: async (elowenUserId) => {
      const person = personFor(elowenUserId);
      if (!person) return null;
      // A missing token is the ordinary "has not signed in, or the grant expired" state and must read as
      // "not connected" rather than as a fault: the caller's whole job is to skip that account this cycle.
      try {
        const session = await linking.delegatedSessionForPerson(person, elowenUserId);
        return new DriveScopedGraph(new DelegatedGraphClient(session.token));
      } catch (error) {
        logger?.warn?.(`msteams delegated drive token for account ${elowenUserId}: ${error?.message ?? error}`);
        return null;
      }
    },
  };

  return {
    control,
    sessionForIdentity: sessionForAccountIdentity,
  };
}

/** Backwards-compatible constructor for tests and consumers that need only the narrow shared control. */
export function createMicrosoftIdentityControl(deps) {
  return createMicrosoftIdentityRuntime(deps).control;
}
