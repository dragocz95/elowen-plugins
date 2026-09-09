import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/** The consumer-side guest acceptance the Elowen core matrix promises.
 *
 *  tests/acceptance/managedEnvironmentMatrix.json in github.com/dragocz95/elowen (key
 *  `registryRealGuestSuites`) records these five suites as the real-guest evidence behind its LSP,
 *  browser, editor, codebase and cron rows. Core cannot check that they exist: a checkout of core alone
 *  has no registry beside it, and the earlier attempt to reach a sibling directory passed or failed on
 *  where the checkout happened to sit. They are files of THIS repository, so this is where a deletion has
 *  to be noticed — otherwise the core matrix keeps claiming evidence that nothing produces any more.
 *
 *  Deleting a suite is allowed; doing it silently is not. Remove the row from the core matrix in the same
 *  change, and this entry with it. */
const REGISTRY_GUEST_SUITES = {
  'lspManagedGuest.podman.test.ts': 'lsp — language server started and driven inside the selected project guest',
  'browserManagedGuest.podman.test.ts': 'browser — project Chromium, its profile and its downloads inside the guest',
  'editorManagedGuest.podman.test.ts': 'editor — editor APIs and office preview conversion through the guest',
  'codebaseManagedGuest.podman.test.ts': 'codebase — semantic index of a managed project keyed by project id',
  'cronManagedGuest.podman.test.ts': 'cronjob — a scheduled check executed inside the selected project guest',
};

const testsDir = dirname(fileURLToPath(import.meta.url));

test('the guest acceptance suites the core matrix attributes to this repository exist', () => {
  for (const [file, reason] of Object.entries(REGISTRY_GUEST_SUITES)) {
    assert.ok(existsSync(join(testsDir, file)), `tests/${file} is named by the core acceptance matrix (${reason}) but absent`);
  }
});
