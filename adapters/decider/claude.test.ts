import { describe, expect, it } from "vitest"
import type Anthropic from "@anthropic-ai/sdk"
import { createClaudeDecider, DeciderError } from "./claude.js"

// El cliente nunca se usa en estos tests: la guarda de fast mode se evalúa
// al construir el decider, antes de cualquier llamada de red.
const stubClient = {} as Anthropic

describe("createClaudeDecider — guarda de fast mode", () => {
  it("tira al construir si fast:true con un modelo que no soporta fast mode", () => {
    expect(() =>
      createClaudeDecider({ client: stubClient, model: "claude-sonnet-5", fast: true }),
    ).toThrow(DeciderError)
  })

  it("el mensaje de la guarda identifica el modelo que no soporta fast mode", () => {
    expect(() =>
      createClaudeDecider({ client: stubClient, model: "claude-sonnet-5", fast: true }),
    ).toThrow(/claude-sonnet-5/)
  })

  it("no tira si no se pide fast mode con un modelo que no lo soporta", () => {
    expect(() =>
      createClaudeDecider({ client: stubClient, model: "claude-sonnet-5" }),
    ).not.toThrow()
  })

  it("no tira con fast:true en un modelo que sí soporta fast mode (claude-opus-5)", () => {
    expect(() =>
      createClaudeDecider({ client: stubClient, model: "claude-opus-5", fast: true }),
    ).not.toThrow()
  })

  it("no tira con fast:true en el otro modelo que soporta fast mode (claude-opus-4-8)", () => {
    expect(() =>
      createClaudeDecider({ client: stubClient, model: "claude-opus-4-8", fast: true }),
    ).not.toThrow()
  })

  it("no tira con fast:true cuando el modelo se deja en su default (claude-opus-5)", () => {
    expect(() => createClaudeDecider({ client: stubClient, fast: true })).not.toThrow()
  })
})
