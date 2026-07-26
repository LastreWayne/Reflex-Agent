import type { Detection, EvalContext, Rule } from "../schema.js"

type FrequencyRule = Extract<Rule, { type: "frequency_in_window" }>

export function evaluateFrequencyInWindow(rule: FrequencyRule, ctx: EvalContext): Detection[] {
  const windowStart = ctx.now.getTime() - rule.windowMs
  const windowStartIso = new Date(windowStart).toISOString()

  const counts = new Map<string, number>()

  for (const interval of ctx.intervals) {
    if (interval.state !== rule.toState) continue
    if (Date.parse(interval.startedAt) < windowStart) continue

    let group: string
    if (rule.groupBy) {
      const raw = interval.metadata[rule.groupBy]
      if (typeof raw !== "string") continue
      group = raw
    } else {
      group = interval.entityId
    }

    counts.set(group, (counts.get(group) ?? 0) + 1)
  }

  const detections: Detection[] = []
  for (const [group, count] of counts) {
    if (count < rule.count) continue
    detections.push({
      ruleId: rule.id,
      entityId: group,
      detectedAt: ctx.now.toISOString(),
      severity: rule.severity,
      evidence: {
        count,
        threshold: rule.count,
        windowMs: rule.windowMs,
        groupBy: rule.groupBy ?? null,
      },
      dedupKey: `${rule.id}:${group}:${windowStartIso}`,
      cooldownKey: `${rule.id}:${group}`,
    })
  }
  return detections
}
