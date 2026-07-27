import { z } from "zod"
import { DomainConfigSchema, SeveritySchema, type DomainConfig } from "../engine/schema.js"
import voltRaw from "../configs/volt.json" with { type: "json" }
import restaurantRaw from "../configs/restaurant.json" with { type: "json" }

export const DOMAIN_IDS = ["volt", "restaurant"] as const
export type DomainId = (typeof DOMAIN_IDS)[number]

export const DomainIdSchema = z.enum(DOMAIN_IDS)

/**
 * Los dos configs de dominio, parseados una sola vez.
 *
 * Vive acá y no dentro de cada ruta porque el servidor y el navegador
 * necesitan el mismo objeto: el cliente lo usa para correr el motor, y las
 * rutas lo usan para resolver acciones sin confiar en nada que venga del
 * navegador. Los configs son públicos — sólo llevan nombres de variables de
 * entorno (`env:X`), nunca valores.
 */
export const CONFIGS: Record<DomainId, DomainConfig> = {
  volt: DomainConfigSchema.parse(voltRaw),
  restaurant: DomainConfigSchema.parse(restaurantRaw),
}

export const DecisionSchema = z.object({
  actionId: z.string().min(1),
  reason: z.string(),
  message: z.string(),
})

export const DetectionSchema = z.object({
  ruleId: z.string().min(1),
  entityId: z.string().min(1),
  detectedAt: z.string(),
  severity: SeveritySchema,
  evidence: z.record(z.string(), z.unknown()),
  dedupKey: z.string(),
  cooldownKey: z.string(),
})

/**
 * El cliente manda el `domain`, no el config: el config se resuelve acá.
 * Aceptar un config del navegador dejaría que el visitante escriba el prompt
 * y la lista de acciones disponibles del decisor.
 */
export const DecideBodySchema = z.object({
  domain: DomainIdSchema,
  detection: DetectionSchema,
})

export const ExecuteBodySchema = z.object({
  domain: DomainIdSchema,
  actionId: z.string().min(1),
  decision: DecisionSchema,
  detection: DetectionSchema,
})
