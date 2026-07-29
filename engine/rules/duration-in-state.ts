import type { Detection, EvalContext, Rule } from "../schema.js"

type DurationInStateRule = Extract<Rule, { type: "duration_in_state" }>

export function evaluateDurationInState(
  rule: DurationInStateRule,
  ctx: EvalContext,
): Detection[] {
  return ctx.intervals
    .filter((i) => i.state === rule.state && i.durationMs > rule.thresholdMs)
    .map((i) => ({
      ruleId: rule.id,
      entityId: i.entityId,
      detectedAt: ctx.now.toISOString(),
      severity: rule.severity,
      evidence: {
        state: i.state,
        durationMs: i.durationMs,
        thresholdMs: rule.thresholdMs,
        startedAt: i.startedAt,
      },
      dedupKey: `${rule.id}:${i.entityId}:${i.startedAt}`,
      cooldownKey: `${rule.id}:${i.entityId}`,
    }))
}
