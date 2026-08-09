import assert from "node:assert/strict";
import test from "node:test";

import { BrainClientError } from "../src/brain/brain-client.ts";
import {
  ConversationSessionError,
  MAX_CONVERSATION_MESSAGES,
  createConversationSession,
} from "../src/brain/conversation-session.ts";
import {
  OLLAMA_CHAT_URL,
  OLLAMA_KEEP_ALIVE,
  OLLAMA_MODEL,
  OLLAMA_NUM_PREDICT,
  createOllamaClient,
} from "../src/brain/ollama-client.ts";
import { BMO_SYSTEM_PROMPT } from "../src/brain/personality.ts";

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test("Ollama request uses the local model, non-streaming mode and system prompt", async () => {
  let capturedUrl;
  let capturedOptions;
  const client = createOllamaClient({
    async transport(url, options) {
      capturedUrl = url;
      capturedOptions = options;
      return jsonResponse({ message: { content: "¡Hola!" } });
    },
  });
  const messages = [
    { role: "system", content: BMO_SYSTEM_PROMPT },
    { role: "user", content: "Hola" },
  ];

  const reply = await client.generateReply(messages);
  const body = JSON.parse(capturedOptions.body);

  assert.equal(reply, "¡Hola!");
  assert.equal(capturedUrl, OLLAMA_CHAT_URL);
  assert.equal(capturedOptions.method, "POST");
  assert.equal(capturedOptions.connectTimeout, 5_000);
  assert.equal(capturedOptions.maxRedirections, 0);
  assert.equal(body.model, OLLAMA_MODEL);
  assert.equal(body.model, "qwen3.5:4b");
  assert.equal(body.think, false);
  assert.equal(body.stream, false);
  assert.equal(body.keep_alive, OLLAMA_KEEP_ALIVE);
  assert.equal(body.keep_alive, "10m");
  assert.equal(body.options.num_predict, OLLAMA_NUM_PREDICT);
  assert.equal(body.options.num_predict, 256);
  assert.deepEqual(body.messages, messages);
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[0].content, BMO_SYSTEM_PROMPT);
});

test("Ollama transport and HTTP failures become controlled errors", async (t) => {
  await t.test("unavailable service", async () => {
    const client = createOllamaClient({
      async transport() {
        throw new TypeError("connection refused");
      },
    });

    await assert.rejects(
      client.generateReply([]),
      (error) =>
        error instanceof BrainClientError && error.code === "unavailable",
    );
  });

  await t.test("HTTP status", async () => {
    const client = createOllamaClient({
      async transport() {
        return jsonResponse({}, { ok: false, status: 503 });
      },
    });

    await assert.rejects(
      client.generateReply([]),
      (error) =>
        error instanceof BrainClientError &&
        error.code === "http-error" &&
        error.status === 503,
    );
  });
});

test("invalid Ollama responses become controlled errors", async (t) => {
  const invalidCases = [
    ["invalid JSON", async () => {
      throw new SyntaxError("bad JSON");
    }],
    ["missing message", async () => ({ done: true })],
    ["missing content", async () => ({ message: {} })],
    ["blank content", async () => ({ message: { content: "   " } })],
  ];

  for (const [name, readJson] of invalidCases) {
    await t.test(name, async () => {
      const client = createOllamaClient({
        async transport() {
          return { ok: true, status: 200, json: readJson };
        },
      });

      await assert.rejects(
        client.generateReply([]),
        (error) =>
          error instanceof BrainClientError &&
          error.code === "invalid-response",
      );
    });
  }
});

test("a multi-turn session preserves system, user and assistant context", async () => {
  const payloads = [];
  const replies = ["¡Hola!", "Sí, acabas de saludarme."];
  const brain = {
    async generateReply(messages) {
      payloads.push(messages.map((message) => ({ ...message })));
      return replies[payloads.length - 1];
    },
  };
  const session = createConversationSession({
    brain,
    systemPrompt: BMO_SYSTEM_PROMPT,
  });

  await session.sendMessage("Hola");
  await session.sendMessage("¿Qué te dije?");

  assert.deepEqual(payloads[1], [
    { role: "system", content: BMO_SYSTEM_PROMPT },
    { role: "user", content: "Hola" },
    { role: "assistant", content: "¡Hola!" },
    { role: "user", content: "¿Qué te dije?" },
  ]);
});

