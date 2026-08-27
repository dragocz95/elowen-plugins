const SCP = /^(?:[^@\s]+@)?github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i;
export function parseGitHubRemote(raw) {
    const value = raw.trim();
    if (!value)
        return null;
    const scp = SCP.exec(value);
    if (scp)
        return { owner: scp[1], name: scp[2] };
    try {
        const url = new URL(value);
        if (url.hostname.toLowerCase() !== 'github.com')
            return null;
        const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1])
            return null;
        return { owner: parts[0], name: parts[1].replace(/\.git$/i, '') };
    }
    catch {
        return null;
    }
}
export function canonicalHttpsRepository(ref) {
    return `https://github.com/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}.git`;
}
function sameRepository(a, b) {
    return a.owner.toLowerCase() === b.owner.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase();
}
function remoteCandidates(remotes) {
    const out = [];
    for (const remote of remotes) {
        const fetch = parseGitHubRemote(remote.fetchUrl);
        const push = parseGitHubRemote(remote.pushUrl);
        if (fetch)
            out.push({ ...fetch, remote: remote.name, kind: 'fetch' });
        if (push && (!fetch || !sameRepository(fetch, push)))
            out.push({ ...push, remote: remote.name, kind: 'push' });
    }
    return out;
}
export function suggestedRepositories(remotes) {
    const candidates = remoteCandidates(remotes);
    const upstream = candidates.find((candidate) => candidate.remote === 'upstream' && candidate.kind === 'fetch') ?? null;
    const originPush = candidates.find((candidate) => candidate.remote === 'origin' && candidate.kind === 'push')
        ?? candidates.find((candidate) => candidate.remote === 'origin') ?? null;
    const unique = candidates.filter((candidate, index) => candidates.findIndex((other) => sameRepository(candidate, other)) === index);
    const only = unique.length === 1 ? unique[0] : null;
    return {
        base: upstream ?? only,
        push: originPush ?? only ?? upstream,
        ambiguous: !upstream && !originPush && unique.length > 1,
        candidates,
    };
}
