import assert from "node:assert/strict";
import test from "node:test";

import {
  CANCEL_VOICE_RECORDING_COMMAND,
  START_VOICE_RECORDING_COMMAND,
  STOP_VOICE_RECORDING_COMMAND,
  VoiceClientError,
  createTauriVoiceClient,
} from "../src/voice/voice-client.ts";
import {
  MAX_VOICE_RECORDING_MS,
  createVoiceUi,
} from "../src/voice/voice-ui.ts";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

class FakeButton {
  constructor(disabled = false) {
    this.attributes = {};
    this.clickCalls = 0;
    this.dataset = {};
    this.disabled = disabled;
    this.focusCalls = 0;
    this.listeners = new Set();
  }

  addEventListener(type, listener) {
    if (type === "click") this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === "click") this.listeners.delete(listener);
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  click() {
    this.clickCalls += 1;
    if (this.disabled) return;

    for (const listener of this.listeners) listener();
  }

  focus() {
    this.focusCalls += 1;
  }
}

function createVoiceUiHarness({
  canStart = () => true,
  busyControlDisabled = false,
  inputDisabled = false,
  submitDisabled = false,
} = {}) {
  const previousWindow = globalThis.window;
  const start = createDeferred();
  const stop = createDeferred();
  const calls = { cancel: 0, start: 0, stop: 0 };
  const button = new FakeButton();
  const busyControl = new FakeButton(busyControlDisabled);
  const input = {
    disabled: inputDisabled,
    focusCalls: 0,
    value: "",
    focus() {
      this.focusCalls += 1;
    },
  };
  const submitButton = new FakeButton(submitDisabled);
  const output = { dataset: {}, textContent: "Respuesta anterior" };
  let timerCallback;
  let timerDelay;
  let clearedTimers = 0;

  globalThis.window = {
    clearTimeout() {
      clearedTimers += 1;
      timerCallback = undefined;
    },
    setTimeout(callback, delay) {
      timerCallback = callback;
      timerDelay = delay;
      return 1;
    },
  };

  const client = {
    async startRecording() {
      calls.start += 1;
      await start.promise;
    },
    async stopRecordingAndTranscribe() {
      calls.stop += 1;
      return stop.promise;
    },
    async cancelRecording() {
      calls.cancel += 1;
    },
  };
  const ui = createVoiceUi({
    button,
    input,
    submitButton,
    busyControls: [busyControl],
    output,
    client,
    canStart,
  });

  return {
    button,
    busyControl,
    calls,
    input,
    output,
    start,
    stop,
    submitButton,
    ui,
    get clearedTimers() {
      return clearedTimers;
    },
    get timerDelay() {
      return timerDelay;
    },
    fireTimer() {
      const callback = timerCallback;
      timerCallback = undefined;
      callback?.();
    },
    cleanup() {
      ui.destroy();
      globalThis.window = previousWindow;
    },
  };
}

async function flushAsyncUi() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("voice UI starts once, stops on the second click and inserts without submitting", async () => {
  const harness = createVoiceUiHarness();
  harness.input.value = "Texto previo  ";

  assert.equal(harness.ui.getState(), "idle");
  assert.equal(harness.ui.isBusy(), false);
  assert.equal(harness.button.attributes["aria-label"], "Hablar con BMO");

  harness.button.click();
  harness.button.click();

  assert.equal(harness.calls.start, 1);
  assert.equal(harness.ui.isBusy(), true);
  assert.equal(harness.input.value, "Texto previo  ");
  assert.equal(harness.input.disabled, true);
  assert.equal(harness.submitButton.disabled, true);
  assert.equal(harness.busyControl.disabled, true);
  assert.equal(harness.output.textContent, "Preparando el micrófono…");

  harness.start.resolve();
  await flushAsyncUi();

  assert.equal(harness.ui.getState(), "recording");
  assert.equal(harness.input.disabled, true);
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.attributes["aria-label"], "Detener grabación");
  assert.equal(harness.button.attributes["aria-pressed"], "true");
  assert.equal(harness.timerDelay, MAX_VOICE_RECORDING_MS);

  harness.button.click();
  harness.button.click();

  assert.equal(harness.calls.stop, 1);
  assert.equal(harness.ui.getState(), "transcribing");
  assert.equal(harness.input.disabled, true);
  assert.equal(harness.button.disabled, true);
  assert.equal(harness.button.attributes["aria-label"], "Transcribiendo");

  harness.stop.resolve("  voz nueva  ");
  await flushAsyncUi();

  assert.equal(harness.input.value, "Texto previo voz nueva");
  assert.equal(harness.ui.getState(), "idle");
  assert.equal(harness.ui.isBusy(), false);
  assert.equal(harness.input.disabled, false);
  assert.equal(harness.submitButton.disabled, false);
  assert.equal(harness.busyControl.disabled, false);
  assert.equal(harness.input.focusCalls, 1);
  assert.equal(harness.submitButton.clickCalls, 0);
  assert.match(harness.output.textContent, /Revísala y pulsa Enviar/);
  harness.cleanup();
});

