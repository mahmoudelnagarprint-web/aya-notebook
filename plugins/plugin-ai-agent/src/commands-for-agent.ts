import type { Kernel } from '@ayatodoist/core-kernel';

export interface ToolSpec {
  /** Provider-safe name: dots are illegal in most function-calling APIs. */
  name: string;
  originalName: string;
  description: string;
  parameters: Record<string, unknown>;
  title?: string;
  destructive: boolean;
  kind: 'query' | 'mutation';
}

export interface AgentTool {
  tool: ToolSpec;
  handler: (input: unknown) => Promise<unknown>;
  kind: 'query' | 'mutation';
  destructive: boolean;
}

/** `task.create` → `task__create`, then anything still illegal becomes `_`. */
function sanitizeName(name: string): string {
  return name.replace(/\./g, '__').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Every visible kernel command, projected into a provider-safe tool. */
export function commandsForAgent(kernel: Kernel): AgentTool[] {
  const catalogue = kernel.toolCatalogue() as Array<{
    name: string;
    title: string;
    description: string;
    kind: 'query' | 'mutation';
    destructive: boolean;
    inputSchema: Record<string, unknown>;
  }>;

  return catalogue.map((definition) => ({
    tool: {
      name: sanitizeName(definition.name),
      originalName: definition.name,
      description: definition.description,
      parameters: definition.inputSchema ?? { type: 'object', properties: {} },
      title: definition.title,
      destructive: definition.destructive === true,
      kind: definition.kind,
    },
    handler: async (input: unknown) => kernel.execute(definition.name, input as never),
    kind: definition.kind,
    destructive: definition.destructive === true,
  }));
}

export function buildToolSpecs(kernel: Kernel): ToolSpec[] {
  return commandsForAgent(kernel).map((entry) => entry.tool);
}
