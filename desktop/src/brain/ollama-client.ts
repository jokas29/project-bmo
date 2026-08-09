import {
  BrainClientError,
  type BrainClient,
  type BrainMessage,
} from "./brain-client.ts";

export const OLLAMA_CHAT_URL = "http://localhost:11434/api/chat";
export const OLLAMA_MODEL = "qwen3.5:4b";
export const OLLAMA_KEEP_ALIVE = "10m";
export const OLLAMA_NUM_PREDICT = 256;

export interface HttpRequestOptions extends RequestInit {
  readonly connectTimeout?: number;
  readonly maxRedirections?: number;
}

export type HttpTransport = (
  url: string,
  options: HttpRequestOptions,
) => Promise<Response>;

interface OllamaClientOptions {
  transport: HttpTransport;
}

interface OllamaChatRequest {
  readonly model: string;
  readonly think: false;
  readonly stream: false;
  readonly keep_alive: string;
  readonly options: {
    readonly num_predict: number;
  };
  readonly messages: readonly BrainMessage[];
}

interface OllamaWarmupRequest {
  readonly model: string;
  readonly think: false;
  readonly stream: false;
  readonly keep_alive: string;
  readonly messages: readonly [];
}

function readAssistantContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new BrainClientError(
      "invalid-response",
      "Ollama devolvió una respuesta que no pude entender.",
    );
  }

  const message = Reflect.get(payload, "message");

  if (typeof message !== "object" || message === null) {
    throw new BrainClientError(
      "invalid-response",
      "Ollama devolvió una respuesta que no pude entender.",
    );
  }

  const content = Reflect.get(message, "content");

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new BrainClientError(
      "invalid-response",
      "Ollama devolvió una respuesta vacía o inválida.",
    );
  }

  return content.trim();
}

export async function warmUpOllama({
  transport,
}: OllamaClientOptions): Promise<void> {
  const request: OllamaWarmupRequest = {
    model: OLLAMA_MODEL,
    think: false,
    stream: false,
    keep_alive: OLLAMA_KEEP_ALIVE,
    messages: [],
  };

  let response: Response;

  try {
    response = await transport(OLLAMA_CHAT_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      connectTimeout: 5_000,
      maxRedirections: 0,
    });
  } catch {
    throw new BrainClientError(
      "unavailable",
      "No pude precargar el cerebro local.",
    );
  }

  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      // El estado HTTP sigue siendo el error útil.
    }

    throw new BrainClientError(
      "http-error",
      `Ollama respondió con un error durante la precarga (HTTP ${response.status}).`,
      response.status,
    );
  }

  try {
    await response.json();
  } catch {
    throw new BrainClientError(
      "invalid-response",
      "Ollama devolvió una respuesta inválida durante la precarga.",
    );
  }
}

export function createOllamaClient({
  transport,
}: OllamaClientOptions): BrainClient {
  return {
    async generateReply(messages: readonly BrainMessage[]): Promise<string> {
      const request: OllamaChatRequest = {
        model: OLLAMA_MODEL,
        think: false,
        stream: false,
        keep_alive: OLLAMA_KEEP_ALIVE,
        options: {
          num_predict: OLLAMA_NUM_PREDICT,
        },
        messages: messages.map((message) => ({ ...message })),
      };

      let response: Response;

      try {
        response = await transport(OLLAMA_CHAT_URL, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
          connectTimeout: 5_000,
          maxRedirections: 0,
        });
      } catch {
        throw new BrainClientError(
          "unavailable",
          "No pude conectar con Ollama. Comprueba que esté ejecutándose en tu Mac.",
        );
      }

      if (!response.ok) {
        try {
          await response.body?.cancel();
        } catch {
          // The HTTP status remains the useful error if cleanup also fails.
        }

        throw new BrainClientError(
          "http-error",
          `Ollama respondió con un error (HTTP ${response.status}).`,
          response.status,
        );
      }

      let payload: unknown;

      try {
        payload = await response.json();
      } catch {
        throw new BrainClientError(
          "invalid-response",
          "Ollama devolvió una respuesta JSON inválida.",
        );
      }

      return readAssistantContent(payload);
    },
  };
}
