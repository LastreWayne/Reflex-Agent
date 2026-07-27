import { afterEach, describe, expect, it, vi } from "vitest"
import type { Detection } from "../../engine/schema.js"
import { POST as decide } from "./decide/route.js"
import { POST as execute } from "./execute/route.js"

const create = vi.fn()

// El decisor real construye un cliente del SDK dentro de la ruta. Se mockea
// el SDK entero para poder distinguir un fallo de CONFIGURACIÓN (500) de un
// fallo del MODELO (502) sin salir a la red.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { create } }
  },
}))

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
  it("rechaza un body inválido", async () => {
    const response = await decide(post({ domain: "volt" }))
    expect(response.status).toBe(400)
  })

  it("rechaza un dominio desconocido", async () => {
    const response = await decide(post({ domain: "marte", detection }))
    expect(response.status).toBe(400)
  })

  it("no acepta un config mandado por el navegador — resuelve el suyo", async () => {
    create.mockResolvedValue({
      content: [{ type: "tool_use", name: "ignore", input: { reason: "r", message: "m" } }],
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

  it("un fallo del MODELO devuelve 502", async () => {
    create.mockRejectedValue(new Error("overloaded"))
    const response = await decide(post({ domain: "volt", detection }))
    expect(response.status).toBe(502)
    expect((await response.json()) as { error: string }).toEqual({ error: "overloaded" })
  })

  it("devuelve la decisión cuando el modelo elige una acción", async () => {
    create.mockResolvedValue({
      content: [
        { type: "tool_use", name: "alert-ops", input: { reason: "urgente", message: "revisar" } },
      ],
      stop_reason: "tool_use",
    })
    const response = await decide(post({ domain: "volt", detection }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      decision: { actionId: "alert-ops", reason: "urgente", message: "revisar" },
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
})
