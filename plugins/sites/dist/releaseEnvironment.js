import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
const RESERVED_ENV = new Set(['HOME', 'PATH', 'NODE_ENV', 'HOST', 'PORT', 'SOCKET_PATH', 'SOCKET_ABSTRACT']);
/** The legacy runtime and conversion interpret application dotenv files identically. */
export function readReleaseEnv(releaseDir) {
    const file = join(releaseDir, '.env');
    let fd = null;
    try {
        fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        if (!fstatSync(fd).isFile())
            throw new Error('.env is not a regular file');
        return Object.fromEntries(Object.entries(parseEnv(readFileSync(fd, 'utf8')))
            .filter((entry) => typeof entry[1] === 'string')
            .filter(([key]) => !RESERVED_ENV.has(key) && !key.startsWith('ELOWEN_')));
    }
    catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
            return {};
        throw new Error(`the runtime .env could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        if (fd !== null)
            closeSync(fd);
    }
}
/** EnvironmentFile syntax, not shell or unit-directive syntax. */
export function systemdEnvironment(env) {
    return Object.entries(env).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value.includes('\0')) {
            throw new Error('application environment cannot be represented in a systemd environment file');
        }
        return `${key}="${value.replace(/([\\"$`])/g, '\\$1')}"\n`;
    }).join('');
}
