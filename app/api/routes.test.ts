import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Detection } from "../../engine/schema.js"
import { POST as decide } from "./decide/route.js"
import { POST as execute } from "./execute/route.js"
import { execute as executeAction } from "../../adapters/executors/index.js"

const create = vi.fn()

// El decisor real construye un cliente del SDK dentro de la ruta. Se mockea
// el SDK entero para poder distinguir un fallo de CONFIGURACIÓN (500) de un
// fallo del MODELO (502) sin salir a la red.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { create } }
  },
}))

// Se envuelve el `execute` real con un spy (en vez de reemplazarlo) para
// poder afirmar "nunca se llamó" en el test del body sobredimensionado sin
// tocar el comportamiento que ya verifican los tests de ejecución de abajo.
vi.mock("../../adapters/executors/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/executors/index.js")>()
  return { ...actual, execute: vi.fn(actual.execute) }
})

const detection: Detection = {
  ruleId: "faulted-stuck",
  entityId: "EVC-01",
  detectedAt: "2026-07-26T20:00:00.000Z",
  severity: "high",
  evidence: { state: "Faulted", durationMs: 1_800_000 },
  dedupKey: "faulted-stuck:EVC-01:2026-07-26T19:30:00.000Z",
  cooldownKey: "faulted-stuck:EVC-01",
}

const decision = { actionId: "ignore", reason: "no amerita", message: "todo bien" }

function post(body: unknown): Request {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
  create.mockReset()
  vi.mocked(executeAction).mockClear()
})

