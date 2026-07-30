# Deploy

Son **dos deploys distintos, a propósito**, y la diferencia entre ellos no es
cosmética: es la mitigación de seguridad del proyecto.

`/api/decide` y `/api/execute` son rutas **públicas y sin autenticación**. La
ausencia de las variables de destino **es** lo que impide que un visitante
anónimo use el deploy público como relay: sin la variable, el executor corta
antes de cualquier llamada de red y la tarjeta dice qué variable falta.

Por eso van en **dos proyectos de Vercel separados** y no en dos entornos del
mismo proyecto: así un scope mal puesto no puede filtrar un secreto a
producción.

---

## Proyecto 1 — `reflex-agent` (público)

Es el link del concurso. Corre el motor de verdad, decide con Claude, y **no
puede ejecutar nada hacia afuera**.

| Variable | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | la clave |
| `DECIDER_MODEL` | `claude-sonnet-5` |
| `DECIDER_FAST` | `0` |

**Y ninguna más.** Las cuatro de destino van **ausentes**:

```
DISCORD_OPS_WEBHOOK   ✗ ausente
NTFY_TOPIC            ✗ ausente
GITHUB_REPO           ✗ ausente
GITHUB_TOKEN          ✗ ausente
```

> `DECIDER_MODEL` y `DECIDER_FAST` coinciden con los defaults del código, así
> que técnicamente alcanza con la clave. Se declaran igual: documentan la
> intención y protegen de que el default cambie.

## Proyecto 2 — `reflex-agent-rec` (grabación)

Sólo para grabar el video. **No se comparte el link.**

| Variable | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | la clave |
| `DECIDER_MODEL` | `claude-opus-5` |
| `DECIDER_FAST` | `1` |
| `DISCORD_OPS_WEBHOOK` | el webhook del canal |
| `NTFY_TOPIC` | el topic |
| `GITHUB_REPO` | `owner/repo` — con la barra, **sin** URL |
| `GITHUB_TOKEN` | PAT con permiso de issues |

⚠️ `DECIDER_FAST=1` **sólo** funciona con `claude-opus-5` o `claude-opus-4-8`.
Con cualquier otro modelo el decisor falla **al construirse**, con un 500
explícito. Es a propósito: una demo en vivo no puede descubrir eso frente a
una audiencia.

---

## Pasos (dashboard)

Para cada proyecto:

1. **vercel.com/new** → Import Git Repository → `LastreWayne/Reflex-Agent`
2. **Project Name**: `reflex-agent` o `reflex-agent-rec`
3. **Framework Preset**: Next.js — lo detecta solo desde `vercel.json`
4. **Root Directory**: `./`
5. **Environment Variables**: cargar las de la tabla que corresponda
6. **Deploy**

El mismo repo se puede importar dos veces; Vercel lo permite.

`vercel.json` ya fija `buildCommand: npm run build` e
`installCommand: npm ci`. No hay `engines` ni `.nvmrc`, así que Vercel usa su
Node por defecto — Next 16 necesita ≥ 20.

---

## Verificar después de deployar

**1 · La página, sin gastar un centavo:**

```
https://<url>/?offline=1
https://<url>/?offline=1&domain=restaurant
```

Corre el pipeline entero con decisiones pregrabadas. Si esto anda, el build
está sano.

**2 · El camino en vivo a Claude** — `/api/decide` debe dar **200** con una
deliberación bien formada:

```bash
curl -s -X POST https://<url>/api/decide \
  -H "content-type: application/json" \
  -d '{"domain":"volt","detection":{
        "ruleId":"faulted-stuck","entityId":"EVC-04",
        "detectedAt":"2026-07-30T20:00:00.000Z","severity":"high",
        "evidence":{"state":"Faulted","durationMs":1200000,"thresholdMs":600000},
        "dedupKey":"faulted-stuck:EVC-04:2026-07-30T19:40:00.000Z",
        "cooldownKey":"faulted-stuck:EVC-04"}}'
```

Tiene que volver `decision` **y** `deliberation`, con `rejected` cubriendo las
otras dos acciones.

**3 · LA MITIGACIÓN — sólo en el público.** Es el chequeo que importa:

```bash
curl -s -X POST https://<url>/api/execute \
  -H "content-type: application/json" \
  -d '{"domain":"volt","actionId":"alert-ops",
       "decision":{"actionId":"alert-ops","reason":"x","message":"y"},
       "detection":{ … el mismo de arriba … }}'
```

Debe volver `{"result":{"ok":false,…}}` con un `detail` que diga **"Falta la
variable DISCORD_OPS_WEBHOOK"**.

Si vuelve `ok: true`, **el deploy público tiene una variable que no debería
tener** y hay que sacarla antes de compartir el link.

---

## Interpretar los errores

| Código | Qué significa |
|---|---|
| **400** | El body no pasó el schema |
| **500** | **Deploy mal armado.** Falta la clave, o `DECIDER_FAST=1` con un modelo que no lo soporta. Se arregla en las variables, no en el código. |
| **502** | Falló el modelo. El deploy está bien. |

La separación 500/502 es deliberada y está testeada: con un solo `catch`, un
deploy roto se vería como un hipo de Claude y nadie lo arreglaría a tiempo.

---

## Dos cosas a mirar antes de compartir el link

**El gasto no está acotado por visitante.** El costo por request sí lo está
—`MAX_EVIDENCE_JSON_LENGTH`, `max_tokens`, `effort: "low"`— pero nada limita
cuántas requests hace una misma persona. Para un playground de concurso es
riesgo aceptado y reversible: se rota la clave y se baja el deploy. Si el link
llega a algún lado con tráfico, el control mínimo es **rate limiting de Vercel
sobre `/api/decide`** — configuración, no código. Conviene además un **spend
limit en la consola de Anthropic**.

**Si agregás un executor que salga a la red**, sumarlo a la lista de variables
ausentes del proyecto público es **parte de su definición de listo**. Esa
lista ya se desactualizó una vez: `NTFY_TOPIC` faltaba, y `.env.example` lo
shipeaba con valor.
