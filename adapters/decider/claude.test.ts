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

/** Un cliente cuyo `create` devuelve el bloque tool_use que se le pase. */
function clienteQueDevuelve(content: unknown[]): Anthropic {
  return {
    beta: { messages: { create: async () => ({ content, stop_reason: "tool_use" }) } },
  } as unknown as Anthropic
}

const bloqueOk = {
  type: "tool_use",
  name: "alert-ops",
  input: {
    message: "La estación EVC-04 lleva 20 minutos en Faulted.",
    reason: "Falla persistente: pierde ingreso y deja conductores varados.",
    // A PROPÓSITO en el orden inverso al del config: el orden de la boleta lo
    // fija el config, no lo que devolvió el modelo.
    rejected: {
      ignore: "Veinte minutos en falla no se ignoran.",
      "create-ticket": "Un ticket no saca a nadie del apuro ahora.",
    },
    wouldChangeIf: "Si hubiera durado 3 min en vez de 20, ignoraba.",
  },
}

describe("createClaudeDecider — deliberación", () => {
  it("devuelve la decisión y la deliberación por separado", async () => {
    const decider = createClaudeDecider({ client: clienteQueDevuelve([bloqueOk]) })
    const verdict = await decider(detection, config)
    expect(verdict.decision).toEqual({
      actionId: "alert-ops",
      reason: "Falla persistente: pierde ingreso y deja conductores varados.",
      message: "La estación EVC-04 lleva 20 minutos en Faulted.",
    })
    expect(verdict.deliberation.wouldChangeIf).toBe(
      "Si hubiera durado 3 min en vez de 20, ignoraba.",
    )
  })

  it("ordena los rechazos por el config, no por lo que devolvió el modelo", async () => {
    const decider = createClaudeDecider({ client: clienteQueDevuelve([bloqueOk]) })
    const { deliberation } = await decider(detection, config)
    // volt.json declara: alert-ops, create-ticket, ignore. Elegida alert-ops.
    expect(deliberation.rejected.map((r) => r.actionId)).toEqual(["create-ticket", "ignore"])
    expect(deliberation.rejected[0]!.reason).toBe("Un ticket no saca a nadie del apuro ahora.")
  })

  it("tira DeciderError si falta el rechazo de una alternativa", async () => {
    const incompleto = {
      ...bloqueOk,
      input: { ...bloqueOk.input, rejected: { ignore: "no" } },
    }
    const decider = createClaudeDecider({ client: clienteQueDevuelve([incompleto]) })
    await expect(decider(detection, config)).rejects.toThrow(DeciderError)
  })

  it("tira DeciderError —no TypeError— si rejected no es un objeto", async () => {
    const roto = { ...bloqueOk, input: { ...bloqueOk.input, rejected: null } }
    const decider = createClaudeDecider({ client: clienteQueDevuelve([roto]) })
    await expect(decider(detection, config)).rejects.toThrow(DeciderError)
  })

  it("tira DeciderError si falta el contrafáctico", async () => {
    const sinContra = { ...bloqueOk, input: { ...bloqueOk.input, wouldChangeIf: undefined } }
    const decider = createClaudeDecider({ client: clienteQueDevuelve([sinContra]) })
    await expect(decider(detection, config)).rejects.toThrow(DeciderError)
  })

  it("saltea los bloques que no son tool_use", async () => {
    const client = clienteQueDevuelve([{ type: "thinking", thinking: "..." }, bloqueOk])
    const verdict = await createClaudeDecider({ client })(detection, config)
    expect(verdict.decision.actionId).toBe("alert-ops")
  })
})

describe("createClaudeDecider — el contrato de UNA sola acción", () => {
  /*
   * `tool_choice: { type: "any" }` garantiza al menos una tool call, no
   * exactamente una. Antes el código retornaba en el primer bloque y la
   * segunda acción se perdía en silencio: el modelo pedía ejecutar dos cosas
   * y el sistema hacía una, elegida por el orden de los bloques.
   */
  const segundoBloque = {
    ...bloqueOk,
    name: "create-ticket",
    input: {
      ...bloqueOk.input,
      rejected: {
        ignore: "No alcanza con ignorar.",
        "alert-ops": "Ya se avisó por otro canal.",
      },
    },
  }

  it("tira DeciderError si el modelo devuelve DOS tool_use", async () => {
    const decider = createClaudeDecider({ client: clienteQueDevuelve([bloqueOk, segundoBloque]) })
    await expect(decider(detection, config)).rejects.toThrow(DeciderError)
  })

  it("el mensaje nombra las dos acciones, para que el fallo sea diagnosticable", async () => {
    const decider = createClaudeDecider({ client: clienteQueDevuelve([bloqueOk, segundoBloque]) })
    await expect(decider(detection, config)).rejects.toThrow(/alert-ops.*create-ticket/)
  })

  it("no tira con un solo tool_use aunque venga rodeado de otros bloques", async () => {
    const client = clienteQueDevuelve([
      { type: "thinking", thinking: "..." },
      bloqueOk,
      { type: "text", text: "listo" },
    ])
    const verdict = await createClaudeDecider({ client })(detection, config)
    expect(verdict.decision.actionId).toBe("alert-ops")
  })
})

describe("createClaudeDecider — input que no es un objeto", () => {
  /*
   * `block.input` es `unknown` para el SDK. Sin el guardia, `typeof
   * input.message` sobre null lanza un TypeError crudo, que la ruta traduce a
   * un 500 de "deploy mal armado" cuando en realidad falló el modelo (502).
   */
  it.each([
    ["null", null],
    ["un string", "alert-ops"],
    ["un número", 42],
  ])("tira DeciderError —no TypeError— si el input es %s", async (_caso, input) => {
    const decider = createClaudeDecider({ client: clienteQueDevuelve([{ ...bloqueOk, input }]) })
    await expect(decider(detection, config)).rejects.toThrow(DeciderError)
  })
})
