import "./styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="stage">
    <div class="bmo" id="bmo">
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

const appWindow = getCurrentWindow();
const bmo = document.querySelector<HTMLElement>("#bmo");

bmo?.addEventListener("mousedown", async (event) => {
  if (event.button === 0) {
    await appWindow.startDragging();
  }
});
