import type { PublishedSitesEnvironmentStatus } from './coreSeams.js';

interface EnvironmentProvisionControl {
  environmentsStatus(): Promise<PublishedSitesEnvironmentStatus>;
  provisionEnvironments(): Promise<PublishedSitesEnvironmentStatus>;
}

export class ProvisionInProgressError extends Error {}

const unavailable = (): PublishedSitesEnvironmentStatus => ({
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
  private inFlight: Promise<PublishedSitesEnvironmentStatus> | null = null;

  constructor(private readonly deps: {
    control(): EnvironmentProvisionControl | undefined;
    imageExists(): Promise<boolean>;
    buildImage(): Promise<void>;
    audit?(status: PublishedSitesEnvironmentStatus, actorUserId: number | null): void;
  }) {}

  async status(): Promise<PublishedSitesEnvironmentStatus> {
    const control = this.deps.control();
    const core = control && typeof control.environmentsStatus === 'function'
      ? await control.environmentsStatus()
      : unavailable();
    return await this.withBaseImage(core);
  }

  private async withBaseImage(core: PublishedSitesEnvironmentStatus): Promise<PublishedSitesEnvironmentStatus> {
    let imageReady = false;
    let detail: string | undefined;
    try { imageReady = await this.deps.imageExists(); }
    catch (error) { detail = error instanceof Error ? error.message : String(error); }
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

  provision(actorUserId: number | null = null): Promise<PublishedSitesEnvironmentStatus> {
    if (this.inFlight) throw new ProvisionInProgressError('environment provisioning is already running');
    const run = this.provisionNow(actorUserId).finally(() => { this.inFlight = null; });
    this.inFlight = run;
    return run;
  }

  private async provisionNow(actorUserId: number | null): Promise<PublishedSitesEnvironmentStatus> {
    const control = this.deps.control();
    if (!control || typeof control.provisionEnvironments !== 'function' || typeof control.environmentsStatus !== 'function') {
      const status = await this.withBaseImage(unavailable());
      this.deps.audit?.(status, actorUserId);
      return status;
    }
    try {
      await control.provisionEnvironments();
      const measured = await control.environmentsStatus();
      if (measured.ready && !await this.deps.imageExists()) {
        try { await this.deps.buildImage(); }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const status: PublishedSitesEnvironmentStatus = {
            ready: false,
            detail: `Environment base-image build failed: ${message}`,
            items: [
              ...measured.items.filter((item) => item.id !== 'base-image'),
              { id: 'base-image', label: 'Deterministic Sites base image', ok: false, detail: message },
            ],
          };
          this.deps.audit?.(status, actorUserId);
          return status;
        }
      }
      const status = await this.withBaseImage(await control.environmentsStatus());
      this.deps.audit?.(status, actorUserId);
      return status;
    } catch (error) {
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
