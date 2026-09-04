export class ProvisionInProgressError extends Error {
}
const unavailable = () => ({
    ready: false,
    detail: 'Environment support is unavailable. Sites requires core 0.28.31 and the installed gateway helper.',
    items: [{
            id: 'core',
            label: 'Elowen core environment control',
            ok: false,
            detail: 'Update Elowen and re-run elowen install as root.',
        }],
});
export class EnvironmentProvisioningService {
    deps;
    inFlight = null;
    constructor(deps) {
        this.deps = deps;
    }
    async status() {
        const control = this.deps.control();
        return control && typeof control.environmentsStatus === 'function'
            ? await control.environmentsStatus()
            : unavailable();
    }
    provision(actorUserId = null) {
        if (this.inFlight)
            throw new ProvisionInProgressError('environment provisioning is already running');
        const run = this.provisionNow(actorUserId).finally(() => { this.inFlight = null; });
        this.inFlight = run;
        return run;
    }
    async provisionNow(actorUserId) {
        const control = this.deps.control();
        if (!control || typeof control.provisionEnvironments !== 'function' || typeof control.environmentsStatus !== 'function') {
            const status = unavailable();
            this.deps.audit?.(status, actorUserId);
            return status;
        }
        try {
            await control.provisionEnvironments();
            const status = await control.environmentsStatus();
            this.deps.audit?.(status, actorUserId);
            return status;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.deps.audit?.({
                ready: false,
                detail: `Environment provisioning failed: ${message}`,
                items: [{ id: 'provision', label: 'Environment provisioning', ok: false, detail: message }],
            }, actorUserId);
            throw error;
        }
    }
}
