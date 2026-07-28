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

/**
 * Cotas de tamaño para los bodies de /api/decide y /api/execute: dos rutas
 * públicas y sin autenticación. `detection.entityId`, `detection.detectedAt`
 * y `evidence` se interpolan tal cual en el prompt de Claude
 * (adapters/decider/prompt.ts:57-63) — sin límite, cualquier visitante
 * anónimo puede mandar un body enorme y quemar crédito de la cuenta de
 * Anthropic del dueño. Los topes salen de lo que el motor produce hoy
 * (ids como "EVC-01"/"mesa-7", ISO timestamps de ~24 caracteres, evidence
 * con hasta 6 campos numéricos en duration_vs_baseline) con harto margen.
 */
const MAX_ID_LENGTH = 200 // ruleId, entityId, actionId: los reales miden <20
const MAX_TIMESTAMP_LENGTH = 40 // ISO 8601 con milisegundos y offset: ~24-30
const MAX_KEY_LENGTH = 500 // dedupKey/cooldownKey = `${ruleId}:${entityId}:${iso}`
const MAX_REASON_LENGTH = 500 // "Una frase, para el log." (prompt.ts:29)
const MAX_MESSAGE_LENGTH = 2000 // mensaje a una persona real, unas oraciones
const MAX_EVIDENCE_JSON_LENGTH = 5000 // el evidence real más grande serializa a <300 chars
const MAX_REJECTED = 8 // los configs reales declaran 3 acciones ⇒ 2 rechazos

export const DecisionSchema = z.object({
  actionId: z.string().min(1).max(MAX_ID_LENGTH),
  reason: z.string().max(MAX_REASON_LENGTH),
  message: z.string().max(MAX_MESSAGE_LENGTH),
})

/**
 * La deliberación NO viaja a /api/execute: sólo la produce /api/decide y sólo
 * la consume la pantalla. El tope se aplica en la ruta, antes de responder,
 * porque ahí es donde la salida del modelo entra al sistema.
 */
export const DeliberationSchema = z.object({
  rejected: z
    .array(
      z.object({
        actionId: z.string().min(1).max(MAX_ID_LENGTH),
        reason: z.string().max(MAX_REASON_LENGTH),
      }),
    )
    .max(MAX_REJECTED),
  wouldChangeIf: z.string().max(MAX_REASON_LENGTH),
})

export const DetectionSchema = z.object({
  ruleId: z.string().min(1).max(MAX_ID_LENGTH),
  entityId: z.string().min(1).max(MAX_ID_LENGTH),
  detectedAt: z.string().max(MAX_TIMESTAMP_LENGTH),
  severity: SeveritySchema,
  // zod no puede acotar el tamaño serializado de un record directamente, así
  // que se cotea a mano: cualquier `evidence` cuyo JSON pase de
  // MAX_EVIDENCE_JSON_LENGTH se rechaza, sin importar cuántas claves tenga
  // (un solo campo con un string enorme también queda cubierto).
  evidence: z
    .record(z.string(), z.unknown())
    .refine((evidence) => JSON.stringify(evidence).length <= MAX_EVIDENCE_JSON_LENGTH),
  dedupKey: z.string().max(MAX_KEY_LENGTH),
  cooldownKey: z.string().max(MAX_KEY_LENGTH),
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
  actionId: z.string().min(1).max(MAX_ID_LENGTH),
  decision: DecisionSchema,
  detection: DetectionSchema,
})
