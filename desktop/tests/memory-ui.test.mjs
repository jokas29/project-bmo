import assert from "node:assert/strict";
import test from "node:test";

import { MemoryServiceError } from "../src/memory/memory-service.ts";
import { createMemoryUi } from "../src/memory/memory-ui.ts";

class FakeElement {
  constructor(ownerDocument, tagName = "div") {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
    this.attributes = {};
    this.children = [];
    this.dataset = {};
    this.disabled = false;
    this.focusCalls = 0;
    this.hidden = false;
    this.listeners = new Map();
    this.textContent = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter(
        (candidate) => candidate !== listener,
      ),
    );
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target: this, preventDefault() {}, ...event });
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children.flatMap((child) =>
      child instanceof FakeFragment ? child.children : [child],
    );
  }

  querySelectorAll(selector) {
    if (selector !== "button[data-memory-id]") return [];

    const matches = [];
    const visit = (element) => {
      if (element.tagName === "button" && element.dataset.memoryId !== undefined) {
        matches.push(element);
      }
      element.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }

  contains(candidate) {
    if (this === candidate) return true;
    return this.children.some((child) => child.contains(candidate));
  }

  closest(selector) {
    return selector === "button[data-memory-id]" &&
      this.tagName === "button" &&
      this.dataset.memoryId !== undefined
      ? this
      : null;
  }

  focus() {
    this.focusCalls += 1;
  }
}

class FakeFragment extends FakeElement {}

class FakeDialog extends FakeElement {
  open = false;

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
    this.dispatch("close");
  }
}

class FakeDocument {
  createDocumentFragment() {
    return new FakeFragment(this, "fragment");
  }

  createElement(tagName) {
    return new FakeElement(this, tagName);
  }
}

function createMemoryUiHarness({ confirmDelete } = {}) {
  const document = new FakeDocument();
  const openButton = new FakeElement(document, "button");
  const dialog = new FakeDialog(document, "dialog");
  const closeButton = new FakeElement(document, "button");
  const list = new FakeElement(document, "ul");
  const empty = new FakeElement(document, "p");
  const feedback = new FakeElement(document, "p");
  const confirmation = new FakeElement(document, "section");
  const confirmationText = new FakeElement(document, "p");
  const confirmationCancelButton = new FakeElement(document, "button");
  const confirmationDeleteButton = new FakeElement(document, "button");
  confirmation.hidden = true;
  let memories = [
    {
      id: "memory-1",
      text: "mi animal favorito es el pingüino",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  let removeError;
  const removeCalls = [];
  const listeners = new Set();
  const service = {
    getMemories() {
      return memories.map((memory) => ({ ...memory }));
    },
    async removeMemory(id) {
      removeCalls.push(id);
      if (removeError !== undefined) throw removeError;
      const previousLength = memories.length;
      memories = memories.filter((memory) => memory.id !== id);
      for (const listener of listeners) listener(this.getMemories());
      return memories.length !== previousLength;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const ui = createMemoryUi({
    service,
    openButton,
    dialog,
    closeButton,
    list,
    empty,
    feedback,
    confirmation,
    confirmationText,
    confirmationCancelButton,
    confirmationDeleteButton,
    confirmDelete,
  });

  return {
    closeButton,
    confirmation,
    confirmationCancelButton,
    confirmationDeleteButton,
    confirmationText,
    dialog,
    empty,
    feedback,
    list,
    openButton,
    removeCalls,
    setRemoveError(error) {
      removeError = error;
    },
    ui,
  };
}

async function flushAsyncUi() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("memory UI opens, renders safely and cancels deletion without mutation", async () => {
  const harness = createMemoryUiHarness();

  assert.equal(harness.list.children.length, 1);
  assert.equal(
    harness.list.children[0].children[0].textContent,
    "mi animal favorito es el pingüino",
  );
  assert.equal(harness.empty.hidden, true);

  harness.openButton.dispatch("click");
  assert.equal(harness.dialog.open, true);
  assert.equal(harness.openButton.attributes["aria-expanded"], "true");

  const deleteButton = harness.list.children[0].children[1];
  harness.list.dispatch("click", { target: deleteButton });
  assert.equal(harness.confirmation.hidden, false);
  assert.match(harness.confirmationText.textContent, /pingüino/);
  assert.deepEqual(harness.removeCalls, []);

  harness.confirmationCancelButton.dispatch("click");
  await flushAsyncUi();

  assert.deepEqual(harness.removeCalls, []);
  assert.equal(harness.confirmation.hidden, true);
  assert.equal(deleteButton.disabled, false);
  harness.ui.destroy();
});

test("confirmed deletion updates the list and leaves useful focus", async () => {
  const harness = createMemoryUiHarness();
  harness.openButton.dispatch("click");
  const deleteButton = harness.list.children[0].children[1];

  harness.list.dispatch("click", { target: deleteButton });
  assert.deepEqual(harness.removeCalls, []);
  harness.confirmationDeleteButton.dispatch("click");
  await flushAsyncUi();

  assert.deepEqual(harness.removeCalls, ["memory-1"]);
  assert.equal(harness.list.children.length, 0);
  assert.equal(harness.empty.hidden, false);
  assert.equal(harness.feedback.textContent, "Recuerdo eliminado.");
  assert.equal(harness.closeButton.focusCalls, 2);
  harness.ui.destroy();
});

test("a deletion error keeps the memory and never exposes a stack", async () => {
  const harness = createMemoryUiHarness();
  harness.setRemoveError(
    new MemoryServiceError(
      "storage-error",
      "No pude guardar la memoria en este momento.",
    ),
  );
  const deleteButton = harness.list.children[0].children[1];

  harness.list.dispatch("click", { target: deleteButton });
  harness.confirmationDeleteButton.dispatch("click");
  await flushAsyncUi();

  assert.equal(harness.list.children.length, 1);
  assert.equal(harness.feedback.attributes.role, "alert");
  assert.match(harness.feedback.textContent, /No pude guardar/);
  assert.doesNotMatch(harness.feedback.textContent, /MemoryServiceError|stack/);
  assert.equal(deleteButton.disabled, false);
  harness.ui.destroy();
});
