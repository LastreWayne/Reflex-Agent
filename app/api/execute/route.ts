import { execute } from "../../../adapters/executors/index.js"
import { CONFIGS, ExecuteBodySchema } from "../../domains.js"

/** `execute` resuelve secretos desde process.env: sólo servidor. */
export const runtime = "nodejs"

export async function POST(request: Request) {
  const parsed = ExecuteBodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: "request inválido" }, { status: 400 })
  }
  const { domain, actionId, decision, detection } = parsed.data

  // La acción se resuelve en el SERVIDOR desde el config. El cliente manda solo
  // un id: nunca puede elegir el destino del POST ni tocar actions[].config.
  // Aceptar el objeto `action` desde el navegador sería SSRF en una URL pública,
  // porque resolveEnv deja pasar sin tocar cualquier string sin prefijo `env:`.
  const action = CONFIGS[domain].actions.find((a) => a.id === actionId)
  if (!action) {
    return Response.json({ error: "acción desconocida" }, { status: 400 })
  }

  const result = await execute(action, decision, detection, process.env)
  return Response.json({ result })
}
