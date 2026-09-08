import { spawn } from 'node:child_process';
/** Host-side archive operations for legacy release conversion. Container execution belongs to Sandbox. */
export class SpawnExecutor {
    async run(file, args, options) {
        return new Promise((resolve, reject) => {
            const grouped = process.platform !== 'win32';
            const child = spawn(file, [...args], { cwd: options.cwd, env: options.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: grouped });
            let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0);
            let timedOut = false;
            let killTimer;
            const append = (current, chunk) => Buffer.concat([current, chunk]).subarray(-options.outputLimitBytes);
            const signal = (name) => {
                if (child.pid === undefined)
                    return;
                try {
                    if (grouped)
                        process.kill(-child.pid, name);
                    else
                        child.kill(name);
                }
                catch (error) {
                    if (error.code !== 'ESRCH')
                        reject(error);
                }
            };
            const timer = setTimeout(() => {
                timedOut = true;
                signal('SIGTERM');
                killTimer = setTimeout(() => signal('SIGKILL'), 250);
            }, options.timeoutMs);
            child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
            child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
            child.once('error', reject);
            child.stdin.on('error', error => { if (error.code !== 'EPIPE')
                reject(error); });
            child.once('close', code => {
                clearTimeout(timer);
                if (killTimer)
                    clearTimeout(killTimer);
                if (timedOut)
                    reject(new Error(`archive command timed out after ${options.timeoutMs}ms`));
                else
                    resolve({ stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), code: code ?? 1 });
            });
            child.stdin.end(options.input);
        });
    }
}
