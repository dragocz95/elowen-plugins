import { SessionRegistry } from './session-registry.js';

export class BrowserService {
  constructor(private readonly registry: SessionRegistry) {}

  start(): void {}

  async stop(): Promise<void> {
    await this.registry.closeAll('plugin_reload');
  }

  async cleanup(): Promise<void> {
    await this.registry.sweep();
  }
}
