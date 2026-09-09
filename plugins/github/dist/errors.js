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
/** Environment-provider refusals raised while reading a MANAGED project's repository state. They are a
 *  decision about the caller's access to the project, so they carry this plugin's existing
 *  `project_forbidden` contract instead of the 502 that says GitHub itself is down — a panel that reported
 *  "GitHub is unavailable" for a project the account may not touch sent everyone looking in the wrong
 *  place. Matched on the provider's stable CODE, never on an arbitrary error's `status`. */
const ACCESS_REFUSALS = new Set(['project_forbidden', 'account_forbidden']);
function asPluginError(error) {
    if (error instanceof GitHubPluginError)
        return error;
    const code = error?.code;
    if (typeof code === 'string' && ACCESS_REFUSALS.has(code)) {
        return new GitHubPluginError('project_forbidden', 403, 'This project is not accessible.');
    }
    return new GitHubPluginError('github_unavailable', 502, 'GitHub is unavailable. Try again later.');
}
export function errorBody(error) {
    const value = asPluginError(error);
    return {
        status: value.status,
        body: { error: value.code, message: value.message, ...(value.details ? { details: value.details } : {}) },
    };
}
