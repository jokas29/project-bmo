import type {
  CharacterState,
  CharacterStateController,
} from "./character-state";

const DEVELOPMENT_STATE_BY_KEY: Readonly<
  Partial<Record<string, CharacterState>>
> = {
  "1": "idle",
  "2": "blink",
  "3": "thinking",
  "4": "talking",
  "5": "happy",
  "6": "sleeping",
};

export function enableDevelopmentStateControls(
  controller: CharacterStateController,
  target: Window = window,
): () => void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const state = DEVELOPMENT_STATE_BY_KEY[event.key];

    if (state !== undefined) {
      controller.setCharacterState(state);
    }
  };

  target.addEventListener("keydown", handleKeyDown);

  return () => target.removeEventListener("keydown", handleKeyDown);
}
