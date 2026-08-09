import { BrainClientError } from "./brain/brain-client.ts";
import {
  ConversationSessionError,
  type ConversationSession,
} from "./brain/conversation-session.ts";
import type { CharacterStateController } from "./character-state";
import { MemoryServiceError } from "./memory/memory-service.ts";

const TALKING_STATE_DURATION_MS = 1_800;

export interface ChatUiController {
  destroy(): void;
}

interface ChatUiOptions {
  form: HTMLFormElement;
  input: HTMLInputElement;
  submitButton: HTMLButtonElement;
  busyControls?: readonly HTMLButtonElement[];
  output: HTMLElement;
  conversation: ConversationSession;
  characterState: CharacterStateController;
  canSubmit?: () => boolean;
}

function userFacingError(error: unknown): string {
  if (
    error instanceof BrainClientError ||
    error instanceof ConversationSessionError ||
    error instanceof MemoryServiceError
  ) {
    return error.message;
  }

  return "Ocurrió un error inesperado al hablar con Ollama.";
}

export function createChatUi({
  form,
  input,
  submitButton,
  busyControls = [],
  output,
  conversation,
  characterState,
  canSubmit = () => true,
}: ChatUiOptions): ChatUiController {
  let talkingTimer: number | undefined;
  let destroyed = false;

  function clearTalkingTimer(): void {
    if (talkingTimer !== undefined) {
      window.clearTimeout(talkingTimer);
      talkingTimer = undefined;
    }
  }

  function setOutput(kind: "assistant" | "error" | "status", text: string): void {
    output.dataset.kind = kind;
    output.textContent = text;
  }

  function setBusy(busy: boolean): void {
    form.setAttribute("aria-busy", String(busy));
    input.disabled = busy;
    submitButton.disabled = busy;

    for (const control of busyControls) {
      control.disabled = busy;
    }
  }

  async function submitMessage(): Promise<void> {
    let submissionAllowed = false;

    try {
      submissionAllowed = canSubmit();
    } catch {
      submissionAllowed = false;
    }

    if (!submissionAllowed) {
      setOutput(
        "error",
        "Termina la grabación o transcripción antes de enviar.",
      );
      return;
    }

    const message = input.value;

    if (message.trim().length === 0) {
      setOutput("error", "Escribe un mensaje antes de enviarlo.");
      input.focus();
      return;
    }

    if (conversation.isPending()) {
      setOutput("error", "BMO ya está pensando. Espera a que termine de responder.");
      return;
    }

    clearTalkingTimer();
    setBusy(true);
    setOutput("status", "BMO está pensando…");
    characterState.setCharacterState("thinking");

    try {
      const reply = await conversation.sendMessage(message);

      if (destroyed) {
        return;
      }

      input.value = "";
      setOutput("assistant", reply);
      characterState.setCharacterState("talking");
      const talkingStateRevision =
        characterState.getCharacterStateRevision();

      talkingTimer = window.setTimeout(() => {
        talkingTimer = undefined;

        if (
          characterState.getCharacterState() === "talking" &&
          characterState.getCharacterStateRevision() === talkingStateRevision
        ) {
          characterState.setCharacterState("idle");
        }
      }, TALKING_STATE_DURATION_MS);
    } catch (error) {
      if (destroyed) {
        return;
      }

      setOutput("error", userFacingError(error));
      characterState.setCharacterState("idle");
    } finally {
      if (!destroyed) {
        setBusy(false);
        input.focus();
      }
    }
  }

  const handleSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void submitMessage();
  };

  form.addEventListener("submit", handleSubmit);

  function destroy(): void {
    destroyed = true;
    clearTalkingTimer();
    form.removeEventListener("submit", handleSubmit);
  }

  return { destroy };
}
