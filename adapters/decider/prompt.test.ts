import { describe, expect, it } from "vitest"
import { buildPrompt, buildTools } from "./prompt.js"
import { DomainConfigSchema, type Detection } from "../../engine/schema.js"
import voltRaw from "../../configs/volt.json" with { type: "json" }

const config = DomainConfigSchema.parse(voltRaw)

const detection: Detection = {
  ruleId: "faulted-stuck",
  entityId: "EVC-04",
  detectedAt: "2026-07-25T20:00:00.000Z",
  severity: "high",
  evidence: { state: "Faulted", durationMs: 720000, thresholdMs: 600000 },
  dedupKey: "faulted-stuck:EVC-04:2026-07-25T19:48:00.000Z",
  cooldownKey: "faulted-stuck:EVC-04",
}

describe("buildTools", () => {
  it("crea una tool por cada acción del config", () => {
    const tools = buildTools(config)
    expect(tools.map((t) => t.name)).toEqual(config.actions.map((a) => a.id))
  })

  it("usa la description del config como description de la tool", () => {
    const tool = buildTools(config).find((t) => t.name === "alert-ops")!
    expect(tool.description).toBe(
      config.actions.find((a) => a.id === "alert-ops")!.description,
    )
  })

  it("marca las tools como strict y cierra el schema", () => {
    for (const tool of buildTools(config)) {
      expect(tool.strict).toBe(true)
      expect(tool.input_schema.additionalProperties).toBe(false)
      expect(tool.input_schema.required).toEqual(["message", "reason"])
    }
  })

  it("no filtra la config de las acciones en las tools", () => {
    const serialized = JSON.stringify(buildTools(config))
    expect(serialized).not.toContain("env:")
    expect(serialized).not.toContain("webhookUrl")
  })
})

describe("buildPrompt", () => {
  it("incluye el contexto del dominio en el system", () => {
    expect(buildPrompt(detection, config).system).toContain(config.context)
  })

  it("usa el naming de la entidad del config", () => {
    expect(buildPrompt(detection, config).system).toContain("estación")
  })

  it("incluye la descripción de la regla y la evidencia en el user", () => {
    const { user } = buildPrompt(detection, config)
    expect(user).toContain("Estación atascada en falla")
    expect(user).toContain("EVC-04")
    expect(user).toContain("720000")
  })
})
