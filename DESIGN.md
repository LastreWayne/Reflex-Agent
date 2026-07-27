# DESIGN.md — Reflex Agent / Centinela

Decisiones visuales durables del playground público. Escrito antes del primer
build del mundo nuevo, según el flujo de `impeccable`.

---

## Contrato de dirección

**THESIS.** Una consola de señalización industrial: el agente vigila
infraestructura física, así que la interfaz se ve como el equipamiento que
vigila. Rechaza el dashboard SaaS de tarjetas iguales sobre gris, y rechaza su
opuesto predecible — negro casi puro con un acento neón y bordes que brillan.

**OWN-WORLD.** Señalética esmaltada: chapa pintada, colores de señal con
significado real, diagonales de peligro, y lámparas indicadoras que son
lámparas (lente, cuerpo, sombra) y no halos. Tipografía Archivo — Expanded
para display con presencia de placa, normal para texto. Reconocible con todo
el contenido borrado por la diagonal de peligro, la placa esmaltada y la
lámpara física.

**STORY.** El visitante entiende en un viewport que esto vigila algo real y
actúa solo; recorre las cinco etapas del pipeline una por una; y descubre que
el mismo motor sirve a dos dominios que no se parecen.

**FIRST VIEWPORT.** Placa de encabezado con el nombre a escala de señal.
Debajo, tres placas que explican los caminos. Después el carril único grande —
la acción primaria (← / →) sobre él — y la mascota bajo el carril.

**FORM.** Señalética industrial esmaltada. Dirección pinneada por el brief del
humano (paleta roja/ámbar/naranja, dos modos, estructura de dos vistas); no se
tiró dado de concepto porque un brief pinneado gana al roll.

---

## Estrategia de color

**Paleta completa, 3 roles nombrados.** Los tres colores del brief no son
decoración: son códigos de señal con significado, igual que en la señalética
real que el producto vigila.

| Rol | Significado | Uso |
|---|---|---|
| **Rojo señal** | falla, severidad alta | lámpara de alerta, placa de incidente |
| **Ámbar** | atención, severidad media | lámpara de advertencia, estado en curso |
| **Naranja** | energía, la marca | acento del producto, acción primaria |

El neutro es chapa, no gris de interfaz: cálido en claro, grafito en oscuro.

**Claro y oscuro salen de la escena de uso, no del rubro.** Claro es el
default: un votante abre un link en el teléfono, de día. Oscuro existe porque
la otra escena real es alguien mirando una red de carga a las 3 de la mañana.

---

## Tipografía

**Archivo** (Google Fonts). Expanded 600/700 para display, normal 400/500 para
texto, cifras tabulares para todo lo numérico.

Elegida como objeto del mundo del sujeto: es una grotesca de señalética con
peso real, no una UI face neutra. Se descartan explícitamente las caras que el
modelo repite por defecto (Inter como display, Space Grotesk, Space Mono, IBM
Plex, DM Sans, Outfit).

---

## Reglas durables

- **La severidad se comunica con una lámpara**, no con un borde de color a la
  izquierda de la tarjeta. Un `border-left` de color arriba de 1px es el
  recurso por defecto de la categoría.
- **Las diagonales de peligro son estructura, no textura.** Marcan zonas de
  atención (incidente forzado, error), nunca decoran un fondo vacío.
- **Las lámparas tienen cuerpo.** Lente, borde y sombra con desplazamiento. Un
  halo de color sin offset es decoración, y el mundo esmaltado no emite luz.
- **Nada de gradientes en texto.** El énfasis sale del peso y del tamaño.
- **Todo el color vive en tokens** al principio de `globals.css`. Cambiar de
  rumbo es editar ese bloque.
- **El estado vive en el marcado** (`data-status`, `data-severity`,
  `data-source`, `data-open`, `data-lane`). El CSS lo lee, nunca lo re-deriva.

---

## Tokens fijados en el primer build

Viven en el bloque 1 de `app/globals.css`. Cambiar el rumbo del color es
editar **esos valores**; el resto de la hoja sólo usa los nombres semánticos.

