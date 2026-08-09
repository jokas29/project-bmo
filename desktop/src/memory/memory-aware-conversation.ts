import {
  ConversationSessionError,
  type ConversationSession,
} from "../brain/conversation-session.ts";
import { parseMemoryCommand } from "./memory-commands.ts";
import type { MemoryService } from "./memory-service";

export interface MemoryAwareConversationOptions {
  conversation: ConversationSession;
  memory: MemoryService;
}

/**
 * Adds deterministic memory commands in front of a normal conversation
 * session. Explicit remember commands never reach the brain and are not added
 * to the ephemeral conversation history.
 */
export function createMemoryAwareConversation({
  conversation,
  memory,
}: MemoryAwareConversationOptions): ConversationSession {
  let memoryPending = false;

  function isPending(): boolean {
    return memoryPending || conversation.isPending();
  }

  async function sendMessage(input: string): Promise<string> {
    if (isPending()) {
      throw new ConversationSessionError(
        "request-in-progress",
        "BMO ya está pensando. Espera a que termine de responder.",
      );
    }

    const command = parseMemoryCommand(input);

    if (command === undefined) {
      return conversation.sendMessage(input);
    }

    memoryPending = true;

    try {
      const result = await memory.remember(command.text);

      return result.kind === "stored" ? "Lo recordaré." : "Ya lo recordaba.";
    } finally {
      memoryPending = false;
    }
  }

  return {
    sendMessage,
    getMessages: () => conversation.getMessages(),
    isPending,
  };
}