test("the 30 second timer stops and transcribes exactly once", async () => {
  const harness = createVoiceUiHarness();

  harness.button.click();
  harness.start.resolve();
  await flushAsyncUi();
  harness.fireTimer();
  harness.fireTimer();

  assert.equal(harness.calls.stop, 1);
  assert.equal(harness.ui.getState(), "transcribing");

  harness.stop.resolve("mensaje por temporizador");
  await flushAsyncUi();

  assert.equal(harness.input.value, "mensaje por temporizador");
  assert.equal(harness.ui.getState(), "idle");
  harness.cleanup();
});

test("a transcription error returns to idle and preserves existing text", async () => {
  const harness = createVoiceUiHarness();
  harness.input.value = "No borrar esto";

  harness.button.click();
  harness.start.resolve();
  await flushAsyncUi();
  harness.button.click();
  harness.stop.reject(
    new VoiceClientError(
      "transcription-failed",
      "No pude reconocer voz en esa grabación.",
    ),
  );
  await flushAsyncUi();

  assert.equal(harness.ui.getState(), "idle");
  assert.equal(harness.input.value, "No borrar esto");
  assert.equal(harness.output.dataset.kind, "error");
  assert.equal(
    harness.output.textContent,
    "No pude reconocer voz en esa grabación.",
  );
  assert.equal(harness.calls.cancel, 1);
  assert.equal(harness.input.disabled, false);
  assert.equal(harness.submitButton.disabled, false);
  harness.cleanup();
});

test("destroy restores prior controls, clears the timer and cancels recording", async () => {
  const harness = createVoiceUiHarness({
    busyControlDisabled: true,
    inputDisabled: true,
    submitDisabled: true,
  });

  harness.button.click();
  harness.start.resolve();
  await flushAsyncUi();
  harness.ui.destroy();
  await flushAsyncUi();

  assert.equal(harness.ui.getState(), "idle");
  assert.equal(harness.calls.cancel, 1);
  assert.equal(harness.input.disabled, true);
  assert.equal(harness.submitButton.disabled, true);
  assert.equal(harness.busyControl.disabled, true);
  assert.equal(harness.button.disabled, true);
  assert.equal(harness.button.dataset.voiceState, "idle");
  assert.ok(harness.clearedTimers > 0);

  harness.button.disabled = false;
  harness.button.click();
  assert.equal(harness.calls.start, 1);
  harness.cleanup();
});

test("canStart prevents recording without changing existing input", () => {
  const harness = createVoiceUiHarness({ canStart: () => false });
  harness.input.value = "Borrador";

  harness.button.click();

  assert.equal(harness.calls.start, 0);
  assert.equal(harness.ui.getState(), "idle");
  assert.equal(harness.input.value, "Borrador");
  assert.equal(harness.output.dataset.kind, "error");
  harness.cleanup();
});

test("Tauri voice client invokes fixed commands without arguments", async () => {
  const calls = [];
  const client = createTauriVoiceClient(async function (...args) {
    calls.push(args);
    return args[0] === STOP_VOICE_RECORDING_COMMAND
      ? "  hola BMO  "
      : undefined;
  });

  await client.startRecording();
  assert.equal(await client.stopRecordingAndTranscribe(), "hola BMO");
  await client.cancelRecording();

  assert.deepEqual(calls, [
    [START_VOICE_RECORDING_COMMAND],
    [STOP_VOICE_RECORDING_COMMAND],
    [CANCEL_VOICE_RECORDING_COMMAND],
  ]);
});

test("Tauri voice client controls invalid and unexpected responses", async () => {
  const invalidClient = createTauriVoiceClient(async () => "   ");

  await assert.rejects(
    invalidClient.stopRecordingAndTranscribe(),
    (error) =>
      error instanceof VoiceClientError &&
      error.code === "invalid-transcript" &&
      !/stack|path/i.test(error.message),
  );

  const failedClient = createTauriVoiceClient(async () => {
    throw new Error("/private/internal/audio.wav");
  });

  await assert.rejects(
    failedClient.startRecording(),
    (error) =>
      error instanceof VoiceClientError &&
      error.code === "start-failed" &&
      !error.message.includes("/private/internal"),
  );
});
