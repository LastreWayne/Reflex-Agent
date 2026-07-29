# Reflex Agent

Un motor genérico de agentes de monitoreo y acción automática, con un
playground público que lo corre en vivo.

La secuencia es siempre la misma —**vigilar → detectar patrón → decidir acción
→ ejecutar**— sin importar si se vigilan estaciones de carga eléctrica, mesas
de un restaurante o cualquier entidad con estados que cambian en el tiempo. Lo
único que cambia entre un cliente y otro es qué cuenta como evento, qué patrón
importa y qué acciones hay disponibles.

Eso vive en un archivo de configuración, no en el código.

---

## Lo que lo hace distinto: el agente muestra lo que descartó

La página no exhibe una decisión, exhibe una **deliberación**.

Cada caso muestra las tres acciones del dominio: la elegida encendida con su
motivo y el mensaje que lee una persona, y las descartadas en gris con el
razonamiento de por qué no. Más el **contrafáctico** — qué tendría que haber
sido distinto para que la decisión cambiara.

Sin las alternativas, un agente es indistinguible de un `switch (ruleId)`. Con
ellas, se vuelve verificable que hubo criterio.

**Y la exhaustividad no se pide en el prompt.** La impone el `input_schema` de
cada tool: se genera una tool por acción, y el schema de cada una conoce a las
otras y las exige en `required` con `additionalProperties: false`. Bajo
`strict: true`, el modelo **no puede** omitir una alternativa. No hay
instrucción que se pueda ignorar.

---

## Correrlo

```bash
npm install
npm run dev          # → http://localhost:3000
```

**Sin clave de API y sin gastar un centavo:** abrí
`http://localhost:3000/?offline=1`. Corre el pipeline entero con decisiones
pregrabadas.

Para el camino en vivo a Claude, copiá `.env.example` a `.env.local` y poné
`ANTHROPIC_API_KEY`.

### Parámetros de URL

| Parámetro | Qué hace |
|---|---|
| `?domain=volt\|restaurant` | Cambia de dominio. **Es la tesis entera.** |
| `?offline=1` | Decisiones pregrabadas: sin clave, sin gasto, sin red |
| `&seed=42` | Fija los eventos generados |
| `&at=ISO` | Fija el instante de evaluación |
| `&force=1` | Fuerza un incidente |
| `&max=3` | Tope de casos |
| `&view=full` | Abre la vista de los cinco carriles |

`seed` + `at` hacen la corrida **determinista hasta el timestamp**: dos
corridas con los mismos parámetros dan exactamente lo mismo. Sin eso el
playground no sería verificable, y a un evaluador escéptico hay que dejarlo
verificar.

### Otros comandos

```bash
npm test              # 203 tests en 18 archivos
npm run typecheck     # tsc sobre el proyecto
npm run build         # build de producción
```

---

## Agregar un dominio

Un dominio es un JSON en `configs/`. Declara la entidad, sus estados, el
contexto que lee el modelo, las reglas de detección y las acciones
disponibles:

```jsonc
{
  "domain": "restaurant",
  "entity": { "singular": "mesa", "plural": "mesas" },
  "states": ["Libre", "Reservada", "Ocupada"],
  "context": "Restaurante de 12 mesas con reservas. El dueño atiende el salón…",
  "rules": [
    { "id": "no-show", "type": "duration_in_state", "state": "Reservada",
      "thresholdMs": 900000, "severity": "medium",
      "description": "Reserva sin check-in, riesgo de no-show" }
  ],
  "actions": [
    { "id": "avisar-dueno", "type": "ntfy",
      "description": "Notificación al celular del dueño",
      "config": { "topic": "env:NTFY_TOPIC" } }
  ],
  "cooldownMs": 600000
}
```

Los secretos **nunca** van en el config: se referencian como `env:NOMBRE` y se
resuelven en el servidor.

**Tipos de regla:** `duration_in_state` · `frequency_in_window` ·
`absence_of_events` · `duration_vs_baseline`

**Tipos de acción:** `discord` · `github_issue` · `ntfy` · `webhook` ·
`state_mutation` · `noop`

> Honestidad sobre la tesis: hoy quedan **dos** lugares en código que conocen
> los dominios existentes —el mapa de tonos de estado en `app/page.tsx` y las
> decisiones pregrabadas del modo offline en `app/pipeline.ts`—. Un tercer
> dominio funciona, pero degrada en esos dos puntos. Está anotado en
> `docs/superpowers/DEUDA-2026-07-29.md` con el plan para cerrarlo.

---

## Arquitectura

```
engine/      el motor, sin ninguna dependencia de framework
  normalizer · intervals · detector · rules/

adapters/    todo lo que toca el mundo exterior
  decider/   prompt + cliente de Claude
  executors/ discord · github-issue · ntfy · webhook · state-mutation · noop
  store/

app/         Next.js (App Router) — el playground y las dos rutas de API
configs/     los dominios
simulators/  generadores de eventos deterministas
```

**Stack:** Next.js · TypeScript · el SDK de Anthropic · zod. **Cero
dependencias de UI**: el vidrio líquido, el escalonado y el dock son CSS a
mano.

### Dos garantías que son estructurales, no filtros

**La deliberación no llega al executor.** `Deliberation` viaja en un tipo
separado de `Decision`, y los executors reciben `Decision` y nada más. El
texto deliberativo del modelo no tiene ninguna ruta hasta un issue de GitHub
ni un canal de Discord — no porque alguien mantenga una lista, sino porque el
camino no existe. Ensanchar lo que llega a `/api/execute` rompe la garantía.

**La evidencia se cerca antes de entrar al prompt.** `/api/decide` es una ruta
pública y su `evidence` es un record abierto, así que el JSON serializado
entero pasa por un escape de `<` → `&lt;`. Sin el ángulo de apertura no se
forma etiqueta, y el cerco deja de ser forjable.

---

## Desplegar

Son **dos despliegues distintos, a propósito**:

- **Público** — sin **ninguna** de las cuatro variables de destino
  (`DISCORD_OPS_WEBHOOK`, `NTFY_TOPIC`, `GITHUB_REPO`, `GITHUB_TOKEN`).
  `/api/decide` y `/api/execute` son públicas y sin autenticación: **la
  ausencia de esas variables es la mitigación**, porque el executor corta
  antes de cualquier llamada de red y la tarjeta dice qué variable falta.
- **Grabación** — con todos los secretos, para el video.

⚠️ Si agregás un executor que salga a la red, **sumarlo a esa lista es parte
de su definición de listo.** Una mitigación que enumera sólo protege si la
enumeración está al día.

---

## Estado

203 tests en 18 archivos · `tsc` limpio · dos dominios completos ejercitados
contra la API real.

**Lo que no hay, y que este README no va a fingir:** no hay clientes reales
usando esto, ni testimonios, ni benchmarks, ni métricas de producción. VOLT es
un proyecto del mismo autor —una plataforma real de carga de vehículos
eléctricos, de donde viene validado el primitivo de convertir eventos crudos
en intervalos de duración— pero no es un cliente.

---

## Más documentación

| Archivo | Qué contiene |
|---|---|
| `PRODUCT.md` | Qué es el producto, para quién, y sus principios |
| `DESIGN.md` | La autoridad visual: vidrio, tokens, contraste medido |
| `docs/superpowers/DEUDA-2026-07-29.md` | La deuda técnica viva, por causa raíz |
