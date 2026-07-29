# Referencias de diseño

Dónde dejar lo que sirve de referencia visual para el dashboard, y cómo pasármelo
de la forma que más rinde.

## Lo más importante

**Puedo ver imágenes.** Si guardás una captura acá, la abro y la miro de verdad —
no leo una descripción, veo el diseño. Es de lejos la forma más útil de pasarme
una referencia.

**Los links de Dribbble y Awwwards casi no sirven.** Son sitios cargados de
JavaScript: si te pido buscar la URL, lo que traigo es el HTML vacío, no el
diseño. **Sacá una captura y guardala.** Para 21st.dev sí sirve el código.

## Dónde va cada cosa

```
docs/design/referencias/
  imagenes/    capturas (.png / .jpg) — Dribbble, Awwwards, cualquier cosa que veas
  codigo/      snippets (.tsx, .css) — 21st.dev, shadcn, lo que tengas
  NOTAS.md     qué te gusta de cada una  ← esto es lo que más cambia el resultado
```

## Cómo nombrar los archivos

Poné en el nombre de dónde salió y qué te llamó la atención:

```
imagenes/awwwards-monitoreo-tipografia.png
imagenes/dribbble-dashboard-oscuro-densidad.png
codigo/21st-spline-hero.tsx
```

No hace falta que sea perfecto — con que yo sepa qué mirar, alcanza.

## Lo que de verdad hace la diferencia

Una referencia sin una nota es ambigua. Si me pasás una captura de un dashboard
oscuro con tipografía grande y mucho aire, no sé si lo que te gustó fue:

- el color
- la tipografía
- la densidad (o la falta de densidad)
- la jerarquía
- el movimiento
- la sensación general

Y son decisiones distintas. **Una línea en `NOTAS.md` por referencia** vale más que
cinco capturas sin contexto:

```markdown
- `awwwards-monitoreo-tipografia.png` — me gusta la tipografía y el contraste
  entre el título enorme y los datos chiquitos. El color no.
```

También sirve el reverso: *"esto NO"*. Saber qué descartar orienta igual de rápido.

## Si preferís no guardar archivos

Pegame la captura directo en el chat, o describime lo que viste. Funciona — la
carpeta existe para que las referencias sobrevivan a la conversación y podamos
volver a ellas, no porque sea obligatorio.
