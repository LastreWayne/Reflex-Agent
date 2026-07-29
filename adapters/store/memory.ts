import type { StateStore } from "../../engine/schema.js"

export function createMemoryStore(): StateStore {
  const fired = new Map<string, Date>()
  return {
    lastFiredAt: (key) => fired.get(key) ?? null,
    markFired: (key, at) => {
      fired.set(key, at)
    },
  }
}
