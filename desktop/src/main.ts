import "./styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CHARACTER_VISUALS } from "./assets/character/character-visuals";
import { createCharacterRenderer } from "./character-renderer";
import { createCharacterStateController } from "./character-state";
import { enableDevelopmentStateControls } from "./character-state-keyboard";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="stage">
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
  </main>
`;

const bmo = document.querySelector<HTMLElement>("#bmo")!;
const characterSprite =
  document.querySelector<HTMLImageElement>("#character-sprite")!;

const characterRenderer = createCharacterRenderer({
  root: bmo,
  image: characterSprite,
  visuals: CHARACTER_VISUALS,
});
const characterState = createCharacterStateController(characterRenderer.render);

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
    characterRenderer.destroy();
  });
}
