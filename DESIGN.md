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
>
> **Tercera vuelta, mismo día.** Dos pedidos puntuales y tres referencias
> nuevas (`references/liquidglass1..3.png`, `liquid-glass-card.tsx`,
> `dock-magnify.tsx`). Sobre el marco: *"reduce el tamaño de este frame aún
> más y hazlo mucho más transparente con este efecto, recuerda LIQUID
> GLASS."* Sobre las pestañas: *"quiero que al pasar el cursor tengan una
> animación más única… redúceles el largo cuando están dormidas y cuando se
> les interactúa se abren al tamaño normal, animado."* Las dos cosas salieron
> como **piezas reusables con props** —`app/vidrio-liquido.tsx` y
> `app/pestanas-dock.tsx`— y no como marcado soldado a la página.

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

## Vidrio líquido

**El vidrio es estructura, no decoración.** Sólo lo llevan las dos superficies
que de verdad se apoyan sobre el fondo animado:

1. el **marco del hero**, y
2. las **cinco pestañas**.

Ningún otro panel de la página lo usa. Nada de blur repartido por paneles que
no tienen nada detrás.

**Qué es liquid glass acá**, leído de `references/liquidglass1..3.png` y no de
la palabra:

- **El filo es el efecto.** En las tres capturas es lo primero que se ve. Y acá
  hay una traducción obligatoria: las tres son vidrio sobre fondo **oscuro**,
  donde un filo blanco brilla. Sobre papel hueso el blanco solo no existe, así
  que el canto es de **dos líneas** — hairline de `--linea-control` por fuera,
  filo blanco por dentro. Es el aro plateado de `liquidglass3.png`.
- **El centro es casi transparente.** No es un panel esmerilado. El marco está
  en **0.30** de tinte: el campo de líneas se lee entero a través de él.
- **El fondo se dobla al cruzarlo** (`liquidglass2.png`, el tallo de la flor).
  `feTurbulence` + `feDisplacementMap`, con `scale` 26 — no los 200 de la
  referencia.
- **Especulares** donde la luz pega: el destello del canto de arriba y los dos
  brillos diagonales opuestos.

**El filtro va ADENTRO de `backdrop-filter`, no al lado.** Probado en Chromium
antes de construir: `filter: url(#…)` sobre el mismo elemento deforma al
elemento entero, su texto incluido; y en una capa aparte no dobla nada, porque
esa capa es transparente. `backdrop-filter: url(#…) blur()` sí funciona — ahí
`SourceGraphic` es el fondo. El valor viaja inline y sin `var()` para que, si el
navegador no soporta `url()` ahí adentro, la declaración se descarte al parsear
y quede el `blur()` de la hoja: se pierde la refracción, nunca el desenfoque.

**La región del filtro es exactamente el elemento.** Agrandarla al 124 % para
que el canto no chupe píxeles de afuera hunde la página de 37 fps a 4. Medido,
no supuesto.

**La legibilidad gana sobre el efecto.** Las opacidades salen de medir el texto
contra el momento **más oscuro** del campo de líneas (dos trazos cruzados en el
pico del latido), no contra su promedio. `backdrop-filter: blur()` sólo
promedia, así que el píxel real nunca es peor que el cálculo — y la cota vale
para cualquier radio de blur. Sin soporte de `backdrop-filter`, la superficie
se vuelve casi opaca en vez de quedarse transparente.

**La tensión, dicha en voz alta.** A 0.30 de tinte `--tinta` todavía da 6.21:1,
pero `--tinta-media` se cae a **2.67:1**: el lema y la bajada no pasan. Subir el
vidrio entero habría sido deshacer el pedido del humano. Entonces la densidad va
**sólo donde hay letras**: `--lavado-hero`, un rectángulo de papel con halo
anclado al bloque de texto, que compone 0.30 + 0.56·0.70 = **0.692** de tinte
efectivo. El vidrio vive en el canto y el lavado vive bajo el texto. Es un
rectángulo desenfocado por `box-shadow` y no por `filter: blur()`, que adentro
de un `backdrop-filter` se comía la mitad del frame rate.

**Regla que se hereda:** dentro del marco, fuera del bloque de texto, no va
texto. El hero usa `--tinta` y `--tinta-media`, y las dos viven sobre el lavado.

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

## Las cinco pestañas: un dock

De `references/dock-magnify.tsx` se toma **el carácter**, no el código: el ancho
de cada pestaña responde a la **distancia** del cursor, así que la de al lado
crece bastante y la siguiente bastante menos. Un hover binario no es esto.

- **Sin framer-motion.** El JS son quince líneas: un `pointermove` con
  `{ passive: true }` sobre la tira, la distancia por ítem, y una custom
  property `--cerca` de 1 a 0. El ancho lo hace un `calc()`. Las lecturas de
  layout van todas antes que las escrituras, y todo agrupado en un
  `requestAnimationFrame`.
