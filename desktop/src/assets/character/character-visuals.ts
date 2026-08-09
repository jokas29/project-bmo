import type { CharacterVisualManifest } from "../../character-renderer";

/**
 * Reemplaza cada `undefined` cuando exista el sprite correspondiente. Los
 * estados todavía no configurados conservan el personaje CSS temporal.
 *
 * Consulta README.md en este mismo directorio para ver el formato y ejemplos.
 */
export const CHARACTER_VISUALS = {
  idle: undefined,
  blink: undefined,
  thinking: undefined,
  talking: undefined,
  happy: undefined,
  sleeping: undefined,
} satisfies CharacterVisualManifest;
