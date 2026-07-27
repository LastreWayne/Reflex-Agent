# DESIGN.md — Reflex Agent

Decisiones visuales durables del playground público.

> **Reemplazo de mundo, 27/07.** La primera dirección fue *señalética industrial
> esmaltada* — chapa, remaches, lámparas con aro. El humano la descartó por
> demasiado robótica/industrial y pinneó una nueva con tres referencias en
> `references/`. Lo que sigue reemplaza esa dirección; el mundo anterior queda
> como evidencia y anti-referencia, no como autoridad.
>
> **Segunda vuelta, mismo día.** Sobre esa base el humano corrigió cuatro
> cosas: el producto se llama **Reflex Agent** (*"Centinela sin más es muy
> olvidable"*), el hero pasa a ser un **recuadro embutido** con **líneas de
> flujo animadas detrás** (componente propio, en `references/background-paths.tsx`),
> los cinco caminos pasan a ser **pestañas mínimas abajo que se abren al pasar
> por encima**, con **vidrio líquido** y **trazo amarillo**, y **se elimina el
> modo oscuro** (*"al final quedémonos con el modo claro, es lo que mejor le
> queda al proyecto"*).

---

## Contrato de dirección

**THESIS.** El agente se presenta con la compostura de algo que ya está
resuelto: una pieza editorial silenciosa donde el título ocupa el aire que
merece y el sistema se explica sin levantar la voz. Rechaza el dashboard denso
que empieza en modo herramienta, y rechaza el mundo industrial que construimos
antes — placa, remache, textura y relieve quedan prohibidos.

**OWN-WORLD.** Papel hueso, un marco de vidrio embutido sobre un campo de
líneas de tinta que corren, tipografía serif de display a escala enorme contra
un cuerpo diminuto, y **muchísimo aire**. Sin bordes pesados: separaciones por
espacio y hairline. Un solo acento amarillo con subtonos definidos.

**STORY.** El visitante entiende de un vistazo qué hace el agente, se asoma a
los cinco caminos tocando las pestañas de abajo, y recién al bajar se encuentra
con el motor corriendo de verdad.

**FIRST VIEWPORT.** El marco embutido con el título adentro, y las cinco
pestañas mínimas apoyadas contra su borde inferior. **Nada más entra en esta
pantalla** — ni controles, ni carriles, ni mascota.

**FORM.** Editorial minimalista, pinneado por referencia del humano
(`references/`). Sin tirada de dado: un brief pinneado gana al roll.

---

## Color

**Un solo modo: claro.** El oscuro se eliminó por pedido del humano. No hay
tokens `--d-*`, no hay rama de `prefers-color-scheme`, no hay interruptor.
`color-scheme: light` queda fijo para que los controles nativos pinten bien.

**Restringido: neutros más un acento.** El amarillo es el único color con
permiso, y aparece poco — por eso pesa cuando aparece.

| Rol | Uso |
|---|---|
| **Amarillo señal** | el acento vivo: píldora de acción, punto de luz encendido, botón activo |
| **Oro profundo** | el amarillo cuando tiene que ser texto o ícono sobre claro |
| **Amarillo pálido** | lavados y fondos de énfasis, nunca texto |
| Neutros | papel hueso, tinta casi negra, y dos tintas intermedias entintadas del papel |

**El amarillo puro no pasa contraste sobre claro** (1.46:1). Por eso los
subtonos no son decorativos: el amarillo vivo se usa **relleno con tinta oscura
encima** o como punto de luz **con aro de oro**; cuando hace falta amarillo
*legible*, se usa el oro profundo.

La severidad se dice con un punto de luz, no con un borde de color a la
izquierda de la tarjeta. Como la paleta tiene un solo acento, los tres niveles
de alerta comparten núcleo amarillo y se distinguen por el **grosor del aro**.

---

## Vidrio

**El vidrio es estructura, no decoración.** Sólo lo llevan las dos superficies
que de verdad se apoyan sobre el fondo animado:

1. el **marco del hero**, y
2. las **cinco pestañas**.

Ningún otro panel de la página lo usa. Nada de blur repartido por paneles que
no tienen nada detrás.

**La legibilidad gana sobre el efecto.** Las opacidades del vidrio son el
resultado de medir el texto contra el momento **más oscuro** del campo de
líneas (dos trazos cruzados en el pico del latido), no contra su promedio.
`backdrop-filter: blur()` sólo promedia, así que el píxel real nunca es peor
que el cálculo. Sin soporte de `backdrop-filter`, la superficie se vuelve casi
opaca en vez de quedarse transparente.

**Regla que se hereda:** dentro del marco, fuera de las pestañas, no va
`--tinta-tenue` — sobre ese vidrio en su peor momento no llega a 4.5:1. El hero
usa `--tinta` y `--tinta-media`, y nada más.

---

## Fondo de flujo

Vive en `app/fondo-flujo.tsx`, adaptado de `references/background-paths.tsx`.
Se toma **sólo la geometría y el movimiento de `FloatingPaths`**; el wrapper
`BackgroundPaths` de la referencia se descarta entero.

- **Sin framer-motion.** `pathLength` + `pathOffset` + `opacity` en loop lineal
  es exactamente `stroke-dasharray` + `stroke-dashoffset` + un keyframe. Con
  `pathLength="1"` el patrón mide 1 y correr el offset una unidad es una vuelta
  sin costura.
- **Sin `Math.random()`.** Duración y desfase salen del índice.
- **El latido de opacidad va en el `<svg>`, no por trazo.** Medido: por trazo
  son 21 fps, en el `<svg>` son 60 con los 72 puestos.
- **Tinta media, no tinta plena.** Un dibujo callado. El amarillo no se reparte
  por el campo: lo llevan tres líneas.
- **`prefers-reduced-motion`:** las líneas quedan enteras y quietas, no se
  ocultan.

---

## Tipografía

**Display: Instrument Serif.** Alto contraste y elegante, con filo editorial
moderno — evita el registro de invitación de boda. Va a escalas grandes de
verdad, no a 1.5rem. Se usa la redonda para el nombre y la itálica para el lema.

**Cuerpo: stack de sistema.** Neutro y diminuto en comparación, exactamente
como en las tres referencias. Se usa el stack nativo en vez de una segunda
fuente de Google para no sumar riesgo de red en el build de Vercel.

Descartadas por ser lo que el modelo repite por default: Playfair, Fraunces,
Cormorant, Lora, Crimson, Newsreader, Inter como display, Space Grotesk, DM
Sans, Outfit, Plus Jakarta, Instrument Sans.

---

## Reglas durables

- **El título manda.** Nada comparte su pantalla salvo las pestañas.
- **El salto de escala es el diseño.** Display enorme contra cuerpo chico; si
  los dos crecen juntos, se perdió.
- **Separar con aire, no con líneas.** Hairline sólo donde el espacio no
  alcanza. Cero paneles con relieve, cero remaches, cero textura de grano.
- **Nada de gradientes en texto.**
- **El vidrio sólo donde hay algo detrás.**
- **Las pestañas se abren por puntero, por teclado Y por toque.** Un disclosure
  sólo-hover no lo puede usar nadie que no tenga mouse.
- **Un solo momento de movimiento autoral** — el motor barriendo las cinco
  etapas. El campo de flujo es ambiente, no es ese momento.
- **Todo el color y el ritmo viven en tokens** al principio de `globals.css`.
- **El estado vive en el marcado** (`data-status`, `data-severity`,
  `data-source`, `data-open`, `data-lane`, `data-view`). El CSS lo lee.
- **La mascota se queda.** Al humano le gusta; se refina después. No vive en el
  primer viewport.

---

## Tokens

Los valores viven una sola vez, arriba de `app/globals.css`. Acá quedan
fijados; los ratios están **medidos** con `node docs/design/contraste.mjs`, no
estimados.

| Rol | Valor |
|---|---|
| `--papel` | `#f2efe7` |
| `--papel-alto` (tarjeta) | `#faf8f2` |
| `--papel-hondo` (input) | `#e7e3d8` |
| `--tinta` | `#17140f` |
| `--tinta-media` | `#57513f` |
| `--tinta-tenue` | `#6b6450` |
| `--linea` (hairline) | `#ddd8c9` |
| `--linea-fuerte` | `#bdb6a2` |
| `--linea-control` (borde de control, canto del marco) | `#867f6b` |
| **`--amarillo`** señal | `#f2c200` |
| `--amarillo-alto` (hover) | `#ffd21e` |
| **`--oro`** profundo | `#6a5000` |
| **`--amarillo-palido`** | `#fbf0c9` |
| `--punto-aro` (aro del punto de luz, trazo de pestaña) | `#8a6b00` |
| `--sobre-amarillo` (tinta sobre relleno) | `#1a1610` |
| `--vidrio` (marco) | `rgba(250,248,242,0.68)` + `blur(10px)` |
| `--vidrio-pestana` | `rgba(250,248,242,0.92)` + `blur(14px)` |
| `--vidrio-opaco` (sin `backdrop-filter`) | `rgba(250,248,242,0.94)` |

**Los amarillos y el vidrio, medidos:**

| Par | Ratio | Mínimo |
|---|---|---|
| `--sobre-amarillo` sobre `--amarillo` (relleno) | **10.71:1** | 4.5 |
| `--oro` como texto sobre `--papel` | **6.62:1** | 4.5 |
| `--oro` sobre `--amarillo-palido` | **6.67:1** | 4.5 |
| `--punto-aro` sobre `--papel` (gráfico, 1.4.11) | **4.37:1** | 3 |
| `--linea-control` sobre `--papel` (gráfico) | **3.47:1** | 3 |
| **`--tinta` sobre el vidrio del marco, peor momento del fondo** | **11.32:1** | 4.5 |
| **`--tinta-media` sobre el vidrio del marco, peor momento** | **4.88:1** | 4.5 |
| `--tinta` sobre el vidrio sin `backdrop-filter` | **16.11:1** | 4.5 |
| **`--tinta-media` sobre el vidrio de la pestaña, peor momento** | **6.75:1** | 4.5 |
| **`--tinta-tenue` sobre el vidrio de la pestaña, peor momento** | **5.03:1** | 4.5 |

`--amarillo` solo sobre papel da **1.46:1**. Por eso nunca aparece suelto: o
lleva tinta encima, o lleva `--punto-aro` alrededor.

Ritmo `--e1`…`--e8` con `--e6: 2.25rem` de paso base. Una sola curva:
`--salida: cubic-bezier(0.16, 1, 0.3, 1)`.

---

## Pendiente

- **PRODUCT.md no existe.** La verdad de producto vive en el hub de Obsidian
  (`projects/reflex-agent.md`) y en `docs/superpowers/specs/`. `init` se difirió
  por el deadline.
- La mascota necesita un pase de refinamiento propio. Acá quedó re-dibujada en
  papel y tinta con un solo punto de luz, con el mismo comportamiento de antes.
- El punto de luz distingue las tres alertas por grosor de aro, no por matiz,
  porque la paleta tiene un solo acento. Falta ver con gente si esa distinción
  se lee o si conviene apoyarla en un segundo canal.
- `data-tema` se eliminó junto con el modo oscuro. Nada lo escribía ni lo leía
  después del cambio.
