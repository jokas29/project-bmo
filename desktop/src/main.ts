import "./styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { CHARACTER_VISUALS } from "./assets/character/character-visuals";
import { createConversationSession } from "./brain/conversation-session";
import { createOllamaClient } from "./brain/ollama-client";
import { BMO_SYSTEM_PROMPT } from "./brain/personality";
import { createCharacterRenderer } from "./character-renderer";
import { createCharacterStateController } from "./character-state";
import { enableDevelopmentStateControls } from "./character-state-keyboard";
import { createChatUi } from "./chat-ui";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="stage">
    <section
      class="chat-output"
      id="chat-output"
      aria-live="polite"
      aria-atomic="true"
      role="status"
      tabindex="0"
      data-kind="status"
    >Escríbeme algo y presiona Enviar.</section>

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
      />
      <button class="chat-submit" id="chat-submit" type="submit">
        Enviar
      </button>
    </form>
  </main>
`;

const bmo = document.querySelector<HTMLElement>("#bmo")!;
const characterSprite =
  document.querySelector<HTMLImageElement>("#character-sprite")!;
const chatForm = document.querySelector<HTMLFormElement>("#chat-form")!;
const chatInput = document.querySelector<HTMLInputElement>("#chat-input")!;
const chatSubmit =
  document.querySelector<HTMLButtonElement>("#chat-submit")!;
const chatOutput = document.querySelector<HTMLElement>("#chat-output")!;

const characterRenderer = createCharacterRenderer({
  root: bmo,
  image: characterSprite,
  visuals: CHARACTER_VISUALS,
});
const characterState = createCharacterStateController(characterRenderer.render);

const brain = createOllamaClient({ transport: tauriFetch });
const conversation = createConversationSession({
  brain,
  systemPrompt: BMO_SYSTEM_PROMPT,
});
const disableDevelopmentStateControls = enableDevelopmentStateControls(
  characterState,
  window,
  () => !conversation.isPending(),
);
const chatUi = createChatUi({
  form: chatForm,
  input: chatInput,
  submitButton: chatSubmit,
  output: chatOutput,
  conversation,
  characterState,
});

bmo.addEventListener("mousedown", async (event) => {
  if (event.button === 0) {
    const appWindow = getCurrentWindow();
    await appWindow.startDragging();
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    chatUi.destroy();
    disableDevelopmentStateControls();
    characterState.destroy();
    characterRenderer.destroy();
  });
}
