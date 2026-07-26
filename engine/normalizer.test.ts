import { describe, expect, it } from "vitest"
import { normalize } from "./normalizer.js"

describe("normalize", () => {
  it("ordena los eventos por timestamp ascendente", () => {
    const result = normalize([
      { entityId: "A", timestamp: "2026-07-25T10:05:00.000Z", state: "Charging" },
      { entityId: "A", timestamp: "2026-07-25T10:00:00.000Z", state: "Available" },
    ])
    expect(result.map((e) => e.state)).toEqual(["Available", "Charging"])
  })

  it("conserva la metadata", () => {
    const result = normalize([
      { entityId: "A", timestamp: "2026-07-25T10:00:00.000Z", state: "Charging", metadata: { zone: "norte" } },
    ])
    expect(result[0]!.metadata).toEqual({ zone: "norte" })
  })

  it("lanza si un evento es inválido", () => {
    expect(() => normalize([{ entityId: "A", state: "Charging" }])).toThrow()
  })

  it("devuelve lista vacía para entrada vacía", () => {
    expect(normalize([])).toEqual([])
  })
})
