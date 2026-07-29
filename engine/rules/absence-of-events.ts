import type { Detection, EvalContext, Rule } from "../schema.js"

type AbsenceRule = Extract<Rule, { type: "absence_of_events" }>

export function evaluateAbsenceOfEvents(rule: AbsenceRule, ctx: EvalContext): Detection[] {
  const lastSeen = new Map<string, string>()
  for (const event of ctx.events) {
    const current = lastSeen.get(event.entityId)
    if (!current || Date.parse(event.timestamp) > Date.parse(current)) {
      lastSeen.set(event.entityId, event.timestamp)
    }
  }

  const detections: Detection[] = []
  for (const [entityId, lastSeenAt] of lastSeen) {
    const silentForMs = ctx.now.getTime() - Date.parse(lastSeenAt)
    if (silentForMs <= rule.windowMs) continue
    detections.push({
      ruleId: rule.id,
      entityId,
      detectedAt: ctx.now.toISOString(),
      severity: rule.severity,
      evidence: { lastSeenAt, silentForMs, windowMs: rule.windowMs },
      dedupKey: `${rule.id}:${entityId}:${lastSeenAt}`,
      cooldownKey: `${rule.id}:${entityId}`,
    })
  }
  return detections
}
