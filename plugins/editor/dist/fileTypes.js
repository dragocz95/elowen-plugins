export const MAX_BUFFERED_BYTES = 50 * 1024 * 1024;
export const MAX_OFFICE_BYTES = 20 * 1024 * 1024;
export const MAX_MEDIA_PREVIEW_BYTES = 50 * 1024 * 1024;
/** An upload travels in chunks because the daemon caps ANY plugin API body at 4 MiB (a bound on what
 *  the dispatcher will allocate, not a policy this plugin may raise). One-shot would therefore refuse
 *  an ordinary photo or PDF. Kept well under that ceiling so a chunk plus its headers can never brush
 *  against it, and shared with the browser so client and server cannot disagree on the split. */
export const MAX_UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
const MIME_BY_EXTENSION = {
    pdf: 'application/pdf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp', avif: 'image/avif',
    mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', m4v: 'video/x-m4v',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv; charset=utf-8',
};
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac']);
const OFFICE_EXTENSIONS = new Set(['docx', 'xlsx', 'pptx']);
const TEXT_EXTENSIONS = new Set([
    'txt', 'log', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'css', 'scss', 'sass', 'less',
    'html', 'htm', 'xml', 'md', 'markdown', 'mdx', 'py', 'pyi', 'sh', 'bash', 'zsh', 'fish', 'yml', 'yaml',
    'sql', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'go', 'rs', 'php', 'java', 'kt', 'kts', 'c', 'h',
    'cc', 'cpp', 'cxx', 'hpp', 'cs', 'fs', 'fsx', 'vb', 'rb', 'swift', 'dart', 'lua', 'r', 'pl', 'pm', 'ex', 'exs',
    'erl', 'hrl', 'vue', 'svelte', 'astro', 'graphql', 'gql', 'proto', 'dockerfile', 'gitignore', 'gitattributes',
    'editorconfig', 'npmrc', 'yarnrc', 'lock', 'patch', 'diff', 'csv', 'tsv', 'tex', 'rst', 'adoc',
]);
const TEXT_BASENAMES = new Set([
    'dockerfile', 'makefile', 'gnumakefile', 'license', 'licence', 'readme', 'changelog', 'authors', 'contributors',
    'copying', 'notice', 'procfile', 'gemfile', 'rakefile', 'vagrantfile', '.gitignore', '.gitattributes', '.editorconfig',
    '.npmrc', '.yarnrc', '.env',
]);
export const baseName = (path) => path.split('/').pop() ?? path;
// Scope extension parsing to the base name so a dotted directory can never contribute a false extension.
export const extOf = (path) => {
    const name = baseName(path);
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
};
export function mimeTypeOf(path) {
    return MIME_BY_EXTENSION[extOf(path)] ?? 'application/octet-stream';
}
export function fileKindOf(path) {
    const ext = extOf(path);
    const name = baseName(path).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext))
        return 'image';
    if (ext === 'pdf')
        return 'pdf';
    if (VIDEO_EXTENSIONS.has(ext))
        return 'video';
    if (AUDIO_EXTENSIONS.has(ext))
        return 'audio';
    if (OFFICE_EXTENSIONS.has(ext))
        return 'office';
    if (ext === 'csv')
        return 'csv';
    if (ext === 'md' || ext === 'markdown' || ext === 'mdx')
        return 'markdown';
    if (TEXT_EXTENSIONS.has(ext) || TEXT_BASENAMES.has(name))
        return 'text';
    return 'binary';
}
