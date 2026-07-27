import { describe, expect, it } from "vitest"
import { resolveEnv } from "./resolve-env.js"

describe("resolveEnv", () => {
  it("reemplaza los strings con prefijo env:", () => {
    const result = resolveEnv({ webhookUrl: "env:HOOK" }, { HOOK: "https://ejemplo/abc" })
    expect(result.webhookUrl).toBe("https://ejemplo/abc")
  })

  it("deja null si la variable no existe", () => {
    expect(resolveEnv({ webhookUrl: "env:FALTANTE" }, {}).webhookUrl).toBeNull()
  })

  it("no toca los valores que no tienen el prefijo", () => {
    expect(resolveEnv({ toState: "Libre" }, {}).toState).toBe("Libre")
  })

  it("no toca valores que no son string", () => {
    expect(resolveEnv({ retries: 3 }, {}).retries).toBe(3)
  })
})
