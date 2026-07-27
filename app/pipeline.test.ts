import { describe, expect, it } from "vitest"
import { CONFIGS } from "./domains.js"
import {
  DEFAULT_AT,
  DEFAULT_MAX_DECISIONS,
  DEFAULT_PARAMS,
  OFFLINE_DECISIONS,
  buildRun,
  findAction,
  formatClock,
  formatDuration,
  formatEvidence,
  formatEvidenceValue,
  offlineDecision,
  parseParams,
  simulatedExecution,
  toSearch,
  type DemoParams,
} from "./pipeline.js"

const base: DemoParams = { ...DEFAULT_PARAMS }

describe("parseParams", () => {
  it("usa los defaults cuando la URL viene vacía", () => {
    expect(parseParams("")).toEqual(DEFAULT_PARAMS)
  })

  it("lee dominio, semilla, force, max y at", () => {
    expect(parseParams("?domain=restaurant&seed=7&force=1&max=2&at=2026-01-02T03:04:05.000Z")).toEqual({
      domain: "restaurant",
      seed: 7,
      offline: "off",
      forceIncident: true,
      maxDecisions: 2,
      at: "2026-01-02T03:04:05.000Z",
    })
  })

  it("cae al default con valores inválidos en vez de romper", () => {
    const params = parseParams("?domain=marte&seed=cero&max=-3&at=ayer")
    expect(params).toEqual(DEFAULT_PARAMS)
  })

  it("distingue los tres modos offline", () => {
    expect(parseParams("").offline).toBe("off")
    expect(parseParams("?offline=0").offline).toBe("off")
    expect(parseParams("?offline=1").offline).toBe("full")
    expect(parseParams("?offline=decide").offline).toBe("decide")
  })

  it("hace ida y vuelta con toSearch", () => {
    const params: DemoParams = {
      domain: "restaurant",
      seed: 99,
      offline: "decide",
      forceIncident: true,
      maxDecisions: 5,
      at: "2026-03-04T05:06:07.000Z",
    }
    expect(parseParams(toSearch(params))).toEqual(params)
  })
})

