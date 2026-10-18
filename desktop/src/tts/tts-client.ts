import { invoke } from "@tauri-apps/api/core";

export const SYNTHESIZE_TTS_COMMAND = "tts_synthesize";

export type TtsStyle = "cheerful" | "calm";

export class TtsClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsClientError";
  }
}

export interface TtsClient {
  synthesize(text: string, style: TtsStyle): Promise<string>;
}

export type TtsCommandInvoker = <Result>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<Result>;

function controlledError(error: unknown): TtsClientError {
  if (error instanceof TtsClientError) {
    return error;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return new TtsClientError(error.trim());
  }

  return new TtsClientError(
    "No pude generar la voz de BMO con el motor local.",
  );
}

export function createTauriTtsClient(
  invokeCommand: TtsCommandInvoker = invoke,
): TtsClient {
  async function synthesize(text: string, style: TtsStyle): Promise<string> {
    const normalizedText = text.trim();

    if (normalizedText.length === 0) {
      throw new TtsClientError("El texto para TTS está vacío.");
    }

    let audioPath: unknown;

    try {
      audioPath = await invokeCommand<unknown>(SYNTHESIZE_TTS_COMMAND, {
        text: normalizedText,
        style,
      });
    } catch (error) {
      throw controlledError(error);
    }

    if (typeof audioPath !== "string" || audioPath.trim().length === 0) {
      throw new TtsClientError(
        "El motor de voz terminó sin devolver un archivo de audio.",
      );
    }

    return audioPath.trim();
  }

  return { synthesize };
}
