import type { Decision, Detection } from "../../engine/schema.js"
import { requireString, type BuildResult } from "./resolve-env.js"

const SEVERITY_COLOR: Record<string, number> = {
  low: 0x3498db,
  medium: 0xf1c40f,
  high: 0xe74c3c,
}

/**
 * Discord, ntfy, webhook y GitHub son el mismo adaptador: un POST a una URL
 * con una forma de payload distinta. Esta función arma esa forma para
 * Discord (un embed); quien de verdad hace la llamada de red es index.ts.
 */
export function buildDiscordRequest(
  config: Record<string, unknown>,
  raw: Record<string, unknown>,
  decision: Decision,
  detection: Detection,
): BuildResult {
  const url = requireString(config, "webhookUrl", raw)
  if ("missing" in url) return { ok: false, missing: url.missing }

  return {
    ok: true,
    request: {
      url: url.value,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          embeds: [
            {
              title: `${detection.ruleId} · ${detection.entityId}`,
              description: decision.message,
              color: SEVERITY_COLOR[detection.severity] ?? 0x95a5a6,
              timestamp: detection.detectedAt,
            },
          ],
        }),
      },
    },
  }
}
