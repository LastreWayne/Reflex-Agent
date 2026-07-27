import { describe, expect, it } from "vitest"
import { detect, suppress } from "./detector.js"
import { createMemoryStore } from "../adapters/store/memory.js"
import type { DomainConfig, NormalizedEvent } from "./schema.js"

const config: DomainConfig = {
  domain: "test",
  displayName: "Test",
  entity: { singular: "cosa", plural: "cosas" },
  states: ["Ok", "Bad"],
  context: "Dominio de prueba.",
  rules: [
    {
      id: "bad-stuck",
      type: "duration_in_state",
      state: "Bad",
      thresholdMs: 600000,
      severity: "high",
      description: "Atascado en Bad",
    },
  ],
  actions: [{ id: "ignore", type: "noop", description: "No hacer nada", config: {} }],
  cooldownMs: 900000,
}

const events: NormalizedEvent[] = [
  { entityId: "X", timestamp: "2026-07-25T10:00:00.000Z", state: "Bad", metadata: {} },
]
const NOW = new Date("2026-07-25T10:30:00.000Z")

describe("detect", () => {
  it("corre todas las reglas del config", () => {
    expect(detect(events, config, NOW)).toHaveLength(1)
  })

  it("es puro: la misma entrada da el mismo resultado", () => {
    expect(detect(events, config, NOW)).toEqual(detect(events, config, NOW))
  })

  it("no detecta nada sin reglas", () => {
    expect(detect(events, { ...config, rules: [] }, NOW)).toEqual([])
  })
})

describe("suppress", () => {
  it("deja pasar una detección nueva", () => {
    const store = createMemoryStore()
    expect(suppress(detect(events, config, NOW), store, config, NOW)).toHaveLength(1)
  })

  it("descarta el segundo disparo del mismo intervalo", () => {
    const store = createMemoryStore()
    suppress(detect(events, config, NOW), store, config, NOW)
    const later = new Date("2026-07-25T10:31:00.000Z")
    expect(suppress(detect(events, config, later), store, config, later)).toEqual([])
  })

  it("respeta el cooldown ante un intervalo nuevo de la misma entidad y regla", () => {
    const store = createMemoryStore()
    suppress(detect(events, config, NOW), store, config, NOW)

    // Nuevo intervalo Bad (pasó por Ok en el medio) 5 min después: dentro del cooldown de 15 min.
    const reincidencia: NormalizedEvent[] = [
      ...events,
      { entityId: "X", timestamp: "2026-07-25T10:31:00.000Z", state: "Ok", metadata: {} },
      { entityId: "X", timestamp: "2026-07-25T10:32:00.000Z", state: "Bad", metadata: {} },
    ]
    const later = new Date("2026-07-25T10:43:00.000Z")
    expect(suppress(detect(reincidencia, config, later), store, config, later)).toEqual([])
  })

  it("deja pasar de nuevo una vez vencido el cooldown", () => {
    const store = createMemoryStore()
    suppress(detect(events, config, NOW), store, config, NOW)

    const reincidencia: NormalizedEvent[] = [
      ...events,
      { entityId: "X", timestamp: "2026-07-25T10:31:00.000Z", state: "Ok", metadata: {} },
      { entityId: "X", timestamp: "2026-07-25T10:32:00.000Z", state: "Bad", metadata: {} },
    ]
    const muchoDespues = new Date("2026-07-25T11:00:00.000Z")
    expect(suppress(detect(reincidencia, config, muchoDespues), store, config, muchoDespues)).toHaveLength(1)
  })

  // Extra boundary assertion to protect a critical behavior

  it("deja pasar exactamente cuando el cooldown terminó (boundary, no un ms más)", () => {
    const store = createMemoryStore()
    suppress(detect(events, config, NOW), store, config, NOW)

    // Nuevo intervalo Bad, distinto dedupKey (startedAt 10:32).
    const reincidencia: NormalizedEvent[] = [
      ...events,
      { entityId: "X", timestamp: "2026-07-25T10:31:00.000Z", state: "Ok", metadata: {} },
      { entityId: "X", timestamp: "2026-07-25T10:32:00.000Z", state: "Bad", metadata: {} },
    ]
    // NOW + cooldownMs (900000ms = 15min) exactamente: 10:30:00 + 15min = 10:45:00.
    // La condición de supresión es "elapsed < cooldownMs"; en el borde exacto (elapsed === cooldownMs)
    // NO debe suprimir.
    const enElBorde = new Date("2026-07-25T10:45:00.000Z")
    expect(
      suppress(detect(reincidencia, config, enElBorde), store, config, enElBorde),
    ).toHaveLength(1)
  })
})
