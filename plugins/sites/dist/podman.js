import { spawn } from 'node:child_process';
import { userInfo } from 'node:os';
const SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT = 256 * 1024;
export function cleanPodmanEnv(input = {}) {
    const service = userInfo();
    const uid = input.uid ?? process.getuid?.() ?? service.uid;
    const home = input.home ?? service.homedir;
    const user = input.user ?? service.username;
    return {
        HOME: home,
        USER: user,
        LOGNAME: user,
        PATH: SYSTEM_PATH,
        XDG_RUNTIME_DIR: `/run/user/${uid}`,
        DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus`,
    };
}
class SpawnExecutor {
    async run(file, args, options) {
        return await new Promise((resolve, reject) => {
            const grouped = process.platform !== 'win32';
            const child = spawn(file, [...args], {
                cwd: options.cwd,
                env: options.env,
                shell: false,
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: grouped,
            });
            let stdout = Buffer.alloc(0);
            let stderr = Buffer.alloc(0);
            let timedOut = false;
            let settled = false;
            const append = (current, chunk) => {
                const combined = Buffer.concat([current, chunk]);
                return combined.length <= options.outputLimitBytes
                    ? combined
                    : combined.subarray(combined.length - options.outputLimitBytes);
            };
            const signal = (name) => {
                if (child.pid === undefined)
                    return;
                try {
                    if (grouped)
                        process.kill(-child.pid, name);
                    else
                        child.kill(name);
                }
                catch {
                    // The process group already exited.
                }
            };
            child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
            child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
            child.once('error', (error) => {
                if (settled)
                    return;
                settled = true;
                reject(error);
            });
            const timer = setTimeout(() => {
                timedOut = true;
                signal('SIGTERM');
                const killTimer = setTimeout(() => signal('SIGKILL'), 250);
                killTimer.unref?.();
            }, options.timeoutMs);
            timer.unref?.();
            child.once('close', (code) => {
                clearTimeout(timer);
                if (settled)
                    return;
                settled = true;
                if (timedOut) {
                    reject(new Error(`podman command timed out after ${options.timeoutMs}ms`));
                    return;
                }
                resolve({
                    stdout: stdout.toString('utf8'),
                    stderr: stderr.toString('utf8'),
                    code: code ?? 1,
                });
            });
            if (options.input !== undefined)
                child.stdin.end(options.input);
            else
                child.stdin.end();
        });
    }
}
const cap = (value, bytes) => {
    const buffer = Buffer.from(value);
    return buffer.length <= bytes ? value : buffer.subarray(buffer.length - bytes).toString('utf8');
};
export class PodmanClient {
    executor;
    binary;
    env;
    timeoutMs;
    outputLimitBytes;
    constructor(options = {}) {
        this.executor = options.executor ?? new SpawnExecutor();
        this.binary = options.binary ?? 'podman';
        this.env = cleanPodmanEnv(options);
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.outputLimitBytes = options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT;
    }
    async run(args, options = {}) {
        if (args.some((arg) => arg.includes('\0')))
            throw new Error('Podman argv contains a NUL byte');
        const result = await this.executor.run(this.binary, args, {
            env: { ...this.env },
            timeoutMs: options.timeoutMs ?? this.timeoutMs,
            outputLimitBytes: this.outputLimitBytes,
            cwd: options.cwd,
            input: options.input,
        });
        const bounded = {
            stdout: cap(result.stdout, this.outputLimitBytes),
            stderr: cap(result.stderr, this.outputLimitBytes),
            code: result.code,
        };
        if (bounded.code !== 0 && !options.allowFailure) {
            throw new Error(`podman ${args[0] ?? ''} failed (${bounded.code}): ${bounded.stderr.trim() || bounded.stdout.trim()}`);
        }
        return bounded;
    }
    async create(spec) {
        const network = spec.network === 'isolated' ? 'none' : 'slirp4netns:allow_host_loopback=false';
        const result = await this.run([
            'create', '--name', spec.name,
            '--label', `io.elowen.site=${spec.siteId}`,
            '--cgroups=split', '--systemd=always',
            `--memory=${spec.memoryMb}m`, `--memory-swap=${spec.memoryMb}m`, `--cpus=${spec.cpus}`, `--pids-limit=${spec.pidsLimit}`,
            `--network=${network}`,
            '--env-file', spec.envFile,
            '--mount', `type=bind,src=${spec.workspace},dst=/workspace`,
            '--mount', `type=bind,src=${spec.gitStub},dst=/workspace/.git,ro`,
            '--mount', `type=bind,src=${spec.brokerDir},dst=/run/elowen`,
            '--mount', `type=volume,src=${spec.volume},dst=/data`,
            spec.image,
        ]);
        return result.stdout.trim();
    }
    async update(name, limits) {
        await this.run([
            'update', `--memory=${limits.memoryMb}m`, `--memory-swap=${limits.memoryMb}m`,
            `--cpus=${limits.cpus}`, `--pids-limit=${limits.pidsLimit}`, name,
        ]);
    }
    async start(name) { await this.run(['start', name]); }
    async stop(name, timeoutSeconds) { await this.run(['stop', '-t', String(timeoutSeconds), name]); }
    async kill(name) { await this.run(['kill', name]); }
    async remove(name, options = {}) {
        const args = ['rm'];
        if (options.force)
            args.push('-f');
        if (options.timeoutSeconds !== undefined)
            args.push('-t', String(options.timeoutSeconds));
        args.push(name);
        await this.run(args);
    }
    missingObject(result) {
        return /no such (?:container|object|volume|image)|does not exist|not found/i.test(`${result.stderr}\n${result.stdout}`);
    }
    /** `--type container` is what makes "no container" answerable.
     *
     *  Bare `podman inspect NAME` searches containers, images, volumes, networks and pods together. Once a
     *  site has a snapshot image, the moment its container is gone the same name resolves to that image
     *  instead, and `{{.State.Status}}` dies with a template error rather than a missing-object message:
     *  exit 125, unrecognized, thrown. Rollback removes the container before recreating it, so this landed
     *  precisely in the window where the environment had none, and it left the site with no container at
     *  all. Scoped to containers, the same call answers "no such container", which reads as null. */
    async inspectStatus(name) {
        const result = await this.run(['inspect', '--type', 'container', '--format', '{{.State.Status}}', name], { allowFailure: true });
        if (result.code === 0)
            return result.stdout.trim() || null;
        if (this.missingObject(result))
            return null;
        throw new Error(`podman inspect failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
    }
    async exec(name, argv, options = {}) {
        const args = ['exec'];
        if (options.workdir)
            args.push('--workdir', options.workdir);
        args.push(name, ...argv);
        return await this.run(args, { timeoutMs: options.timeoutMs });
    }
    async execInteractive(name, argv, input, options = {}) {
        const args = ['exec', '--interactive'];
        if (options.workdir)
            args.push('--workdir', options.workdir);
        args.push(name, ...argv);
        return await this.run(args, { timeoutMs: options.timeoutMs, input });
    }
    async pause(name) { await this.run(['pause', name]); }
    async unpause(name) { await this.run(['unpause', name]); }
    async ps() {
        const result = await this.run(['ps', '-a', '--format', 'json', '--filter', 'label=io.elowen.site']);
        const parsed = JSON.parse(result.stdout || '[]');
        if (!Array.isArray(parsed))
            return [];
        return parsed.map((row) => ({
            id: row.id ?? row.Id ?? row.ID,
            names: row.names ?? row.Names,
            state: row.state ?? row.State,
            status: row.status ?? row.Status,
            labels: row.labels ?? row.Labels,
        }));
    }
    async build(tag, contextDir) {
        await this.run(['build', '--tag', tag, contextDir], { timeoutMs: 15 * 60_000 });
    }
    async imageExists(reference) {
        const result = await this.run(['image', 'exists', reference], { allowFailure: true });
        if (result.code === 0)
            return true;
        if (result.code === 1 || this.missingObject(result))
            return false;
        throw new Error(`podman image exists failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
    }
    async removeImage(reference) {
        const result = await this.run(['image', 'rm', reference], { allowFailure: true });
        if (result.code !== 0 && !this.missingObject(result)) {
            throw new Error(`podman image rm failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
        }
    }
    async volumeExists(name) {
        const result = await this.run(['volume', 'exists', name], { allowFailure: true });
        if (result.code === 0)
            return true;
        if (result.code === 1 || this.missingObject(result))
            return false;
        throw new Error(`podman volume exists failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
    }
    async createVolume(name, siteId) {
        await this.run(['volume', 'create', '--label', `io.elowen.site=${siteId}`, name]);
    }
    async ensureVolume(name, siteId) {
        if (!await this.volumeExists(name))
            await this.createVolume(name, siteId);
    }
    async removeVolume(name) {
        const result = await this.run(['volume', 'rm', name], { allowFailure: true });
        if (result.code !== 0 && !this.missingObject(result)) {
            throw new Error(`podman volume rm failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
        }
    }
    async exportVolume(name, output) { await this.run(['volume', 'export', '--output', output, name]); }
    async importVolume(name, input) { await this.run(['volume', 'import', name, input]); }
    async commit(name, image, options = {}) {
        await this.run(['commit', `--pause=${options.pause === false ? 'false' : 'true'}`, name, image]);
    }
    async unshareRemove(paths) {
        if (paths.length === 0)
            return;
        if (paths.some((path) => !path.startsWith('/')))
            throw new Error('Podman cleanup paths must be absolute');
        await this.run(['unshare', 'rm', '-rf', '--', ...paths]);
    }
}
