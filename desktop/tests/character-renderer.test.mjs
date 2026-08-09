import assert from "node:assert/strict";
import test from "node:test";

import { createCharacterRenderer } from "../src/character-renderer.ts";

const CHARACTER_STATES = [
  "idle",
  "blink",
  "thinking",
  "talking",
  "happy",
  "sleeping",
];

const emptyManifest = () =>
  Object.fromEntries(CHARACTER_STATES.map((state) => [state, undefined]));

class FakeImage {
  complete = false;
  naturalWidth = 0;
  onerror = null;
  onload = null;
  source = "";

  get src() {
    return this.source;
  }

  set src(source) {
    this.source = source;
  }

  removeAttribute(attribute) {
    if (attribute === "src") {
      this.source = "";
    }
  }
}

function createTestRenderer(visuals) {
  const root = { dataset: {} };
  const image = new FakeImage();
  const renderer = createCharacterRenderer({ root, image, visuals });

  return { image, renderer, root };
}

test("uses the CSS fallback for every unconfigured state", () => {
  const { image, renderer, root } = createTestRenderer(emptyManifest());

  for (const state of CHARACTER_STATES) {
    renderer.render(state);

    assert.equal(root.dataset.characterState, state);
    assert.equal(root.dataset.characterRenderMode, "fallback");
    assert.equal(image.src, "");
  }
});

test("shows the first frame after a static visual loads", () => {
  const visuals = emptyManifest();
  visuals.talking = {
    frames: ["talking-01.webp", "talking-02.webp"],
  };
  const { image, renderer, root } = createTestRenderer(visuals);

  renderer.render("talking");

  assert.equal(image.src, "talking-01.webp");
  assert.equal(root.dataset.characterRenderMode, "fallback");

  image.onload();

  assert.equal(root.dataset.characterRenderMode, "sprite");
});

test("keeps the fallback when a visual fails to load", () => {
  const visuals = emptyManifest();
  visuals.happy = { frames: ["missing.webp"] };
  const { image, renderer, root } = createTestRenderer(visuals);

  renderer.render("happy");
  image.onerror();

  assert.equal(root.dataset.characterState, "happy");
  assert.equal(root.dataset.characterRenderMode, "fallback");
  assert.equal(image.src, "");
});

test("ignores a completed load from an obsolete state", () => {
  const visuals = emptyManifest();
  visuals.idle = { frames: ["idle.webp"] };
  visuals.sleeping = { frames: ["sleeping.webp"] };
  const { image, renderer, root } = createTestRenderer(visuals);

  renderer.render("idle");
  const finishIdleLoad = image.onload;

  renderer.render("sleeping");
  const finishSleepingLoad = image.onload;
  finishIdleLoad();

  assert.equal(root.dataset.characterState, "sleeping");
  assert.equal(root.dataset.characterRenderMode, "fallback");

  finishSleepingLoad();

  assert.equal(root.dataset.characterRenderMode, "sprite");
});

test("destroy prevents a pending load from enabling its sprite", () => {
  const visuals = emptyManifest();
  visuals.idle = { frames: ["idle.webp"] };
  const { image, renderer, root } = createTestRenderer(visuals);

  renderer.render("idle");
  const finishLoad = image.onload;
  renderer.destroy();
  finishLoad();

  assert.equal(root.dataset.characterRenderMode, "fallback");
  assert.equal(image.src, "");
});
