import type { NormalizedEvent } from "../engine/schema.js"
import { createRng } from "./rng.js"

const CYCLE = ["Libre", "Reservada", "Ocupada", "Libre"] as const

export interface SimulateRestaurantOptions {
  seed: number
  tables: number
  from: Date
  durationMs: number
  forceIncident?: boolean
}

export function simulateRestaurant(opts: SimulateRestaurantOptions): NormalizedEvent[] {
  const rng = createRng(opts.seed)
  const events: NormalizedEvent[] = []
  const end = opts.from.getTime() + opts.durationMs

  for (let i = 0; i < opts.tables; i++) {
    const entityId = `mesa-${i + 1}`
    let cursor = opts.from.getTime() + Math.floor(rng() * 15 * 60_000)
    let step = 0

    while (cursor < end) {
      events.push({
        entityId,
        entityType: "table",
        timestamp: new Date(cursor).toISOString(),
        state: CYCLE[step % CYCLE.length]!,
        metadata: { seats: 2 + Math.floor(rng() * 4) },
      })
      cursor += 10 * 60_000 + Math.floor(rng() * 40 * 60_000)
      step++
    }
  }

  if (opts.forceIncident) {
    // Una mesa queda Reservada 45 min antes del cierre y nadie hace check-in:
    // margen 3x sobre el umbral de no-show (900000ms / 15 min).
    const reservedAt = end - 45 * 60_000
    const victim = "mesa-1"
    const kept = events.filter(
      (e) => !(e.entityId === victim && Date.parse(e.timestamp) >= reservedAt),
    )
    kept.push({
      entityId: victim,
      entityType: "table",
      timestamp: new Date(reservedAt).toISOString(),
      state: "Reservada",
      metadata: { seats: 4 },
    })
    events.length = 0
    events.push(...kept)
  }

  return events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}
