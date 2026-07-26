# Centinela — Diseño

**Fecha:** 2026-07-25
**Estado:** aprobado, listo para plan de implementación
**Deadline:** menos de una semana (cierre de votación del concurso Plogui)

## 1. Qué es

Un motor que ejecuta `vigilar → detectar patrón → decidir acción → ejecutar`, donde cambiar de dominio es **cargar otro JSON**, no reescribir código.

Proyecto personal que además compite en el carril de Automatizaciones y Agentes IA de Plogui (fase final, votación pública abierta). El concurso es el forcing function, no el dueño del proyecto: VOLT — plataforma propia de carga de vehículos eléctricos — es el primer dominio real, no un mockup para el jurado.

**La tesis:** la secuencia de monitoreo es idéntica sin importar el dominio. Lo único que cambia es qué cuenta como evento, qué patrón importa y qué acciones existen. Si eso vive en configuración, el resultado es un producto y no una automatización de un solo uso.

**El primitivo que lo sostiene**, tomado de VOLT: convertir eventos de cambio de estado en **intervalos de duración**. Sirve para cualquier entidad con estados que cambian en el tiempo.

## 2. Objetivo verificable

1. El motor corre end-to-end sobre dos dominios que no se parecen en nada — estaciones de carga y reservas de restaurante — con la **misma** función de detección.
2. Existe una URL pública que cualquiera abre, toca y entiende sin ser técnico.
3. Un visitante describe su propio dominio en una frase y ve el motor arrancar con él.

## 3. Arquitectura

```
/engine          ← puro: sin I/O, sin red, sin APIs de Node
  schema.ts        Zod: DomainConfig, NormalizedEvent, Interval, Detection, Decision
  normalizer.ts    entrada cruda → NormalizedEvent[]
  intervals.ts     NormalizedEvent[] → Interval[]
  detector.ts      Interval[] + rules → Detection[]
  rules/           duration-in-state · duration-vs-baseline · absence · frequency
/adapters        ← todo el I/O, intercambiable
  decider/         Claude tool use
  executors/       discord · ntfy · webhook · github-issue · state-mutation · noop
  store/           interfaz StateStore + impl en memoria
/simulators      volt-ocpp.ts · restaurant.ts
/configs         volt.json · restaurant.json
/app             Next.js: dashboard + /api/decide + /api/execute + /api/generate-config
```

**La regla dura:** `/engine` no importa nada de Node ni hace red. De ahí sale todo lo demás — el motor corre igual en el navegador (playground sin estado de servidor, visitantes ilimitados, costo cero) que en un worker de producción, y es trivial de testear.

**Descartado para el alcance del concurso:** n8n como orquestador, Supabase, Kafka. Las tres entran después detrás de interfaces (`webhook` executor, `StateStore`, `normalizer`) sin tocar el núcleo.

## 4. Contratos de datos

### NormalizedEvent

```ts
{
  entityId: string
  entityType?: string
  timestamp: string          // ISO8601
  state: string
  metadata: Record<string, unknown>
}
```

### Interval (derivado)

```ts
{
  entityId: string
  state: string
  startedAt: string
  endedAt: string | null     // null = intervalo abierto
  durationMs: number         // hasta endedAt, o hasta "ahora" si está abierto
  isOpen: boolean
  metadata: Record<string, unknown>
}
```

### DomainConfig

El contrato que sostiene la tesis. `context`, `entity` y los `description` de cada acción no son decoración: son lo que Claude lee para redactar un mensaje que suene al dominio. Viven en config, nunca en código.

```json
{
  "domain": "volt",
  "displayName": "VOLT — Estaciones de carga",
  "entity": { "singular": "estación", "plural": "estaciones" },
  "states": ["Available","Occupied","Charging","Faulted","Reserved","Unavailable"],
  "context": "Red de carga de vehículos eléctricos. El equipo de ops responde 24/7...",
  "rules": [
    { "id": "faulted-stuck", "type": "duration_in_state", "state": "Faulted",
      "thresholdMs": 600000, "severity": "high",
      "description": "Estación atascada en falla" }
  ],
  "actions": [
    { "id": "alert-ops", "type": "discord", "description": "Alerta al equipo de operaciones",
      "config": { "webhookUrl": "env:DISCORD_OPS_WEBHOOK" } },
    { "id": "ignore", "type": "noop", "description": "No amerita acción" }
  ],
  "cooldownMs": 900000
}
```

