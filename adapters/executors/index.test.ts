import { describe, expect, it, vi } from "vitest"
import { execute } from "./index.js"
import type { Action, Decision, Detection } from "../../engine/schema.js"

const decision: Decision = {
  actionId: "x",
  reason: "porque sí",
  message: "🔴 EVC-04 lleva 12 min en falla",
}

const detection: Detection = {
  ruleId: "faulted-stuck",
  entityId: "EVC-04",
  detectedAt: "2026-07-25T20:00:00.000Z",
  severity: "high",
  evidence: {},
  dedupKey: "a",
  cooldownKey: "b",
}

const action = (over: Partial<Action>): Action => ({
  id: "x",
  type: "noop",
  description: "d",
  config: {},
  ...over,
})

describe("execute", () => {
  it("noop no hace red y reporta ok", async () => {
    const fetchImpl = vi.fn()
    const result = await execute(action({ type: "noop" }), decision, detection, {}, fetchImpl)
    expect(result.ok).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("discord postea un embed al webhook resuelto", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    await execute(
      action({ type: "discord", config: { webhookUrl: "env:HOOK" } }),
      decision,
      detection,
      { HOOK: "https://discord/hook" },
      fetchImpl,
    )
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe("https://discord/hook")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.embeds[0].description).toBe(decision.message)
  })

  it("falla explícitamente si el secreto no está en el entorno", async () => {
    const fetchImpl = vi.fn()
    const result = await execute(
      action({ type: "discord", config: { webhookUrl: "env:FALTANTE" } }),
      decision,
      detection,
      {},
      fetchImpl,
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain("FALTANTE")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("ntfy postea el mensaje como cuerpo plano al topic", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    await execute(
      action({ type: "ntfy", config: { topic: "env:TOPIC" } }),
      decision,
      detection,
      { TOPIC: "centinela-demo" },
      fetchImpl,
    )
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe("https://ntfy.sh/centinela-demo")
    expect((init as RequestInit).body).toBe(decision.message)
  })

  it("state_mutation no hace red y reporta el estado destino", async () => {
    const fetchImpl = vi.fn()
    const result = await execute(
      action({ type: "state_mutation", config: { toState: "Libre" } }),
      decision,
      detection,
      {},
      fetchImpl,
    )
    expect(result.ok).toBe(true)
    expect(result.detail).toContain("Libre")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("reporta no-ok cuando el POST falla", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const result = await execute(
      action({ type: "webhook", config: { url: "env:URL" } }),
      decision,
      detection,
      { URL: "https://ejemplo/hook" },
      fetchImpl,
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain("500")
  })

  // --- No leak: un secreto resuelto no puede aparecer en ningún resultado ---

  it("no filtra la URL resuelta en el detail cuando el POST tiene éxito", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    const result = await execute(
      action({ type: "webhook", config: { url: "env:URL" } }),
      decision,
      detection,
      { URL: "https://secreto.example.com/muy-privado" },
      fetchImpl,
    )
    expect(result.ok).toBe(true)
    expect(result.detail).not.toContain("secreto.example.com")
  })

  it("no filtra la URL resuelta en el detail cuando el POST falla", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const result = await execute(
      action({ type: "webhook", config: { url: "env:URL" } }),
      decision,
      detection,
      { URL: "https://secreto.example.com/muy-privado" },
      fetchImpl,
    )
    expect(result.detail).not.toContain("secreto.example.com")
  })

  it("no filtra el secreto si fetchImpl tira una excepción", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error("fetch failed: https://secreto.example.com/muy-privado"))
    const result = await execute(
      action({ type: "webhook", config: { url: "env:URL" } }),
      decision,
      detection,
      { URL: "https://secreto.example.com/muy-privado" },
      fetchImpl,
    )
    expect(result.ok).toBe(false)
    expect(result.detail).not.toContain("secreto.example.com")
  })

  // --- github_issue: sin cobertura en el set anterior, se prueba aparte ---

  it("github_issue crea un issue autenticado con el repo y el token resueltos", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 201 })
    await execute(
      action({
        type: "github_issue",
        config: { repo: "env:REPO", token: "env:TOKEN" },
      }),
      decision,
      detection,
      { REPO: "acme/volt", TOKEN: "ghp_secreto" },
      fetchImpl,
    )
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe("https://api.github.com/repos/acme/volt/issues")
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer ghp_secreto")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.title).toContain("EVC-04")
  })

  it("github_issue falla explícitamente si falta el token, sin tocar la red", async () => {
    const fetchImpl = vi.fn()
    const result = await execute(
      action({
        type: "github_issue",
        config: { repo: "env:REPO", token: "env:FALTANTE" },
      }),
      decision,
      detection,
      { REPO: "acme/volt" },
      fetchImpl,
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain("FALTANTE")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("github_issue no filtra el token resuelto en el detail", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 })
    const result = await execute(
      action({
        type: "github_issue",
        config: { repo: "env:REPO", token: "env:TOKEN" },
      }),
      decision,
      detection,
      { REPO: "acme/volt", TOKEN: "ghp_secreto" },
      fetchImpl,
    )
    expect(result.detail).not.toContain("ghp_secreto")
  })
})
