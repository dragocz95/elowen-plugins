// Discord server tools: raw REST access plus curated wrappers.
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });
const fail = (e) => ok(`Error: ${e instanceof Error ? e.message : String(e)}`);

export function registerTools(ctx, adapter) {
  // Raw Discord REST access: delete/purge messages, manage roles, edit channels — whatever the bot permissions allow.
  ctx.registerTool(defineTool({
    name: 'DiscordApi', label: 'Discord API',
    description: [
      'Call any Discord REST API v10 endpoint directly with the bot token — the raw escape hatch for Discord server management when no curated Discord* tool covers what you need.',
      'Typical uses: delete a message (DELETE /channels/{id}/messages/{msgId}), bulk-delete messages younger than 14 days (POST /channels/{id}/messages/bulk-delete with {"messages":[ids]}), grant or revoke a role (PUT or DELETE /guilds/{gid}/members/{uid}/roles/{roleId}), fetch messages (GET /channels/{id}/messages?limit=50), edit channel settings, manage bans, invites, emojis and webhooks.',
      'Prefer the structured wrappers first — DiscordListChannels, DiscordReadChannel, DiscordDeleteMessage, DiscordPurgeMessages, DiscordAssignRole and friends — because they validate the arguments for you; reach for this tool only for an endpoint they do not expose.',
      'HIGHLY DESTRUCTIVE: the raw bot token can delete channels, ban members and reconfigure the entire guild. Use the curated wrappers whenever they cover the operation.',
      'method is the HTTP verb, path must start with "/" (query string included), and body is a JSON string parsed before sending — invalid JSON is rejected without any request being made.',
      'The response is the pretty-printed JSON returned by Discord, "(no content)" for a 204, and it is truncated after 4000 characters; a non-2xx status comes back as an "Error: discord API … → HTTP <status>" text rather than an exception, and 429 rate limits are retried automatically.',
    ].join(' '),
    parameters: Type.Object({
      method: Type.Union([Type.Literal('GET'), Type.Literal('POST'), Type.Literal('PATCH'), Type.Literal('PUT'), Type.Literal('DELETE')], { description: 'HTTP method for the Discord REST call: GET to read, POST to create, PATCH to modify, PUT to set/add, DELETE to remove' }),
      path: Type.String({ description: 'API path starting with /, relative to the Discord API v10 base, query string included — e.g. /channels/123/messages?limit=20 or /guilds/456/members/789/roles/321' }),
      body: Type.Optional(Type.String({ description: 'JSON request body as a string, when the endpoint takes one — e.g. {"name":"general"} or {"messages":["1","2"]}. Must parse as JSON; omit for GET and DELETE.' })),
    }),
    execute: async (_id, p) => {
      try {
        if (!p.path.startsWith('/')) return ok('Error: path must start with "/".');
        let body;
        if (p.body) {
          try { body = JSON.parse(p.body); } catch { return ok('Error: body is not valid JSON.'); }
        }
        const res = await adapter.rest(p.method, p.path, body);
        const text = res === null ? '(no content)' : JSON.stringify(res, null, 2);
        return ok(text.length > 4000 ? `${text.slice(0, 4000)}\n… (truncated)` : text);
      } catch (e) { return fail(e); }
    },
  }));

  // ── Ergonomic server tools (structured wrappers over the REST surface, so the agent needn't know raw endpoints). ──
  const cfgGuild = typeof ctx.config.guildId === 'string' ? ctx.config.guildId.trim() : '';
  const requireGuild = (p) => {
    const g = (p?.guildId && String(p.guildId).trim()) || cfgGuild;
    if (!g) throw new Error('no guild id — set guildId in the plugin config or pass it as guildId');
    return g;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CHAN_TYPE = { 0: 'text', 2: 'voice', 4: 'category', 5: 'news', 10: 'news-thread', 11: 'thread', 12: 'private-thread', 13: 'stage', 15: 'forum' };
  // Channel type name → numeric id, for create_channel (text/voice/category/news/forum/stage).
  const CHAN_TYPE_ID = { text: 0, voice: 2, category: 4, news: 5, stage: 13, forum: 15 };

  ctx.registerTool(defineTool({
    name: 'DiscordListChannels', label: 'List Discord channels',
    description: [
      'List every channel of a Discord guild (server) together with its currently active threads, so you can pick the right channel or thread id before reading or posting.',
      'Use it as the first step whenever a request names a channel by name rather than by id — "read the #support channel", "post into the release thread" — because every other Discord* tool wants the numeric id.',
      'Each line is "id  [type]  name (parent …)", where type is text, voice, category, news, thread, private-thread, stage, forum or active-thread; the parent tells you which category or channel it hangs under.',
      'guildId is optional and defaults to the guild configured for this plugin; pass it only for a different server.',
      'Archived threads are NOT included, and for details about a single channel use DiscordChannelInfo instead.',
    ].join(' '),
    parameters: Type.Object({ guildId: Type.Optional(Type.String({ description: 'Discord guild (server) id — numeric snowflake, defaults to the guild configured in the plugin config' })) }),
    execute: async (_id, p) => {
      try {
        const g = requireGuild(p);
        const chans = (await adapter.rest('GET', `/guilds/${g}/channels`)) ?? [];
        const active = ((await adapter.rest('GET', `/guilds/${g}/threads/active`)) ?? {}).threads ?? [];
        const line = (c, t) => `${c.id}  [${t}]  ${c.name ?? ''}${c.parent_id ? `  (parent ${c.parent_id})` : ''}`;
        const out = [...chans.map((c) => line(c, CHAN_TYPE[c.type] ?? c.type)), ...active.map((t) => line(t, 'active-thread'))];
        return ok(out.length ? out.join('\n') : '(no channels)');
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordReadChannel', label: 'Read Discord channel',
    description: [
      'Read the recent message history of a Discord channel or thread by id and return it in chronological order, oldest first.',
      'Use it to load the conversation context of another channel or thread — catching up on what was discussed, summarising a thread, or checking whether something was already answered somewhere else.',
      'channelId is the channel or thread snowflake (get it from DiscordListChannels), and limit sets how many of the most recent messages to fetch: default 30, clamped to 1..100.',
      'Each line is "messageId  author: text", with a trailing "[n attachment(s)]" marker when a message carries files; whitespace is collapsed to one line per message.',
      'The leading id is what DiscordPinMessage, DiscordUnpinMessage and DiscordDeleteMessage expect, so reading a channel is enough to act on any message in it.',
      'Caveat: when the history exceeds 6000 characters the OLDEST lines are dropped (never a partial line, so an id is never truncated), embeds and reactions are omitted.',
    ].join(' '),
    parameters: Type.Object({
      channelId: Type.String({ description: 'Discord channel or thread id (numeric snowflake) whose messages should be read' }),
      limit: Type.Optional(Type.Number({ description: 'How many of the most recent messages to fetch — default 30, clamped to the range 1..100' })),
    }),
    execute: async (_id, p) => {
      try {
        const limit = Math.min(Math.max(1, Number(p.limit) || 30), 100);
        const msgs = (await adapter.rest('GET', `/channels/${encodeURIComponent(p.channelId)}/messages?limit=${limit}`)) ?? [];
        const lines = msgs.reverse().map((m) => `${m.id}  ${m.author?.username ?? m.author?.id ?? '?'}: ${(m.content ?? '').replace(/\s+/g, ' ').trim()}${m.attachments?.length ? `  [${m.attachments.length} attachment(s)]` : ''}`);
        // Drop whole lines from the oldest end, never a character slice: a half-cut snowflake would read as a
        // valid message id and send the next pin/delete at the wrong message.
        while (lines.length > 1 && lines.join('\n').length > 6000) lines.shift();
        return ok(lines.join('\n') || '(no messages)');
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordListRoles', label: 'List Discord roles',
    description: [
      'List all roles defined in a Discord guild (server) as "id  name" lines.',
      'Use it to resolve a role name a person mentions — "give her the moderator role", "who can post in announcements" — into the numeric roleId that DiscordAssignRole and DiscordRemoveRole require.',
      'guildId is optional and defaults to the guild configured for this plugin.',
      'Only ids and names are returned: permissions, colour, position, mentionability and member counts are not — read those with DiscordApi (GET /guilds/{id}/roles) if you need them.',
    ].join(' '),
    parameters: Type.Object({ guildId: Type.Optional(Type.String({ description: 'Discord guild (server) id — numeric snowflake, defaults to the guild configured in the plugin config' })) }),
    execute: async (_id, p) => {
      try {
        const roles = (await adapter.rest('GET', `/guilds/${requireGuild(p)}/roles`)) ?? [];
        return ok(roles.map((r) => `${r.id}  ${r.name}`).join('\n') || '(no roles)');
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordListMembers', label: 'List Discord members',
    description: [
      'List the members of a Discord guild (server) as "id  username  roles:[…]" lines, so you can see who is on the server and which roles they hold.',
      'Use it to browse the membership or to find a user id before assigning a role; when you already know part of the name, DiscordSearchMembers is the faster and more targeted tool, and for one specific person use DiscordMemberInfo.',
      'guildId defaults to the configured guild, and limit caps how many members are returned — default 50, clamped to 1..200.',
      'Requires the bot to have the SERVER MEMBERS privileged intent enabled in the Discord developer portal; without it Discord rejects the request and you get an HTTP error text. and the listing is a single page — there is no pagination cursor here.',
    ].join(' '),
    parameters: Type.Object({
      guildId: Type.Optional(Type.String({ description: 'Discord guild (server) id — numeric snowflake, defaults to the guild configured in the plugin config' })),
      limit: Type.Optional(Type.Number({ description: 'How many members to list — default 50, clamped to the range 1..200' })),
    }),
    execute: async (_id, p) => {
      try {
        const limit = Math.min(Math.max(1, Number(p.limit) || 50), 200);
        const members = (await adapter.rest('GET', `/guilds/${requireGuild(p)}/members?limit=${limit}`)) ?? [];
        return ok(members.map((m) => `${m.user?.id}  ${m.user?.username ?? ''}${m.roles?.length ? `  roles:[${m.roles.join(',')}]` : ''}`).join('\n') || '(no members)');
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordAssignRole', label: 'Assign Discord role',
    description: [
      'Grant a role to a member of a Discord guild (server).',
      'Use it when someone should get access, moderator rights or a marker role; resolve the ids first with DiscordSearchMembers or DiscordListMembers for userId and DiscordListRoles for roleId, and use DiscordRemoveRole to take a role away again.',
      'guildId defaults to the configured guild; userId and roleId are numeric snowflakes.',
      'SENSITIVE AND EFFECTIVELY DESTRUCTIVE: a role can carry permissions, so this can hand a person moderator or administrator power over the server, and in this deployment role ids also map to the assistant\'s own admin access. Confirm the exact role before calling. and the bot\'s own highest role must sit above the role being granted, otherwise Discord answers with an HTTP 403 error text.',
    ].join(' '),
    parameters: Type.Object({
      userId: Type.String({ description: 'Discord user id (numeric snowflake) of the guild member who should receive the role' }),
      roleId: Type.String({ description: 'Discord role id (numeric snowflake) to grant — get it from DiscordListRoles' }),
      guildId: Type.Optional(Type.String({ description: 'Discord guild (server) id — numeric snowflake, defaults to the guild configured in the plugin config' })),
    }),
    execute: async (_id, p) => {
      try {
        await adapter.rest('PUT', `/guilds/${requireGuild(p)}/members/${encodeURIComponent(p.userId)}/roles/${encodeURIComponent(p.roleId)}`);
        return ok(`Assigned role ${p.roleId} to member ${p.userId}.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordRemoveRole', label: 'Remove Discord role',
    description: [
      'Revoke a role from a member of a Discord guild (server).',
      'Use it to withdraw access or moderator rights someone should no longer have; DiscordAssignRole is the inverse, and DiscordMemberInfo shows which roles a person currently holds.',
      'guildId defaults to the configured guild; userId and roleId are numeric snowflakes taken from DiscordListMembers and DiscordListRoles.',
      'DESTRUCTIVE: removing a role immediately strips every permission and channel visibility it granted, and it can also revoke that person\'s admin access to the assistant. The role itself is not deleted, only the membership. and the bot\'s highest role must outrank the role being removed.',
    ].join(' '),
    parameters: Type.Object({
      userId: Type.String({ description: 'Discord user id (numeric snowflake) of the guild member losing the role' }),
      roleId: Type.String({ description: 'Discord role id (numeric snowflake) to revoke — get it from DiscordListRoles or DiscordMemberInfo' }),
      guildId: Type.Optional(Type.String({ description: 'Discord guild (server) id — numeric snowflake, defaults to the guild configured in the plugin config' })),
    }),
    execute: async (_id, p) => {
      try {
        await adapter.rest('DELETE', `/guilds/${requireGuild(p)}/members/${encodeURIComponent(p.userId)}/roles/${encodeURIComponent(p.roleId)}`);
        return ok(`Removed role ${p.roleId} from member ${p.userId}.`);
      } catch (e) { return fail(e); }
    },
  }));

  // ── More server tools (structured REST wrappers). ──

  ctx.registerTool(defineTool({
    name: 'DiscordServerInfo', label: 'Discord server info',
    description: [
      'Give a one-screen overview of a Discord guild (server): its name, id, owner id, approximate member and online counts, and the total number of channels and roles.',
      'Use it to answer "how big is the server", "who owns it", "how many people are online" or to sanity-check that the bot is connected to the guild you think it is.',
      'guildId is optional and defaults to the guild configured for this plugin.',
      'It is a read-only summary — for the actual channel list use DiscordListChannels, for roles DiscordListRoles, and for members DiscordListMembers. Member and presence counts are Discord\'s approximations, not exact figures.',
    ].join(' '),
    parameters: Type.Object({ guildId: Type.Optional(Type.String({ description: 'Discord guild (server) id — numeric snowflake, defaults to the guild configured in the plugin config' })) }),
    execute: async (_id, p) => {
      try {
        const g = requireGuild(p);
        const info = await adapter.rest('GET', `/guilds/${g}?with_counts=true`);
        const chans = (await adapter.rest('GET', `/guilds/${g}/channels`)) ?? [];
        const roles = (await adapter.rest('GET', `/guilds/${g}/roles`)) ?? [];
        return ok([
          `name: ${info.name}`, `id: ${info.id}`, `owner_id: ${info.owner_id}`,
          `members≈ ${info.approximate_member_count ?? '?'} (online≈ ${info.approximate_presence_count ?? '?'})`,
          `channels: ${chans.length}`, `roles: ${roles.length}`,
        ].join('\n'));
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordChannelInfo', label: 'Discord channel info',
    description: [
      'Show the settings of a single Discord channel or thread by id: type, name, topic, parent category, NSFW flag, slowmode interval, and for threads whether they are archived or locked.',
      'Use it to check the state of one specific channel before changing it — for instance to confirm a thread really is archived before reopening it with DiscordArchiveThread, or to see which category a channel belongs to.',
      'To discover the channelId in the first place, or to see the whole server at once, use DiscordListChannels instead.',
      'channelId is the numeric snowflake of a channel or thread. Optional fields are omitted when empty, permission overwrites and member lists are not included, and the tool is read-only.',
    ].join(' '),
    parameters: Type.Object({ channelId: Type.String({ description: 'Discord channel or thread id (numeric snowflake) to inspect' }) }),
    execute: async (_id, p) => {
      try {
        const c = await adapter.rest('GET', `/channels/${encodeURIComponent(p.channelId)}`);
        const out = [`id: ${c.id}`, `type: ${CHAN_TYPE[c.type] ?? c.type}`, `name: ${c.name ?? ''}`];
        if (c.topic) out.push(`topic: ${c.topic}`);
        if (c.parent_id) out.push(`parent: ${c.parent_id}`);
        if (c.nsfw) out.push('nsfw: true');
        if (c.rate_limit_per_user) out.push(`slowmode: ${c.rate_limit_per_user}s`);
        if (c.thread_metadata) out.push(`archived: ${!!c.thread_metadata.archived}`, `locked: ${!!c.thread_metadata.locked}`);
        return ok(out.join('\n'));
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordMemberInfo', label: 'Discord member info',
    description: [
      'Show the guild profile of one Discord member by user id: username, server nickname, the role ids they hold and the date they joined the server.',
      'Use it to check what access a specific person has before granting or revoking a role, or to confirm you picked the right user after a name lookup.',
      'When you only know a name, resolve the userId first with DiscordSearchMembers; to see everyone at once use DiscordListMembers.',
      'guildId defaults to the configured guild. Roles come back as ids only — pair them with DiscordListRoles to get names. Read-only, and an unknown user id returns an HTTP 404 error text.',
    ].join(' '),
    parameters: Type.Object({
      userId: Type.String({ description: 'Discord user id (numeric snowflake) of the guild member to inspect' }),
      guildId: Type.Optional(Type.String({ description: 'Discord guild (server) id — numeric snowflake, defaults to the guild configured in the plugin config' })),
    }),
    execute: async (_id, p) => {
      try {
        const m = await adapter.rest('GET', `/guilds/${requireGuild(p)}/members/${encodeURIComponent(p.userId)}`);
        return ok([
          `id: ${m.user?.id}`, `username: ${m.user?.username ?? ''}`,
          m.nick ? `nick: ${m.nick}` : null, `roles: [${(m.roles ?? []).join(', ')}]`,
          m.joined_at ? `joined: ${m.joined_at}` : null,
        ].filter(Boolean).join('\n'));
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordSearchMembers', label: 'Search Discord members',
    description: [
      'Search the members of a Discord guild (server) by name and return the matches as "id  username (nick)" lines.',
      'This is the fastest way to turn a person\'s name into the userId that DiscordAssignRole, DiscordRemoveRole, DiscordMemberInfo and DiscordAddThreadMember need.',
      'query is matched as a PREFIX against username and server nickname, so a substring from the middle of a name will not match; limit caps the results at default 10, clamped to 1..100, and guildId defaults to the configured guild.',
      'Prefer this over DiscordListMembers whenever you have a name to go on. Returns "(no matches)" when nothing matches.',
    ].join(' '),
    parameters: Type.Object({
      query: Type.String({ description: 'Name prefix to match against username and server nickname — e.g. "mar" finds "martin"; matching is prefix-only, not substring' }),
      guildId: Type.Optional(Type.String({ description: 'Discord guild (server) id — numeric snowflake, defaults to the guild configured in the plugin config' })),
      limit: Type.Optional(Type.Number({ description: 'Maximum number of matching members to return — default 10, clamped to the range 1..100' })),
    }),
    execute: async (_id, p) => {
      try {
        const limit = Math.min(Math.max(1, Number(p.limit) || 10), 100);
        const members = (await adapter.rest('GET', `/guilds/${requireGuild(p)}/members/search?query=${encodeURIComponent(p.query)}&limit=${limit}`)) ?? [];
        return ok(members.map((m) => `${m.user?.id}  ${m.user?.username ?? ''}${m.nick ? `  (${m.nick})` : ''}`).join('\n') || '(no matches)');
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordListPins', label: 'List Discord pins',
    description: [
      'List the pinned messages of a Discord channel or thread as "message id  author: text" lines.',
      'Use it to see what is currently pinned; for a message that is not pinned, read the channel with DiscordReadChannel, which returns the message id on every line.',
      'channelId is the numeric snowflake of the channel or thread; get it from DiscordListChannels.',
      'Each message body is collapsed to one line and cut after 120 characters, so it is a preview, not the full text; attachments and embeds are not shown. Returns "(no pins)" for an empty channel. Read-only.',
    ].join(' '),
    parameters: Type.Object({ channelId: Type.String({ description: 'Discord channel or thread id (numeric snowflake) whose pinned messages should be listed' }) }),
    execute: async (_id, p) => {
      try {
        const pins = (await adapter.rest('GET', `/channels/${encodeURIComponent(p.channelId)}/pins`)) ?? [];
        return ok(pins.map((m) => `${m.id}  ${m.author?.username ?? '?'}: ${(m.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)}`).join('\n') || '(no pins)');
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordCreateThread', label: 'Create Discord thread',
    description: [
      'Create a new public thread in a Discord text channel and return its id and name.',
      'Use it to split a side discussion out of a busy channel, to open a thread for a topic or ticket, or to give a specific message its own conversation.',
      'Pass messageId to hang the thread off that existing message; omit it and a standalone public thread is created directly in the channel. name is the thread title, and autoArchiveMinutes must be one of 60, 1440, 4320 or 10080 — any other value silently falls back to 1440 (one day).',
      'The parent channelId must be a normal text channel; you cannot create a thread inside another thread. Nothing is posted into the thread — use the normal channel reply flow for that, DiscordAddThreadMember to pull people in, and DiscordArchiveThread or DiscordLockThread to close it later.',
    ].join(' '),
    parameters: Type.Object({
      channelId: Type.String({ description: 'Id (numeric snowflake) of the parent text channel the thread is created in — not another thread' }),
      name: Type.String({ description: 'Title of the new thread as it appears in the channel list, e.g. "Release 2.4 checklist"' }),
      messageId: Type.Optional(Type.String({ description: 'Id of an existing message to anchor the thread to; omit for a standalone thread created directly in the channel' })),
      autoArchiveMinutes: Type.Optional(Type.Number({ description: 'Inactivity period after which Discord auto-archives the thread — 60, 1440, 4320 or 10080 minutes; any other value falls back to 1440' })),
    }),
    execute: async (_id, p) => {
      try {
        const auto = [60, 1440, 4320, 10080].includes(Number(p.autoArchiveMinutes)) ? Number(p.autoArchiveMinutes) : 1440;
        const cid = encodeURIComponent(p.channelId);
        const path = p.messageId
          ? `/channels/${cid}/messages/${encodeURIComponent(p.messageId)}/threads`
          : `/channels/${cid}/threads`;
        const body = p.messageId ? { name: p.name, auto_archive_duration: auto } : { name: p.name, auto_archive_duration: auto, type: 11 };
        const th = await adapter.rest('POST', path, body);
        return ok(`Created thread ${th.id} "${th.name}".`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordPinMessage', label: 'Pin Discord message',
    description: [
      'Pin an existing message to the top of its Discord channel or thread, so members can find it from the channel\'s pinned-messages list.',
      'Use it to highlight an announcement, a set of rules, a summary or any message someone asks to "pin" or keep visible.',
      'channelId and messageId are numeric snowflakes and must belong together — the message has to live in that channel; DiscordReadChannel prints the id at the start of every line, and DiscordListPins lists the already-pinned ones.',
      'A Discord channel holds at most 50 pins, and pinning beyond that limit fails with an HTTP error text. DiscordUnpinMessage reverses this without deleting anything.',
    ].join(' '),
    parameters: Type.Object({
      channelId: Type.String({ description: 'Discord channel or thread id (numeric snowflake) containing the message' }),
      messageId: Type.String({ description: 'Id (numeric snowflake) of the message to pin — it must live in the given channel' }),
    }),
    execute: async (_id, p) => {
      try {
        await adapter.rest('PUT', `/channels/${encodeURIComponent(p.channelId)}/pins/${encodeURIComponent(p.messageId)}`);
        return ok(`Pinned message ${p.messageId}.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordUnpinMessage', label: 'Unpin Discord message',
    description: [
      'Unpin a message from a Discord channel or thread, removing it from the channel\'s pinned list.',
      'Use it to clear an outdated announcement or to make room when the 50-pin limit is reached; DiscordPinMessage is the inverse operation.',
      'channelId and messageId are numeric snowflakes — list the current pins with DiscordListPins to get the right messageId.',
      'This is NOT destructive to the message: it stays in the channel history and only loses its pinned status. To actually remove it use DiscordDeleteMessage. and unpinning a message that is not pinned returns an HTTP error text.',
    ].join(' '),
    parameters: Type.Object({
      channelId: Type.String({ description: 'Discord channel or thread id (numeric snowflake) the message is pinned in' }),
      messageId: Type.String({ description: 'Id (numeric snowflake) of the pinned message to unpin — get it from DiscordListPins' }),
    }),
    execute: async (_id, p) => {
      try {
        await adapter.rest('DELETE', `/channels/${encodeURIComponent(p.channelId)}/pins/${encodeURIComponent(p.messageId)}`);
        return ok(`Unpinned message ${p.messageId}.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordDeleteMessage', label: 'Delete Discord message',
    description: [
      'Permanently delete a single message from a Discord channel or thread.',
      'Use it to remove one specific message — a mistaken post, spam, or something a person asks to take down; to clear many messages at once use DiscordPurgeMessages instead of calling this in a loop.',
      'channelId and messageId are numeric snowflakes and must match: the message has to live in that channel. DiscordReadChannel prints the id at the start of every line, which is the usual way to find the message you mean.',
      'DESTRUCTIVE AND IRREVERSIBLE — the message and its attachments are gone from Discord with no undo, so verify the target before calling. and deleting someone else\'s message needs the MANAGE_MESSAGES permission or Discord answers HTTP 403.',
    ].join(' '),
    parameters: Type.Object({
      channelId: Type.String({ description: 'Discord channel or thread id (numeric snowflake) containing the message' }),
      messageId: Type.String({ description: 'Id (numeric snowflake) of the message to delete permanently — verify it before calling, there is no undo' }),
    }),
    execute: async (_id, p) => {
      try {
        await adapter.rest('DELETE', `/channels/${encodeURIComponent(p.channelId)}/messages/${encodeURIComponent(p.messageId)}`);
        return ok(`Deleted message ${p.messageId}.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordPurgeMessages', label: 'Purge Discord messages',
    description: [
      'Bulk-delete recent messages from a Discord channel or thread — the tool for "clear this channel", "wipe the last 200 messages" or cleaning up a spam flood.',
      'It pages through the history newest first up to maxMessages, drops pinned messages unless includePinned is set, then deletes what remains: messages younger than 14 days go through Discord\'s bulk-delete endpoint in chunks of 100, older ones are removed one by one, both throttled to respect rate limits.',
      'ALWAYS call it with dryRun:true first — that only counts and reports how many messages would be deleted without touching anything — and only then repeat the exact same arguments with dryRun off.',
      'maxMessages defaults to 100 and is clamped to 1..5000, channelId is the numeric snowflake of the channel or thread.',
      'EXTREMELY DESTRUCTIVE AND IRREVERSIBLE: deleted Discord messages cannot be recovered, and a large purge over old messages takes minutes because each one is a separate throttled request. It deletes messages from EVERY author, not just the bot\'s own. For a single message use DiscordDeleteMessage. Requires an admin session and the MANAGE_MESSAGES permission.',
    ].join(' '),
    parameters: Type.Object({
      channelId: Type.String({ description: 'Discord channel or thread id (numeric snowflake) to purge messages from' }),
      maxMessages: Type.Optional(Type.Number({ description: 'Upper bound on how many recent messages to consider, newest first — default 100, clamped to the range 1..5000' })),
      includePinned: Type.Optional(Type.Boolean({ description: 'Set true to delete pinned messages as well; default false keeps every pinned message untouched' })),
      dryRun: Type.Optional(Type.Boolean({ description: 'Set true to only count and report the messages that would be deleted, deleting nothing — always do this first (default false)' })),
    }),
    execute: async (_id, p) => {
      try {
        const cid = encodeURIComponent(p.channelId);
        const cap = Math.min(Math.max(1, Number(p.maxMessages) || 100), 5000);
        const collected = [];
        let before;
        while (collected.length < cap) {
          const q = `limit=${Math.min(100, cap - collected.length)}${before ? `&before=${before}` : ''}`;
          const batch = (await adapter.rest('GET', `/channels/${cid}/messages?${q}`)) ?? [];
          if (!batch.length) break;
          collected.push(...batch);
          before = batch[batch.length - 1].id;
          if (batch.length < 100) break;
        }
        let targets = collected.slice(0, cap);
        if (!p.includePinned) targets = targets.filter((m) => !m.pinned);
        if (p.dryRun) return ok(`Dry run: ${targets.length} message(s) would be deleted${p.includePinned ? '' : ' (pinned skipped)'}.`);
        // Discord's bulk endpoint only accepts 2–100 messages younger than 14 days; older ones must go one by one.
        const CUTOFF = 14 * 24 * 60 * 60 * 1000 - 60_000;
        const now = Date.now();
        const fresh = []; const old = [];
        for (const m of targets) ((now - Date.parse(m.timestamp)) < CUTOFF ? fresh : old).push(m.id);
        let deleted = 0;
        for (let i = 0; i < fresh.length; i += 100) {
          const chunk = fresh.slice(i, i + 100);
          if (chunk.length >= 2) { await adapter.rest('POST', `/channels/${cid}/messages/bulk-delete`, { messages: chunk }); }
          else { await adapter.rest('DELETE', `/channels/${cid}/messages/${chunk[0]}`); }
          deleted += chunk.length;
          await sleep(500);
        }
        for (const mid of old) { await adapter.rest('DELETE', `/channels/${cid}/messages/${mid}`); deleted += 1; await sleep(400); }
        return ok(`Deleted ${deleted} message(s)${old.length ? ` (${old.length} older than 14 days, removed individually)` : ''}.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordCreateChannel', label: 'Create Discord channel',
    description: [
      'Create a new channel in a Discord guild (server) and return its id and name.',
      'Use it when someone asks for a new channel for a topic, project or client; for a category (the collapsible group that holds channels) use DiscordCreateCategory, and for a thread inside an existing channel use DiscordCreateThread.',
      'type selects the kind of channel — text, voice, news, stage or forum — and anything else, including an unknown word, falls back to a plain text channel. parentId nests the new channel under an existing category; get that id from DiscordListChannels.',
      'guildId defaults to the configured guild. The channel is created with the category\'s or server\'s default permissions — no overwrites are set here, so use DiscordApi if it needs restricted access. Requires an admin session and the MANAGE_CHANNELS permission.',
    ].join(' '),
    parameters: Type.Object({
      name: Type.String({ description: 'Name of the new channel, e.g. "release-notes" — Discord lowercases and hyphenates text channel names' }),
      type: Type.Optional(Type.String({ description: 'Kind of channel: text, voice, news, stage or forum — case-insensitive, defaults to text, and an unrecognised value also becomes text' })),
      parentId: Type.Optional(Type.String({ description: 'Id of an existing category to nest the channel under; omit to place it at the top level' })),
      guildId: Type.Optional(Type.String({ description: 'Discord guild (server) id — numeric snowflake, defaults to the guild configured in the plugin config' })),
    }),
    execute: async (_id, p) => {
      try {
        const type = CHAN_TYPE_ID[String(p.type ?? 'text').toLowerCase()] ?? 0;
        const body = { name: p.name, type };
        if (p.parentId) body.parent_id = p.parentId;
        const c = await adapter.rest('POST', `/guilds/${requireGuild(p)}/channels`, body);
        return ok(`Created channel ${c.id} "${c.name}".`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordCreateCategory', label: 'Create Discord category',
    description: [
      'Create a category in a Discord guild (server) — the collapsible group header that channels are sorted under — and return its id and name.',
      'Use it when organising a server into sections; afterwards pass the returned id as parentId to DiscordCreateChannel to place new channels inside it.',
      'name is the category label and guildId defaults to the configured guild.',
      'It creates the container only, no channels inside it, and sets no permission overwrites. Existing channels are not moved into it — do that with DiscordApi (PATCH /channels/{id} with parent_id). Requires an admin session and the MANAGE_CHANNELS permission.',
    ].join(' '),
    parameters: Type.Object({
      name: Type.String({ description: 'Display name of the new category, e.g. "Projects"' }),
      guildId: Type.Optional(Type.String({ description: 'Discord guild (server) id — numeric snowflake, defaults to the guild configured in the plugin config' })),
    }),
    execute: async (_id, p) => {
      try {
        const c = await adapter.rest('POST', `/guilds/${requireGuild(p)}/channels`, { name: p.name, type: 4 });
        return ok(`Created category ${c.id} "${c.name}".`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordRenameChannel', label: 'Rename Discord channel',
    description: [
      'Rename an existing Discord channel, thread or category and report the name Discord actually stored.',
      'Use it for tidying up naming, fixing a typo in a channel name, or retitling a thread; nothing else about the channel changes — topic, category, permissions and message history all stay as they are.',
      'channelId is the numeric snowflake of the channel, thread or category (from DiscordListChannels) and name is the new name.',
      'Discord normalises text channel names to lowercase with hyphens, so the stored name may differ from what you passed; the returned confirmation shows the real result. Renaming is rate-limited by Discord to roughly twice per ten minutes per channel. Requires an admin session and the MANAGE_CHANNELS permission.',
    ].join(' '),
    parameters: Type.Object({
      channelId: Type.String({ description: 'Discord channel, thread or category id (numeric snowflake) to rename' }),
      name: Type.String({ description: 'New name — Discord lowercases and hyphenates text channel names, so the stored value may differ' }),
    }),
    execute: async (_id, p) => {
      try {
        const c = await adapter.rest('PATCH', `/channels/${encodeURIComponent(p.channelId)}`, { name: p.name });
        return ok(`Renamed channel ${p.channelId} to "${c.name}".`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordDeleteChannel', label: 'Delete Discord channel',
    description: [
      'Permanently delete a Discord channel, thread or category by id.',
      'Use it only for a genuine cleanup request such as removing an obsolete channel; if the goal is merely to stop a thread from being used, DiscordArchiveThread or DiscordLockThread is the reversible choice, and to clear messages while keeping the channel use DiscordPurgeMessages.',
      'channelId is the numeric snowflake of the channel, thread or category — confirm it with DiscordListChannels or DiscordChannelInfo before calling, because the argument is easy to mix up.',
      'EXTREMELY DESTRUCTIVE AND IRREVERSIBLE: the channel and its entire message history are gone with no undo. Deleting a CATEGORY does not delete the channels inside it — they survive and simply become uncategorised. Requires an admin session and the MANAGE_CHANNELS permission.',
    ].join(' '),
    parameters: Type.Object({ channelId: Type.String({ description: 'Discord channel, thread or category id (numeric snowflake) to delete permanently — there is no undo, so verify it first' }) }),
    execute: async (_id, p) => {
      try {
        await adapter.rest('DELETE', `/channels/${encodeURIComponent(p.channelId)}`);
        return ok(`Deleted channel ${p.channelId}.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordArchiveThread', label: 'Archive Discord thread',
    description: [
      'Archive a Discord thread — closing it and hiding it from the active thread list — or reopen an archived one.',
      'Use it to wrap up a finished discussion, or to bring an old thread back when the topic returns. It is fully REVERSIBLE: nothing is deleted and the whole message history stays readable, which makes it the safe alternative to DiscordDeleteChannel.',
      'threadId is the thread\'s numeric snowflake (from DiscordListChannels, which shows active threads). archived defaults to true; pass archived:false to reopen. Only an explicit false reopens — any other value archives.',
      'It affects threads only, not regular channels, and it does not stop people from posting: an archived thread reopens as soon as someone writes in it, so use DiscordLockThread when the thread must stay closed.',
    ].join(' '),
    parameters: Type.Object({
      threadId: Type.String({ description: 'Discord thread id (numeric snowflake) to archive or reopen — regular channels are not accepted' }),
      archived: Type.Optional(Type.Boolean({ description: 'true archives (closes) the thread, false reopens it — defaults to true' })),
    }),
    execute: async (_id, p) => {
      try {
        const archived = p.archived !== false;
        await adapter.rest('PATCH', `/channels/${encodeURIComponent(p.threadId)}`, { archived });
        return ok(`${archived ? 'Archived' : 'Reopened'} thread ${p.threadId}.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordLockThread', label: 'Lock Discord thread',
    description: [
      'Lock a Discord thread so that only moderators can still post in it, or unlock it again.',
      'Use it to stop a heated or finished discussion from continuing while keeping every message readable; it is REVERSIBLE and deletes nothing. Combine it with DiscordArchiveThread when the thread should also disappear from the active list — an archived but unlocked thread reopens the moment somebody writes in it.',
      'threadId is the thread\'s numeric snowflake. locked defaults to true; pass locked:false to unlock. Only an explicit false unlocks — any other value locks.',
      'It applies to threads only, not to regular channels: to silence a whole channel you need permission overwrites via DiscordApi. Requires an admin session and the MANAGE_THREADS permission.',
    ].join(' '),
    parameters: Type.Object({
      threadId: Type.String({ description: 'Discord thread id (numeric snowflake) to lock or unlock — regular channels are not accepted' }),
      locked: Type.Optional(Type.Boolean({ description: 'true locks the thread so only moderators can post, false unlocks it — defaults to true' })),
    }),
    execute: async (_id, p) => {
      try {
        const locked = p.locked !== false;
        await adapter.rest('PATCH', `/channels/${encodeURIComponent(p.threadId)}`, { locked });
        return ok(`${locked ? 'Locked' : 'Unlocked'} thread ${p.threadId}.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordAddThreadMember', label: 'Add Discord thread member',
    description: [
      'Add a guild member to a Discord thread so the thread shows up for them and they receive its notifications.',
      'Use it to pull the right people into a thread you just created with DiscordCreateThread, or when someone asks to be included in an ongoing discussion; DiscordRemoveThreadMember takes them back out.',
      'threadId is the thread\'s numeric snowflake and userId the member\'s — resolve a name to a user id with DiscordSearchMembers first.',
      'The person must already be a member of the guild and able to see the thread\'s parent channel, otherwise Discord answers with an HTTP error text; the thread must not be archived. This grants thread membership only, no roles or permissions.',
    ].join(' '),
    parameters: Type.Object({
      threadId: Type.String({ description: 'Discord thread id (numeric snowflake) to add the member to' }),
      userId: Type.String({ description: 'Discord user id (numeric snowflake) of the guild member to add — get it from DiscordSearchMembers' }),
    }),
    execute: async (_id, p) => {
      try {
        await adapter.rest('PUT', `/channels/${encodeURIComponent(p.threadId)}/thread-members/${encodeURIComponent(p.userId)}`);
        return ok(`Added member ${p.userId} to thread ${p.threadId}.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'DiscordRemoveThreadMember', label: 'Remove Discord thread member',
    description: [
      'Remove a member from a Discord thread, so it disappears from their thread list and stops notifying them.',
      'Use it when somebody was added to a thread by mistake or no longer needs to follow it; DiscordAddThreadMember is the inverse.',
      'threadId and userId are numeric snowflakes — DiscordSearchMembers resolves a name to a user id.',
      'This only ends thread membership: no message is deleted, the person keeps every role, and if the parent channel is public they can still read the thread and rejoin by posting in it. To really shut a thread down use DiscordLockThread. Requires an admin session and the MANAGE_THREADS permission for removing anyone other than the bot itself.',
    ].join(' '),
    parameters: Type.Object({
      threadId: Type.String({ description: 'Discord thread id (numeric snowflake) to remove the member from' }),
      userId: Type.String({ description: 'Discord user id (numeric snowflake) of the member to remove from the thread' }),
    }),
    execute: async (_id, p) => {
      try {
        await adapter.rest('DELETE', `/channels/${encodeURIComponent(p.threadId)}/thread-members/${encodeURIComponent(p.userId)}`);
        return ok(`Removed member ${p.userId} from thread ${p.threadId}.`);
      } catch (e) { return fail(e); }
    },
  }));
}
