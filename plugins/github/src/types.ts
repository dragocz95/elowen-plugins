export interface DeviceFlow {
  flowId: string;
  userId: number;
  verificationUrl: string | null;
  userCode: string | null;
  directory: string | null;
  replaceIdentity: boolean;
  expiresAt: number;
  status: 'pending' | 'completing' | 'connected' | 'cancelled' | 'expired' | 'failed' | 'interrupted';
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GitHubAccount {
  userId: number;
  githubUserId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  status: 'connected' | 'reconnect_required';
  lastError: string | null;
  verifiedAt: number;
  updatedAt: number;
}

export interface GitHubRepository {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
  permissions: { pull: boolean; push: boolean; maintain: boolean; admin: boolean };
  allowMergeCommit: boolean;
  allowSquashMerge: boolean;
  allowRebaseMerge: boolean;
}

export interface ProjectMapping {
  userId: number;
  projectId: number;
  baseRepoId: number;
  baseOwner: string;
  baseName: string;
  pushRepoId: number;
  pushOwner: string;
  pushName: string;
  baseRemote: string | null;
  pushRemote: string | null;
  verifiedAt: number;
  active: boolean;
}

export interface RemoteRepositoryRef {
  owner: string;
  name: string;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  htmlUrl: string;
  author: string;
  headRef: string;
  headSha: string;
  headOwner: string;
  baseRef: string;
  updatedAt: string;
  mergeable: boolean | null;
  mergeableState: string | null;
  reviewDecision: 'approved' | 'changes_requested' | 'review_required' | null;
}

export interface PullRequestDetails extends PullRequestSummary {
  body: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  merged: boolean;
  files: { path: string; status: string; additions: number; deletions: number; patch: string | null }[];
  reviews: { id: number; user: string; state: string; body: string; submittedAt: string | null }[];
}

type ChecksState = 'pending' | 'success' | 'failure' | 'action_required';
export interface CombinedChecks {
  state: ChecksState;
  items: { name: string; state: ChecksState; description: string | null; targetUrl: string | null }[];
}

export type MutationAction =
  | { type: 'publish'; projectId: number; sessionId: string }
  | { type: 'create_pr'; projectId: number; sessionId: string; title: string; body?: string; base?: string }
  | { type: 'review'; projectId: number; number: number; event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'; body?: string }
  | { type: 'merge'; projectId: number; number: number; expectedHeadSha: string; method?: 'squash' | 'merge' | 'rebase' }
  | { type: 'disconnect' }
  | { type: 'replace_identity' }
  | { type: 'remove_mapping'; projectId: number };

export interface MutationPreview {
  action: MutationAction;
  title: string;
  description: string;
  target: Record<string, unknown>;
  expected: Record<string, unknown>;
  confirmationToken?: string;
  expiresAt?: number;
}