**Convención `env:`** — dentro de `actions[].config`, cualquier string con prefijo `env:` se resuelve contra una variable de entorno **en el servidor, en el momento de ejecutar**. Nunca del lado del cliente. Así un config es compartible y publicable sin filtrar webhooks ni tokens: el JSON dice `"env:DISCORD_OPS_WEBHOOK"`, no la URL. Un config generado por un visitante solo puede referirse a variables que el servidor ya tiene, y cualquier otra se resuelve a `null` y la acción falla de forma explícita.

### Detection / Decision

```ts
Detection = { ruleId, entityId, detectedAt, severity, evidence: Record<string, unknown> }
Decision  = { actionId, reason, message }
```

## 5. Los 4 evaluadores

Cubren todos los patrones de ambos dominios. Esa cobertura es el argumento de generalidad, y es verificable con un test.

| Regla | VOLT | Restaurante |
|---|---|---|
| `duration_in_state` | Faulted > 10min | Reservada sin check-in |
| `duration_vs_baseline` | Sesión de carga anómala | Mesa ocupada de más |
| `absence_of_events` | Estación sin heartbeat | — |
| `frequency_in_window` | Pico de demanda por zona | Ráfaga de reservas |

**Semántica precisa:**

- **`duration_in_state`** — existe un intervalo de `state` cuya `durationMs` supera `thresholdMs`. Los intervalos abiertos se evalúan contra *ahora*. Dedup por `entityId + ruleId + startedAt`: un disparo por intervalo.
- **`duration_vs_baseline`** — el umbral es el percentil `percentile` de las duraciones históricas cerradas de ese estado para esa entidad. Con menos de `minSamples` muestras **no dispara** — silencio honesto en vez de falsos positivos en vivo.
- **`absence_of_events`** — la última marca de tiempo de la entidad es más vieja que `windowMs`. El roster de entidades se deriva de los eventos vistos.
- **`frequency_in_window`** — cuenta transiciones hacia `toState` dentro de `windowMs`, con `groupBy` opcional sobre un campo de metadata. Dispara si el conteo alcanza `count`.

El `cooldownMs` del config evita re-alertar sobre la misma entidad+regla dentro de la ventana.

## 6. Dónde trabaja Claude

Modelo: **`claude-opus-5`** en ambos puntos.

### 6.1 Decisor (tool use)

Recibe la detección con su evidencia, el `context` del dominio, el naming de la entidad y las acciones disponibles. **Cada acción del config se convierte en una tool generada dinámicamente**, con `strict: true`, `additionalProperties: false` y `required` para que el input valide exacto. Claude elige la tool y redacta el mensaje; la tool elegida *es* la decisión.

```ts
const tools = config.actions.map(a => ({
  name: a.id,
  description: a.description,
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      message: { type: "string" },
      reason:  { type: "string" },
    },
    required: ["message", "reason"],
    additionalProperties: false,
  },
}))
```

**Parámetros y por qué:**

- `output_config: { effort: "low" }` — en Opus 5 los niveles bajos rinden desproporcionadamente bien, y `effort` es el lever de latencia y costo.
- **No desactivar el thinking.** Con `thinking: {type: "disabled"}` Opus 5 ocasionalmente escribe la llamada a la tool como texto plano en vez de emitir el bloque `tool_use`: el turno termina sin error y la acción nunca se ejecuta. En un decisor que es enteramente tool use eso es un fallo silencioso. El thinking queda encendido (es el default) y el ahorro sale de `effort`.
- `max_tokens: 8000` — el thinking y el texto de respuesta comparten el mismo tope.
- **Fast mode** para la demo en vivo: `speed: "fast"` + beta `fast-mode-2026-02-01` sobre `client.beta.messages.create`. Hasta 2.5× tokens/seg a $10/$50 por MTok. Solo Claude API.
- **Prompt caching** sobre el bloque de `context` del dominio con `cache_control: { type: "ephemeral" }`. El mínimo cacheable en Opus 5 es 512 tokens. Con muchas detecciones del mismo dominio en una demo, el ahorro y la latencia mejoran notablemente.

Este es el punto donde el LLM carga peso real: la misma detección "Faulted 12min" produce un texto para un ingeniero de ops y otro completamente distinto para el dueño de un restaurante, y elegir entre alertar / abrir ticket / ignorar depende de contexto que no es una regla.

### 6.2 Generador de config (structured outputs)

El visitante escribe una frase y recibe un `DomainConfig` válido. **No usa tool use** — usa structured outputs, que es más directo y valida solo:

