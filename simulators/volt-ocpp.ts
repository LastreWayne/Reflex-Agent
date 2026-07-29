import type { NormalizedEvent } from "../engine/schema.js"
import { createRng } from "./rng.js"

const ZONES = ["norte", "centro", "sur"] as const
const CYCLE = ["Available", "Occupied", "Charging", "Available"] as const

export interface SimulateVoltOptions {
  seed: number
  stations: number
  from: Date
  durationMs: number
  forceIncident?: boolean
}

export function simulateVolt(opts: SimulateVoltOptions): NormalizedEvent[] {
  const rng = createRng(opts.seed)
  const events: NormalizedEvent[] = []
  const end = opts.from.getTime() + opts.durationMs

  for (let i = 0; i < opts.stations; i++) {
    const entityId = `EVC-${String(i + 1).padStart(2, "0")}`
    const zone = ZONES[Math.floor(rng() * ZONES.length)]!
    const metadata = { zone }

    let cursor = opts.from.getTime() + Math.floor(rng() * 5 * 60_000)
    let step = 0

    while (cursor < end) {
      const state = CYCLE[step % CYCLE.length]!
      events.push({
        entityId,
        entityType: "station",
        timestamp: new Date(cursor).toISOString(),
        state,
        metadata,
      })
      cursor += 5 * 60_000 + Math.floor(rng() * 20 * 60_000)
      step++
    }
  }

  if (opts.forceIncident) {
    // Una estación entra en Faulted 30 min antes del final y no sale.
    const faultAt = end - 30 * 60_000
    const victim = "EVC-01"
    const zone = events.find((e) => e.entityId === victim)?.metadata.zone ?? ZONES[0]
    const kept = events.filter(
      (e) => !(e.entityId === victim && Date.parse(e.timestamp) >= faultAt),
    )
    kept.push({
      entityId: victim,
      entityType: "station",
      timestamp: new Date(faultAt).toISOString(),
      state: "Faulted",
      metadata: { zone },
    })
    events.length = 0
    events.push(...kept)
  }

  return events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}
