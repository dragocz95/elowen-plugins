/** The ten memory tools core builds in `buildMemoryTools` (src/brain/tools/memoryTools.ts). A visitor turn
 *  runs AS the chatbot account, so anything the agent remembers is filed under that one account and can
 *  surface in another visitor's prompt. Core turns automatic memory off for a chatbot account; denying the
 *  tools for every visitor turn is the per-turn half of the same rule, restated here because core publishes
 *  no constant for the names. A rename in core is a name this list has to follow. */
export const MEMORY_TOOL_NAMES = [
    'MemorySearch',
    'MemoryAdd',
    'MemoryUpdate',
    'MemoryMerge',
    'MemoryDelete',
    'MemoryListRecent',
    'MemoryCategories',
    'MemoryCategoryCreate',
    'MemoryCategoryDelete',
    'MemoryRecategorize',
];
export const asChatbotContext = (ctx) => ctx;