| Rol | Día (`--l-*`) | Noche (`--d-*`) |
|---|---|---|
| chapa (fondo) | `#e7dfd2` | `#22201b` |
| placa (cara) | `#f8f4ec` | `#2e2b25` |
| canto / canto duro | `#c7bba8` / `#93866f` | `#474137` / `#625b4f` |
| tinta / media / suave | `#221e18` / `#554c40` / `#655a4a` | `#f4ede0` / `#bfb3a0` / `#b0a48d` |
| acero (mascota) | `#cdc2af` → `#8b8070` | `#6e6555` → `#474033` |
| **rojo señal** — lente / aro / tinta | `#e8412a` / `#6d1a0f` / `#a52a1b` | `#ef4a2f` / `#58150a` / `#ff8770` |
| **ámbar** — lente / aro / tinta | `#f4ac1b` / `#7a5206` / `#7f5303` | `#f6b431` / `#6b4905` / `#f7bd58` |
| **naranja** — lente / aro / tinta | `#ef6f1c` / `#7c330e` / `#9e3c0c` | `#f57722` / `#6c2b0b` / `#ff9a5e` |
| lente clara ("en orden") | `#fffdf3` / aro `#7c6f59` | `#fff7e6` / aro `#6a6053` |
| lente apagada | `#c6bbaa` / aro `#8b7f6e` | `#3c382f` / aro `#575044` |

**La pintura de las teclas no cambia entre modos** (`--tecla-alta #c9530f`,
`--tecla-baja #8b3408`, peligro `#b5301f` → `#7c1c12`): una tecla esmaltada
está pintada del mismo color a las 3 de la tarde y a las 3 de la mañana, y con
esos valores el blanco encima pasa 4.5:1 en los dos modos.

**El verde no existe en esta paleta.** "En orden" se dice con lente incolora,
que es lo que hace la señalética real.

Ritmo: `--e1…--e8` = 0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3 / 4.5 rem. Radios 3 /
7 / 12 px. `--relieve: 3px` es cuánto se levanta una placa de la chapa.
Movimiento: `--rapido 130ms`, `--medio 280ms`, `--lento 520ms`, salida
`cubic-bezier(.16,1,.3,1)`.

## Cómo se construyó

- **Dos vistas.** `?view=full` muestra los cinco carriles en grilla; el default
  (`simple`) muestra uno solo, grande, con ← / → arriba. **Los cinco carriles
  están siempre en el DOM** — la vista simple oculta cuatro con `display:none`
  — para que `data-count`, `data-lane` y compañía sigan ahí para los tests y
  el checklist manual.
- **El único momento autoral es el pipeline avanzando**: mientras nadie toca
  las flechas, el visor persigue al motor; cada carril entra deslizándose por
  el lado hacia el que se movió, y las chapitas se atornillan escalonadas. Al
  primer ← / → manda la persona y el visor deja de seguir solo.
- **La mascota es SVG + CSS, no Spline.** La referencia
  (`docs/design/referencias/codigo/21st-spline-scene.tsx`) necesita un
  `.splinecode` alojado en la nube de Spline, que no se genera desde código.
  El patrón de lazy + Suspense no hizo falta: el SVG es inline y sin
  dependencias. "Sigue la luz del cursor" es una lámpara de taller barriendo
  chapa pintada — reflejo especular que se corre, sombra propia al lado
  opuesto, sombra de piso que se alarga, cabeza y pupilas orientadas.

## Pendiente

- **PRODUCT.md no existe.** La verdad de producto vive hoy en el hub de
  Obsidian (`projects/reflex-agent.md`) y en `docs/superpowers/specs/`. Se
  difirió el `init` por el deadline del concurso; conviene correrlo después.
- **FIRST VIEWPORT decía "tres placas" y el brief del humano pidió las cinco
  etapas.** Se construyeron cinco, como una sola placa esmaltada dividida en
  bahías (no cinco tarjetas iguales). Vale confirmarlo.
