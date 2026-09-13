/** What a Site says when the Sandbox is not there.
 *
 *  Sites declares `requiresControls: ['sandbox']`, so the daemon refuses to enable it without a provider
 *  and refuses to disable the provider underneath it. This message is what is left: the reload window
 *  between the two, and an operator reading a log or a tool result. It names the plugin to switch on,
 *  because "the environment runtime is unavailable" sent every reader looking for a broken container. */
export const SANDBOX_REQUIRED = 'Sites needs the Sandbox plugin, which is not enabled on this instance. Switch Sandbox on in Settings › Plugins and try again.';
/** A refusal whose message is already written for whoever asked, so nothing wraps it in a prefix of its
 *  own. `tools.ts` re-throws these verbatim; everywhere else it is an ordinary Error. */
export class SandboxRequiredError extends Error {
    constructor() {
        super(SANDBOX_REQUIRED);
        this.name = 'SandboxRequiredError';
    }
}
/** The single place the absence of the Sandbox control becomes an error.
 *
 *  Every path that CANNOT proceed without the Sandbox resolves it through here: reaching a managed
 *  Project's files, creating or publishing a site, and every Project transport operation. Generic in the
 *  control's shape because the services take narrower views of it
 *  (`projectPreviewBinding` alone, the publication transport alone) and each keeps its own type.
 *
 *  The paths that legitimately answer "unknown" instead — a status projection, a readiness row, a
 *  visitor-facing proxy response — keep their own `undefined` handling on purpose, and say so where they
 *  sit. */
export const requireSandbox = (control) => {
    if (!control)
        throw new SandboxRequiredError();
    return control;
};
