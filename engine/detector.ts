import { toIntervals } from "./intervals.js"
import { evaluateRule } from "./rules/index.js"
import type {
  Detection,
  DomainConfig,
  EvalContext,
  NormalizedEvent,
  StateStore,
} from "./schema.js"

export function detect(
  events: NormalizedEvent[],
  config: DomainConfig,
  now: Date,
): Detection[] {
  const ctx: EvalContext = { intervals: toIntervals(events, now), events, now }
  return config.rules.flatMap((rule) => evaluateRule(rule, ctx))
}

export function suppress(
  detections: Detection[],
  store: StateStore,
  config: DomainConfig,
  now: Date,
): Detection[] {
  const passed: Detection[] = []

  for (const detection of detections) {
    if (store.lastFiredAt(detection.dedupKey)) continue

    const lastForEntity = store.lastFiredAt(detection.cooldownKey)
    if (lastForEntity && now.getTime() - lastForEntity.getTime() < config.cooldownMs) continue

    store.markFired(detection.dedupKey, now)
    store.markFired(detection.cooldownKey, now)
    passed.push(detection)
  }

  return passed
}
