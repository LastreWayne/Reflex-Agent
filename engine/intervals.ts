import type { Interval, NormalizedEvent } from "./schema.js"

export function toIntervals(events: NormalizedEvent[], now: Date): Interval[] {
  const byEntity = new Map<string, NormalizedEvent[]>()
  for (const event of events) {
    const bucket = byEntity.get(event.entityId)
    if (bucket) bucket.push(event)
    else byEntity.set(event.entityId, [event])
  }

  const intervals: Interval[] = []

  for (const entityEvents of byEntity.values()) {
    let open: Interval | null = null

    for (const event of entityEvents) {
      if (open && open.state === event.state) continue

      if (open) {
        open.endedAt = event.timestamp
        open.durationMs = Date.parse(event.timestamp) - Date.parse(open.startedAt)
        open.isOpen = false
        intervals.push(open)
      }

      open = {
        entityId: event.entityId,
        state: event.state,
        startedAt: event.timestamp,
        endedAt: null,
        durationMs: 0,
        isOpen: true,
        metadata: event.metadata,
      }
    }

    if (open) {
      open.durationMs = now.getTime() - Date.parse(open.startedAt)
      intervals.push(open)
    }
  }

  return intervals.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
}
