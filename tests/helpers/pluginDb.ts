import { openDb } from 'elowen/dist/store/db.js';
import { makePluginDb } from 'elowen/dist/store/pluginDb.js';

const providers = new Map<string, ReturnType<typeof createPluginDbProvider>>();

function createPluginDbProvider() {
  const db = openDb(':memory:');
  return {
    db,
    pluginDb: (plugin: string) => makePluginDb(db, plugin, { canMigrate: true }),
  };
}

export function pluginDbFor(key: string) {
  let provider = providers.get(key);
  if (!provider) {
    provider = createPluginDbProvider();
    providers.set(key, provider);
  }
  return provider.pluginDb;
}
