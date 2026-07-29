import { describe, expect, it } from "vitest"
import { DomainConfigSchema, NormalizedEventSchema } from "./schema.js"

describe("NormalizedEventSchema", () => {
  it("aplica metadata vacía por defecto", () => {
    const parsed = NormalizedEventSchema.parse({
      entityId: "EVC-01",
      timestamp: "2026-07-25T10:00:00.000Z",
      state: "Charging",
    })
    expect(parsed.metadata).toEqual({})
  })

  it("rechaza un evento sin entityId", () => {
    expect(() =>
      NormalizedEventSchema.parse({ timestamp: "2026-07-25T10:00:00.000Z", state: "Charging" }),
    ).toThrow()
  })

  it("rechaza un timestamp que no es una fecha ISO", () => {
    expect(() =>
      NormalizedEventSchema.parse({
        entityId: "EVC-01",
        timestamp: "ayer por la tarde",
        state: "Charging",
      }),
    ).toThrow()
  })
})

describe("DomainConfigSchema", () => {
  const base = {
    domain: "volt",
    displayName: "VOLT",
    entity: { singular: "estación", plural: "estaciones" },
    states: ["Available", "Faulted"],
    context: "Red de carga.",
    actions: [{ id: "ignore", type: "noop", description: "No hacer nada" }],
    cooldownMs: 900000,
  }

  it("discrimina las reglas por type", () => {
    const parsed = DomainConfigSchema.parse({
      ...base,
      rules: [
        {
          id: "faulted-stuck",
          type: "duration_in_state",
          state: "Faulted",
          thresholdMs: 600000,
          severity: "high",
          description: "Estación atascada en falla",
        },
      ],
    })
    const rule = parsed.rules[0]!
    expect(rule.type).toBe("duration_in_state")
    if (rule.type === "duration_in_state") expect(rule.thresholdMs).toBe(600000)
  })

  it("rechaza una regla con un type desconocido", () => {
    expect(() =>
      DomainConfigSchema.parse({
        ...base,
        rules: [{ id: "x", type: "telepatia", severity: "low", description: "no" }],
      }),
    ).toThrow()
  })

  it("rechaza una acción con un type que no es executor conocido", () => {
    expect(() =>
      DomainConfigSchema.parse({
        ...base,
        rules: [],
        actions: [{ id: "x", type: "paloma-mensajera", description: "no" }],
      }),
    ).toThrow()
  })
})
