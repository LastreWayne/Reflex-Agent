import type { Detection } from "../../engine/schema.js"
import type { ExecutionResult } from "./index.js"

/**
 * El motor de detección es puro: nunca escribe estado. Acá es donde una
 * decisión de tipo "mutar el estado" se vuelve real. Por ahora esto reporta
 * la transición decidida (p. ej. liberar una mesa) — cablear la escritura
 * hacia el sistema de origen (POS, OCPP, etc.) es responsabilidad de otra
 * capa, no de este executor.
 */
export function executeStateMutation(
  config: Record<string, unknown>,
  detection: Detection,
): ExecutionResult {
  const toState = typeof config.toState === "string" ? config.toState : "?"
  return { ok: true, detail: `${detection.entityId} pasa a ${toState}` }
}