- **El alcance tiene que abarcar dos pestañas.** Con 190 px el vecino crecía 22
  px y el siguiente nada: se leía como un hover con retardo. Con **360 px** la
  caída se lee.
- **La caída es un suavizado de Hermite**, no una rampa lineal. La rampa se lee
  como un escalón.
- **El rebote** —lo único que una librería de springs haría mejor— se aproxima
  con `--rebote: cubic-bezier(.34, 1.56, .64, 1)`.
- **El largo en reposo lo decide el CSS, no el JS.** Sin puntero fino (teléfono,
  tableta) y con `prefers-reduced-motion`, las pestañas arrancan **enteras**. La
  magnificación es una gracia de puntero: sin puntero no hay nada que
  magnificar, y una pestaña recortada que nadie puede agrandar es una pestaña
  rota. Sin JS, o antes de la hidratación, se siguen abriendo por hover y por
  foco: se pierde la proximidad, no el acceso.
- **Se abren por puntero, por teclado (`:focus-visible`) Y por toque.** El ancho
  toma `max(--cerca, --abierto)`, así el teclado la abre entera aunque el cursor
  esté lejos y un `--cerca` viejo no pueda cerrarla.

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
- **El marco no llena la pantalla.** Es más chico que el viewport a propósito:
  el campo de flujo tiene que correr libre alrededor, no asomar por un margen
  de doce píxeles.
- **Las pestañas se abren por puntero, por teclado Y por toque.** Un disclosure
  sólo-hover no lo puede usar nadie que no tenga mouse.
- **Cualquier efecto nuevo sobre el fondo animado se mide antes de quedarse.**
  El campo de flujo ya se ganó sus 60 fps; un `feTurbulence` mal encuadrado los
  tira a 4. `node docs/design/mirar.mjs` imprime los fps.
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
| `--vidrio-papel` (el papel de todo el vidrio) | `250 248 242` |
| `--lavado-hero` (bajo el bloque de texto) | `0.56` |
| `--vidrio-tinte-sin-soporte` | `0.94` |

Los alfa de cada superficie son **props de `useVidrio`**, no tokens: son
distintos en cada una y el de la refracción tiene que viajar inline.

| Superficie | Tinte | Blur | Refracción |
|---|---|---|---|
| Marco del hero | `0.30` | `5px` | `scale 26` |
| Pestaña dormida | `0.88` | `13px` | — |
| Pestaña abierta | `0.95` | `13px` | — |

**Los amarillos y el vidrio, medidos** (`node docs/design/contraste.mjs`):

| Par | Ratio | Mínimo |
|---|---|---|
| `--sobre-amarillo` sobre `--amarillo` (relleno) | **10.71:1** | 4.5 |
| `--oro` como texto sobre `--papel` | **6.62:1** | 4.5 |
| `--oro` sobre `--amarillo-palido` | **6.67:1** | 4.5 |
| `--punto-aro` sobre `--papel` (gráfico, 1.4.11) | **4.37:1** | 3 |
| `--linea-control` sobre `--papel` (gráfico) | **3.47:1** | 3 |
| **`--tinta` sobre vidrio + lavado, peor momento del fondo** | **11.55:1** | 4.5 |
| **`--tinta-media` sobre vidrio + lavado, peor momento** | **4.98:1** | 4.5 |
| `--tinta` sobre el vidrio PELADO (0.30), peor momento | **6.21:1** | 4.5 |
| `--tinta` sobre el vidrio sin `backdrop-filter` | **16.11:1** | 4.5 |
| **`--tinta` sobre el vidrio de la pestaña, peor momento** | **14.87:1** | 4.5 |
| **`--tinta-media` sobre el vidrio de la pestaña, peor momento** | **6.41:1** | 4.5 |
| **`--tinta-tenue` sobre el vidrio de la pestaña, peor momento** | **4.77:1** | 4.5 |
| `--punto-aro` sobre el vidrio de la pestaña (gráfico) | **4.06:1** | 3 |
| `--linea-control` sobre vidrio limpio (canto del marco) | **3.56:1** | 3 |

`--tinta-media` sobre el vidrio **pelado** da **2.67:1** y no aparece en la
tabla porque no existe en la página: todo el texto del hero vive sobre el
lavado. Ese número es la razón de que el lavado exista.

`--amarillo` solo sobre papel da **1.46:1**. Por eso nunca aparece suelto: o
lleva tinta encima, o lleva `--punto-aro` alrededor.

Ritmo `--e1`…`--e8` con `--e6: 2.25rem` de paso base. Dos curvas y no más:
`--salida: cubic-bezier(0.16, 1, 0.3, 1)` para todo lo que abre y cierra, y
`--rebote: cubic-bezier(0.34, 1.56, 0.64, 1)` sólo para el ancho del dock.

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
