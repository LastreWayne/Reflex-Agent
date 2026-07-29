import { describe, expect, it } from "vitest"
import { normalize } from "./normalizer.js"

describe("normalize", () => {
  it("ordena los eventos por timestamp ascendente", () => {
    const { events } = normalize([
      { entityId: "A", timestamp: "2026-07-25T10:05:00.000Z", state: "Charging" },
      { entityId: "A", timestamp: "2026-07-25T10:00:00.000Z", state: "Available" },
    ])
    expect(events.map((e) => e.state)).toEqual(["Available", "Charging"])
  })

  it("conserva la metadata", () => {
    const { events } = normalize([
      { entityId: "A", timestamp: "2026-07-25T10:00:00.000Z", state: "Charging", metadata: { zone: "norte" } },
    ])
    expect(events[0]!.metadata).toEqual({ zone: "norte" })
  })

  it("devuelve ambas listas vacías para entrada vacía", () => {
    expect(normalize([])).toEqual({ events: [], errors: [] })
  })

  it("descarta las entradas inválidas y devuelve el resto", () => {
    const { events, errors } = normalize([
      { entityId: "EVC-02", timestamp: "2026-07-25T10:05:00.000Z", state: "Charging" },
      { entityId: "EVC-09", timestamp: "ayer por la tarde", state: "Faulted" },
      { entityId: "EVC-01", timestamp: "2026-07-25T10:00:00.000Z", state: "Available" },
    ])

    expect(events.map((e) => e.entityId)).toEqual(["EVC-01", "EVC-02"])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      index: 1,
      entityId: "EVC-09",
      fields: ["timestamp"],
    })
  })

  it("deja entityId en null y fields vacío si la entrada no es un objeto", () => {
    const { events, errors } = normalize(["esto no es un evento"])

    expect(events).toEqual([])
    expect(errors[0]).toMatchObject({ index: 0, entityId: null, fields: [] })
  })
})
