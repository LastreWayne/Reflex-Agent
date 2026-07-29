import type { ExecutionResult } from "./index.js"

/**
 * No hacer nada es una decisión legítima, no una omisión: cuando el agente
 * elige la acción de "ignorar", esto es lo que se ejecuta. Sin red.
 */
export function executeNoop(): ExecutionResult {
  return { ok: true, detail: "Sin acción — la situación no la ameritaba" }
}
