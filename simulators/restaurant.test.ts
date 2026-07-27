import { describe, expect, it } from "vitest"
import { simulateRestaurant } from "./restaurant.js"
import { detect } from "../engine/detector.js"
import { DomainConfigSchema } from "../engine/schema.js"
import restaurantRaw from "../configs/restaurant.json" with { type: "json" }

const FROM = new Date("2026-07-25T18:00:00.000Z")
const DURATION = 3 * 60 * 60 * 1000
const opts = { seed: 7, tables: 6, from: FROM, durationMs: DURATION }

describe("simulateRestaurant", () => {
  it("es determinístico para el mismo seed", () => {
    expect(simulateRestaurant(opts)).toEqual(simulateRestaurant(opts))
  })

  it("difiere cuando cambia el seed", () => {
    expect(simulateRestaurant(opts)).not.toEqual(simulateRestaurant({ ...opts, seed: 8 }))
  })

  it("emite eventos ordenados por timestamp", () => {
    const times = simulateRestaurant(opts).map((e) => Date.parse(e.timestamp))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it("usa solo estados declarados en la config del restaurante", () => {
    const config = DomainConfigSchema.parse(restaurantRaw)
    for (const event of simulateRestaurant(opts)) {
      expect(config.states).toContain(event.state)
    }
  })

  it("con forceIncident garantiza una detección de no-show", () => {
    const config = DomainConfigSchema.parse(restaurantRaw)
    const now = new Date(FROM.getTime() + DURATION)
    const ids = detect(simulateRestaurant({ ...opts, forceIncident: true }), config, now).map(
      (d) => d.ruleId,
    )
    expect(ids).toContain("no-show")
  })

  it("con forceIncident, mesa-1 queda Reservada exactamente en el instante forzado y no se mueve más", () => {
    const end = FROM.getTime() + DURATION
    const reservedAt = end - 45 * 60_000
    const events = simulateRestaurant({ ...opts, forceIncident: true })
    const victimEvents = events.filter((e) => e.entityId === "mesa-1")
    const last = victimEvents[victimEvents.length - 1]

    expect(last).toBeDefined()
    expect(last?.state).toBe("Reservada")
    // Coincide con el instante forzado exactamente: una coincidencia aleatoria
    // de la simulación no reproduciría este timestamp preciso.
    expect(last?.timestamp).toBe(new Date(reservedAt).toISOString())
    // Margen generoso: el umbral de no-show es 900000ms (15 min); el forzado es 3x.
    expect(end - reservedAt).toBeGreaterThan(900_000)
  })
})
