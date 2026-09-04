import { spawn } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
const SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT = 256 * 1024;
export function cleanPodmanEnv(input = {}) {
    const uid = input.uid ?? process.getuid?.() ?? userInfo().uid;
    const home = input.home ?? process.env.HOME ?? homedir();
    const user = input.user ?? process.env.USER ?? process.env.LOGNAME ?? userInfo().username;
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
            const child = spawn(file, [...args], {
                cwd: options.cwd,
                env: options.env,
                shell: false,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = Buffer.alloc(0);
            let stderr = Buffer.alloc(0);
            const append = (current, chunk) => {
                const combined = Buffer.concat([current, chunk]);
                return combined.length <= options.outputLimitBytes
                    ? combined
                    : combined.subarray(combined.length - options.outputLimitBytes);
            };
            child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
            child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
            child.once('error', reject);
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error(`podman command timed out after ${options.timeoutMs}ms`));
            }, options.timeoutMs);
            timer.unref?.();
            child.once('close', (code) => {
                clearTimeout(timer);
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
        return /no such (?:container|object)|does not exist|not found/i.test(`${result.stderr}\n${result.stdout}`);
    }
    async inspect(name) {
        const result = await this.run(['inspect', name], { allowFailure: true });
        if (result.code !== 0) {
            if (this.missingObject(result))
                return null;
            throw new Error(`podman inspect failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
        }
        const parsed = JSON.parse(result.stdout);
        const first = Array.isArray(parsed) ? parsed[0] : parsed;
        return first && typeof first === 'object' ? first : null;
    }
    async inspectStatus(name) {
        const result = await this.run(['inspect', '--format', '{{.State.Status}}', name], { allowFailure: true });
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
    async ps() {
        const result = await this.run(['ps', '-a', '--format', 'json', '--filter', 'label=io.elowen.site']);
        const parsed = JSON.parse(result.stdout || '[]');
        return Array.isArray(parsed) ? parsed : [];
    }
    async events(since = '0s') {
        const result = await this.run(['events', '--since', since, '--stream=false', '--format', 'json', '--filter', 'label=io.elowen.site']);
        return result.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    }
    async stats(name) {
        const result = await this.run(['stats', '--no-stream', '--format', 'json', name], { allowFailure: true });
        if (result.code !== 0)
            return null;
        const parsed = JSON.parse(result.stdout || '[]');
        return Array.isArray(parsed) ? parsed[0] ?? null : null;
    }
    async build(tag, contextDir) {
        await this.run(['build', '--tag', tag, contextDir], { timeoutMs: 15 * 60_000 });
    }
    async imageExists(reference) {
        return (await this.run(['image', 'exists', reference], { allowFailure: true })).code === 0;
    }
    async removeImage(reference) { await this.run(['image', 'rm', reference]); }
    async volumeExists(name) {
        return (await this.run(['volume', 'exists', name], { allowFailure: true })).code === 0;
    }
    async removeVolume(name) { await this.run(['volume', 'rm', name], { allowFailure: true }); }
    async exportVolume(name, output) { await this.run(['volume', 'export', '--output', output, name]); }
    async importVolume(name, input) { await this.run(['volume', 'import', name, input]); }
    async commit(name, image) { await this.run(['commit', '--pause', name, image]); }
    async unshareRemove(paths) {
        if (paths.length === 0)
            return;
        if (paths.some((path) => !path.startsWith('/')))
            throw new Error('Podman cleanup paths must be absolute');
        await this.run(['unshare', 'rm', '-rf', '--', ...paths]);
    }
}
