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
        const core = control && typeof control.environmentsStatus === 'function'
            ? await control.environmentsStatus()
            : unavailable();
        return await this.withBaseImage(core);
    }
    async withBaseImage(core) {
        let imageReady = false;
        let detail;
        try {
            imageReady = await this.deps.imageExists();
        }
        catch (error) {
            detail = error instanceof Error ? error.message : String(error);
        }
        return {
            ready: core.ready && imageReady,
            detail: core.detail,
            items: [
                ...core.items.filter((item) => item.id !== 'base-image'),
                {
                    id: 'base-image',
                    label: 'Deterministic Sites base image',
                    ok: imageReady,
                    ...(imageReady ? {} : { detail: detail ?? 'The base image has not been built yet.' }),
                },
            ],
        };
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
            const status = await this.withBaseImage(unavailable());
            this.deps.audit?.(status, actorUserId);
            return status;
        }
        try {
            await control.provisionEnvironments();
            const measured = await control.environmentsStatus();
            if (measured.ready && !await this.deps.imageExists())
                await this.deps.buildImage();
            const status = await this.withBaseImage(await control.environmentsStatus());
            this.deps.audit?.(status, actorUserId);
            return status;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const status = await this.withBaseImage({
                ready: false,
                detail: `Environment provisioning failed: ${message}`,
                items: [{ id: 'provision', label: 'Environment provisioning', ok: false, detail: message }],
            });
            this.deps.audit?.(status, actorUserId);
            throw error;
        }
    }
}
