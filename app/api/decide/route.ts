import Anthropic from "@anthropic-ai/sdk"
import { createClaudeDecider } from "../../../adapters/decider/claude.js"
import type { Decider } from "../../../engine/schema.js"
import { CONFIGS, DecideBodySchema } from "../../domains.js"

/** El SDK de Anthropic y la clave viven en el servidor. Nunca en el bundle. */
export const runtime = "nodejs"

export async function POST(request: Request) {
  const parsed = DecideBodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: "request inválido" }, { status: 400 })
  }
  const { domain, detection } = parsed.data
  const config = CONFIGS[domain]

  // El modelo se lee por request y no a nivel de módulo: en Vercel, leer
  // process.env al importar el módulo puede congelar el valor del build.
  // El playground público corre sonnet por costo; el video corre opus-5 fast.
  const model = process.env.DECIDER_MODEL ?? "claude-sonnet-5"
  const fast = process.env.DECIDER_FAST === "1"

  // La construcción va FUERA del try/catch de la decisión, a propósito.
  // `createClaudeDecider` tira DeciderError cuando la configuración es
  // inválida (p. ej. fast mode en un modelo que no lo soporta) y el SDK tira
  // cuando falta la clave: eso es un deploy mal armado (500), no un fallo del
  // modelo (502). Con un solo catch, un deploy roto se vería como un hipo de
  // Claude y nadie lo arreglaría a tiempo.
  let decider: Decider
  try {
    decider = createClaudeDecider({ client: new Anthropic(), model, fast })
  } catch (error) {
    return Response.json(
      { error: `configuración del servidor inválida: ${(error as Error).message}` },
      { status: 500 },
    )
  }

  try {
    const decision = await decider(detection, config)
    return Response.json({ decision })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 })
  }
}
