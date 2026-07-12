import type { WorkspacePanelDescriptor } from "./types"

export class WorkspaceRegistryError extends Error {
  readonly code: "PANEL_ALREADY_REGISTERED"

  constructor(code: "PANEL_ALREADY_REGISTERED", id: string) {
    super(`${code}: ${id}`)
    this.name = "WorkspaceRegistryError"
    this.code = code
  }
}

export class PanelRegistry {
  readonly #panels = new Map<string, WorkspacePanelDescriptor>()

  register(panel: WorkspacePanelDescriptor): void {
    if (this.#panels.has(panel.id)) {
      throw new WorkspaceRegistryError("PANEL_ALREADY_REGISTERED", panel.id)
    }
    this.#panels.set(panel.id, panel)
  }

  get(id: string): WorkspacePanelDescriptor | undefined {
    return this.#panels.get(id)
  }

  has(id: string): boolean {
    return this.#panels.has(id)
  }

  all(): WorkspacePanelDescriptor[] {
    return [...this.#panels.values()]
  }
}

export const WorkspacePanelRegistry = PanelRegistry

export function createPanelRegistry(): PanelRegistry {
  return new PanelRegistry()
}
