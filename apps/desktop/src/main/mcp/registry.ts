/**
 * MCP tool registry — tracks all available tools across connectors.
 * Used to build the tool list injected into AI engine context.
 */

export interface RegisteredTool {
  connectorId: string;
  name: string;
  namespacedName: string;
  description?: string;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.namespacedName, tool);
  }

  unregisterByConnector(connectorId: string): void {
    for (const [key, tool] of this.tools) {
      if (tool.connectorId === connectorId) {
        this.tools.delete(key);
      }
    }
  }

  getAll(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  get(namespacedName: string): RegisteredTool | undefined {
    return this.tools.get(namespacedName);
  }

  clear(): void {
    this.tools.clear();
  }
}
