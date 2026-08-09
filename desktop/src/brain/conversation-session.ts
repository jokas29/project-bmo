import type { BrainClient, BrainMessage } from "./brain-client";

export const MAX_CONVERSATION_MESSAGES = 16;

export type ConversationSessionErrorCode =
  | "empty-message"
  | "request-in-progress";

export class ConversationSessionError extends Error {
  readonly code: ConversationSessionErrorCode;

  constructor(code: ConversationSessionErrorCode, message: string) {
    super(message);
    this.name = "ConversationSessionError";
    this.code = code;
  }
}

export interface ConversationSession {
  sendMessage(input: string): Promise<string>;
  getMessages(): readonly BrainMessage[];
  isPending(): boolean;
}

interface ConversationSessionOptions {
  brain: BrainClient;
  systemPrompt: string;
  maxConversationMessages?: number;
}

function cloneMessage(message: BrainMessage): BrainMessage {
  return { ...message };
}

export function createConversationSession({
  brain,
  systemPrompt,
  maxConversationMessages = MAX_CONVERSATION_MESSAGES,
}: ConversationSessionOptions): ConversationSession {
  if (
    !Number.isInteger(maxConversationMessages) ||
    maxConversationMessages < 2 ||
    maxConversationMessages % 2 !== 0
  ) {
    throw new Error("maxConversationMessages must be an even integer of 2 or more");
  }

  const systemMessage: BrainMessage = {
    role: "system",
    content: systemPrompt,
  };
  let conversationMessages: BrainMessage[] = [];
  let pending = false;

  async function sendMessage(input: string): Promise<string> {
    if (pending) {
      throw new ConversationSessionError(
        "request-in-progress",
        "BMO ya está pensando. Espera a que termine de responder.",
      );
    }

    const content = input.trim();

    if (content.length === 0) {
      throw new ConversationSessionError(
        "empty-message",
        "Escribe un mensaje antes de enviarlo.",
      );
    }

    const retainedCount = maxConversationMessages - 2;
    const retainedHistory =
      retainedCount === 0
        ? []
        : conversationMessages.slice(-retainedCount);
    const userMessage: BrainMessage = { role: "user", content };
    const requestMessages = [
      cloneMessage(systemMessage),
      ...retainedHistory.map(cloneMessage),
      cloneMessage(userMessage),
    ];

    pending = true;

    try {
      const reply = await brain.generateReply(requestMessages);
      const assistantMessage: BrainMessage = {
        role: "assistant",
        content: reply,
      };

      conversationMessages = [
        ...conversationMessages,
        userMessage,
        assistantMessage,
      ].slice(-maxConversationMessages);

      return reply;
    } finally {
      pending = false;
    }
  }

  function getMessages(): readonly BrainMessage[] {
    return [
      cloneMessage(systemMessage),
      ...conversationMessages.map(cloneMessage),
    ];
  }

  function isPending(): boolean {
    return pending;
  }

  return {
    sendMessage,
    getMessages,
    isPending,
  };
}
