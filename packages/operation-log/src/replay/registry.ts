import type { ReplayHandler, ReplayHandlerResolution, ReplayDifference } from "./types"

export class ReplayHandlerRegistry {
  readonly #handlers = new Map<string, ReplayHandler>()

  register(eventType: string, handler: ReplayHandler): () => void {
    if (this.#handlers.has(eventType)) throw new Error("DUPLICATE_REPLAY_HANDLER")
    this.#handlers.set(eventType, handler)

    return () => {
      if (this.#handlers.get(eventType) === handler) this.#handlers.delete(eventType)
    }
  }

  resolve(eventType: string, sequence = 0): ReplayHandlerResolution {
    const handler = this.#handlers.get(eventType)
    if (handler !== undefined) return { ok: true, handler }

    const difference: ReplayDifference = {
      type: "missing-handler",
      sequence,
      eventType,
    }
    return { ok: false, difference }
  }
}
