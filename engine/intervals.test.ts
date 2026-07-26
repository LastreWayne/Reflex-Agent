import { describe, expect, it } from "vitest"
import { toIntervals } from "./intervals.js"
import type { NormalizedEvent } from "./schema.js"

const ev = (entityId: string, minute: number, state: string, metadata = {}): NormalizedEvent => ({
  entityId,
  timestamp: `2026-07-25T10:${String(minute).padStart(2, "0")}:00.000Z`,
  state,
  metadata,
})

const NOW = new Date("2026-07-25T10:30:00.000Z")

describe("toIntervals", () => {
  it("cierra un intervalo cuando cambia el estado", () => {
    const [first] = toIntervals([ev("A", 0, "Available"), ev("A", 10, "Charging")], NOW)
    expect(first).toMatchObject({
      entityId: "A",
      state: "Available",
      startedAt: "2026-07-25T10:00:00.000Z",
      endedAt: "2026-07-25T10:10:00.000Z",
      durationMs: 600000,
      isOpen: false,
    })
  })

  it("deja el último intervalo abierto y lo mide hasta now", () => {
    const intervals = toIntervals([ev("A", 0, "Available"), ev("A", 10, "Charging")], NOW)
    const last = intervals[intervals.length - 1]!
    expect(last).toMatchObject({
      state: "Charging",
      endedAt: null,
      isOpen: true,
      durationMs: 1200000,
    })
  })

  it("ignora eventos consecutivos con el mismo estado", () => {
    const intervals = toIntervals(
      [ev("A", 0, "Charging"), ev("A", 5, "Charging"), ev("A", 10, "Available")],
      NOW,
    )
    expect(intervals).toHaveLength(2)
    expect(intervals[0]!.durationMs).toBe(600000)
  })

  it("separa entidades distintas", () => {
    const intervals = toIntervals([ev("A", 0, "Charging"), ev("B", 0, "Faulted")], NOW)
    expect(intervals.map((i) => i.entityId).sort()).toEqual(["A", "B"])
    expect(intervals.every((i) => i.isOpen)).toBe(true)
  })

  it("toma la metadata del evento que abrió el intervalo", () => {
    const intervals = toIntervals(
      [ev("A", 0, "Charging", { zone: "norte" }), ev("A", 10, "Available", { zone: "sur" })],
      NOW,
    )
    expect(intervals[0]!.metadata).toEqual({ zone: "norte" })
  })

  it("devuelve lista vacía sin eventos", () => {
    expect(toIntervals([], NOW)).toEqual([])
  })

  it("ordena los intervalos por startedAt across entidades", () => {
    // A se inserta primero en el Map pero empieza después que B.
    const intervals = toIntervals([ev("A", 20, "Charging"), ev("B", 5, "Faulted")], NOW)
    expect(intervals.map((i) => i.entityId)).toEqual(["B", "A"])
  })
})
