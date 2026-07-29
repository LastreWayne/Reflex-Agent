import { describe, expect, it } from "vitest"
import { evaluateDurationInState } from "./duration-in-state.js"
import type { EvalContext, Interval, Rule } from "../schema.js"

const rule = {
  id: "faulted-stuck",
  type: "duration_in_state",
  state: "Faulted",
  thresholdMs: 600000,
  severity: "high",
  description: "Estación atascada en falla",
} as const satisfies Extract<Rule, { type: "duration_in_state" }>

const interval = (over: Partial<Interval> = {}): Interval => ({
  entityId: "EVC-01",
  state: "Faulted",
  startedAt: "2026-07-25T10:00:00.000Z",
  endedAt: null,
  durationMs: 700000,
  isOpen: true,
  metadata: {},
  ...over,
})

const ctx = (intervals: Interval[]): EvalContext => ({
  intervals,
  events: [],
  now: new Date("2026-07-25T10:30:00.000Z"),
})

describe("evaluateDurationInState", () => {
  it("dispara cuando la duración supera el umbral", () => {
    const [detection] = evaluateDurationInState(rule, ctx([interval()]))
    expect(detection).toMatchObject({
      ruleId: "faulted-stuck",
      entityId: "EVC-01",
      severity: "high",
      dedupKey: "faulted-stuck:EVC-01:2026-07-25T10:00:00.000Z",
      cooldownKey: "faulted-stuck:EVC-01",
    })
    expect(detection!.evidence).toMatchObject({ durationMs: 700000, thresholdMs: 600000 })
  })

  it("no dispara por debajo del umbral", () => {
    expect(evaluateDurationInState(rule, ctx([interval({ durationMs: 500000 })]))).toEqual([])
  })

  it("ignora intervalos de otro estado", () => {
    expect(evaluateDurationInState(rule, ctx([interval({ state: "Charging" })]))).toEqual([])
  })

  it("también dispara sobre intervalos ya cerrados", () => {
    const closed = interval({ endedAt: "2026-07-25T10:12:00.000Z", isOpen: false, durationMs: 720000 })
    expect(evaluateDurationInState(rule, ctx([closed]))).toHaveLength(1)
  })

  it("emite una detección por cada intervalo que supera el umbral", () => {
    const detections = evaluateDurationInState(
      rule,
      ctx([interval(), interval({ entityId: "EVC-02" })]),
    )
    expect(detections.map((d) => d.entityId)).toEqual(["EVC-01", "EVC-02"])
  })
})
