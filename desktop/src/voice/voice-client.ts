import { invoke } from "@tauri-apps/api/core";

export const START_VOICE_RECORDING_COMMAND = "start_voice_recording";
export const STOP_VOICE_RECORDING_COMMAND =
  "stop_voice_recording_and_transcribe";
export const CANCEL_VOICE_RECORDING_COMMAND = "cancel_voice_recording";

export type VoiceClientErrorCode =
  | "start-failed"
  | "transcription-failed"
  | "invalid-transcript"
  | "cancel-failed";

export class VoiceClientError extends Error {
  readonly code: VoiceClientErrorCode;

  constructor(code: VoiceClientErrorCode, message: string) {
    super(message);
    this.name = "VoiceClientError";
    this.code = code;
  }
}

export interface VoiceClient {
  startRecording(): Promise<void>;
  stopRecordingAndTranscribe(): Promise<string>;
  cancelRecording(): Promise<void>;
}

export type VoiceCommandInvoker = <Result>(command: string) => Promise<Result>;

function controlledError(
  error: unknown,
  code: VoiceClientErrorCode,
  fallback: string,
): VoiceClientError {
  if (error instanceof VoiceClientError) {
    return error;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return new VoiceClientError(code, error.trim());
  }

  return new VoiceClientError(code, fallback);
}

export function createTauriVoiceClient(
  invokeCommand: VoiceCommandInvoker = invoke,
): VoiceClient {
  async function startRecording(): Promise<void> {
    try {
      await invokeCommand<void>(START_VOICE_RECORDING_COMMAND);
    } catch (error) {
      throw controlledError(
        error,
        "start-failed",
        "No pude iniciar el micrófono. Comprueba el permiso e inténtalo de nuevo.",
      );
    }
  }

  async function stopRecordingAndTranscribe(): Promise<string> {
    let transcript: unknown;

    try {
      transcript = await invokeCommand<unknown>(STOP_VOICE_RECORDING_COMMAND);
    } catch (error) {
      throw controlledError(
        error,
        "transcription-failed",
        "No pude transcribir el audio. Inténtalo de nuevo.",
      );
    }

    if (typeof transcript !== "string" || transcript.trim().length === 0) {
      throw new VoiceClientError(
        "invalid-transcript",
        "No pude reconocer voz en esa grabación. Inténtalo de nuevo.",
      );
    }

    return transcript.trim();
  }

  async function cancelRecording(): Promise<void> {
    try {
      await invokeCommand<void>(CANCEL_VOICE_RECORDING_COMMAND);
    } catch (error) {
      throw controlledError(
        error,
        "cancel-failed",
        "No pude cancelar la grabación de voz de forma normal.",
      );
    }
  }

  return {
    startRecording,
    stopRecordingAndTranscribe,
    cancelRecording,
  };
}
