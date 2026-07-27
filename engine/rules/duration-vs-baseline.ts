import type { Detection, EvalContext, Interval, Rule } from "../schema.js"

type BaselineRule = Extract<Rule, { type: "duration_vs_baseline" }>

/** Percentil por nearest-rank sobre una lista ascendente no vacía. */
function percentile(sortedAsc: number[], p: number): number {
  const index = Math.ceil((p / 100) * sortedAsc.length) - 1
  return sortedAsc[Math.min(Math.max(index, 0), sortedAsc.length - 1)]!
}

export function evaluateDurationVsBaseline(rule: BaselineRule, ctx: EvalContext): Detection[] {
  const byEntity = new Map<string, { closed: number[]; open: Interval | null }>()

  for (const interval of ctx.intervals) {
    if (interval.state !== rule.state) continue
    const bucket = byEntity.get(interval.entityId) ?? { closed: [], open: null }
    if (interval.isOpen) bucket.open = interval
    else bucket.closed.push(interval.durationMs)
    byEntity.set(interval.entityId, bucket)
  }

  const detections: Detection[] = []

  for (const [entityId, { closed, open }] of byEntity) {
    if (!open) continue
    if (closed.length < rule.minSamples) continue

    const baselineMs = percentile([...closed].sort((a, b) => a - b), rule.percentile)
    if (open.durationMs <= baselineMs) continue

    detections.push({
      ruleId: rule.id,
      entityId,
      detectedAt: ctx.now.toISOString(),
      severity: rule.severity,
      evidence: {
        state: rule.state,
        durationMs: open.durationMs,
        baselineMs,
        percentile: rule.percentile,
        samples: closed.length,
        startedAt: open.startedAt,
      },
      dedupKey: `${rule.id}:${entityId}:${open.startedAt}`,
      cooldownKey: `${rule.id}:${entityId}`,
    })
  }

  return detections
}
