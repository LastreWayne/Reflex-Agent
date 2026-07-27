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

  it("cada config ve lo suyo en el mismo stream de eventos", () => {
    const volt = DomainConfigSchema.parse(voltRaw)
    const restaurant = DomainConfigSchema.parse(restaurantRaw)
    const { events, errors } = normalize([
      { entityId: "mesa-7", timestamp: "2026-07-25T19:40:00.000Z", state: "Reservada" },
    ] satisfies unknown[])
    expect(errors).toEqual([])

    // Mismo stream, dos configs. El restaurante ve una reserva sin check-in
    // (no-show, 20 min > 15); VOLT ve una entidad sin heartbeat (offline,
    // 20 min > 5). Cada motor produce exactamente la detección de SU dominio.
    expect(detect(events, restaurant, NOW).map((d) => d.ruleId)).toEqual(["no-show"])
    expect(detect(events, volt, NOW).map((d) => d.ruleId)).toEqual(["offline"])
  })

  it("detecta una sesión de carga anómala vía duration_vs_baseline usando la config de VOLT", () => {
    const config = DomainConfigSchema.parse(voltRaw)

    // EVC-09 pasa 5 veces por Charging con duraciones crecientes (1..5 min,
    // cerradas), suficientes para cubrir minSamples: 5 de "long-session".
    // Luego entra en Charging una sexta vez y queda abierta 10 min, muy por
    // encima del p95 histórico (el máximo cerrado, 5 min).
    const { events, errors } = normalize([
      { entityId: "EVC-09", timestamp: "2026-07-25T09:00:00.000Z", state: "Available" },
      { entityId: "EVC-09", timestamp: "2026-07-25T09:01:00.000Z", state: "Charging" },
      { entityId: "EVC-09", timestamp: "2026-07-25T09:02:00.000Z", state: "Available" }, // Charging #1: 1 min
      { entityId: "EVC-09", timestamp: "2026-07-25T09:03:00.000Z", state: "Charging" },
      { entityId: "EVC-09", timestamp: "2026-07-25T09:05:00.000Z", state: "Available" }, // Charging #2: 2 min
      { entityId: "EVC-09", timestamp: "2026-07-25T09:06:00.000Z", state: "Charging" },
      { entityId: "EVC-09", timestamp: "2026-07-25T09:09:00.000Z", state: "Available" }, // Charging #3: 3 min
      { entityId: "EVC-09", timestamp: "2026-07-25T09:10:00.000Z", state: "Charging" },
      { entityId: "EVC-09", timestamp: "2026-07-25T09:14:00.000Z", state: "Available" }, // Charging #4: 4 min
      { entityId: "EVC-09", timestamp: "2026-07-25T09:15:00.000Z", state: "Charging" },
      { entityId: "EVC-09", timestamp: "2026-07-25T09:20:00.000Z", state: "Available" }, // Charging #5: 5 min
      { entityId: "EVC-09", timestamp: "2026-07-25T09:21:00.000Z", state: "Charging" }, // abierta
    ] satisfies unknown[])
    expect(errors).toEqual([])

    const localNow = new Date("2026-07-25T09:31:00.000Z") // abierta: 10 min > baseline (5 min)
    const ids = detect(events, config, localNow).map((d) => d.ruleId)
    expect(ids).toContain("long-session")
  })
})
