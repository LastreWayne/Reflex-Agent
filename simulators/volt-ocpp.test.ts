import { describe, expect, it } from "vitest"
import { createRng } from "./rng.js"
import { simulateVolt } from "./volt-ocpp.js"
import { detect } from "../engine/detector.js"
import { DomainConfigSchema } from "../engine/schema.js"
import voltRaw from "../configs/volt.json" with { type: "json" }

const FROM = new Date("2026-07-25T18:00:00.000Z")
const DURATION = 2 * 60 * 60 * 1000

describe("createRng", () => {
  it("es determinístico para el mismo seed", () => {
    const a = createRng(42)
    const b = createRng(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it("difiere entre seeds", () => {
    expect(createRng(1)()).not.toBe(createRng(2)())
  })

  it("devuelve valores en [0, 1)", () => {
    const rng = createRng(7)
    for (let i = 0; i < 100; i++) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe("simulateVolt", () => {
  const opts = { seed: 42, stations: 5, from: FROM, durationMs: DURATION }

  it("es determinístico para el mismo seed", () => {
    expect(simulateVolt(opts)).toEqual(simulateVolt(opts))
  })

  it("emite eventos ordenados por timestamp", () => {
    const times = simulateVolt(opts).map((e) => Date.parse(e.timestamp))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it("usa solo estados declarados en la config de VOLT", () => {
    const config = DomainConfigSchema.parse(voltRaw)
    for (const event of simulateVolt(opts)) {
      expect(config.states).toContain(event.state)
    }
  })

  it("marca cada estación con una zona en la metadata", () => {
    for (const event of simulateVolt(opts)) {
      expect(typeof event.metadata.zone).toBe("string")
    }
  })

  it("con forceIncident garantiza una detección de faulted-stuck", () => {
    const config = DomainConfigSchema.parse(voltRaw)
    const now = new Date(FROM.getTime() + DURATION)
    const events = simulateVolt({ ...opts, forceIncident: true })
    const ids = detect(events, config, now).map((d) => d.ruleId)
    expect(ids).toContain("faulted-stuck")
  })
})
