export class GitHubPluginError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'GitHubPluginError';
  }
}

function asPluginError(error: unknown): GitHubPluginError {
  if (error instanceof GitHubPluginError) return error;
  return new GitHubPluginError('github_unavailable', 502, 'GitHub is unavailable. Try again later.');
}

export function errorBody(error: unknown): { status: number; body: Record<string, unknown> } {
  const value = asPluginError(error);
  return {
    status: value.status,
    body: { error: value.code, message: value.message, ...(value.details ? { details: value.details } : {}) },
  };
}
