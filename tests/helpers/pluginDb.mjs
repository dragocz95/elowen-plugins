import Database from 'better-sqlite3';

export function pluginDb() {
  const raw = new Database(':memory:');
  raw.exec('CREATE TABLE plugin_migrations(version INTEGER PRIMARY KEY)');
  const handle = {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => {
      const statement = raw.prepare(sql);
      return {
        run: (...params) => statement.run(...params),
        get: (...params) => statement.get(...params),
        all: (...params) => statement.all(...params),
      };
    },
    migrate: (steps) => {
      for (const step of steps) {
        if (raw.prepare('SELECT 1 FROM plugin_migrations WHERE version=?').get(step.version)) continue;
        raw.transaction(() => {
          step.up(handle);
          raw.prepare('INSERT INTO plugin_migrations(version) VALUES (?)').run(step.version);
        })();
      }
    },
    appliedVersion: () => 0,
    transaction: (fn) => raw.transaction(fn)(),
  };
  return handle;
}