describe("buildRun", () => {
  it("es determinista: mismos params, misma corrida hasta el timestamp", () => {
    const a = buildRun(base)
    const b = buildRun({ ...base })
    expect(b.events).toEqual(a.events)
    expect(b.intervals).toEqual(a.intervals)
    expect(b.classified.map((c) => c.detection)).toEqual(a.classified.map((c) => c.detection))
  })

  it("otra semilla produce otra secuencia de eventos", () => {
    const a = buildRun(base)
    const b = buildRun({ ...base, seed: 43 })
    expect(b.events).not.toEqual(a.events)
  })

  it("la ventana termina exactamente en `at` y dura tres horas", () => {
    const run = buildRun(base)
    expect(run.now.toISOString()).toBe(DEFAULT_AT)
    expect(run.now.getTime() - run.from.getTime()).toBe(3 * 60 * 60_000)
  })

  it("forzar incidente en volt produce una detección de faulted-stuck", () => {
    const run = buildRun({ ...base, forceIncident: true })
    const reglas = run.classified.map((c) => c.detection.ruleId)
    expect(reglas).toContain("faulted-stuck")
  })

  it("faulted-stuck queda primero en la cola: es la de mayor severidad y la primera regla", () => {
    const run = buildRun({ ...base, forceIncident: true })
    expect(run.queued[0]?.ruleId).toBe("faulted-stuck")
  })

  it("forzar incidente en el restaurante produce un no-show", () => {
    const run = buildRun({ ...base, domain: "restaurant", forceIncident: true })
    expect(run.classified.map((c) => c.detection.ruleId)).toContain("no-show")
  })

  it("respeta el tope de decisiones", () => {
    const run = buildRun({ ...base, domain: "restaurant", maxDecisions: 2 })
    expect(run.queued.length).toBeLessThanOrEqual(2)
    const fuera = run.classified.filter((c) => c.status === "fuera-de-cupo")
    expect(fuera.length).toBeGreaterThan(0)
  })

  it("por defecto no manda más de DEFAULT_MAX_DECISIONS a decidir", () => {
    expect(buildRun(base).queued.length).toBeLessThanOrEqual(DEFAULT_MAX_DECISIONS)
  })

  it("las detecciones de la cola tienen dedupKeys únicos — sirven de key de React", () => {
    const run = buildRun({ ...base, domain: "restaurant", maxDecisions: 10 })
    const keys = run.queued.map((d) => d.dedupKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("clasifica las suprimidas con un motivo", () => {
    const run = buildRun({ ...base, domain: "restaurant", maxDecisions: 99 })
    const suprimidas = run.classified.filter((c) => c.status === "suprimida")
    expect(suprimidas.length).toBeGreaterThan(0)
    for (const c of suprimidas) {
      expect(["dedup", "cooldown"]).toContain(c.suppressedBy)
    }
  })

  it("lo que pasa la supresión nunca lleva motivo de supresión", () => {
    const run = buildRun({ ...base, maxDecisions: 99 })
    for (const c of run.classified) {
      if (c.status !== "suprimida") expect(c.suppressedBy).toBeNull()
    }
  })

  it("cada dominio usa su propio vocabulario de entidad", () => {
    expect(buildRun(base).config.entity.singular).toBe("estación")
    expect(buildRun({ ...base, domain: "restaurant" }).config.entity.singular).toBe("mesa")
  })
})

describe("decisiones pregrabadas (modo offline)", () => {
  it("toda regla de todo dominio tiene decisión pregrabada", () => {
    for (const [domain, config] of Object.entries(CONFIGS)) {
      for (const rule of config.rules) {
        expect(OFFLINE_DECISIONS[`${domain}:${rule.id}`], `${domain}:${rule.id}`).toBeDefined()
      }
    }
  })

  it("toda decisión pregrabada apunta a una acción que existe en su config", () => {
    for (const [key, decision] of Object.entries(OFFLINE_DECISIONS)) {
      const domain = key.split(":")[0] as keyof typeof CONFIGS
      expect(findAction(CONFIGS[domain], decision.actionId), key).toBeDefined()
    }
  })

  it("interpola la entidad concreta en el mensaje", () => {
    const run = buildRun({ ...base, forceIncident: true })
    const detection = run.queued[0]
    expect(detection).toBeDefined()
    const decision = offlineDecision("volt", detection!, run.config)
    expect(decision.message).toContain(detection!.entityId)
    expect(decision.message).not.toContain("{entidad}")
  })

  it("no duplica el sustantivo del dominio: el nombre va en la plantilla, no en {entidad}", () => {
    // Regresión: interpolar `${entity.singular} ${entityId}` dentro de una
    // plantilla que ya decía "La estación {entidad}" producía
    // "La estación estación EVC-01".
    for (const [key, recorded] of Object.entries(OFFLINE_DECISIONS)) {
      const domain = key.split(":")[0] as keyof typeof CONFIGS
      const config = CONFIGS[domain]
      const message = offlineDecision(
        domain,
        {
          ruleId: key.split(":")[1] ?? "",
          entityId: "X-1",
          detectedAt: DEFAULT_AT,
          severity: "low",
          evidence: {},
          dedupKey: "k",
          cooldownKey: "c",
        },
        config,
      ).message
      expect(message, key).not.toContain(`${config.entity.singular} ${config.entity.singular}`)
      expect(message, key).toBe(recorded.message.replaceAll("{entidad}", "X-1"))
    }
  })

  it("usa vocabulario del dominio en el mensaje", () => {
    const run = buildRun({ ...base, domain: "restaurant", forceIncident: true })
    const detection = run.queued.find((d) => d.ruleId === "no-show")
    expect(detection).toBeDefined()
    expect(offlineDecision("restaurant", detection!, run.config).message).toContain("mesa")
  })

  it("una regla sin pregrabar cae a la acción de descarte en vez de romper", () => {
    const decision = offlineDecision(
      "volt",
      {
        ruleId: "regla-inventada",
        entityId: "EVC-99",
        detectedAt: DEFAULT_AT,
        severity: "low",
        evidence: {},
        dedupKey: "k",
        cooldownKey: "c",
      },
      CONFIGS.volt,
    )
    expect(decision.actionId).toBe("ignore")
    expect(findAction(CONFIGS.volt, decision.actionId)).toBeDefined()
  })
})

describe("ejecución simulada", () => {
  it("marca la ejecución como simulada y no toca la red", () => {
    const result = simulatedExecution(findAction(CONFIGS.volt, "alert-ops"))
    expect(result.ok).toBe(true)
    expect(result.detail).toContain("simulado")
  })

  it("noop se reporta como noop, no como simulado", () => {
    expect(simulatedExecution(findAction(CONFIGS.volt, "ignore")).detail).toContain("noop")
  })

  it("una acción inexistente falla en vez de fingir éxito", () => {
    expect(simulatedExecution(undefined).ok).toBe(false)
  })
})

describe("formateo", () => {
  it("formatDuration no depende del locale", () => {
    expect(formatDuration(45_000)).toBe("45 s")
    expect(formatDuration(30 * 60_000)).toBe("30 min")
    expect(formatDuration(72 * 60_000)).toBe("1 h 12 min")
  })

  it("formatClock lee la hora UTC del ISO sin tocar el timezone local", () => {
    expect(formatClock("2026-07-26T19:30:00.000Z")).toBe("19:30")
  })

  it("formatEvidenceValue traduce duraciones y timestamps", () => {
    expect(formatEvidenceValue("durationMs", 1_800_000)).toBe("30 min")
    expect(formatEvidenceValue("lastSeenAt", "2026-07-26T19:47:00.000Z")).toBe("19:47 UTC")
    expect(formatEvidenceValue("state", "Faulted")).toBe("Faulted")
    expect(formatEvidenceValue("groupBy", null)).toBe("—")
    expect(formatEvidenceValue("count", 4)).toBe("4")
  })

  it("formatEvidence etiqueta en español todas las claves que producen las reglas", () => {
    const run = buildRun({ ...base, forceIncident: true })
    const detection = run.queued[0]
    expect(detection).toBeDefined()
    const filas = formatEvidence(detection!.evidence)
    expect(filas.length).toBeGreaterThan(0)
    for (const fila of filas) expect(fila.label).not.toMatch(/Ms$|At$/)
  })
})
