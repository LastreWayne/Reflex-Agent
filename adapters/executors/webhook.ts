import type { Decision, Detection } from "../../engine/schema.js"
import { requireString, type BuildResult } from "./resolve-env.js"

/** Webhook genérico: POST con la detección y la decisión completas como JSON. */
export function buildWebhookRequest(
  config: Record<string, unknown>,
  raw: Record<string, unknown>,
  decision: Decision,
  detection: Detection,
): BuildResult {
  const url = requireString(config, "url", raw)
  if ("missing" in url) return { ok: false, missing: url.missing }

  return {
    ok: true,
    request: {
      url: url.value,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detection, decision }),
      },
    },
  }
}
