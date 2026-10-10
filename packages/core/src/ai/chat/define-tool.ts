import type { tool as aiTool } from 'ai'

/**
 * The AI SDK's `tool()`, minus the SDK: at runtime it returns its argument
 * unchanged and exists only so TypeScript infers each tool's input and output
 * from its schema. Re-declaring it keeps the modules that define the note
 * tools from pulling the whole SDK into the startup bundle (see `load-sdk`).
 */
export const tool: typeof aiTool = ((definition: unknown) => definition) as typeof aiTool
