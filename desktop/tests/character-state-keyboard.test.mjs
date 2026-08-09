import assert from "node:assert/strict";
import test from "node:test";

import { enableDevelopmentStateControls } from "../src/character-state-keyboard.ts";

test("development shortcuts work outside controls and ignore editable targets", () => {
  const previousElement = globalThis.Element;
  let keydownListener;
  const states = [];
  let canChangeState = true;

  class FakeElement {
    constructor(editable) {
      this.editable = editable;
    }

    closest() {
      return this.editable ? this : null;
    }
  }

  globalThis.Element = FakeElement;

  const target = {
    addEventListener(type, listener) {
      if (type === "keydown") keydownListener = listener;
    },
    removeEventListener() {},
  };
  const controller = {
    setCharacterState(state) {
      states.push(state);
    },
  };
  const disable = enableDevelopmentStateControls(
    controller,
    target,
    () => canChangeState,
  );
  const event = (key, eventTarget) => ({
    key,
    target: eventTarget,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  });

  keydownListener(event("3", new FakeElement(false)));
  keydownListener(event("4", new FakeElement(true)));
  keydownListener(event("5", {}));
  canChangeState = false;
  keydownListener(event("6", {}));

  assert.deepEqual(states, ["thinking", "happy"]);

  disable();
  globalThis.Element = previousElement;
});
