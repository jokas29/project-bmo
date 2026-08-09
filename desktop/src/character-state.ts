export const CHARACTER_STATES = [
  "idle",
  "blink",
  "thinking",
  "talking",
  "happy",
  "sleeping",
] as const;

export type CharacterState = (typeof CHARACTER_STATES)[number];

export type CharacterStateRenderer = (state: CharacterState) => void;

export interface CharacterStateController {
  setCharacterState(state: CharacterState): void;
  getCharacterState(): CharacterState;
  getCharacterStateRevision(): number;
  destroy(): void;
}

const AUTO_BLINK_DELAY_MIN_MS = 3_000;
const AUTO_BLINK_DELAY_MAX_MS = 7_000;
const BLINK_DURATION_MIN_MS = 100;
const BLINK_DURATION_MAX_MS = 200;

function randomMilliseconds(minimum: number, maximum: number): number {
  return Math.round(minimum + Math.random() * (maximum - minimum));
}

export function createCharacterStateController(
  render: CharacterStateRenderer,
  initialState: CharacterState = "idle",
): CharacterStateController {
  let currentState = initialState;
  let automaticBlinkTimer: number | undefined;
  let blinkEndTimer: number | undefined;
  let stateRevision = 0;
  let destroyed = false;

  function clearTimers(): void {
    if (automaticBlinkTimer !== undefined) {
      window.clearTimeout(automaticBlinkTimer);
      automaticBlinkTimer = undefined;
    }

    if (blinkEndTimer !== undefined) {
      window.clearTimeout(blinkEndTimer);
      blinkEndTimer = undefined;
    }
  }

  function scheduleAutomaticBlink(): void {
    if (destroyed || currentState !== "idle") {
      return;
    }

    automaticBlinkTimer = window.setTimeout(() => {
      automaticBlinkTimer = undefined;

      if (!destroyed && currentState === "idle") {
        setCharacterState("blink");
      }
    }, randomMilliseconds(AUTO_BLINK_DELAY_MIN_MS, AUTO_BLINK_DELAY_MAX_MS));
  }

  function scheduleBlinkEnd(): void {
    blinkEndTimer = window.setTimeout(() => {
      blinkEndTimer = undefined;

      if (!destroyed && currentState === "blink") {
        setCharacterState("idle");
      }
    }, randomMilliseconds(BLINK_DURATION_MIN_MS, BLINK_DURATION_MAX_MS));
  }

  function setCharacterState(state: CharacterState): void {
    if (destroyed) {
      return;
    }

    clearTimers();
    currentState = state;
    stateRevision += 1;
    render(currentState);

    if (currentState === "idle") {
      scheduleAutomaticBlink();
    } else if (currentState === "blink") {
      scheduleBlinkEnd();
    }
  }

  function getCharacterState(): CharacterState {
    return currentState;
  }

  function getCharacterStateRevision(): number {
    return stateRevision;
  }

  function destroy(): void {
    destroyed = true;
    clearTimers();
  }

  setCharacterState(initialState);

  return {
    setCharacterState,
    getCharacterState,
    getCharacterStateRevision,
    destroy,
  };
}
