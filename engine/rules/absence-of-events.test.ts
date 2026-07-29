import { describe, expect, it } from "vitest"
import { evaluateAbsenceOfEvents } from "./absence-of-events.js"
import type { EvalContext, NormalizedEvent, Rule } from "../schema.js"

const rule = {
  id: "offline",
  type: "absence_of_events",
  windowMs: 300000,
  severity: "high",
  description: "Estación sin heartbeat",
} as const satisfies Extract<Rule, { type: "absence_of_events" }>

const ev = (entityId: string, iso: string): NormalizedEvent => ({
  entityId,
  timestamp: iso,
  state: "Available",
  metadata: {},
})

const ctx = (events: NormalizedEvent[]): EvalContext => ({
  intervals: [],
  events,
  now: new Date("2026-07-25T10:30:00.000Z"),
})

describe("evaluateAbsenceOfEvents", () => {
  it("dispara cuando la entidad lleva más que la ventana sin reportar", () => {
    const [detection] = evaluateAbsenceOfEvents(rule, ctx([ev("EVC-01", "2026-07-25T10:20:00.000Z")]))
    expect(detection).toMatchObject({
      entityId: "EVC-01",
      dedupKey: "offline:EVC-01:2026-07-25T10:20:00.000Z",
      cooldownKey: "offline:EVC-01",
    })
    expect(detection!.evidence).toMatchObject({
      lastSeenAt: "2026-07-25T10:20:00.000Z",
      silentForMs: 600000,
      windowMs: 300000
    })
  })

  it("no dispara si reportó dentro de la ventana", () => {
    expect(evaluateAbsenceOfEvents(rule, ctx([ev("EVC-01", "2026-07-25T10:28:00.000Z")]))).toEqual([])
  })

  it("usa el evento más reciente de cada entidad", () => {
    const result = evaluateAbsenceOfEvents(
      rule,
      ctx([ev("EVC-01", "2026-07-25T10:00:00.000Z"), ev("EVC-01", "2026-07-25T10:29:00.000Z")]),
    )
    expect(result).toEqual([])
  })

  it("evalúa cada entidad por separado", () => {
    const result = evaluateAbsenceOfEvents(
      rule,
      ctx([ev("EVC-01", "2026-07-25T10:00:00.000Z"), ev("EVC-02", "2026-07-25T10:29:00.000Z")]),
    )
    expect(result.map((d) => d.entityId)).toEqual(["EVC-01"])
  })

  it("no dispara sin eventos", () => {
    expect(evaluateAbsenceOfEvents(rule, ctx([]))).toEqual([])
  })

  it("no dispara si la entidad lleva exactamente la ventana sin reportar (boundary)", () => {
    const [detection] = evaluateAbsenceOfEvents(rule, ctx([ev("EVC-01", "2026-07-25T10:25:00.000Z")]))
    expect(detection).toBeUndefined()
  })
})
