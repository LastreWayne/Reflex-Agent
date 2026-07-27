import type { Detection, DomainConfig } from "../../engine/schema.js"

export interface DeciderTool {
  name: string
  description: string
  strict: true
  input_schema: {
    type: "object"
    properties: Record<string, { type: "string"; description: string }>
    required: ["message", "reason"]
    additionalProperties: false
  }
}

export function buildTools(config: DomainConfig): DeciderTool[] {
  return config.actions.map((action) => ({
    name: action.id,
    description: action.description,
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "El texto que le llega a la persona. Escribilo en el tono del dominio.",
        },
        reason: {
          type: "string",
          description: "Por qué elegiste esta acción. Una frase, para el log.",
        },
      },
      required: ["message", "reason"],
      additionalProperties: false,
    },
  }))
}

export function buildPrompt(
  detection: Detection,
  config: DomainConfig,
): { system: string; user: string } {
  const rule = config.rules.find((r) => r.id === detection.ruleId)

  const system = [
    `Sos el agente de monitoreo de: ${config.displayName}.`,
    "",
    config.context,
    "",
    `Cada entidad que vigilás es una ${config.entity.singular}.`,
    "Recibís un patrón detectado y elegís exactamente una acción llamando a su tool.",
    "El mensaje que escribas lo lee una persona real de este dominio: usá su vocabulario,",
    "sé concreto con el dato que importa, y no expliques el sistema.",
    "Si la situación no amerita nada, es legítimo elegir la acción de no hacer nada.",
  ].join("\n")

  const user = [
    `Patrón detectado: ${rule?.description ?? detection.ruleId}`,
    `${config.entity.singular}: ${detection.entityId}`,
    `Severidad: ${detection.severity}`,
    `Momento: ${detection.detectedAt}`,
    "",
    "Evidencia:",
    JSON.stringify(detection.evidence, null, 2),
  ].join("\n")

  return { system, user }
}
