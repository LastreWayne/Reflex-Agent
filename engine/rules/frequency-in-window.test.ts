import { describe, expect, it } from "vitest"
import { evaluateFrequencyInWindow } from "./frequency-in-window.js"
import type { EvalContext, Interval, Rule } from "../schema.js"

const rule = {
  id: "demand-spike",
  type: "frequency_in_window",
  toState: "Charging",
  windowMs: 900000,
  count: 3,
  severity: "low",
  description: "Pico de demanda",
} as const satisfies Extract<Rule, { type: "frequency_in_window" }>

const iv = (entityId: string, minute: number, state = "Charging", metadata = {}): Interval => ({
  entityId,
  state,
  startedAt: `2026-07-25T10:${String(minute).padStart(2, "0")}:00.000Z`,
  endedAt: null,
  durationMs: 0,
  isOpen: true,
  metadata,
})

const ctx = (intervals: Interval[]): EvalContext => ({
  intervals,
  events: [],
  now: new Date("2026-07-25T10:30:00.000Z"),
})

describe("evaluateFrequencyInWindow", () => {
  it("dispara cuando se alcanza el conteo dentro de la ventana", () => {
    const [detection] = evaluateFrequencyInWindow(
      rule,
      ctx([iv("A", 20), iv("A", 22), iv("A", 25)]),
    )
    expect(detection).toMatchObject({ entityId: "A", ruleId: "demand-spike" })
    expect(detection!.evidence).toMatchObject({ count: 3, threshold: 3 })
  })

  it("no dispara por debajo del conteo", () => {
    expect(evaluateFrequencyInWindow(rule, ctx([iv("A", 20), iv("A", 22)]))).toEqual([])
  })

  it("descarta lo que quedó fuera de la ventana", () => {
    // 10:10 está a 20 min de now; la ventana es de 15 min.
    expect(
      evaluateFrequencyInWindow(rule, ctx([iv("A", 10), iv("A", 22), iv("A", 25)])),
    ).toEqual([])
  })

  it("ignora transiciones a otro estado", () => {
    expect(
      evaluateFrequencyInWindow(rule, ctx([iv("A", 20), iv("A", 22), iv("A", 25, "Faulted")])),
    ).toEqual([])
  })

  it("agrupa por un campo de metadata cuando hay groupBy", () => {
    const grouped = { ...rule, groupBy: "zone" } as const
    const [detection] = evaluateFrequencyInWindow(
      grouped,
      ctx([
        iv("A", 20, "Charging", { zone: "norte" }),
        iv("B", 22, "Charging", { zone: "norte" }),
        iv("C", 25, "Charging", { zone: "norte" }),
        iv("D", 26, "Charging", { zone: "sur" }),
      ]),
    )
    expect(detection).toMatchObject({ entityId: "norte" })
    expect(detection!.evidence).toMatchObject({ count: 3, groupBy: "zone" })
  })

  it("ignora entradas sin el campo de groupBy", () => {
    const grouped = { ...rule, groupBy: "zone" } as const
    expect(
      evaluateFrequencyInWindow(grouped, ctx([iv("A", 20), iv("B", 22), iv("C", 25)])),
    ).toEqual([])
  })

  // Extra boundary assertions to protect critical behaviors

  it("dispara exactamente en el umbral (count = 3)", () => {
    // This is the boundary: exactly 3 intervals should fire with count: 3
    const [detection] = evaluateFrequencyInWindow(
      rule,
      ctx([iv("A", 20), iv("A", 22), iv("A", 25)]),
    )
    expect(detection).toBeDefined()
    expect(detection!.evidence).toMatchObject({ count: 3, threshold: 3 })
  })

  it("no dispara con count-1 intervalos (threshold boundary)", () => {
    // With only 2 intervals (count - 1), should not fire
    expect(evaluateFrequencyInWindow(rule, ctx([iv("A", 20), iv("A", 22)]))).toEqual([])
  })

  it("cuenta intervalos que comienzan exactamente en el borde de la ventana", () => {
    // now = 10:30:00, windowMs = 900000ms = 15 min
    // windowStart = 10:15:00
    // An interval starting at exactly 10:15:00 should count
    const detections = evaluateFrequencyInWindow(
      rule,
      ctx([iv("A", 15), iv("A", 22), iv("A", 25)]),
    )
    expect(detections).toHaveLength(1)
    expect(detections[0]!.evidence).toMatchObject({ count: 3 })
  })

  it("evidence.groupBy es null cuando no hay groupBy", () => {
    const [detection] = evaluateFrequencyInWindow(
      rule,
      ctx([iv("A", 20), iv("A", 22), iv("A", 25)]),
    )
    expect(detection!.evidence).toHaveProperty("groupBy")
    expect(detection!.evidence.groupBy).toBeNull()
  })

  it("dedupKey incluye el windowStartIso completo", () => {
    // windowStart = 10:30:00 - 15min = 10:15:00
    // windowStartIso should be "2026-07-25T10:15:00.000Z"
    const [detection] = evaluateFrequencyInWindow(
      rule,
      ctx([iv("A", 20), iv("A", 22), iv("A", 25)]),
    )
    expect(detection!.dedupKey).toBe("demand-spike:A:2026-07-25T10:15:00.000Z")
  })

  it("dedupKey con groupBy incluye el valor del grupo", () => {
    const grouped = { ...rule, groupBy: "zone" } as const
    const [detection] = evaluateFrequencyInWindow(
      grouped,
      ctx([
        iv("A", 20, "Charging", { zone: "norte" }),
        iv("B", 22, "Charging", { zone: "norte" }),
        iv("C", 25, "Charging", { zone: "norte" }),
      ]),
    )
    expect(detection!.dedupKey).toBe("demand-spike:norte:2026-07-25T10:15:00.000Z")
  })
})
