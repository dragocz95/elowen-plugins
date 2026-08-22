// Link a platform sender to the daemon's bootstrapped admin account.
//
// A room/sender rolePolicy ADMITS a sender and describes the room; it does not create a principal. The
// host drops a human platform turn whose sender has no linked Elowen account (PlatformOrchestrator:
// `if (humanPlatformSender && linkedUserId == null) return undefined`) — silently, because an adapter is
// expected to answer with its own onboarding UI. Without this link a scenario sees a turn that starts,
// posts its typing/reaction trace and then produces no reply at all.
//
// The link lives in the account's CLI settings (`discordUserId` / `whatsappNumber` / `telegramUserId` /
// `msteamsUserId`), which is what `resolvePlatformUser` reads. The store SILENTLY DROPS a value whose
// shape it does not recognise (a GUID or `29:…` for Teams, digits for the rest), so this reads the
// setting back and fails loudly rather than leaving the suite to time out on a mysteriously mute bot.

/**
 * @param {string} baseUrl Daemon base URL.
 * @param {string} token   Bearer token of the bootstrapped admin.
 * @param {Record<string, string>} links CLI-settings patch, e.g. `{ msteamsUserId: '<guid>' }`.
 */
export async function linkPlatformAccount(baseUrl, token, links) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const res = await fetch(`${baseUrl}/auth/me/cli-settings`, { method: 'PATCH', headers, body: JSON.stringify(links) });
  if (!res.ok) throw new Error(`linking the platform sender failed: HTTP ${res.status} ${await res.text()}`);

  const readBack = await fetch(`${baseUrl}/auth/me/cli-settings`, { headers });
  if (!readBack.ok) throw new Error(`reading back the platform link failed: HTTP ${readBack.status}`);
  const stored = await readBack.json();
  for (const [key, value] of Object.entries(links)) {
    const got = String(stored?.[key] ?? '');
    // Teams ids are stored lower-cased; the numeric ids are stored verbatim.
    if (got.toLowerCase() !== String(value).toLowerCase()) {
      throw new Error(`the daemon rejected the ${key} link (stored "${got}", wanted "${value}") — the id shape is invalid`);
    }
  }
}
