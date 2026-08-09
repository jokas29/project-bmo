# Sprites de BMO Desktop

Este directorio contiene los recursos visuales del personaje. El manifest
`character-visuals.ts` asocia esos archivos con los seis `CharacterState`.

Si un estado permanece como `undefined`, o su imagen no puede cargarse, BMO
usa automáticamente el personaje CSS temporal.

## Formato recomendado

- Usa fondo transparente y no incluyas un rectángulo de color como fondo.
- Mantén el mismo canvas y la misma proporción en todos los estados.
- El espacio actual del personaje es de `220 × 280` píxeles CSS, proporción
  `11:14`. Para pantallas Retina se recomienda exportar a `440 × 560` o
  `880 × 1120` píxeles.
- Mantén el cuerpo y sus puntos de apoyo alineados en todos los canvases. Los
  ojos o la boca pueden cambiar, pero BMO no debería saltar de posición ni
  cambiar de tamaño entre estados.
- WebP suele ser la mejor opción de entrega por su menor peso. PNG también es
  válido, especialmente como original sin pérdidas o para arte pixelado.
- Evita mezclar archivos con dimensiones o márgenes visuales incompatibles.

## Nombres sugeridos

Para una imagen estática por estado:

```text
idle.webp
blink.webp
thinking.webp
talking.webp
happy.webp
sleeping.webp
```

Para futuros estados con varios frames, usa nombres ordenables:

```text
talking-01.webp
talking-02.webp
talking-03.webp
```

## Registrar los sprites

Después de copiar los archivos a este directorio, edita
`character-visuals.ts`:

```ts
export const CHARACTER_VISUALS: CharacterVisualManifest = {
  idle: {
    frames: [new URL("./idle.webp", import.meta.url).href],
  },
  blink: {
    frames: [new URL("./blink.webp", import.meta.url).href],
  },
  thinking: {
    frames: [new URL("./thinking.webp", import.meta.url).href],
  },
  talking: {
    frames: [new URL("./talking.webp", import.meta.url).href],
  },
  happy: {
    frames: [new URL("./happy.webp", import.meta.url).href],
  },
  sleeping: {
    frames: [new URL("./sleeping.webp", import.meta.url).href],
  },
};
```

Cada recurso usa una lista `frames`. Una lista con un solo elemento representa
una imagen estática, que es lo que soporta esta versión. El contrato ya permite
añadir varios archivos más adelante, pero el renderer actual muestra únicamente
el primer frame y todavía no implementa temporización de animaciones.
