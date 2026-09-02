export class BrowserService {
    registry;
    constructor(registry) {
        this.registry = registry;
    }
    start() { }
    async stop() {
        await this.registry.closeAll('plugin_reload');
    }
    async cleanup() {
        await this.registry.sweep();
    }
}
