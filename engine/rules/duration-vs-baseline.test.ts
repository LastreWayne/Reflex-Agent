import { describe, expect, it } from "vitest"
import { evaluateDurationVsBaseline } from "./duration-vs-baseline.js"
import type { EvalContext, Interval, Rule } from "../schema.js"

const rule = {
  id: "long-session",
  type: "duration_vs_baseline",
  state: "Charging",
  percentile: 95,
  minSamples: 3,
  severity: "medium",
  description: "Sesión de carga anómala",
} as const satisfies Extract<Rule, { type: "duration_vs_baseline" }>

const closed = (entityId: string, durationMs: number, minute: number): Interval => ({
  entityId,
  state: "Charging",
  startedAt: `2026-07-25T09:${String(minute).padStart(2, "0")}:00.000Z`,
  endedAt: `2026-07-25T09:59:00.000Z`,
  durationMs,
  isOpen: false,
  metadata: {},
})

const open = (entityId: string, durationMs: number): Interval => ({
  entityId,
  state: "Charging",
  startedAt: "2026-07-25T10:00:00.000Z",
  endedAt: null,
  durationMs,
  isOpen: true,
  metadata: {},
})

const ctx = (intervals: Interval[]): EvalContext => ({
  intervals,
  events: [],
  now: new Date("2026-07-25T10:30:00.000Z"),
})

describe("evaluateDurationVsBaseline", () => {
  it("no dispara con menos muestras que minSamples", () => {
    const result = evaluateDurationVsBaseline(
      rule,
      ctx([closed("A", 1000, 1), closed("A", 2000, 2), open("A", 999999)]),
    )
    expect(result).toEqual([])
  })

  it("dispara cuando el intervalo abierto supera el percentil del histórico", () => {
    const [detection] = evaluateDurationVsBaseline(
      rule,
      ctx([closed("A", 1000, 1), closed("A", 2000, 2), closed("A", 3000, 3), open("A", 9000)]),
    )
    expect(detection).toMatchObject({ entityId: "A", ruleId: "long-session" })
    expect(detection!.evidence).toMatchObject({ durationMs: 9000, baselineMs: 3000 })
  })

  it("no dispara si el abierto está dentro del baseline", () => {
    const result = evaluateDurationVsBaseline(
      rule,
      ctx([closed("A", 1000, 1), closed("A", 2000, 2), closed("A", 3000, 3), open("A", 2500)]),
    )
    expect(result).toEqual([])
  })

  it("calcula el baseline por entidad, no global", () => {
    const result = evaluateDurationVsBaseline(
      rule,
      ctx([
        closed("A", 1000, 1),
        closed("A", 1000, 2),
        closed("A", 1000, 3),
        closed("B", 90000, 1),
        closed("B", 90000, 2),
        closed("B", 90000, 3),
        open("A", 5000),
        open("B", 5000),
      ]),
    )
    expect(result.map((d) => d.entityId)).toEqual(["A"])
  })

  it("ignora intervalos de otro estado", () => {
    const result = evaluateDurationVsBaseline(
      rule,
      ctx([{ ...closed("A", 1000, 1), state: "Faulted" }, open("A", 999999)]),
    )
    expect(result).toEqual([])
  })

  // Extra boundary assertion to protect a critical behavior

  it("no dispara cuando el abierto es exactamente igual al baseline (boundary)", () => {
    // closed = [1000, 2000, 3000], p95 -> index = ceil(0.95*3)-1 = 2 -> baseline = 3000.
    // open.durationMs === baselineMs must NOT fire (strictly greater required).
    const result = evaluateDurationVsBaseline(
      rule,
      ctx([closed("A", 1000, 1), closed("A", 2000, 2), closed("A", 3000, 3), open("A", 3000)]),
    )
    expect(result).toEqual([])
  })
})
