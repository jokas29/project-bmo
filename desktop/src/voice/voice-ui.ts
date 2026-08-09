import { VoiceClientError, type VoiceClient } from "./voice-client.ts";

export const MAX_VOICE_RECORDING_MS = 30_000;

export type VoiceUiState = "idle" | "recording" | "transcribing";

export interface VoiceUiController {
  getState(): VoiceUiState;
  isBusy(): boolean;
  destroy(): void;
}

export interface VoiceUiOptions {
  button: HTMLButtonElement;
  input: HTMLInputElement;
  submitButton: HTMLButtonElement;
  busyControls?: readonly HTMLButtonElement[];
  output: HTMLElement;
  client: VoiceClient;
  canStart?: () => boolean;
}

type OutputKind = "error" | "status";

function mergeTranscript(existingText: string, transcript: string): string {
  const normalizedExistingText = existingText.trimEnd();
  const normalizedTranscript = transcript.trim();

  if (normalizedExistingText.trim().length === 0) {
    return normalizedTranscript;
  }

  return `${normalizedExistingText} ${normalizedTranscript}`;
}

function friendlyVoiceError(error: unknown, fallback: string): string {
  if (error instanceof VoiceClientError) {
    return error.message;
  }

  return fallback;
}

export function createVoiceUi({
  button,
  input,
  submitButton,
  busyControls = [],
  output,
  client,
  canStart = () => true,
}: VoiceUiOptions): VoiceUiController {
  let state: VoiceUiState = "idle";
  let operationPending = false;
  let recordingTimer: number | undefined;
  let operationRevision = 0;
  let inputWasDisabled = false;
  let submitWasDisabled = false;
  let busyControlStates: boolean[] = [];
  let ownsInteractionLock = false;
  let destroyed = false;

  function clearRecordingTimer(): void {
    if (recordingTimer !== undefined) {
      window.clearTimeout(recordingTimer);
      recordingTimer = undefined;
    }
  }

  function setOutput(kind: OutputKind, message: string): void {
    output.dataset.kind = kind;
    output.textContent = message;
  }

  function acquireInteractionLock(): void {
    if (ownsInteractionLock) {
      return;
    }

    inputWasDisabled = input.disabled;
    submitWasDisabled = submitButton.disabled;
    busyControlStates = busyControls.map((control) => control.disabled);
    input.disabled = true;
    submitButton.disabled = true;

    for (const control of busyControls) {
      control.disabled = true;
    }

    ownsInteractionLock = true;
  }

  function releaseInteractionLock(): void {
    if (!ownsInteractionLock) {
      return;
    }

    input.disabled = inputWasDisabled;
    submitButton.disabled = submitWasDisabled;

    busyControls.forEach((control, index) => {
      control.disabled = busyControlStates[index] ?? false;
    });

    busyControlStates = [];
    ownsInteractionLock = false;
  }

  function renderState(): void {
    button.dataset.voiceState = state;
    button.setAttribute("aria-pressed", String(state === "recording"));
    button.setAttribute(
      "aria-busy",
      String(operationPending || state === "transcribing"),
    );

    if (state === "recording") {
      button.disabled = operationPending;
      button.setAttribute("aria-label", "Detener grabación");
      return;
    }

    if (state === "transcribing") {
      button.disabled = true;
      button.setAttribute("aria-label", "Transcribiendo");
      return;
    }

    button.disabled = operationPending;
    button.setAttribute("aria-label", "Hablar con BMO");
  }

  function returnToIdle(focusInput: boolean): void {
    clearRecordingTimer();
    state = "idle";
    operationPending = false;
    releaseInteractionLock();
    renderState();

    if (focusInput) {
      input.focus();
    }
  }

  async function cancelBestEffort(): Promise<void> {
    try {
      await client.cancelRecording();
    } catch {
      // The backend owns temporary-file cleanup. There is no useful UI action
      // after destroy or after a primary voice error.
    }
  }

  async function stopAndTranscribe(): Promise<void> {
    if (
      destroyed ||
      operationPending ||
      state !== "recording"
    ) {
      return;
    }

    clearRecordingTimer();
    const revision = ++operationRevision;
    state = "transcribing";
    operationPending = true;
    renderState();
    setOutput("status", "Transcribiendo…");

    try {
      const transcript = await client.stopRecordingAndTranscribe();

      if (destroyed || revision !== operationRevision) {
        return;
      }

      input.value = mergeTranscript(input.value, transcript);
      setOutput(
        "status",
        "Transcripción lista. Revísala y pulsa Enviar.",
      );
      returnToIdle(true);
    } catch (error) {
      if (destroyed || revision !== operationRevision) {
        return;
      }

      await cancelBestEffort();

      if (destroyed || revision !== operationRevision) {
        return;
      }

      setOutput(
        "error",
        friendlyVoiceError(
          error,
          "No pude transcribir el audio. Inténtalo de nuevo.",
        ),
      );
      returnToIdle(true);
    }
  }

  function scheduleAutomaticStop(): void {
    recordingTimer = window.setTimeout(() => {
      recordingTimer = undefined;
      void stopAndTranscribe();
    }, MAX_VOICE_RECORDING_MS);
  }

  async function startRecording(): Promise<void> {
    if (destroyed || operationPending || state !== "idle") {
      return;
    }

    let allowedToStart = false;

    try {
      allowedToStart = canStart();
    } catch {
      allowedToStart = false;
    }

    if (!allowedToStart) {
      setOutput("error", "BMO está ocupado. Espera antes de grabar.");
      input.focus();
      return;
    }

    const revision = ++operationRevision;
    operationPending = true;
    acquireInteractionLock();
    renderState();
    setOutput("status", "Preparando el micrófono…");

    try {
      await client.startRecording();

      if (destroyed || revision !== operationRevision) {
        await cancelBestEffort();
        return;
      }

      state = "recording";
      operationPending = false;
      renderState();
      setOutput("status", "Escuchando… Pulsa de nuevo para terminar.");
      scheduleAutomaticStop();
      button.focus();
    } catch (error) {
      if (destroyed || revision !== operationRevision) {
        return;
      }

      await cancelBestEffort();

      if (destroyed || revision !== operationRevision) {
        return;
      }

      setOutput(
        "error",
        friendlyVoiceError(
          error,
          "No pude iniciar el micrófono. Comprueba el permiso e inténtalo de nuevo.",
        ),
      );
      returnToIdle(true);
    }
  }

  function handleClick(): void {
    if (state === "recording") {
      void stopAndTranscribe();
      return;
    }

    if (state === "idle") {
      void startRecording();
    }
  }

  button.addEventListener("click", handleClick);
  renderState();

  function getState(): VoiceUiState {
    return state;
  }

  function isBusy(): boolean {
    return operationPending || state !== "idle";
  }

  function destroy(): void {
    if (destroyed) {
      return;
    }

    const shouldCancel = state !== "idle" || operationPending;

    destroyed = true;
    operationRevision += 1;
    clearRecordingTimer();
    button.removeEventListener("click", handleClick);
    releaseInteractionLock();
    state = "idle";
    operationPending = false;
    button.dataset.voiceState = "idle";
    button.disabled = true;
    button.setAttribute("aria-busy", "false");
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", "Hablar con BMO");

    if (shouldCancel) {
      void cancelBestEffort();
    }
  }

  return {
    getState,
    isBusy,
    destroy,
  };
}
