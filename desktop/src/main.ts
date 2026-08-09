import "./styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { CHARACTER_VISUALS } from "./assets/character/character-visuals";
import { createConversationSession } from "./brain/conversation-session";
import {
  createOllamaClient,
  warmUpOllama,
} from "./brain/ollama-client";
import { BMO_SYSTEM_PROMPT } from "./brain/personality";
import { createCharacterRenderer } from "./character-renderer";
import { createCharacterStateController } from "./character-state";
import { enableDevelopmentStateControls } from "./character-state-keyboard";
import { createChatUi } from "./chat-ui";
import { createMemoryAwareConversation } from "./memory/memory-aware-conversation";
import { buildSystemPromptWithMemories } from "./memory/memory-context";
import { createMemoryService } from "./memory/memory-service";
import { createMemoryUi } from "./memory/memory-ui";
import { createTauriMemoryStore } from "./memory/tauri-memory-store";
import { createTauriVoiceClient } from "./voice/voice-client";
import { createVoiceUi } from "./voice/voice-ui";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="stage">
    <div class="chat-output-shell">
      <section
        class="chat-output"
        id="chat-output"
        aria-live="polite"
        aria-atomic="true"
        role="status"
        tabindex="0"
        data-kind="status"
      >Cargando memoria local…</section>
      <button
        class="memory-open"
        id="memory-open"
        type="button"
        aria-haspopup="dialog"
        aria-controls="memory-dialog"
        aria-expanded="false"
        disabled
      >Memoria</button>
    </div>

    <div class="character-slot">
      <div class="bmo" id="bmo" role="img" aria-label="Personaje BMO">
        <img
          class="character-sprite"
          id="character-sprite"
          alt=""
          aria-hidden="true"
          draggable="false"
        />

        <div class="character-css-fallback">
          <div class="screen">
            <div class="eyes">
              <span class="eye"></span>
              <span class="eye"></span>
            </div>

            <div class="mouth"></div>
          </div>

          <div class="label">BMO</div>
        </div>
      </div>
    </div>

    <form class="chat-composer" id="chat-form" novalidate>
      <label class="sr-only" for="chat-input">Mensaje para BMO</label>
      <input
        class="chat-input"
        id="chat-input"
        type="text"
        maxlength="500"
        autocomplete="off"
        placeholder="Habla con BMO…"
        disabled
      />
      <button
        class="voice-button"
        id="voice-button"
        type="button"
        aria-label="Hablar con BMO"
        aria-pressed="false"
        disabled
      >
        <span aria-hidden="true">🎙</span>
      </button>
      <button class="chat-submit" id="chat-submit" type="submit" disabled>
        Enviar
      </button>
    </form>

    <dialog
      class="memory-dialog"
      id="memory-dialog"
      aria-labelledby="memory-title"
    >
      <header class="memory-header">
        <h2 id="memory-title">Memoria</h2>
        <button
          class="memory-close"
          id="memory-close"
          type="button"
          aria-label="Cerrar memoria"
        >×</button>
      </header>
      <p
        class="memory-feedback"
        id="memory-feedback"
        role="status"
        aria-live="polite"
      ></p>
      <div class="memory-content">
        <ul
          class="memory-list"
          id="memory-list"
          aria-label="Recuerdos guardados"
        ></ul>
        <p class="memory-empty" id="memory-empty">
          Todavía no hay recuerdos guardados.
        </p>
      </div>
      <section
        class="memory-confirm"
        id="memory-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="memory-confirm-title"
        aria-describedby="memory-confirm-text"
        hidden
      >
        <h3 id="memory-confirm-title">Eliminar recuerdo</h3>
        <p id="memory-confirm-text"></p>
        <div class="memory-confirm-actions">
          <button id="memory-confirm-cancel" type="button">Cancelar</button>
          <button
            class="memory-confirm-delete"
            id="memory-confirm-delete"
            type="button"
          >Eliminar</button>
        </div>
      </section>
    </dialog>
  </main>
