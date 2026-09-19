/** Capture a project command through the provider's leased session, never a host descriptor. */
export async function editorExecute(ctx, projectId, accountUserId, command, cwd) {
    const provider = ctx.control('sandbox');
    if (!provider)
        throw new Error('project environment unavailable');
    const prepared = await provider.prepareExecution({ projectRef: { kind: 'managed', projectId }, cwd, command, leaseKind: 'editor' }, { accountUserId, roots: [] });
    let heartbeat;
    let timer;
    let failure;
    try {
        if (prepared.mode !== 'managed' || prepared.projectRef.projectId !== projectId || typeof prepared.start !== 'function' || typeof prepared.cancel !== 'function')
            throw new Error('managed execution unavailable');
        let interrupt;
        const interrupted = new Promise((_resolve, reject) => { interrupt = reject; });
        void interrupted.catch(() => { });
        timer = setTimeout(() => interrupt(new Error('project command timed out')), 30000);
        heartbeat = setInterval(() => { void Promise.resolve().then(() => prepared.lease.heartbeat()).catch(interrupt); }, 5000);
        heartbeat.unref();
        const session = await Promise.race([prepared.start(), interrupted]);
        let bytes = 0;
        const output = [];
        const collect = (chunk, stdout) => {
            bytes += chunk.length;
            if (bytes > 8 * 1024 * 1024)
                interrupt(new Error('project command output too large'));
            else if (stdout)
                output.push(chunk);
        };
        session.stdout.on('data', (chunk) => collect(chunk, true));
        session.stderr.on('data', (chunk) => collect(chunk, false));
        session.stdin.end();
        const result = await Promise.race([session.closed, interrupted]);
        if (result.code !== 0)
            throw new Error('project command failed');
        return prepared.sanitizeOutput(Buffer.concat(output).toString('utf8'));
    }
    catch (error) {
        failure = error;
        try {
            await prepared.cancel?.();
        }
        catch (cleanup) {
            failure = new AggregateError([failure, cleanup], 'Project command cancellation failed');
        }
        throw failure;
    }
    finally {
        clearTimeout(timer);
        clearInterval(heartbeat);
        try {
            await prepared.lease.release();
        }
        catch (cleanup) {
            throw new AggregateError([...(failure ? [failure] : []), cleanup], 'Project command cleanup failed');
        }
    }
}
