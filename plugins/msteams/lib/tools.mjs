// Teams tools: outbound messaging, conversation/member inspection and raw connector access. All of them ride the Bot Connector API only — no Graph permissions involved,
// except TeamsMessagePerson's optional last resort, which stays behind a config switch that is off.
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { personLine } from './directory.mjs';

const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });
const fail = (e) => ok(`Error: ${e instanceof Error ? e.message : String(e)}`);

const memberLine = (m) => [
  `id: ${m?.id ?? '?'}`,
  m?.aadObjectId ? `aadObjectId: ${m.aadObjectId}` : null,
  m?.name ? `name: ${m.name}` : null,
  m?.userPrincipalName || m?.email ? `upn: ${m.userPrincipalName || m.email}` : null,
].filter(Boolean).join(' · ');

export function registerTools(ctx, adapter) {
  // Send a message into any conversation the bot can reach.
  ctx.registerTool(defineTool({
    name: 'TeamsSend', label: 'Teams send message',
    description: [
      'Post a message into a Microsoft Teams conversation — a channel, a group chat or a 1:1 chat — addressed by its conversation id, which means a conversation the bot already participates in and has seen.',
      'Use it to write, reply or notify in a Teams chat you already have the id for; get ids from TeamsListConversations or TeamsChatInfo. If you only know WHO you want to reach and have no conversation id, use TeamsMessagePerson instead, which opens the 1:1 chat itself. To attach a file rather than text, use TeamsSendFile.',
      'The text is sent as markdown; to notify a participant write "<@id>" (or their e-mail, or their exact display name) and it is converted into a real Teams mention — TeamsMembers lists the ids. A long message may be split into several Teams messages.',
      'This posts immediately and visibly to real people and cannot be unsent, so confirm the recipient before calling it. It works only through the Bot Connector API — the bot must already be in that conversation.',
    ].join(' '),
    parameters: Type.Object({
      conversationId: Type.String({ description: 'Teams conversation id of the target channel or chat, e.g. "19:…@thread.tacv2" for a channel/group or "a:…" for a 1:1 chat' }),
      text: Type.String({ description: 'The message body, in markdown. Mention someone with "<@id>", their e-mail or their exact display name.' }),
    }),
    execute: async (_id, p) => {
      try {
        adapter.requireServiceUrl(String(p.conversationId));
        await adapter.send(String(p.conversationId), String(p.text ?? ''));
        return ok(`Sent to ${p.conversationId}.`);
      } catch (e) { return fail(e); }
    },
  }));

  // Write to a person even when the bot has no existing conversation id for them.
  ctx.registerTool(defineTool({
    name: 'TeamsMessagePerson', label: 'Teams message a person',
    description: [
      'Send a Microsoft Teams message straight to a PERSON — a colleague, a team member — identified by e-mail/UPN, Entra object id, "29:…" account id or display name, with no conversation id needed, because the bot opens or reuses their private 1:1 chat itself.',
      'This is the tool for a request like "tell Michal the build broke" or "let Petra know the report is ready". Use TeamsSend instead when you already have the conversation id, or when the message belongs in a channel or group chat rather than a direct message; use TeamsSendFile to hand over a file.',
      'Name the recipient with exactly one of email, aadObjectId, userId or name — at least one is required. A display name that matches several people is refused with the candidates listed rather than guessed, so resolve it with TeamsFindPerson first when you are unsure who is meant. The text is markdown.',
      'Delivery may go through the recipient own Elowen agent when their account is mapped, otherwise it is sent as a plain direct message; the result says which path was taken and reports partial delivery when Teams accepted only some parts. An unsolicited direct message reaches a real person immediately and cannot be recalled.',
    ].join(' '),
    parameters: Type.Object({
      text: Type.String({ description: 'The message body, in markdown, as the recipient will read it' }),
      email: Type.Optional(Type.String({ description: 'Recipient e-mail address / Teams UPN, e.g. "michal@firma.cz" — the most reliable identifier' })),
      aadObjectId: Type.Optional(Type.String({ description: 'Recipient Entra (Azure AD) object id, a GUID' })),
      userId: Type.Optional(Type.String({ description: 'Recipient Teams account id, starting with "29:"' })),
      name: Type.Optional(Type.String({ description: 'Recipient display name, e.g. "Michal Novák" — must match exactly one known person, otherwise the send is refused' })),
    }),
    execute: async (_id, p) => {
      try {
        const target = {
          email: p.email ? String(p.email) : undefined,
          aadObjectId: p.aadObjectId ? String(p.aadObjectId) : undefined,
          userId: p.userId ? String(p.userId) : undefined,
          name: p.name ? String(p.name) : undefined,
        };
        if (!target.email && !target.aadObjectId && !target.userId && !target.name) {
          return ok('Error: name the recipient with one of email, aadObjectId, userId or name.');
        }
        const identity = ctx.currentIdentity?.();
        const sender = identity?.elowenUsername || identity?.userId || 'another Elowen agent';
        const { person, conversationId, relay, delivery, deliveredParts, totalParts } = await adapter.messagePerson(target, String(p.text ?? ''), {
          relay: { sender, senderUserId: identity?.elowenUserId },
        });
        const recipient = person.name || person.upn || person.aad || person.id;
        if (delivery === 'agent') return ok(`Delivered to ${recipient} through the recipient’s Elowen agent (chat ${conversationId}).`);
        if (delivery === 'partial') return ok(`The recipient agent ran for ${recipient}, but its Teams reply was incomplete: ${relay.error}`);
        if (delivery === 'direct-partial') return ok(`Teams accepted only ${deliveredParts} of ${totalParts} direct message parts for ${recipient} (chat ${conversationId}); the message was not recorded as fully delivered.`);
        const fallback = relay?.error
          ? ` The recipient agent handoff failed before delivering a reply, so the original message was sent directly: ${relay.error}`
          : relay?.sameAccount
            ? ' The recipient uses the same Elowen account, so the message was sent directly without another agent wake.'
            : relay?.woken
              ? ' The recipient agent produced no reply, so the original message was sent directly.'
              : ' No mapped recipient Elowen account was available, so the message was sent directly.';
        return ok(`Sent to ${recipient} (chat ${conversationId}).${fallback}`);
      } catch (e) { return fail(e); }
    },
  }));

  // Read-only counterpart: check WHO you would be writing to before writing to them.
  ctx.registerTool(defineTool({
    name: 'TeamsFindPerson', label: 'Teams find person',
    description: [
      'Search the people the bot knows in Microsoft Teams and can message proactively, matching on e-mail/UPN, Entra object id, "29:…" account id or part of a display name.',
      'Use it to find a colleague contact details or account id, to check whether a person is reachable at all, and above all to confirm WHO you are about to write to before calling TeamsMessagePerson or TeamsSendFile — a display name matching several people is refused by those tools, and this is how you resolve the ambiguity.',
      'It is read-only: it sends nothing and notifies nobody, so it is always safe to call first. Each match shows the identifiers you can address the person by and whether a 1:1 chat with them is already open.',
      'The directory only covers people the bot has actually seen, mostly through conversation rosters, so someone missing here may still exist in the tenant — reading a channel roster with TeamsMembers teaches the bot about its members. At most 25 matches are shown.',
    ].join(' '),
    parameters: Type.Object({
      query: Type.String({ description: 'What to search for: an e-mail/UPN, an Entra object id, a "29:…" account id, or a full or partial display name such as "Novák"' }),
    }),
    execute: async (_id, p) => {
      try {
        const query = String(p.query ?? '').trim();
        if (!query) return ok('Error: give something to look for.');
        const found = await adapter.lookupPeople(query);
        if (!found.length) return ok(adapter.unknownPersonHelp(query));
        const lines = found.slice(0, 25).map((person) => `· ${personLine(person)}`);
        if (found.length > 25) lines.push(`… and ${found.length - 25} more`);
        return ok(`${found.length === 1 ? 'One match' : `${found.length} matches`} for "${query}":\n${lines.join('\n')}`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TeamsChatInfo', label: 'Teams chat info',
    description: [
      'Show what a Microsoft Teams conversation actually is: its id, its type (channel, group chat or 1:1 chat), the tenant it belongs to and how many members it has.',
      'Use it to check where a conversation id points before posting into it with TeamsSend, or to tell apart a private chat from a public channel. For the list of members with their names and ids use TeamsMembers, and to discover which conversations exist at all use TeamsListConversations.',
      'It is read-only and posts nothing. It works only for conversations the bot participates in, and the type shows as "unknown" when the bot has not yet observed enough about that chat.',
    ].join(' '),
    parameters: Type.Object({ conversationId: Type.String({ description: 'Teams conversation id to inspect, e.g. "19:…@thread.tacv2" (channel or group) or "a:…" (1:1 chat)' }) }),
    execute: async (_id, p) => {
      try {
        const id = String(p.conversationId);
        const ref = adapter.state.get(id).ref ?? {};
        const members = await adapter.readRoster(id);
        return ok([
          `id: ${id}`,
          `type: ${ref.conversationType ?? 'unknown'}`,
          ref.tenantId ? `tenant: ${ref.tenantId}` : null,
          `members: ${members.length}`,
        ].filter(Boolean).join('\n'));
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TeamsMembers', label: 'Teams members',
    description: [
      'Read the roster of a Microsoft Teams conversation: who is in that channel, group chat or team, with each member display name, "29:…" account id, Entra object id and UPN/e-mail.',
      'Use it to answer who is in a channel, to find the id of a specific participant, or to gather the people you need before writing to them. To notify one of them, write "<@id>" — or their e-mail, or their exact display name — in your reply and it becomes a real Teams mention. For details of a single known member use TeamsMemberInfo; to search people across conversations use TeamsFindPerson.',
      'Reading a roster has a useful side effect: it teaches the bot who these people are, so afterwards they can be written to directly with TeamsMessagePerson even without a conversation id. Nothing is posted into the conversation itself.',
      'The listing is capped at 50 members, with the remainder reported as a count, and it only works for conversations the bot participates in.',
    ].join(' '),
    parameters: Type.Object({ conversationId: Type.String({ description: 'Teams conversation id whose members to list, e.g. "19:…@thread.tacv2"' }) }),
    execute: async (_id, p) => {
      try {
        const id = String(p.conversationId);
        const list = await adapter.readRoster(id);
        const lines = list.slice(0, 50).map(memberLine);
        if (list.length > 50) lines.push(`… and ${list.length - 50} more`);
        return ok(lines.join('\n') || '(no members)');
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TeamsMemberInfo', label: 'Teams member info',
    description: [
      'Look up one specific member of a Microsoft Teams conversation by their id and return their identity details: display name, "29:…" account id, Entra object id and UPN/e-mail.',
      'Use it when you already know both the conversation and the person id and want to confirm exactly who that is — for example to verify a mention target or to resolve an id seen in a roster into a real name. To list everyone instead, use TeamsMembers; to search for a person you cannot name precisely, use TeamsFindPerson.',
      'Both ids are required: the member is looked up within that one conversation, so an id from a different chat will not resolve. It is read-only and sends nothing.',
    ].join(' '),
    parameters: Type.Object({
      conversationId: Type.String({ description: 'Teams conversation id the member belongs to, e.g. "19:…@thread.tacv2"' }),
      userId: Type.String({ description: 'The member Teams account id (starting with "29:") or their Entra object id (a GUID)' }),
    }),
    execute: async (_id, p) => {
      try {
        const id = String(p.conversationId);
        const m = await adapter.connector.member(adapter.requireServiceUrl(id), id, String(p.userId));
        return ok(memberLine(m));
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TeamsListConversations', label: 'Teams conversations',
    description: [
      'List the Microsoft Teams conversations the bot is part of on the current Teams service host, giving the conversation id and, where Teams reports it, the member count for each.',
      'Use it to discover which channels and chats are reachable and to obtain a conversation id you can then pass to TeamsSend, TeamsChatInfo or TeamsMembers. It is the starting point when the user talks about a chat by name and you have no id for it yet.',
      'Results are paged: when more conversations exist, the output ends with a continuationToken — call the tool again passing that token to fetch the next page. Without a token you get the first page.',
      'The listing shows raw ids and counts, not conversation titles or message content, so use TeamsChatInfo to see what a given id actually is. It is read-only and covers only the current service host.',
    ].join(' '),
    parameters: Type.Object({
      continuationToken: Type.Optional(Type.String({ description: 'Paging token returned at the end of a previous page; omit it to get the first page' })),
    }),
    execute: async (_id, p) => {
      try {
        const out = await adapter.callApi('GET', p.continuationToken
          ? `/v3/conversations?continuationToken=${encodeURIComponent(p.continuationToken)}`
          : '/v3/conversations');
        const list = Array.isArray(out?.conversations) ? out.conversations : [];
        const lines = list.map((c) => `${c.id}${Array.isArray(c.members) ? ` · ${c.members.length} members` : ''}`);
        if (out?.continuationToken) lines.push(`(more — continuationToken: ${out.continuationToken})`);
        return ok(lines.join('\n') || '(no conversations)');
      } catch (e) { return fail(e); }
    },
  }));

  // Hand a file to a person in a private chat.
  ctx.registerTool(defineTool({
    name: 'TeamsSendFile', label: 'Teams send a file',
    description: [
      'Send a file — a document, report, export, screenshot or attachment from disk — to a PERSON in their private 1:1 Microsoft Teams chat, addressing them by e-mail/UPN, Entra object id, "29:…" account id or display name.',
      'Use it to hand somebody an actual file rather than text; for a plain message use TeamsMessagePerson or TeamsSend. The recipient is named with at least one of email, aadObjectId, userId or name, exactly as in TeamsMessagePerson, and a display name must match exactly one known person — check with TeamsFindPerson when unsure. The `path` must be an absolute path to a readable local file, and `description` is the one line shown on the offer, defaulting to the file name.',
      'Teams never pushes a file silently: the recipient first sees a consent card and the upload into their OneDrive happens only when they accept. The tool therefore returns as soon as the offer is posted, and a successful result means the offer was delivered, NOT that the file has arrived or was accepted.',
      'Files cannot be sent into a channel or a group chat — that is a Teams limitation, so post a link there instead. The offer reaches a real person and cannot be withdrawn.',
    ].join(' '),
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute path of the local file to send, e.g. "/var/www/reports/august.pdf" — it must exist and be readable' }),
      email: Type.Optional(Type.String({ description: 'Recipient e-mail address / Teams UPN' })),
      aadObjectId: Type.Optional(Type.String({ description: 'Recipient Entra (Azure AD) object id, a GUID' })),
      userId: Type.Optional(Type.String({ description: 'Recipient Teams account id, starting with "29:"' })),
      name: Type.Optional(Type.String({ description: 'Recipient display name — must match exactly one known person, otherwise the send is refused' })),
      description: Type.Optional(Type.String({ description: 'One line shown to the recipient on the consent card, e.g. "Monthly report for August"; defaults to the file name' })),
    }),
    execute: async (_id, p) => {
      try {
        const target = {
          email: p.email ? String(p.email) : undefined,
          aadObjectId: p.aadObjectId ? String(p.aadObjectId) : undefined,
          userId: p.userId ? String(p.userId) : undefined,
          name: p.name ? String(p.name) : undefined,
        };
        if (!target.email && !target.aadObjectId && !target.userId && !target.name) {
          return ok('Error: name the recipient with one of email, aadObjectId, userId or name.');
        }
        const filePath = String(p.path);
        if (!isAbsolute(filePath)) return ok('Error: give an absolute path.');
        let data;
        try { data = await readFile(filePath); } catch (e) { return ok(`Error: cannot read ${filePath}: ${e?.message ?? e}`); }
        const person = await adapter.findPerson(target);
        const conversationId = await adapter.conversationForPerson(person);
        await adapter.offerFile(conversationId, basename(filePath), data, p.description ? String(p.description) : undefined);
        return ok(`Offered ${basename(filePath)} (${data.length} bytes) to ${person.name || person.upn || person.aad || person.id}; it uploads once they accept.`);
      } catch (e) { return fail(e); }
    },
  }));

  // Raw Bot Connector access: any method+path the bot credentials can call.
  ctx.registerTool(defineTool({
    name: 'TeamsApi', label: 'Teams Bot Connector API',
    description: [
      'Call the Microsoft Bot Connector REST API directly with an HTTP method, a connector path such as "/v3/conversations/{id}/members" and an optional JSON body, exposing the full connector surface behind the Teams integration.',
      'This is the escape hatch for endpoints no dedicated tool covers. Do not reach for it for ordinary work: sending a message is TeamsSend or TeamsMessagePerson, rosters are TeamsMembers, conversation discovery is TeamsListConversations — those apply the right validation, while this one does not.',
      'The `path` is relative to the current Teams service host, which is supplied automatically. `body` must be a valid JSON string and is rejected outright if it is not; it is sent as the request body for POST and PUT.',
      'Responses are returned as pretty-printed JSON and truncated after 4000 characters.',
    ].join(' '),
    parameters: Type.Object({
      method: Type.String({ description: 'HTTP method to use: GET, POST, PUT or DELETE' }),
      path: Type.String({ description: 'Connector path relative to the service host, e.g. "/v3/conversations" or "/v3/conversations/{id}/members"' }),
      body: Type.Optional(Type.String({ description: 'Request body as a JSON string, e.g. {"type":"message","text":"hi"} — invalid JSON is refused' })),
    }),
    execute: async (_id, p) => {
      try {
        let body;
        if (p.body) {
          try { body = JSON.parse(p.body); } catch { return ok('Error: body is not valid JSON.'); }
        }
        const res = await adapter.callApi(String(p.method), String(p.path), body);
        const text = res === undefined || res === null ? '(no content)' : JSON.stringify(res, null, 2);
        return ok(text.length > 4000 ? `${text.slice(0, 4000)}\n… (truncated)` : text);
      } catch (e) { return fail(e); }
    },
  }));
}
