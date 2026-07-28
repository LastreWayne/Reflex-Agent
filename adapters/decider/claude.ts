import Anthropic from "@anthropic-ai/sdk"
import type { Decider, DomainConfig } from "../../engine/schema.js"
import { buildPrompt, buildTools } from "./prompt.js"

export class DeciderError extends Error {}

/**
 * El objeto `rejected` que devolvió el modelo → array en el orden de
 * `config.actions`, salteando la elegida.
 *
 * El orden lo fija el CONFIG y no el objeto recibido: la boleta tiene que
 * verse igual en todas las corridas, y el orden de las claves de un objeto
 * JSON no es algo sobre lo que valga la pena confiar.
 */
function normalizeRejected(
  raw: unknown,
  chosenId: string,
  config: DomainConfig,
): { actionId: string; reason: string }[] {
  if (raw === null || typeof raw !== "object") {
    throw new DeciderError("La tool devolvió `rejected` con una forma inesperada")
  }
  const porId = raw as Record<string, unknown>

  return config.actions
    .filter((a) => a.id !== chosenId)
    .map((a) => {
      const reason = porId[a.id]
      if (typeof reason !== "string") {
        throw new DeciderError(`La tool no explicó por qué descartó "${a.id}"`)
      }
      return { actionId: a.id, reason }
    })
}

// speed: "fast" solo existe en estos modelos; con cualquier otro, la API
// devuelve error. Ver constraint en el brief de la Task 9b.
const FAST_MODE_MODELS = new Set(["claude-opus-5", "claude-opus-4-8"])

export interface ClaudeDeciderOptions {
  client: Anthropic
  /** Default: "claude-opus-5" */
  model?: string
  /** Default: false. Solo válido en modelos que soportan fast mode. */
  fast?: boolean
}

export function createClaudeDecider(opts: ClaudeDeciderOptions): Decider {
  const { client } = opts
  const model = opts.model ?? "claude-opus-5"
  const fast = opts.fast ?? false

  // Falla acá, al construir, y no en la primera detección: una demo en vivo
  // no puede darse el lujo de descubrir esto en frente de una audiencia.
  if (fast && !FAST_MODE_MODELS.has(model)) {
    throw new DeciderError(
      `El modelo "${model}" no soporta fast mode. Solo lo soportan: ${[...FAST_MODE_MODELS].join(", ")}.`,
    )
  }

  return async (detection, config) => {
    const { system, user } = buildPrompt(detection, config)

    const response = await client.beta.messages.create({
      model,
      max_tokens: 8000,
      // Fast mode: la demo en vivo necesita que esto vuelva rápido. Sin
      // fast, la request no debe llevar ni speed ni el beta.
      ...(fast ? { speed: "fast" as const, betas: ["fast-mode-2026-02-01" as const] } : {}),
      // NO desactivar el thinking: con thinking disabled, Opus 5 a veces escribe
      // la tool call como texto plano y la acción nunca se ejecuta, sin error.
      output_config: { effort: "low" },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: buildTools(config),
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: user }],
    })

    for (const block of response.content) {
      if (block.type === "tool_use") {
        const input = block.input as {
          message?: unknown
          reason?: unknown
          rejected?: unknown
          wouldChangeIf?: unknown
        }
        if (
          typeof input.message !== "string" ||
          typeof input.reason !== "string" ||
          typeof input.wouldChangeIf !== "string"
        ) {
          throw new DeciderError(`La tool ${block.name} devolvió un input con forma inesperada`)
        }
        return {
          decision: { actionId: block.name, reason: input.reason, message: input.message },
          deliberation: {
            rejected: normalizeRejected(input.rejected, block.name, config),
            wouldChangeIf: input.wouldChangeIf,
          },
        }
      }
    }

    throw new DeciderError(
      `Claude no eligió ninguna acción (stop_reason: ${response.stop_reason})`,
    )
  }
}