`;

const bmo = document.querySelector<HTMLElement>("#bmo")!;
const characterSprite =
  document.querySelector<HTMLImageElement>("#character-sprite")!;
const chatForm = document.querySelector<HTMLFormElement>("#chat-form")!;
const chatInput = document.querySelector<HTMLInputElement>("#chat-input")!;
const chatSubmit =
  document.querySelector<HTMLButtonElement>("#chat-submit")!;
const voiceButton =
  document.querySelector<HTMLButtonElement>("#voice-button")!;
const chatOutput = document.querySelector<HTMLElement>("#chat-output")!;
const memoryOpenButton =
  document.querySelector<HTMLButtonElement>("#memory-open")!;
const memoryDialog =
  document.querySelector<HTMLDialogElement>("#memory-dialog")!;
const memoryCloseButton =
  document.querySelector<HTMLButtonElement>("#memory-close")!;
const memoryList = document.querySelector<HTMLElement>("#memory-list")!;
const memoryEmpty = document.querySelector<HTMLElement>("#memory-empty")!;
const memoryFeedback =
  document.querySelector<HTMLElement>("#memory-feedback")!;
const memoryConfirm =
  document.querySelector<HTMLElement>("#memory-confirm")!;
const memoryConfirmText =
  document.querySelector<HTMLElement>("#memory-confirm-text")!;
const memoryConfirmCancel =
  document.querySelector<HTMLButtonElement>("#memory-confirm-cancel")!;
const memoryConfirmDelete =
  document.querySelector<HTMLButtonElement>("#memory-confirm-delete")!;

const characterRenderer = createCharacterRenderer({
  root: bmo,
  image: characterSprite,
  visuals: CHARACTER_VISUALS,
});
const characterState = createCharacterStateController(characterRenderer.render);
let initializationCancelled = false;
let destroyInitializedFeatures = (): void => {};

async function initializeApp(): Promise<void> {
  void warmUpOllama({ transport: tauriFetch }).catch((error: unknown) => {
    console.warn(
      "BMO brain warmup failed; the first reply may be slower.",
      error,
    );
  });

  const memory = createMemoryService({
    store: createTauriMemoryStore(),
  });

  await memory.initialize();

  if (initializationCancelled) {
    return;
  }

  const brain = createOllamaClient({ transport: tauriFetch });
  const conversationSession = createConversationSession({
    brain,
    systemPrompt: () =>
      buildSystemPromptWithMemories(
        BMO_SYSTEM_PROMPT,
        memory.getMemories(),
      ),
  });
  const conversation = createMemoryAwareConversation({
    conversation: conversationSession,
    memory,
  });
  const memoryUi = createMemoryUi({
    service: memory,
    openButton: memoryOpenButton,
    dialog: memoryDialog,
    closeButton: memoryCloseButton,
    list: memoryList,
    empty: memoryEmpty,
    feedback: memoryFeedback,
    confirmation: memoryConfirm,
    confirmationText: memoryConfirmText,
    confirmationCancelButton: memoryConfirmCancel,
    confirmationDeleteButton: memoryConfirmDelete,
  });
  const voiceUi = createVoiceUi({
    button: voiceButton,
    input: chatInput,
    submitButton: chatSubmit,
    busyControls: [memoryOpenButton],
    output: chatOutput,
    client: createTauriVoiceClient(),
    canStart: () => !conversation.isPending() && !memoryUi.isOpen(),
  });
  const chatUi = createChatUi({
    form: chatForm,
    input: chatInput,
    submitButton: chatSubmit,
    busyControls: [voiceButton],
    output: chatOutput,
    conversation,
    characterState,
    canSubmit: () => !voiceUi.isBusy(),
  });
  const disableDevelopmentStateControls = enableDevelopmentStateControls(
    characterState,
    window,
    () =>
      !conversation.isPending() &&
      !memoryUi.isOpen() &&
      !voiceUi.isBusy(),
  );

  chatInput.disabled = false;
  chatSubmit.disabled = false;
  memoryOpenButton.disabled = false;
  chatOutput.dataset.kind = "status";
  chatOutput.textContent = "Escríbeme algo y presiona Enviar.";
  chatInput.focus();

  destroyInitializedFeatures = () => {
    voiceUi.destroy();
    chatUi.destroy();
    disableDevelopmentStateControls();
    memoryUi.destroy();
  };
}

void initializeApp().catch((error: unknown) => {
  console.error("BMO Desktop could not initialize.", error);
  chatOutput.dataset.kind = "error";
  chatOutput.textContent =
    "No pude iniciar BMO. Cierra la ventana e inténtalo de nuevo.";
});

bmo.addEventListener("mousedown", async (event) => {
  if (event.button === 0) {
    const appWindow = getCurrentWindow();
    await appWindow.startDragging();
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    initializationCancelled = true;
    destroyInitializedFeatures();
    characterState.destroy();
    characterRenderer.destroy();
  });
}
