import { describe, expect, it } from "vitest"
import { CONFIGS, DOMAIN_IDS } from "./domains.js"
import {
  DEFAULT_AT,
  DEFAULT_MAX_DECISIONS,
  DEFAULT_PARAMS,
  OFFLINE_VERDICTS,
  buildBallot,
  buildFunnel,
  buildRun,
  findAction,
  formatClock,
  formatDuration,
  formatEvidence,
  formatEvidenceValue,
  offlineDecision,
  parseParams,
  parseView,
  simulatedExecution,
  toSearch,
  toSearchWithView,
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

describe("vista", () => {
  it("la vista simple es el default", () => {
    expect(parseView("")).toBe("simple")
    expect(parseView("?domain=volt&seed=42")).toBe("simple")
    expect(parseView("?view=cualquiera")).toBe("simple")
  })

  it("lee ?view=full", () => {
    expect(parseView("?view=full")).toBe("full")
    expect(parseView("?domain=volt&view=full&seed=7")).toBe("full")
  })

  it("toSearchWithView sólo escribe la vista cuando no es el default", () => {
    expect(toSearchWithView(base, "simple")).toBe(toSearch(base))
    expect(toSearchWithView(base, "full")).toBe(`${toSearch(base)}&view=full`)
  })

  it("hace ida y vuelta sin perder los params de la corrida", () => {
    const params: DemoParams = { ...base, domain: "restaurant", seed: 12, forceIncident: true }
    const search = toSearchWithView(params, "full")
    expect(parseParams(search)).toEqual(params)
    expect(parseView(search)).toBe("full")
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
        expect(OFFLINE_VERDICTS[`${domain}:${rule.id}`], `${domain}:${rule.id}`).toBeDefined()
      }
    }
  })

  it("toda decisión pregrabada apunta a una acción que existe en su config", () => {
    for (const [key, verdict] of Object.entries(OFFLINE_VERDICTS)) {
      const domain = key.split(":")[0] as keyof typeof CONFIGS
      expect(findAction(CONFIGS[domain], verdict.decision.actionId), key).toBeDefined()
    }
  })

  it("interpola la entidad concreta en el mensaje", () => {
    const run = buildRun({ ...base, forceIncident: true })
    const detection = run.queued[0]
    expect(detection).toBeDefined()
    const verdict = offlineDecision("volt", detection!, run.config)
    expect(verdict.decision.message).toContain(detection!.entityId)
    expect(verdict.decision.message).not.toContain("{entidad}")
  })

  it("no duplica el sustantivo del dominio: el nombre va en la plantilla, no en {entidad}", () => {
    // Regresión: interpolar `${entity.singular} ${entityId}` dentro de una
    // plantilla que ya decía "La estación {entidad}" producía
    // "La estación estación EVC-01".
    for (const [key, recorded] of Object.entries(OFFLINE_VERDICTS)) {
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
      ).decision.message
      expect(message, key).not.toContain(`${config.entity.singular} ${config.entity.singular}`)
      expect(message, key).toBe(recorded.decision.message.replaceAll("{entidad}", "X-1"))
    }
  })

  it("usa vocabulario del dominio en el mensaje", () => {
    const run = buildRun({ ...base, domain: "restaurant", forceIncident: true })
    const detection = run.queued.find((d) => d.ruleId === "no-show")
    expect(detection).toBeDefined()
    expect(offlineDecision("restaurant", detection!, run.config).decision.message).toContain("mesa")
  })

  it("una regla sin pregrabar cae a la acción de descarte en vez de romper", () => {
    const verdict = offlineDecision(
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
    expect(verdict.decision.actionId).toBe("ignore")
    expect(findAction(CONFIGS.volt, verdict.decision.actionId)).toBeDefined()
  })
})

