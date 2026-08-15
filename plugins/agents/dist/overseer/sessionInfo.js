const ELOWEN = 'elowen-';
const OVERSEER = 'overseer-';
const PILOT = 'pilot-';
const ADVISOR = 'advisor-';
const CHAT = 'chat-';
/** Classify a live session name into its role + identity. Mirrors the spawn-time conventions:
 *  overseer → `elowen-overseer-<missionId>`, pilot → `elowen-pilot-<name>`, advisor → `elowen-advisor-<userId>`,
 *  chat → `elowen-chat-<userId>-<tail>`, worker → `elowen-<name>`. */
export function classifySession(name) {
    const bare = name.startsWith(ELOWEN) ? name.slice(ELOWEN.length) : name;
    if (bare.startsWith(OVERSEER))
        return { name, role: 'overseer', agent: '', missionId: bare.slice(OVERSEER.length) };
    if (bare.startsWith(PILOT))
        return { name, role: 'pilot', agent: bare.slice(PILOT.length) };
    if (bare.startsWith(ADVISOR)) {
        const userId = Number(bare.slice(ADVISOR.length));
        return { name, role: 'advisor', agent: '', userId: Number.isInteger(userId) ? userId : undefined };
    }
    if (bare.startsWith(CHAT)) {
        // `elowen-chat-<userId>-<tail>` — extract the owner userId (the segment before the first dash). A
        // malformed name (non-numeric) leaves userId undefined, so the ownership gate refuses it to everyone.
        const rest = bare.slice(CHAT.length);
        const dash = rest.indexOf('-');
        const userId = Number(rest.slice(0, dash < 0 ? rest.length : dash));
        return { name, role: 'chat', agent: '', userId: Number.isInteger(userId) ? userId : undefined };
    }
    return { name, role: 'agent', agent: bare };
}
