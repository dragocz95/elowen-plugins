import { registerLspUi } from './runtime';
import { LspRail } from './LspRail';
registerLspUi({ requiresApiVersion: 17, chatRailSections: { lsp: LspRail } });