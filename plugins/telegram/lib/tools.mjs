// Admin/owner-gated Telegram* tools: outbound messaging, chat/member inspection and group management.
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });
const fail = (e) => ok(`Error: ${e instanceof Error ? e.message : String(e)}`);

/** Coerce a chat id string into what the Bot API expects: a numeric id, or an `@channelusername`. */
function chat(v) {
  const s = String(v ?? '').trim();
  return /^-?\d+$/.test(s) ? Number(s) : s;
}

export function registerTools(ctx, adapter) {
  const adminGate = () => { if (!ctx.isAdminSession()) throw new Error('available only in an admin session'); };
  const ownerGate = (name) => { if (ctx.currentIdentity?.()?.owner !== true) throw new Error(`${name} is only available to the operator`); };
  const api = () => adapter.requireBot().api;

  // Send a message to any chat — OWNER only (it can message anyone the bot can reach).
  ctx.registerTool(defineTool({
    name: 'TelegramSend', label: 'Telegram send message',
    description: [
      'Send a plain-text Telegram message to any chat the bot can reach — a private conversation, a group, a supergroup or a channel — through the Bot API sendMessage method.',
      'Use it to notify someone on Telegram, post an update into a group or channel, or answer a person outside the current conversation; to reply inside the chat you are already talking in, just write your answer normally instead of calling this tool.',
      'chatId accepts a numeric user or chat id (e.g. 123456789), a negative supergroup or channel id (e.g. -1001234567890) or a public @channelusername, and text is sent as-is with no Markdown or HTML parse mode.',
      'OPERATOR ONLY: any other sender gets an error, because this tool can message anybody in the bot address book. It also fails when the bot is not configured or the bot was never allowed to write to that chat, and it returns only a short confirmation, not the sent message id — for the full sendMessage surface (parse mode, reply markup, threads) use TelegramApi.',
    ].join(' '),
    parameters: Type.Object({
      chatId: Type.String({ description: 'Target chat: numeric user/group/channel id (e.g. 123456789 or -1001234567890) or a public @channelusername' }),
      text: Type.String({ description: 'Message body, sent as plain text without any parse mode' }),
    }),
    execute: async (_id, p) => {
      try {
        ownerGate('TelegramSend');
        await api().sendMessage(chat(p.chatId), String(p.text ?? ''));
        return ok(`Sent to ${p.chatId}.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TelegramChatInfo', label: 'Telegram chat info',
    description: [
      'Read the profile of one Telegram chat through the Bot API getChat method and report its id, type (private, group, supergroup or channel), title, public @username, description and whether it is a forum with topics.',
      'Use it to confirm which group or channel an id actually points at before posting, renaming, moderating or creating a topic in it, and to learn whether topics are available at all.',
      'chatId is a numeric chat id or a public @channelusername; the bot must be a member of the chat (or the chat must be public) or the Bot API rejects the lookup.',
      'Read-only and safe to call. It does NOT list members or messages — use TelegramGetMembersCount for the member count, TelegramMemberInfo for one person, and note that the pinned message and photo are not included in the output.',
    ].join(' '),
    parameters: Type.Object({ chatId: Type.String({ description: 'Chat to inspect: numeric id or public @channelusername' }) }),
    execute: async (_id, p) => {
      try {
        adminGate();
        const c = await api().getChat(chat(p.chatId));
        const out = [`id: ${c.id}`, `type: ${c.type}`];
        if (c.title) out.push(`title: ${c.title}`);
        if (c.username) out.push(`username: @${c.username}`);
        if (c.description) out.push(`description: ${c.description}`);
        if (c.is_forum) out.push('forum: true');
        return ok(out.join('\n'));
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TelegramGetMembersCount', label: 'Telegram member count',
    description: [
      'Report how many members a Telegram group, supergroup or channel currently has, using the Bot API getChatMemberCount method.',
      'Use it when someone asks how big a group or channel is, or to sanity-check audience size before broadcasting a message there.',
      'chatId is a numeric chat id or a public @channelusername, and the bot has to be a member of that chat for the count to be readable.',
      'Read-only and safe. It returns a single number and NOT the list of participants — the Telegram Bot API cannot enumerate members, so use TelegramMemberInfo to check one specific user id instead.',
    ].join(' '),
    parameters: Type.Object({ chatId: Type.String({ description: 'Group, supergroup or channel: numeric id or public @channelusername' }) }),
    execute: async (_id, p) => {
      try {
        adminGate();
        const n = await api().getChatMemberCount(chat(p.chatId));
        return ok(`members: ${n}`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TelegramMemberInfo', label: 'Telegram member info',
    description: [
      'Look up one participant of a Telegram chat by numeric user id via the Bot API getChatMember method and report their id, first and last name, @username and membership status (creator, administrator, member, restricted, left or kicked).',
      'Use it to verify that a person is really in a group, to check whether they are an admin or already banned, or to resolve a user id to a name before mentioning them.',
      'chatId is a numeric chat id or a public @channelusername and userId must be the numeric Telegram user id — a phone number or an @username of a private person will not work here.',
      'Read-only and safe to call. The status field is the only permission signal returned: the detailed can_* administrator rights are NOT included, so fetch them with TelegramApi (getChatMember) if you need the exact rights.',
    ].join(' '),
    parameters: Type.Object({
      chatId: Type.String({ description: 'Chat the person belongs to: numeric id or public @channelusername' }),
      userId: Type.Number({ description: 'Numeric Telegram user id of the member, e.g. 123456789' }),
    }),
    execute: async (_id, p) => {
      try {
        adminGate();
        const m = await api().getChatMember(chat(p.chatId), Number(p.userId));
        const u = m.user ?? {};
        return ok([
          `id: ${u.id}`, `name: ${[u.first_name, u.last_name].filter(Boolean).join(' ')}`,
          u.username ? `username: @${u.username}` : null, `status: ${m.status}`,
        ].filter(Boolean).join('\n'));
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TelegramPinMessage', label: 'Pin Telegram message',
    description: [
      'Pin an existing message to the top of a Telegram group, supergroup or channel so every member sees it, using the Bot API pinChatMessage method.',
      'Use it to highlight an announcement, rules or a link that people keep asking about; to take a pin down again use TelegramUnpinMessage, which leaves the message itself in place.',
      'chatId is a numeric chat id or a public @channelusername and messageId is the numeric id of the message inside that chat — message ids are per-chat, so an id from another chat will not resolve.',
      'The bot must be an administrator with the can_pin_messages right, otherwise the Bot API refuses the call. Pinning notifies the members of the chat, so it is visible to everyone, though it is fully reversible.',
    ].join(' '),
    parameters: Type.Object({
      chatId: Type.String({ description: 'Chat holding the message: numeric id or public @channelusername' }),
      messageId: Type.Number({ description: 'Numeric id of the message to pin, as it exists in that chat' }),
    }),
    execute: async (_id, p) => {
      try { adminGate(); await api().pinChatMessage(chat(p.chatId), Number(p.messageId)); return ok(`Pinned message ${p.messageId}.`); }
      catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TelegramUnpinMessage', label: 'Unpin Telegram message',
    description: [
      'Remove one pinned message from the top of a Telegram group, supergroup or channel through the Bot API unpinChatMessage method.',
      'Use it when a pinned announcement is out of date; to pin something new instead use TelegramPinMessage, and to actually erase the message from the chat use TelegramDeleteMessage.',
      'chatId is a numeric chat id or a public @channelusername and messageId is the numeric id of the pinned message inside that chat.',
      'The bot must be an administrator with the can_pin_messages right. This only clears the pin: the message stays in the history and can be pinned again, so nothing is destroyed.',
    ].join(' '),
    parameters: Type.Object({
      chatId: Type.String({ description: 'Chat holding the pinned message: numeric id or public @channelusername' }),
      messageId: Type.Number({ description: 'Numeric id of the pinned message to unpin' }),
    }),
    execute: async (_id, p) => {
      try { adminGate(); await api().unpinChatMessage(chat(p.chatId), Number(p.messageId)); return ok(`Unpinned message ${p.messageId}.`); }
      catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TelegramDeleteMessage', label: 'Delete Telegram message',
    description: [
      'DESTRUCTIVE AND IRREVERSIBLE: permanently delete one message from a Telegram chat for everyone, using the Bot API deleteMessage method.',
      'Use it only when someone explicitly asks to remove a specific message, for example a wrong post or leaked content; if the goal is merely to stop highlighting it, use TelegramUnpinMessage instead, which keeps the message.',
      'chatId is a numeric chat id or a public @channelusername and messageId is the numeric id of that single message — there is no bulk or range delete here, one call removes exactly one message.',
      'The bot can always delete its own messages, but to delete somebody else message it must be an administrator with the can_delete_messages right, and Telegram refuses messages older than 48 hours in many chat types. Deleted content cannot be restored, so confirm the exact message id before calling.',
    ].join(' '),
    parameters: Type.Object({
      chatId: Type.String({ description: 'Chat holding the message: numeric id or public @channelusername' }),
      messageId: Type.Number({ description: 'Numeric id of the single message to delete permanently' }),
    }),
    execute: async (_id, p) => {
      try { adminGate(); await api().deleteMessage(chat(p.chatId), Number(p.messageId)); return ok(`Deleted message ${p.messageId}.`); }
      catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TelegramBanMember', label: 'Ban Telegram member',
    description: [
      'DESTRUCTIVE: ban a user from a Telegram group, supergroup or channel through the Bot API banChatMember method, which kicks them out and blocks them from coming back.',
      'Use it for moderation against spammers or abusive members when the operator asks for it; a ban is heavier than a mute, so if the intent is only to silence someone temporarily, use TelegramApi with restrictChatMember instead.',
      'chatId is a numeric chat id or a public @channelusername and userId is the numeric Telegram user id of the person to remove — check them first with TelegramMemberInfo so you ban the right account.',
      'The bot must be an administrator with the can_restrict_members right. The ban is permanent until it is lifted with TelegramUnbanMember, and in supergroups it also removes the user from the member list, so treat it as a high-impact action and confirm the target before calling.',
    ].join(' '),
    parameters: Type.Object({
      chatId: Type.String({ description: 'Group, supergroup or channel to ban from: numeric id or public @channelusername' }),
      userId: Type.Number({ description: 'Numeric Telegram user id of the person to ban' }),
    }),
    execute: async (_id, p) => {
      try { adminGate(); await api().banChatMember(chat(p.chatId), Number(p.userId)); return ok(`Banned member ${p.userId}.`); }
      catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TelegramUnbanMember', label: 'Unban Telegram member',
    description: [
      'Lift an existing ban on a Telegram user via the Bot API unbanChatMember method, so the person is allowed to join the group, supergroup or channel again.',
      'Use it to reverse a moderation decision made with TelegramBanMember or to clean up an old ban list entry.',
      'chatId is a numeric chat id or a public @channelusername and userId is the numeric Telegram user id that was banned.',
      'The bot must be an administrator with the can_restrict_members right. Unbanning does NOT re-add the person to the chat — it only removes the block, so they still have to join again through an invite link or the public username.',
    ].join(' '),
    parameters: Type.Object({
      chatId: Type.String({ description: 'Group, supergroup or channel the ban applies to: numeric id or public @channelusername' }),
      userId: Type.Number({ description: 'Numeric Telegram user id of the banned person to unban' }),
    }),
    execute: async (_id, p) => {
      try { adminGate(); await api().unbanChatMember(chat(p.chatId), Number(p.userId)); return ok(`Unbanned member ${p.userId}.`); }
      catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TelegramPromoteMember', label: 'Promote Telegram member',
    description: [
      'Change the administrator rights of a member in a Telegram group, supergroup or channel through the Bot API promoteChatMember method — this both promotes a normal member to admin and demotes an existing admin.',
      'Use it when the operator wants somebody to be able to moderate, pin, invite or manage topics; to remove a person from the chat entirely use TelegramBanMember instead, and to see what somebody is today use TelegramMemberInfo.',
      'Each canXxx flag maps to one Telegram right (can_manage_chat, can_delete_messages, can_restrict_members, can_promote_members, can_change_info, can_invite_users, can_pin_messages, can_manage_topics): pass true for every right you want granted, and note that the call is absolute rather than additive — any flag you omit or set to false is taken away, and sending all of them false demotes the person back to an ordinary member.',
      'PRIVILEGE-CHANGING AND EASY TO GET WRONG: the bot must be an administrator with can_promote_members, it can only grant rights it holds itself, and it cannot touch the chat creator. Always send the complete set of rights the person should keep, otherwise you silently strip the rest.',
    ].join(' '),
    parameters: Type.Object({
      chatId: Type.String({ description: 'Group, supergroup or channel: numeric id or public @channelusername' }),
      userId: Type.Number({ description: 'Numeric Telegram user id of the member to promote or demote' }),
      canManageChat: Type.Optional(Type.Boolean({ description: 'Grant can_manage_chat: access the admin panel and chat statistics' })),
      canDeleteMessages: Type.Optional(Type.Boolean({ description: 'Grant can_delete_messages: delete messages posted by other members' })),
      canRestrictMembers: Type.Optional(Type.Boolean({ description: 'Grant can_restrict_members: mute, kick and ban members' })),
      canPromoteMembers: Type.Optional(Type.Boolean({ description: 'Grant can_promote_members: make other members administrators' })),
      canChangeInfo: Type.Optional(Type.Boolean({ description: 'Grant can_change_info: edit the chat title, description and photo' })),
      canInviteUsers: Type.Optional(Type.Boolean({ description: 'Grant can_invite_users: add members and create invite links' })),
      canPinMessages: Type.Optional(Type.Boolean({ description: 'Grant can_pin_messages: pin and unpin messages in the chat' })),
      canManageTopics: Type.Optional(Type.Boolean({ description: 'Grant can_manage_topics: create, rename, close and reopen forum topics' })),
    }),
    execute: async (_id, p) => {
      try {
        adminGate();
        await api().promoteChatMember(chat(p.chatId), Number(p.userId), {
          can_manage_chat: p.canManageChat, can_delete_messages: p.canDeleteMessages,
          can_restrict_members: p.canRestrictMembers, can_promote_members: p.canPromoteMembers,
          can_change_info: p.canChangeInfo, can_invite_users: p.canInviteUsers,
          can_pin_messages: p.canPinMessages, can_manage_topics: p.canManageTopics,
        });
        return ok(`Updated admin rights for member ${p.userId}.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TelegramSetChatTitle', label: 'Set Telegram chat title',
    description: [
      'Rename a Telegram group, supergroup or channel by setting a new title through the Bot API setChatTitle method.',
      'Use it when the operator asks to rename a chat; for the longer descriptive text under the name use TelegramSetChatDescription instead, and to check the current title first use TelegramChatInfo.',
      'chatId is a numeric chat id or a public @channelusername and title is the new display name, limited by Telegram to 128 characters.',
      'The bot must be an administrator with the can_change_info right. The rename is visible to every member and posts a service message into the chat; it overwrites the previous title, so read it first if you may need to restore it.',
    ].join(' '),
    parameters: Type.Object({
      chatId: Type.String({ description: 'Group, supergroup or channel to rename: numeric id or public @channelusername' }),
      title: Type.String({ description: 'New chat title, at most 128 characters' }),
    }),
    execute: async (_id, p) => {
      try { adminGate(); await api().setChatTitle(chat(p.chatId), String(p.title)); return ok(`Set title to "${p.title}".`); }
      catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TelegramSetChatDescription', label: 'Set Telegram chat description',
    description: [
      'Set the description (the "about" text shown in the chat profile) of a Telegram group, supergroup or channel via the Bot API setChatDescription method.',
      'Use it to document what a group is for or to publish rules and links in the profile; to change the name itself use TelegramSetChatTitle, and to read the current description use TelegramChatInfo.',
      'chatId is a numeric chat id or a public @channelusername and description is the new text, limited by Telegram to 255 characters; passing an empty string clears the description entirely.',
      'The bot must be an administrator with the can_change_info right. The new text replaces the old one with no history kept, so read the current value first if you might need to put it back.',
    ].join(' '),
    parameters: Type.Object({
      chatId: Type.String({ description: 'Group, supergroup or channel: numeric id or public @channelusername' }),
      description: Type.String({ description: 'New description text, at most 255 characters; an empty string clears it' }),
    }),
    execute: async (_id, p) => {
      try { adminGate(); await api().setChatDescription(chat(p.chatId), String(p.description ?? '')); return ok('Set chat description.'); }
      catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TelegramCreateForumTopic', label: 'Create Telegram forum topic',
    description: [
      'Create a new forum topic (a named thread) inside a Telegram supergroup that has topics enabled, using the Bot API createForumTopic method.',
      'Use it to open a dedicated thread for a project, an incident or a recurring subject; to rename an existing topic use TelegramEditForumTopic and to archive one use TelegramCloseForumTopic.',
      'chatId is a numeric supergroup id or a public @channelusername and name is the topic title; the reply reports the created topic together with its message_thread_id, which is the id you pass to the other topic tools and to sending into that thread.',
      'The bot must be an administrator with the can_manage_topics right and the supergroup must actually be a forum — check the "forum: true" line in TelegramChatInfo first, because a normal group rejects the call.',
    ].join(' '),
    parameters: Type.Object({
      chatId: Type.String({ description: 'Forum-enabled supergroup: numeric id or public @channelusername' }),
      name: Type.String({ description: 'Title of the new topic, e.g. "Deployments"' }),
    }),
    execute: async (_id, p) => {
      try {
        adminGate();
        const t = await api().createForumTopic(chat(p.chatId), String(p.name));
        return ok(`Created topic "${t.name}" (thread ${t.message_thread_id}).`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TelegramEditForumTopic', label: 'Edit Telegram forum topic',
    description: [
      'Rename an existing forum topic in a Telegram forum-enabled supergroup through the Bot API editForumTopic method.',
      'Use it when a thread outgrew its original title; to create a new topic use TelegramCreateForumTopic, and to close or reopen one use TelegramCloseForumTopic.',
      'chatId is a numeric supergroup id or a public @channelusername, threadId is the message_thread_id of the topic (returned when the topic was created, or visible in a message from that thread) and name is the new title.',
      'The bot must be an administrator with the can_manage_topics right. Only the name is changed here — the topic icon is left untouched — and the rename is announced in the thread, so it is visible to all members.',
    ].join(' '),
    parameters: Type.Object({
      chatId: Type.String({ description: 'Forum-enabled supergroup: numeric id or public @channelusername' }),
      threadId: Type.Number({ description: 'message_thread_id of the topic to rename' }),
      name: Type.String({ description: 'New topic title' }),
    }),
    execute: async (_id, p) => {
      try { adminGate(); await api().editForumTopic(chat(p.chatId), Number(p.threadId), { name: String(p.name) }); return ok(`Renamed topic ${p.threadId} to "${p.name}".`); }
      catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'TelegramCloseForumTopic', label: 'Close Telegram forum topic',
    description: [
      'Close or reopen a forum topic in a Telegram forum-enabled supergroup, calling the Bot API closeForumTopic or reopenForumTopic method depending on the flag.',
      'Use it to archive a finished thread so nobody can post in it any more, or to bring a closed thread back to life; to rename a topic use TelegramEditForumTopic and to start a new one use TelegramCreateForumTopic.',
      'chatId is a numeric supergroup id or a public @channelusername and threadId is the message_thread_id of the topic; closed defaults to true (close the topic) and closed:false reopens it.',
      'The bot must be an administrator with the can_manage_topics right. Closing is fully reversible and deletes nothing: the messages stay readable, members simply cannot post there while the topic is closed.',
    ].join(' '),
    parameters: Type.Object({
      chatId: Type.String({ description: 'Forum-enabled supergroup: numeric id or public @channelusername' }),
      threadId: Type.Number({ description: 'message_thread_id of the topic to close or reopen' }),
      closed: Type.Optional(Type.Boolean({ description: 'true (default) closes the topic; false reopens it' })),
    }),
    execute: async (_id, p) => {
      try {
        adminGate();
        const close = p.closed !== false;
        if (close) await api().closeForumTopic(chat(p.chatId), Number(p.threadId));
        else await api().reopenForumTopic(chat(p.chatId), Number(p.threadId));
        return ok(`${close ? 'Closed' : 'Reopened'} topic ${p.threadId}.`);
      } catch (e) { return fail(e); }
    },
  }));

  // Raw Bot API access for the OWNER: any method the bot token can call. Operator only.
  ctx.registerTool(defineTool({
    name: 'TelegramApi', label: 'Telegram Bot API',
    description: [
      'Call any raw Telegram Bot API method by name with a JSON parameter object — the full bot surface, including methods that have no dedicated tool here: restrictChatMember, exportChatInviteLink, sendPhoto, sendDocument, forwardMessage, editMessageText, getUpdates, setMyCommands and the rest.',
      'Use it as the escape hatch when the focused tools are not enough, for example to mute somebody temporarily, send formatted or media messages, or read fields that TelegramChatInfo and TelegramMemberInfo do not print; for ordinary sending, chat inspection and moderation prefer the dedicated Telegram* tools, which validate the arguments for you.',
      'method is the Bot API method name in camelCase exactly as documented (e.g. "sendMessage", "getChat", "restrictChatMember") and params is a JSON string of that method own parameters using snake_case keys, e.g. {"chat_id":-1001234567890,"text":"hi","parse_mode":"HTML"}; an unknown method name or malformed JSON is refused with an error instead of being sent.',
      'OPERATOR ONLY and effectively unrestricted: it can send, edit, delete, ban and reconfigure anything the bot token is allowed to touch, with no extra confirmation, so treat destructive methods with the same care as the dedicated tools. The reply is the raw JSON response pretty-printed and truncated after 4000 characters.',
    ].join(' '),
    parameters: Type.Object({
      method: Type.String({ description: 'Bot API method name in camelCase, e.g. "sendMessage", "getChat" or "restrictChatMember"' }),
      params: Type.Optional(Type.String({ description: 'JSON object of the method parameters with snake_case keys, e.g. {"chat_id":123,"text":"hi"}' })),
    }),
    execute: async (_id, p) => {
      try {
        ownerGate('TelegramApi');
        let params;
        if (p.params) {
          try { params = JSON.parse(p.params); } catch { return ok('Error: params is not valid JSON.'); }
        }
        const res = await adapter.callApi(p.method, params);
        const text = res === undefined || res === null ? '(no content)' : JSON.stringify(res, null, 2);
        return ok(text.length > 4000 ? `${text.slice(0, 4000)}\n… (truncated)` : text);
      } catch (e) { return fail(e); }
    },
  }));
}