describe("las decisiones pregrabadas", () => {
  it("cubren exactamente las otras acciones de su dominio", () => {
    for (const clave of Object.keys(OFFLINE_VERDICTS)) {
      const [domain] = clave.split(":") as [keyof typeof CONFIGS]
      const verdict = OFFLINE_VERDICTS[clave]!
      const esperadas = CONFIGS[domain].actions
        .map((a) => a.id)
        .filter((id) => id !== verdict.decision.actionId)
      expect(verdict.deliberation.rejected.map((r) => r.actionId)).toEqual(esperadas)
    }
  })

  it("ninguna tiene un motivo de rechazo ni un contrafáctico vacío", () => {
    for (const verdict of Object.values(OFFLINE_VERDICTS)) {
      expect(verdict.deliberation.wouldChangeIf.length).toBeGreaterThan(10)
      for (const r of verdict.deliberation.rejected) {
        expect(r.reason.length).toBeGreaterThan(10)
      }
    }
  })

  it("hay una pregrabada por cada regla de cada dominio", () => {
    for (const domain of DOMAIN_IDS) {
      for (const rule of CONFIGS[domain].rules) {
        expect(OFFLINE_VERDICTS[`${domain}:${rule.id}`]).toBeDefined()
      }
    }
  })

  it("la rama de fallback igual devuelve un veredicto completo", () => {
    const config = CONFIGS.volt
    const verdict = offlineDecision(
      "volt",
      {
        ruleId: "regla-inexistente",
        entityId: "EVC-09",
        detectedAt: "2026-07-26T20:00:00.000Z",
        severity: "low",
        evidence: {},
        dedupKey: "k",
        cooldownKey: "c",
      },
      config,
    )
    expect(verdict.deliberation.rejected).toHaveLength(config.actions.length - 1)
    expect(verdict.deliberation.wouldChangeIf).not.toBe("")
  })

  it("reemplaza {entidad} por el id concreto", () => {
    const verdict = offlineDecision(
      "volt",
      {
        ruleId: "offline",
        entityId: "EVC-02",
        detectedAt: "2026-07-26T20:00:00.000Z",
        severity: "high",
        evidence: {},
        dedupKey: "k",
        cooldownKey: "c",
      },
      CONFIGS.volt,
    )
    expect(verdict.decision.message).toContain("EVC-02")
    expect(verdict.decision.message).not.toContain("{entidad}")
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

describe("buildFunnel", () => {
  it("cuenta cada etapa del embudo", () => {
    const snap = buildRun({ ...DEFAULT_PARAMS, forceIncident: true })
    const f = buildFunnel(snap)
    expect(f.events).toBe(snap.events.length)
    expect(f.intervals).toBe(snap.intervals.length)
    expect(f.detections).toBe(snap.classified.length)
  })

  it("las tres salidas suman el total de detecciones", () => {
    const snap = buildRun({ ...DEFAULT_PARAMS, forceIncident: true })
    const f = buildFunnel(snap)
    expect(f.silenced + f.overCap + f.delivered).toBe(f.detections)
  })

  it("no mezcla lo suprimido con lo que quedó fuera del cupo de la demo", () => {
    const snap = buildRun({ ...DEFAULT_PARAMS, forceIncident: true, maxDecisions: 1 })
    const f = buildFunnel(snap)
    expect(f.delivered).toBeLessThanOrEqual(1)
    expect(f.overCap).toBe(snap.classified.filter((c) => c.status === "fuera-de-cupo").length)
  })

  /*
   * Va sobre `restaurant` a propósito: `volt` no produce ni una supresión en
   * ningún seed (medido), así que sobre volt esta aserción sería 0 === 0 y no
   * podría cazar que la rama "suprimida" se caiga entera. La cota inferior está
   * para que el test no se degrade en silencio si el fixture cambia.
   */
  it("cuenta las silenciadas contra el estado real, no contra el total", () => {
    const snap = buildRun({ ...DEFAULT_PARAMS, domain: "restaurant" })
    const f = buildFunnel(snap)
    expect(f.silenced).toBeGreaterThan(0)
    expect(f.silenced).toBe(snap.classified.filter((c) => c.status === "suprimida").length)
    expect(f.delivered).toBe(snap.classified.filter((c) => c.status === "pasa").length)
  })
})

describe("buildBallot", () => {
  const config = CONFIGS.volt
  const verdict = {
    decision: { actionId: "create-ticket", reason: "vale una revisión", message: "revisar" },
    deliberation: {
      rejected: [
        { actionId: "alert-ops", reason: "no hay nadie varado" },
        { actionId: "ignore", reason: "conviene que quede anotado" },
      ],
      wouldChangeIf: "si estuviera dentro del p95, no era nada",
    },
  }

  it("devuelve una fila por acción del config, siempre en el orden del config", () => {
    expect(buildBallot(config, verdict).map((r) => r.actionId)).toEqual(
      config.actions.map((a) => a.id),
    )
  })

  it("marca la elegida y le adjunta el mensaje", () => {
    const fila = buildBallot(config, verdict).find((r) => r.actionId === "create-ticket")!
    expect(fila.status).toBe("elegida")
    expect(fila.reason).toBe("vale una revisión")
    expect(fila.message).toBe("revisar")
  })

  it("las descartadas llevan su motivo y ningún mensaje", () => {
    const fila = buildBallot(config, verdict).find((r) => r.actionId === "alert-ops")!
    expect(fila.status).toBe("descartada")
    expect(fila.reason).toBe("no hay nadie varado")
    expect(fila.message).toBeNull()
  })

  it("expone el type de cada acción, para que se vea que no todas avisan", () => {
    const tipos = buildBallot(config, verdict).map((r) => r.actionType)
    expect(tipos).toEqual(["discord", "github_issue", "noop"])
  })

  it("sin veredicto devuelve la boleta completa y sin ganadora", () => {
    const filas = buildBallot(config, null)
    expect(filas).toHaveLength(config.actions.length)
    expect(filas.every((r) => r.status === "sin-resolver")).toBe(true)
    expect(filas.every((r) => r.reason === null)).toBe(true)
    expect(filas.every((r) => r.message === null)).toBe(true)
  })

  it("una acción sin rechazo registrado igual sale como descartada, sin motivo", () => {
    const incompleto = {
      decision: verdict.decision,
      deliberation: {
        // Falta el rechazo de `alert-ops` a propósito: el decisor real siempre
        // los manda todos, pero la boleta no puede confiar en datos que no produce.
        rejected: [{ actionId: "ignore", reason: "conviene que quede anotado" }],
        wouldChangeIf: verdict.deliberation.wouldChangeIf,
      },
    }
    const fila = buildBallot(config, incompleto).find((r) => r.actionId === "alert-ops")!
    expect(fila.status).toBe("descartada")
    expect(fila.reason).toBeNull()
    expect(fila.message).toBeNull()
  })
})
