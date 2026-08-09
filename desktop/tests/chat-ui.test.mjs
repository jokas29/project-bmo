import assert from "node:assert/strict";
import test from "node:test";

import { BrainClientError } from "../src/brain/brain-client.ts";
import { createChatUi } from "../src/chat-ui.ts";

function createHarness({ sendMessage, pending = false }) {
  let submitListener;
  let timerCallback;
  const states = ["idle"];
  let stateRevision = 0;
  const form = {
    attributes: {},
    addEventListener(type, listener) {
      if (type === "submit") submitListener = listener;
    },
    removeEventListener() {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const input = {
    disabled: false,
    focusCalls: 0,
    value: "",
    focus() {
      this.focusCalls += 1;
    },
  };
  const submitButton = { disabled: false };
  const output = { dataset: {}, textContent: "" };
  const conversation = {
    isPending() {
      return pending;
    },
    sendMessage,
  };
  const characterState = {
    getCharacterState() {
      return states.at(-1);
    },
    getCharacterStateRevision() {
      return stateRevision;
    },
    setCharacterState(state) {
      states.push(state);
      stateRevision += 1;
    },
  };
  const previousWindow = globalThis.window;

  globalThis.window = {
    clearTimeout() {
      timerCallback = undefined;
    },
    setTimeout(callback) {
      timerCallback = callback;
      return 1;
    },
  };

  const ui = createChatUi({
    form,
    input,
    submitButton,
    output,
    conversation,
    characterState,
  });

  return {
    form,
    input,
    output,
    states,
    submitButton,
    submit() {
      submitListener({ preventDefault() {} });
    },
    finishTalking() {
      timerCallback();
    },
    setManualState(state) {
      characterState.setCharacterState(state);
    },
    cleanup() {
      ui.destroy();
      globalThis.window = previousWindow;
    },
  };
}

test("chat UI moves through thinking, talking and idle on a valid reply", async () => {
  let stateWhileSending;
  let harness;

  harness = createHarness({
    async sendMessage(message) {
      assert.equal(message, "Mi fruta favorita es el mango.");
      stateWhileSending = harness.states.at(-1);
      return "¡Entendido, tu fruta favorita es el mango!";
    },
  });
  harness.input.value = "  Mi fruta favorita es el mango.  ";

  harness.submit();
  assert.equal(harness.form.attributes["aria-busy"], "true");
  assert.equal(harness.input.disabled, true);
  assert.equal(harness.output.textContent, "BMO está pensando…");

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(stateWhileSending, "thinking");
  assert.equal(harness.states.at(-1), "talking");
  assert.equal(
    harness.output.textContent,
    "¡Entendido, tu fruta favorita es el mango!",
  );
  assert.equal(harness.output.dataset.kind, "assistant");
  assert.equal(harness.input.value, "");
  assert.equal(harness.input.disabled, false);
  assert.equal(harness.submitButton.disabled, false);

  harness.finishTalking();
  assert.equal(harness.states.at(-1), "idle");
  harness.cleanup();
});

test("an old talking timer does not override a later manual talking state", async () => {
  const harness = createHarness({
    async sendMessage() {
      return "Respuesta";
    },
  });
  harness.input.value = "Hola";

  harness.submit();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.states.at(-1), "talking");

  harness.setManualState("talking");
  const stateCount = harness.states.length;
  harness.finishTalking();

  assert.equal(harness.states.at(-1), "talking");
  assert.equal(harness.states.length, stateCount);
  harness.cleanup();
});

test("chat UI returns to idle and shows a friendly Ollama error", async () => {
  const harness = createHarness({
    async sendMessage() {
      throw new BrainClientError(
        "unavailable",
        "No pude conectar con Ollama. Comprueba que esté ejecutándose en tu Mac.",
      );
    },
  });
  harness.input.value = "Hola";

  harness.submit();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(harness.states.slice(-2), ["thinking", "idle"]);
  assert.equal(harness.output.dataset.kind, "error");
  assert.match(harness.output.textContent, /No pude conectar con Ollama/);
  assert.doesNotMatch(harness.output.textContent, /stack|BrainClientError/);
  assert.equal(harness.input.disabled, false);
  harness.cleanup();
});

test("chat UI rejects empty and already-pending submissions", async () => {
  let calls = 0;
  const emptyHarness = createHarness({
    async sendMessage() {
      calls += 1;
      return "unused";
    },
  });
  emptyHarness.input.value = "   ";
  emptyHarness.submit();

  assert.equal(calls, 0);
  assert.equal(emptyHarness.states.at(-1), "idle");
  assert.equal(emptyHarness.output.dataset.kind, "error");
  emptyHarness.cleanup();

  const pendingHarness = createHarness({
    pending: true,
    async sendMessage() {
      calls += 1;
      return "unused";
    },
  });
  pendingHarness.input.value = "Segundo mensaje";
  pendingHarness.submit();
  await Promise.resolve();

  assert.equal(calls, 0);
  assert.equal(pendingHarness.states.at(-1), "idle");
  assert.match(pendingHarness.output.textContent, /ya está pensando/);
  pendingHarness.cleanup();
});