test("session history keeps the system prompt and the latest 16 conversation messages", async () => {
  const payloads = [];
  let round = 0;
  const brain = {
    async generateReply(messages) {
      payloads.push(messages.map((message) => ({ ...message })));
      round += 1;
      return `respuesta ${round}`;
    },
  };
  const session = createConversationSession({
    brain,
    systemPrompt: BMO_SYSTEM_PROMPT,
  });

  for (let index = 1; index <= 9; index += 1) {
    await session.sendMessage(`mensaje ${index}`);
  }

  const storedMessages = session.getMessages();
  const ninthPayload = payloads[8];

  assert.equal(MAX_CONVERSATION_MESSAGES, 16);
  assert.equal(storedMessages.length, 17);
  assert.deepEqual(storedMessages[0], {
    role: "system",
    content: BMO_SYSTEM_PROMPT,
  });
  assert.equal(storedMessages[1].content, "mensaje 2");
  assert.equal(storedMessages.at(-1).content, "respuesta 9");
  assert.equal(ninthPayload.length, 16);
  assert.equal(ninthPayload[0].role, "system");
  assert.equal(ninthPayload[1].content, "mensaje 2");
  assert.equal(ninthPayload.at(-1).content, "mensaje 9");
});

test("a two-message cap does not retain the previous pair in the next payload", async () => {
  const payloads = [];
  const brain = {
    async generateReply(messages) {
      payloads.push(messages.map((message) => ({ ...message })));
      return `respuesta ${payloads.length}`;
    },
  };
  const session = createConversationSession({
    brain,
    systemPrompt: BMO_SYSTEM_PROMPT,
    maxConversationMessages: 2,
  });

  await session.sendMessage("primero");
  await session.sendMessage("segundo");

  assert.deepEqual(payloads[1], [
    { role: "system", content: BMO_SYSTEM_PROMPT },
    { role: "user", content: "segundo" },
  ]);
  assert.equal(session.getMessages().length, 3);
});

test("a failed turn does not contaminate conversation history", async () => {
  const brain = {
    async generateReply() {
      throw new BrainClientError("unavailable", "Ollama no está disponible.");
    },
  };
  const session = createConversationSession({
    brain,
    systemPrompt: BMO_SYSTEM_PROMPT,
  });

  await assert.rejects(session.sendMessage("Hola"), BrainClientError);

  assert.deepEqual(session.getMessages(), [
    { role: "system", content: BMO_SYSTEM_PROMPT },
  ]);
  assert.equal(session.isPending(), false);
});

test("empty and concurrent messages are rejected before a second request", async () => {
  let transportCalls = 0;
  let resolveReply;
  const deferredReply = new Promise((resolve) => {
    resolveReply = resolve;
  });
  const brain = {
    async generateReply() {
      transportCalls += 1;
      return deferredReply;
    },
  };
  const session = createConversationSession({
    brain,
    systemPrompt: BMO_SYSTEM_PROMPT,
  });

  await assert.rejects(
    session.sendMessage("   "),
    (error) =>
      error instanceof ConversationSessionError &&
      error.code === "empty-message",
  );

  const firstRequest = session.sendMessage("Primero");

  await assert.rejects(
    session.sendMessage("Segundo"),
    (error) =>
      error instanceof ConversationSessionError &&
      error.code === "request-in-progress",
  );
  assert.equal(transportCalls, 1);
  assert.equal(session.isPending(), true);

  resolveReply("Listo");
  assert.equal(await firstRequest, "Listo");
  assert.equal(session.isPending(), false);
});
