import type {
  CharacterState,
  CharacterStateRenderer,
} from "./character-state";

export interface CharacterVisualResource {
  readonly frames: readonly [string, ...string[]];
}

export type CharacterVisualManifest = Readonly<
  Record<CharacterState, CharacterVisualResource | undefined>
>;

export interface CharacterRenderer {
  render: CharacterStateRenderer;
  destroy(): void;
}

interface CharacterRendererOptions {
  root: HTMLElement;
  image: HTMLImageElement;
  visuals: CharacterVisualManifest;
}

export function createCharacterRenderer({
  root,
  image,
  visuals,
}: CharacterRendererOptions): CharacterRenderer {
  let renderRevision = 0;
  let destroyed = false;

  function showFallback(): void {
    root.dataset.characterRenderMode = "fallback";
  }

  function clearImage(): void {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute("src");
  }

  const render: CharacterStateRenderer = (state) => {
    if (destroyed) {
      return;
    }

    const revision = ++renderRevision;
    const source = visuals[state]?.frames[0];

    root.dataset.characterState = state;
    showFallback();
    clearImage();

    if (source === undefined) {
      return;
    }

    image.onload = () => {
      if (!destroyed && revision === renderRevision) {
        root.dataset.characterRenderMode = "sprite";
      }
    };

    image.onerror = () => {
      if (!destroyed && revision === renderRevision) {
        showFallback();
        clearImage();
      }
    };

    image.src = source;

    if (image.complete && image.naturalWidth > 0) {
      root.dataset.characterRenderMode = "sprite";
    }
  };

  function destroy(): void {
    destroyed = true;
    renderRevision += 1;
    clearImage();
    showFallback();
  }

  return {
    render,
    destroy,
  };
}
