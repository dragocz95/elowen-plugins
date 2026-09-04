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
    audit?(status: PublishedSitesEnvironmentStatus, actorUserId: number | null): void;
  }) {}

  async status(): Promise<PublishedSitesEnvironmentStatus> {
    const control = this.deps.control();
    return control && typeof control.environmentsStatus === 'function'
      ? await control.environmentsStatus()
      : unavailable();
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
      const status = unavailable();
      this.deps.audit?.(status, actorUserId);
      return status;
    }
    try {
      await control.provisionEnvironments();
      const status = await control.environmentsStatus();
      this.deps.audit?.(status, actorUserId);
      return status;
    } catch (error) {
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
