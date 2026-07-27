import { describe, expect, it } from "vitest"
import { detect } from "./detector.js"
import { normalize } from "./normalizer.js"
import { DomainConfigSchema } from "./schema.js"
import voltRaw from "../configs/volt.json" with { type: "json" }
import restaurantRaw from "../configs/restaurant.json" with { type: "json" }

const NOW = new Date("2026-07-25T20:00:00.000Z")

describe("el mismo motor sobre dos dominios distintos", () => {
  it("los dos configs son válidos contra el mismo schema", () => {
    expect(() => DomainConfigSchema.parse(voltRaw)).not.toThrow()
    expect(() => DomainConfigSchema.parse(restaurantRaw)).not.toThrow()
  })

  it("detecta una estación atascada en falla usando la config de VOLT", () => {
    const config = DomainConfigSchema.parse(voltRaw)
    const { events } = normalize([
      { entityId: "EVC-04", timestamp: "2026-07-25T19:30:00.000Z", state: "Available", metadata: { zone: "norte" } },
      { entityId: "EVC-04", timestamp: "2026-07-25T19:45:00.000Z", state: "Faulted", metadata: { zone: "norte" } },
    ] satisfies unknown[])

    const ids = detect(events, config, NOW).map((d) => d.ruleId)
    expect(ids).toContain("faulted-stuck")
  })

  it("detecta un no-show usando la config del restaurante — misma función", () => {
    const config = DomainConfigSchema.parse(restaurantRaw)
    const { events } = normalize([
      { entityId: "mesa-7", timestamp: "2026-07-25T19:00:00.000Z", state: "Libre" },
      { entityId: "mesa-7", timestamp: "2026-07-25T19:40:00.000Z", state: "Reservada" },
    ] satisfies unknown[])

    const ids = detect(events, config, NOW).map((d) => d.ruleId)
    expect(ids).toContain("no-show")
  })

  it("cada config solo dispara sus propias reglas", () => {
    const volt = DomainConfigSchema.parse(voltRaw)
    const restaurant = DomainConfigSchema.parse(restaurantRaw)
    const { events } = normalize([
      { entityId: "mesa-7", timestamp: "2026-07-25T19:40:00.000Z", state: "Reservada" },
    ] satisfies unknown[])

    // El estado "Reservada" existe en ambos dominios, pero solo el restaurante
    // tiene una regla que lo vigile.
    expect(detect(events, restaurant, NOW).map((d) => d.ruleId)).toContain("no-show")
    expect(detect(events, volt, NOW).filter((d) => d.ruleId === "no-show")).toEqual([])
  })
})
