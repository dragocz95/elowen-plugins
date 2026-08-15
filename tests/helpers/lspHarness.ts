/** Adopted from the Elowen package together with the lsp plugin. The path seams come from the published
 *  package (`elowen/dist/plugins/*`), so a tool test runs against the same guard code an installed
 *  daemon applies; the plugin itself comes from this repo. */
import { allowedRoots, assertPathAllowed, defaultCwd, isAllAccess } from 'elowen/dist/plugins/pathGuard.js';
import { currentWorkDir } from 'elowen/dist/plugins/policyContext.js';
import type { PluginContext } from 'elowen/dist/plugins/api.js';
import { LspManager } from '../../plugins/lsp/src/manager.js';
import { registerLspTools } from '../../plugins/lsp/src/tools.js';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

/** A PluginContext carrying the REAL path seams the registry wires (contextFor passes exactly these
 *  functions), so a tool test still exercises the per-turn policy under `runWithPolicy` instead
 *  of a permissive stub. Everything else a tool never touches is left off. */
export function lspToolCtx(extra: Partial<PluginContext> = {}): PluginContext {
  return { assertPathAllowed, allowedRoots, defaultCwd, workDir: currentWorkDir, isAdminSession: isAllAccess, registerTool: () => {}, ...extra } as unknown as PluginContext;
}

/** The tools exactly as `register()` hands them to the host, with a manager the caller can pin. */
export function registeredLspTools(manager: LspManager = new LspManager()): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  registerLspTools(lspToolCtx({ registerTool: (t: ToolDefinition) => { tools.push(t); } }), () => manager);
  return tools;
}