```ts
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"

const res = await client.messages.parse({
  model: "claude-opus-5",
  max_tokens: 8000,
  output_config: { format: zodOutputFormat(DomainConfigSchema) },
  messages: [{ role: "user", content: descripcionDelUsuario }],
})
const config = res.parsed_output   // ya validado contra el Zod
```

`zodOutputFormat` deriva el JSON Schema desde el mismo Zod que valida los configs escritos a mano, así que el generador no puede producir algo que el motor rechace. Los constraints que structured outputs no soporta (rangos numéricos, largos de string) el SDK los quita del schema enviado y los valida del lado del cliente.

## 7. Superficie de demo

Cinco carriles que se encienden en secuencia:

```
Eventos → Intervalos → Detecciones → Decisión de Claude → Acción ejecutada
```

Selector de dominio arriba (VOLT / Restaurante) y botón "Crear mi dominio" que abre el generador.

El motor corre client-side. Solo tres rutas van al servidor, para no exponer la API key: `/api/decide`, `/api/execute`, `/api/generate-config`.

El carril de Claude muestra un estado de "pensando" mientras la llamada está en vuelo. **No se streamea**: fast mode va por el endpoint no-streaming y ya reduce la espera lo suficiente. Streaming queda como mejora posterior si la latencia percibida molesta.

**Modo determinístico, obligatorio:** seed fijo por query param más un botón "Forzar incidente". Grabar un video esperando a que la simulación se digne a fallar es la forma más tonta de perder medio día.

**Caché de decisiones y modo offline** con respuestas pregrabadas: si la presentación tiene mal wifi, la demo no se cae.

## 8. Executors

Discord, ntfy, webhook y GitHub son el mismo adapter — un POST a una URL con distinta forma de payload. Cada canal extra cuesta ~15 líneas.

| Tipo | Rol | Setup |
|---|---|---|
| `discord` | Canal principal del video. Embeds con color por severidad | Pegar una webhook URL |
| `ntfy` | Playground público: el visitante recibe la alerta **en su propio celular** | Ninguno |
| `webhook` | Escape hatch universal — aquí entra n8n, y VOLT real después | — |
| `github_issue` | "Crear ticket" verificable: el issue queda público y permanente | Un PAT |
| `state_mutation` | Cambia el estado de la entidad (liberar la mesa). La única acción que **cambia el mundo** | — |
| `noop` | Para que "esto no amerita nada" sea una decisión legítima | — |

Los dos últimos hacen a la identidad del proyecto: el nombre dice *acción automática*, y si todos los executors fueran notificaciones, Centinela sería un bot de alertas con pasos de más.

WhatsApp queda fuera: la verificación con Meta toma días o semanas y el deadline es de una.

## 9. Testing

Vitest sobre `/engine`.

- Tabla de casos por cada uno de los 4 evaluadores, incluyendo los bordes: intervalo abierto vs cerrado, `minSamples` insuficiente, dedup por intervalo, cooldown.
- **Un test de integración que corre la misma función de detección sobre las dos configs con sus fixtures** y verifica detecciones correctas en ambos dominios. Ese test es la tesis del proyecto convertida en algo verificable.

## 10. Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| El día de UI se desborda | Dashboard primero feo y funcional; pulir al final |
| Mal wifi en la presentación | Caché de decisiones + modo offline pregrabado |
| La simulación no falla durante la grabación | Seed determinístico + botón "Forzar incidente" |
| Latencia de Claude rompe el ritmo | `effort: "low"` + fast mode + streaming |
| Presupuesto de API en un playground público | Rate limit por sesión + caché por detección |

## 11. Orden de corte si el tiempo aprieta

1. `duration_vs_baseline` — las otras tres reglas ya cubren ambos dominios.
2. `github_issue` — queda como quinto adapter opcional.
3. El generador de config se defiende hasta el final: es lo que convierte la tesis en algo que el votante comprueba con las manos.

## 12. Orden de construcción

1. Contrato de datos: schema Zod de `DomainConfig`, `NormalizedEvent`, `Interval`, `Detection`, `Decision`.
2. Normalizador + `intervals.ts` (el primitivo de VOLT) + tests.
3. Detector con los 4 evaluadores + tests + el test de integración de dos dominios.
4. Simulador OCPP de VOLT con seed determinístico.
5. Decisor con Claude tool use.
6. Executors: discord, ntfy, webhook, state_mutation, noop.
7. Config del restaurante + su simulador.
8. Dashboard con los cinco carriles.
9. Generador de config.
10. Deploy, video, landing de voto.
