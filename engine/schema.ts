import { z } from "zod"

export const SeveritySchema = z.enum(["low", "medium", "high"])
export type Severity = z.infer<typeof SeveritySchema>

export const NormalizedEventSchema = z.object({
  entityId: z.string().min(1),
  entityType: z.string().optional(),
  timestamp: z.iso.datetime(),
  state: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
})
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>

export interface Interval {
  entityId: string
  state: string
  startedAt: string
  endedAt: string | null
  durationMs: number
  isOpen: boolean
  metadata: Record<string, unknown>
}

const ruleBase = {
  id: z.string().min(1),
  severity: SeveritySchema,
  description: z.string().min(1),
}

export const RuleSchema = z.discriminatedUnion("type", [
  z.object({
    ...ruleBase,
    type: z.literal("duration_in_state"),
    state: z.string().min(1),
    thresholdMs: z.number().positive(),
  }),
  z.object({
    ...ruleBase,
    type: z.literal("duration_vs_baseline"),
    state: z.string().min(1),
    percentile: z.number().min(1).max(99),
    minSamples: z.number().int().positive(),
  }),
  z.object({
    ...ruleBase,
    type: z.literal("absence_of_events"),
    windowMs: z.number().positive(),
  }),
  z.object({
    ...ruleBase,
    type: z.literal("frequency_in_window"),
    toState: z.string().min(1),
    windowMs: z.number().positive(),
    count: z.number().int().positive(),
    groupBy: z.string().optional(),
  }),
])
export type Rule = z.infer<typeof RuleSchema>

export const ActionTypeSchema = z.enum([
  "discord",
  "ntfy",
  "webhook",
  "github_issue",
  "state_mutation",
  "noop",
])
export type ActionType = z.infer<typeof ActionTypeSchema>

export const ActionSchema = z.object({
  id: z.string().min(1),
  type: ActionTypeSchema,
  description: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
})
export type Action = z.infer<typeof ActionSchema>

export const DomainConfigSchema = z.object({
  domain: z.string().min(1),
  displayName: z.string().min(1),
  entity: z.object({ singular: z.string().min(1), plural: z.string().min(1) }),
  states: z.array(z.string().min(1)).min(1),
  context: z.string().min(1),
  rules: z.array(RuleSchema),
  actions: z.array(ActionSchema).min(1),
  cooldownMs: z.number().nonnegative(),
})
export type DomainConfig = z.infer<typeof DomainConfigSchema>

export interface Detection {
  ruleId: string
  entityId: string
  detectedAt: string
  severity: Severity
  evidence: Record<string, unknown>
  /** Un disparo por ocurrencia concreta. Incluye el inicio del intervalo. */
  dedupKey: string
  /** Ventana de silencio por entidad+regla. */
  cooldownKey: string
}

export interface NormalizeError {
  index: number
  entityId: string | null
  fields: string[]
  message: string
}

export interface NormalizeResult {
  events: NormalizedEvent[]
  errors: NormalizeError[]
}

export interface Decision {
  actionId: string
  reason: string
  message: string
}

export interface EvalContext {
  intervals: Interval[]
  events: NormalizedEvent[]
  now: Date
}
