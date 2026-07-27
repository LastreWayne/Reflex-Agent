import Anthropic from "@anthropic-ai/sdk"
import type { Decision, Detection, DomainConfig } from "../../engine/schema.js"
import { buildPrompt, buildTools } from "./prompt.js"

export class DeciderError extends Error {}

export async function decide(
  detection: Detection,
  config: DomainConfig,
  client: Anthropic,
): Promise<Decision> {
  const { system, user } = buildPrompt(detection, config)

  const response = await client.beta.messages.create({
    model: "claude-opus-5",
    max_tokens: 8000,
    // Fast mode: la demo en vivo necesita que esto vuelva rápido.
    speed: "fast",
    betas: ["fast-mode-2026-02-01"],
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
      const input = block.input as { message?: unknown; reason?: unknown }
      if (typeof input.message !== "string" || typeof input.reason !== "string") {
        throw new DeciderError(`La tool ${block.name} devolvió un input con forma inesperada`)
      }
      return { actionId: block.name, reason: input.reason, message: input.message }
    }
  }

  throw new DeciderError(
    `Claude no eligió ninguna acción (stop_reason: ${response.stop_reason})`,
  )
}
