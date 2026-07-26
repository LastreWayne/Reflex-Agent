import { NormalizedEventSchema, type NormalizedEvent } from "./schema.js"

export function normalize(raw: unknown[]): NormalizedEvent[] {
  return raw
    .map((entry) => NormalizedEventSchema.parse(entry))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}
