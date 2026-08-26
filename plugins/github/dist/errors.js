export class GitHubPluginError extends Error {
    code;
    status;
    details;
    constructor(code, status, message, details) {
        super(message);
        this.code = code;
        this.status = status;
        this.details = details;
        this.name = 'GitHubPluginError';
    }
}
export function asPluginError(error) {
    if (error instanceof GitHubPluginError)
        return error;
    return new GitHubPluginError('github_unavailable', 502, 'GitHub is unavailable. Try again later.');
}
export function errorBody(error) {
    const value = asPluginError(error);
    return {
        status: value.status,
        body: { error: value.code, message: value.message, ...(value.details ? { details: value.details } : {}) },
    };
}
