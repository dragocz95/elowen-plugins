// Admin/owner-gated Whatsapp* tools: outbound messaging and group management.
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { toJid } from './jid.mjs';

const ok = (text) => ({ content: [{ type: 'text', text }], details: {} });
const fail = (e) => ok(`Error: ${e instanceof Error ? e.message : String(e)}`);

export function registerTools(ctx, adapter) {
  const adminGate = () => { if (!ctx.isAdminSession()) throw new Error('available only in an admin session'); };

  // Send a message to any chat — OWNER only (it can message anyone the account can reach).
  ctx.registerTool(defineTool({
    name: 'WhatsappSend', label: 'WhatsApp send message',
    description: [
      'Send a plain-text WhatsApp message from the linked WhatsApp account to any contact or group, whether or not that conversation is the one you are currently in.',
      'Use it to notify a person on their phone number, to post an update into a WhatsApp group, or to reach somebody outside this conversation; to answer inside the chat you are already talking in, simply write your reply instead of calling this tool.',
      'The to parameter accepts a phone number in international format without a plus sign or spaces (e.g. 420777123456), a full user JID ending in @s.whatsapp.net, or a group JID ending in @g.us — a bare number is normalized into a user JID automatically — and text is delivered as plain text.',
      'OPERATOR ONLY: any other sender is rejected, because this tool can write to anyone the account can reach. It also fails while the WhatsApp device is not paired and connected, and it returns only a short confirmation with the resolved JID, not a message id. A sent WhatsApp message cannot be unsent through this tool, so check the recipient before calling.',
    ].join(' '),
    parameters: Type.Object({
      to: Type.String({ description: 'Recipient: international phone number without + (e.g. 420777123456), user JID (…@s.whatsapp.net) or group JID (…@g.us)' }),
      text: Type.String({ description: 'Message body, sent as plain text' }),
    }),
    execute: async (_id, p) => {
      try {
        if (ctx.currentIdentity?.()?.owner !== true) throw new Error('WhatsappSend is only available to the operator');
        const sock = adapter.requireSock();
        const jid = toJid(p.to);
        if (!jid) return ok('Error: no recipient.');
        await sock.sendMessage(jid, { text: String(p.text ?? '') });
        return ok(`Sent to ${jid}.`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'WhatsappGroupList', label: 'List WhatsApp groups',
    description: [
      'List every WhatsApp group the linked account currently participates in, one per line with the group JID (…@g.us), its subject and the number of members.',
      'Use it first whenever a request names a group in words ("the family group", "the work chat") — it is how you turn that name into the group JID that WhatsappGroupInfo, WhatsappGroupAdd, WhatsappGroupRemove and WhatsappSend need.',
      'It takes no parameters and always covers the whole membership of the account; there is no filter or search argument, so match the subject yourself in the returned list.',
      'Read-only and safe to call. It requires a connected, paired WhatsApp device, it does not list one-to-one chats or the participants of a group (use WhatsappGroupInfo for those), and it prints "(no groups)" when the account is in none.',
    ].join(' '),
    parameters: Type.Object({}),
    execute: async () => {
      try {
        adminGate();
        const sock = adapter.requireSock();
        const groups = await sock.groupFetchAllParticipating();
        const lines = Object.values(groups ?? {}).map((g) => `${g.id}  ${g.subject ?? ''}  (${g.participants?.length ?? 0} members)`);
        return ok(lines.join('\n') || '(no groups)');
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'WhatsappGroupInfo', label: 'WhatsApp group info',
    description: [
      'Read the full metadata of one WhatsApp group: its JID, subject, description, owner and the complete participant list, where each member is shown by JID and marked when they are an admin or the superadmin.',
      'Use it to check who is actually in a group, to confirm whether somebody is an administrator, or to verify a group before adding, removing or messaging people in it; to find the JID in the first place use WhatsappGroupList.',
      'groupJid must be a full group JID ending in @g.us — a group name or a phone number will not resolve here.',
      'Read-only and safe to call. It requires a connected, paired WhatsApp device and the account must itself be a participant of that group; members appear as JIDs, not as saved contact names, and no message history is returned.',
    ].join(' '),
    parameters: Type.Object({ groupJid: Type.String({ description: 'Group JID ending in @g.us, as returned by WhatsappGroupList' }) }),
    execute: async (_id, p) => {
      try {
        adminGate();
        const sock = adapter.requireSock();
        const g = await sock.groupMetadata(p.groupJid);
        const members = (g.participants ?? []).map((m) => `${m.id}${m.admin ? `  [${m.admin}]` : ''}`);
        return ok([
          `id: ${g.id}`, `subject: ${g.subject ?? ''}`,
          g.desc ? `desc: ${g.desc}` : null, g.owner ? `owner: ${g.owner}` : null,
          `participants (${members.length}):`, ...members,
        ].filter(Boolean).join('\n'));
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'WhatsappGroupCreate', label: 'Create WhatsApp group',
    description: [
      'Create a brand-new WhatsApp group owned by the linked account, with the given subject (group name) and an initial set of participants, and report the JID of the group that was created.',
      'Use it when the operator wants a new group chat set up for a team, a project or an event; to change who is in an existing group use WhatsappGroupAdd or WhatsappGroupRemove instead.',
      'subject is the visible group name and members is an array of recipients — international phone numbers without a plus sign (e.g. 420777123456) or user JIDs ending in @s.whatsapp.net — of which at least one valid entry is required, otherwise the call is refused with an error.',
      'This is a real, visible action: everyone listed is added immediately and gets a notification on their phone, and the group cannot be undone from here — it can only be emptied with WhatsappGroupRemove. It needs a connected, paired WhatsApp device, and numbers that are not on WhatsApp are silently left out by the platform.',
    ].join(' '),
    parameters: Type.Object({
      subject: Type.String({ description: 'Name of the new group as members will see it' }),
      members: Type.Array(Type.String(), { description: 'Initial participants: international phone numbers without + (e.g. 420777123456) or user JIDs (…@s.whatsapp.net); at least one is required' }),
    }),
    execute: async (_id, p) => {
      try {
        adminGate();
        const sock = adapter.requireSock();
        const jids = (p.members ?? []).map(toJid).filter(Boolean);
        if (!jids.length) return ok('Error: at least one member is required.');
        const g = await sock.groupCreate(String(p.subject ?? 'Group'), jids);
        return ok(`Created group ${g.id} "${g.subject ?? p.subject}".`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'WhatsappGroupAdd', label: 'Add WhatsApp group member',
    description: [
      'Add one or more people to an existing WhatsApp group, so they immediately become participants and can read everything posted from that moment on.',
      'Use it to invite colleagues or family members into a group that already exists; to take somebody out again use WhatsappGroupRemove, and to start a completely new group use WhatsappGroupCreate.',
      'groupJid is the full group JID ending in @g.us (get it from WhatsappGroupList) and members is an array of international phone numbers without a plus sign or user JIDs ending in @s.whatsapp.net.',
      'The linked account must be an administrator of that group and the device must be paired and connected. This is visible to every participant and notifies the people added, so confirm the group and the numbers first; the reply is the raw per-participant result, where a non-zero status means WhatsApp refused that particular person, for example because their privacy settings require an invite link.',
    ].join(' '),
    parameters: Type.Object({
      groupJid: Type.String({ description: 'Group JID ending in @g.us, as returned by WhatsappGroupList' }),
      members: Type.Array(Type.String(), { description: 'People to add: international phone numbers without + (e.g. 420777123456) or user JIDs (…@s.whatsapp.net)' }),
    }),
    execute: async (_id, p) => {
      try {
        adminGate();
        const sock = adapter.requireSock();
        const jids = (p.members ?? []).map(toJid).filter(Boolean);
        const res = await sock.groupParticipantsUpdate(p.groupJid, jids, 'add');
        return ok(`add → ${JSON.stringify(res)}`);
      } catch (e) { return fail(e); }
    },
  }));

  ctx.registerTool(defineTool({
    name: 'WhatsappGroupRemove', label: 'Remove WhatsApp group member',
    description: [
      'DESTRUCTIVE: remove (kick) one or more participants from a WhatsApp group, cutting off their access to the conversation from that moment on.',
      'Use it only when the operator explicitly asks to throw somebody out of a group; to add people use WhatsappGroupAdd, and check who is actually in the group with WhatsappGroupInfo before you remove anyone.',
      'groupJid is the full group JID ending in @g.us and members is an array of international phone numbers without a plus sign or user JIDs ending in @s.whatsapp.net — every entry listed is removed in a single call, so double-check the list.',
      'The linked account must be an administrator of that group and the device must be paired and connected. Removal is announced to the whole group and cannot be undone here: the person has to be invited back with WhatsappGroupAdd, and they lose access to any message posted after the removal. The reply is the raw per-participant result, where a non-zero status means WhatsApp refused that removal.',
    ].join(' '),
    parameters: Type.Object({
      groupJid: Type.String({ description: 'Group JID ending in @g.us, as returned by WhatsappGroupList' }),
      members: Type.Array(Type.String(), { description: 'People to remove: international phone numbers without + (e.g. 420777123456) or user JIDs (…@s.whatsapp.net)' }),
    }),
    execute: async (_id, p) => {
      try {
        adminGate();
        const sock = adapter.requireSock();
        const jids = (p.members ?? []).map(toJid).filter(Boolean);
        const res = await sock.groupParticipantsUpdate(p.groupJid, jids, 'remove');
        return ok(`remove → ${JSON.stringify(res)}`);
      } catch (e) { return fail(e); }
    },
  }));
}