describe("POST /api/execute", () => {
  it("rechaza un body inválido", async () => {
    const response = await execute(post({ domain: "volt" }))
    expect(response.status).toBe(400)
  })

  it("rechaza un dominio desconocido", async () => {
    const response = await execute(
      post({ domain: "marte", actionId: "ignore", decision, detection }),
    )
    expect(response.status).toBe(400)
  })

  it("rechaza un actionId que no existe en el config del dominio", async () => {
    const response = await execute(
      post({ domain: "volt", actionId: "no-existe", decision, detection }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "acción desconocida" })
  })

  it("rechaza un body que excede las cotas de tamaño y nunca llega al executor", async () => {
    // decision.message viaja sin cotas hasta el executor real (Discord, ntfy,
    // github issue). Debe rechazarse en el safeParse de app/domains.ts —
    // antes de resolver CONFIGS o llamar a execute() — con el mismo 400
    // genérico que un body inválido, sin devolver el valor ofensivo.
    const response = await execute(
      post({
        domain: "volt",
        actionId: "ignore",
        decision: { ...decision, message: "x".repeat(2001) },
        detection,
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "request inválido" })
    expect(executeAction).not.toHaveBeenCalled()
  })

  it("la deliberación no puede colarse hasta el executor", async () => {
    /*
     * LA GARANTÍA QUE EL PRODUCTO ENCABEZA. La prosa deliberativa del modelo
     * no tiene ninguna ruta hasta un issue de GitHub ni un canal de Discord
     * —no por un filtro que alguien tenga que mantener, sino porque el camino
     * no existe—. Hasta acá la única evidencia era una observación sobre el
     * diff ("los archivos del executor no aparecen"), que es un argumento
     * sobre lo que NO se tocó, no sobre lo que el sistema hace.
     *
     * Acá se construye a mano el body que un atacante mandaría —la pantalla
     * nunca lo emite— y se afirma sobre las CLAVES que llegan al executor, no
     * sobre el status. `ExecuteBodySchema.decision` es `DecisionSchema`, y un
     * z.object() de zod descarta las claves desconocidas al parsear.
     *
     * Verificado por inversión: con `DecisionSchema.loose()` el test falla con
     * la clave `deliberation` de más en el array recibido.
     */
    const response = await execute(
      post({
        domain: "volt",
        actionId: "ignore",
        decision: {
          ...decision,
          deliberation: {
            rejected: [{ actionId: "alert-ops", reason: "prosa que no debe viajar" }],
            wouldChangeIf: "prosa que no debe viajar",
          },
        },
        detection,
      }),
    )
    expect(response.status).toBe(200)
    expect(executeAction).toHaveBeenCalled()
    const pasada = vi.mocked(executeAction).mock.calls[0]![1]
    expect(Object.keys(pasada).sort()).toEqual(["actionId", "message", "reason"])
    expect(JSON.stringify(pasada)).not.toContain("prosa que no debe viajar")
  })

  it("ejecuta una acción resuelta desde el config del servidor", async () => {
    const response = await execute(post({ domain: "volt", actionId: "ignore", decision, detection }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { result: { ok: boolean } }
    expect(body.result.ok).toBe(true)
  })

  it("no acepta la acción del navegador: el destino sale del config del servidor", async () => {
    // Éste es el agujero que la ruta cierra. Si el cliente pudiera mandar el
    // objeto `action`, resolveEnv dejaría pasar tal cual un webhookUrl
    // arbitrario y el servidor haría POST a donde le digan — SSRF en una URL
    // pública. El campo extra se ignora: la acción se busca por id.
    vi.stubEnv("DISCORD_OPS_WEBHOOK", "")
    const response = await execute(
      post({
        domain: "volt",
        actionId: "alert-ops",
        decision,
        detection,
        action: {
          id: "alert-ops",
          type: "webhook",
          description: "atacante",
          config: { webhookUrl: "https://atacante.invalid/hook" },
        },
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { result: { ok: boolean; detail: string } }
    // Sin la variable de entorno, la acción real ni siquiera sale a la red.
    expect(body.result.ok).toBe(false)
    expect(body.result.detail).toContain("DISCORD_OPS_WEBHOOK")
    expect(body.result.detail).not.toContain("atacante")
  })

  it("una acción de mutación de estado se ejecuta con el config del servidor", async () => {
    const response = await execute(
      post({
        domain: "restaurant",
        actionId: "liberar-reserva",
        decision: { ...decision, actionId: "liberar-reserva" },
        detection: { ...detection, ruleId: "no-show", entityId: "mesa-1" },
      }),
    )
    const body = (await response.json()) as { result: { ok: boolean; detail: string } }
    expect(body.result.ok).toBe(true)
    expect(body.result.detail).toContain("mesa-1")
  })
})

describe("POST /api/decide", () => {
  /*
   * La ruta ahora exige ANTHROPIC_API_KEY antes de construir el decisor, así
   * que sin esto CUALQUIER test de este bloque devolvería 500 y estaría
   * probando el guardia en vez de lo suyo. El SDK está mockeado: el valor no
   * sale a ningún lado, sólo tiene que existir.
   *
   * El test del guardia la borra explícitamente con stubEnv("").
   */
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test")
  })

  it("rechaza un body inválido", async () => {
    const response = await decide(post({ domain: "volt" }))
    expect(response.status).toBe(400)
  })

  it("rechaza un dominio desconocido", async () => {
    const response = await decide(post({ domain: "marte", detection }))
    expect(response.status).toBe(400)
  })

  it("rechaza un body que excede las cotas de tamaño y nunca llega al decisor", async () => {
    // detection.evidence se interpola tal cual en el prompt de Claude
    // (adapters/decider/prompt.ts:57-63): sin cota, un visitante anónimo
    // puede quemar crédito de la cuenta de Anthropic del dueño. Debe
    // rechazarse en el safeParse, con el mismo 400 genérico que un body
    // inválido, antes de construir el decider o llamar al SDK.
    const response = await decide(
      post({
        domain: "volt",
        detection: { ...detection, evidence: { big: "x".repeat(6000) } },
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "request inválido" })
    expect(create).not.toHaveBeenCalled()
  })

  it("no acepta un config mandado por el navegador — resuelve el suyo", async () => {
    create.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "ignore",
          input: {
            reason: "r",
            message: "m",
            rejected: { "alert-ops": "no amerita", "create-ticket": "no amerita" },
            wouldChangeIf: "n/a",
          },
        },
      ],
      stop_reason: "tool_use",
    })
    const response = await decide(
      post({
        domain: "volt",
        detection,
        config: { domain: "volt", actions: [{ id: "hackeada" }] },
      }),
    )
    expect(response.status).toBe(200)
    const tools = create.mock.calls[0]?.[0]?.tools as { name: string }[]
    expect(tools.map((t) => t.name)).toEqual(["alert-ops", "create-ticket", "ignore"])
  })

  it("un fallo de CONFIGURACIÓN devuelve 500, no 502", async () => {
    // fast mode sólo existe en opus-5 / opus-4-8: createClaudeDecider tira
    // DeciderError al construirse. Si esto se mezclara con el catch de la
    // decisión, un deploy mal configurado se leería como un hipo del modelo
    // y nadie lo iría a arreglar.
    vi.stubEnv("DECIDER_MODEL", "claude-sonnet-5")
    vi.stubEnv("DECIDER_FAST", "1")
    const response = await decide(post({ domain: "volt", detection }))
    expect(response.status).toBe(500)
    expect(create).not.toHaveBeenCalled()
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain("configuración del servidor inválida")
  })

  it("sin ANTHROPIC_API_KEY devuelve 500, no 502", async () => {
    /*
     * MEDIDO EN EL PRIMER DEPLOY REAL. `new Anthropic()` no tira cuando falta
     * la clave: el SDK resuelve la autenticación al mandar la request, así que
     * el fallo caía en el catch de la decisión y salía 502 —"falló el
     * modelo"— cuando en realidad era el deploy sin variable.
     *
     * O sea que el único caso que la separación 500/502 NO cubría era
     * justamente el más probable de todos en un deploy nuevo. Doce tasks y una
     * review de rama completa no lo cazaron porque ningún test corría sin la
     * clave y el camino en vivo siempre la tuvo.
     */
    vi.stubEnv("ANTHROPIC_API_KEY", "")
    const response = await decide(post({ domain: "volt", detection }))
    expect(response.status).toBe(500)
    expect(create).not.toHaveBeenCalled()
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain("ANTHROPIC_API_KEY")
  })

  it("un fallo del MODELO devuelve 502", async () => {
    create.mockRejectedValue(new Error("overloaded"))
    const response = await decide(post({ domain: "volt", detection }))
    expect(response.status).toBe(502)
    expect((await response.json()) as { error: string }).toEqual({ error: "overloaded" })
  })

  it("devuelve la decisión cuando el modelo elige una acción", async () => {
    create.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "alert-ops",
          input: {
            reason: "urgente",
            message: "revisar",
            rejected: { "create-ticket": "no aplica", ignore: "no aplica" },
            wouldChangeIf: "si bajara la severidad",
          },
        },
      ],
      stop_reason: "tool_use",
    })
    const response = await decide(post({ domain: "volt", detection }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      decision: { actionId: "alert-ops", reason: "urgente", message: "revisar" },
      deliberation: {
        rejected: [
          { actionId: "create-ticket", reason: "no aplica" },
          { actionId: "ignore", reason: "no aplica" },
        ],
        wouldChangeIf: "si bajara la severidad",
      },
    })
  })

  it("usa claude-sonnet-5 por defecto y sin fast mode", async () => {
    create.mockResolvedValue({
      content: [{ type: "tool_use", name: "ignore", input: { reason: "r", message: "m" } }],
      stop_reason: "tool_use",
    })
    await decide(post({ domain: "volt", detection }))
    const request = create.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request.model).toBe("claude-sonnet-5")
    expect(request.speed).toBeUndefined()
  })

  it("con DECIDER_MODEL=claude-opus-5 y DECIDER_FAST=1 manda fast mode", async () => {
    vi.stubEnv("DECIDER_MODEL", "claude-opus-5")
    vi.stubEnv("DECIDER_FAST", "1")
    create.mockResolvedValue({
      content: [{ type: "tool_use", name: "ignore", input: { reason: "r", message: "m" } }],
      stop_reason: "tool_use",
    })
    await decide(post({ domain: "volt", detection }))
    const request = create.mock.calls[0]?.[0] as Record<string, unknown>
    expect(request.model).toBe("claude-opus-5")
    expect(request.speed).toBe("fast")
  })

  it("responde la decisión y la deliberación por separado", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test")
    create.mockResolvedValue({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          name: "alert-ops",
          input: {
            message: "La estación EVC-01 no responde.",
            reason: "Sin heartbeat.",
            rejected: {
              "create-ticket": "Un ticket llega tarde.",
              ignore: "No se puede ignorar una estación muda.",
            },
            wouldChangeIf: "Si hubiera reportado hace un minuto, ignoraba.",
          },
        },
      ],
    })

    const response = await decide(post({ domain: "volt", detection }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.decision.actionId).toBe("alert-ops")
    expect(body.deliberation.rejected).toHaveLength(2)
    expect(body.deliberation.wouldChangeIf).toBe("Si hubiera reportado hace un minuto, ignoraba.")
  })

  it("devuelve 502 si el modelo produce una deliberación fuera de las cotas", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test")
    create.mockResolvedValue({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          name: "alert-ops",
          input: {
            message: "ok",
            reason: "ok",
            rejected: { "create-ticket": "x".repeat(501), ignore: "ok" },
            wouldChangeIf: "ok",
          },
        },
      ],
    })

    const response = await decide(post({ domain: "volt", detection }))
    expect(response.status).toBe(502)
  })
})
