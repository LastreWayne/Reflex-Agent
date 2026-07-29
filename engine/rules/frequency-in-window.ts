import type { Detection, EvalContext, Rule } from "../schema.js"

type FrequencyRule = Extract<Rule, { type: "frequency_in_window" }>

export function evaluateFrequencyInWindow(rule: FrequencyRule, ctx: EvalContext): Detection[] {
  const windowStart = ctx.now.getTime() - rule.windowMs

  const groups = new Map<string, { count: number; latestStartedAt: string }>()

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

    const current = groups.get(group)
    const startedAtMs = Date.parse(interval.startedAt)
    const latestMs = current ? Date.parse(current.latestStartedAt) : startedAtMs

    groups.set(group, {
      count: (current?.count ?? 0) + 1,
      latestStartedAt:
        startedAtMs > latestMs ? interval.startedAt : current?.latestStartedAt ?? interval.startedAt,
    })
  }

  const detections: Detection[] = []
  for (const [group, { count, latestStartedAt }] of groups) {
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
      dedupKey: `${rule.id}:${group}:${latestStartedAt}`,
      cooldownKey: `${rule.id}:${group}`,
    })
  }
  return detections
}
