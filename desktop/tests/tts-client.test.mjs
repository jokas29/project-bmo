import assert from "node:assert/strict";
import test from "node:test";

import {
  SYNTHESIZE_TTS_COMMAND,
  TtsClientError,
  createTauriTtsClient,
} from "../src/tts/tts-client.ts";

test("Tauri TTS client sends text and style and returns the audio path", async () => {
  const calls = [];

  const client = createTauriTtsClient(async (...args) => {
    calls.push(args);
    return "  /tmp/bmo.wav  ";
  });

  const result = await client.synthesize("  Hola BMO  ", "calm");

  assert.equal(result, "/tmp/bmo.wav");
  assert.deepEqual(calls, [
    [
      SYNTHESIZE_TTS_COMMAND,
      {
        text: "Hola BMO",
        style: "calm",
      },
    ],
  ]);
});

test("TTS client rejects empty text before invoking Tauri", async () => {
  let calls = 0;

  const client = createTauriTtsClient(async () => {
    calls += 1;
    return "/tmp/bmo.wav";
  });

  await assert.rejects(
    client.synthesize("   ", "calm"),
    (error) =>
      error instanceof TtsClientError &&
      error.message === "El texto para TTS está vacío.",
  );

  assert.equal(calls, 0);
});

test("TTS client rejects an invalid audio path response", async () => {
  const client = createTauriTtsClient(async () => "   ");

  await assert.rejects(
    client.synthesize("Hola", "cheerful"),
    (error) =>
      error instanceof TtsClientError &&
      /sin devolver un archivo de audio/i.test(error.message),
  );
});
