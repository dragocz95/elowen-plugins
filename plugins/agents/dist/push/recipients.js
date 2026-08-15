/** User ids that should be notified about a mission: its owner (the user who engaged it) plus every
 *  admin. Deduped. An unknown/owner-less mission falls back to admins only — never throws, so a
 *  deleted mission simply yields no owner. */
export function recipientsForMission(missionId, d) {
    const ids = new Set();
    const owner = d.missions.get(missionId)?.created_by;
    if (owner != null)
        ids.add(owner);
    for (const u of d.users.list())
        if (u.is_admin)
            ids.add(u.id);
    return [...ids];
}
