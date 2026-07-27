import { z } from 'zod'
import { 
  NormalizedEventSchema,
  type NormalizedEvent,
  type NormalizeResult,
  type NormalizeError 
} from "./schema.js"

const EntityIdProbe = z.object({ entityId: z.string().min(1) })

export function normalize(raw: unknown[]): NormalizeResult {

  const events: NormalizedEvent[] = []
  const errors: NormalizeError[] = []

  for (const [index, entry] of raw.entries()) {
    const result = NormalizedEventSchema.safeParse(entry)

    if (result.success) {
      events.push(result.data)
      continue
    }

    const probe = EntityIdProbe.safeParse(entry)

    errors.push({
      index,
      entityId: probe.success ? probe.data.entityId : null,
      fields: result.error.issues
        .map((issue) => issue.path.join("."))
        .filter((path) => path !== ""),
      message: z.prettifyError(result.error),
    })
  }

  events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))

  return { events, errors }

}
