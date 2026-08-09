import "./styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createCharacterStateController } from "./character-state";
import { enableDevelopmentStateControls } from "./character-state-keyboard";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="stage">
    <div class="bmo" id="bmo" role="img" aria-label="Personaje BMO">
      <div class="screen">
        <div class="eyes">
          <span class="eye"></span>
          <span class="eye"></span>
        </div>

        <div class="mouth"></div>
      </div>

      <div class="label">BMO</div>
    </div>
  </main>
`;

const bmo = document.querySelector<HTMLElement>("#bmo")!;

const characterState = createCharacterStateController((state) => {
  bmo.dataset.characterState = state;
});

const disableDevelopmentStateControls =
  enableDevelopmentStateControls(characterState);

bmo.addEventListener("mousedown", async (event) => {
  if (event.button === 0) {
    const appWindow = getCurrentWindow();
    await appWindow.startDragging();
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disableDevelopmentStateControls();
    characterState.destroy();
  });
}
