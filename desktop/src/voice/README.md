# Voice input frontend

Este módulo contiene la parte frontend del push-to-talk local de BMO Desktop.
No escucha en segundo plano: la captura solamente comienza después de que el
usuario pulsa explícitamente el botón de micrófono.

## Arquitectura

- `voice-client.ts` define el contrato reemplazable `VoiceClient` y su adaptador
  Tauri para macOS.
- `voice-ui.ts` controla el botón, el límite de 30 segundos y la inserción de la
  transcripción en el input existente.
- Los comandos Tauri son fijos, no reciben rutas ni argumentos del frontend:
  `start_voice_recording`, `stop_voice_recording_and_transcribe` y
  `cancel_voice_recording`.

El adaptador podrá reemplazarse más adelante por uno de Android sin acoplar la
UI al mecanismo de captura de macOS.

## Flujo local de macOS

El servicio Rust usa CPAL y el dispositivo de entrada predeterminado de macOS;
no depende de un índice AVFoundation. Mantiene la captura en memoria durante un
máximo de 30 segundos y suelta el stream automáticamente al alcanzar ese límite.
Al detenerse crea un directorio temporal privado, escribe un WAV con la
frecuencia y canales nativos, y ejecuta ffmpeg con argumentos fijos para obtener
PCM signed 16-bit, mono y 16 kHz. Después ejecuta `whisper-cli` en español con el
hint estático `BMO` y lee únicamente su archivo de texto controlado.

Rust resuelve `ffmpeg` y `whisper-cli` solamente desde las ubicaciones Homebrew
conocidas `/opt/homebrew/bin` y `/usr/local/bin`. El modelo se resuelve desde
`app_data_dir/models/whisper/ggml-base.bin`; ninguna ruta llega desde el
frontend. El directorio temporal elimina juntos el WAV capturado, el convertido
y la salida de Whisper en éxito o error.

## Wiring

```ts
const voiceClient = createTauriVoiceClient();
const voiceUi = createVoiceUi({
  button: voiceButton,
  input: chatInput,
  submitButton: chatSubmit,
  output: chatOutput,
  client: voiceClient,
  canStart: () => !conversation.isPending() && !memoryUi.isOpen(),
});

// Durante cleanup/HMR:
voiceUi.destroy();
```

`VoiceUiController` expone únicamente:

- `getState(): "idle" | "recording" | "transcribing"`
- `isBusy(): boolean`
- `destroy(): void`

El botón recibe `data-voice-state` y los labels accesibles `Hablar con BMO`,
`Detener grabación` y `Transcribiendo` para que el wiring visual permanezca
separado del controlador.

## Comportamiento del texto

La transcripción nunca se envía automáticamente. Si el input está vacío, se
inserta el texto transcrito. Si ya contiene texto, se conserva ese contenido,
se elimina solamente su espacio final y se añade exactamente un espacio antes
de la transcripción. El usuario puede revisarla y pulsar Enviar normalmente.

Mientras la voz está preparando, grabando o transcribiendo, el input, Enviar y
el acceso al diálogo de Memoria quedan bloqueados. El chat mantiene además un
gate lógico para rechazar cualquier submit programático durante ese intervalo.

Un error conserva el input anterior, devuelve el botón a `idle` y muestra un
mensaje controlado. `destroy()` retira el listener, limpia el temporizador y
solicita cancelación al backend cuando existe una operación activa.

Al cerrarse normalmente la aplicación, el evento final de Tauri ejecuta un
shutdown explícito del backend. La captura se detiene y una transcripción activa
recibe una señal de cancelación; el cierre espera hasta cinco segundos para que
el proceso local termine y el directorio temporal sea eliminado.

## Privacidad y dependencias locales

El audio y la transcripción permanecen en el Mac. El backend es responsable de
crear y eliminar sus temporales tanto en éxito como en error; este frontend no
recibe ni construye paths, ejecutables o argumentos.

El prototipo de macOS utiliza `ffmpeg` y `whisper-cli` instalados con Homebrew,
además del modelo externo multilingüe Whisper base (`ggml-base.bin`) ubicado en
el directorio de datos de la aplicación. El modelo no se copia al repositorio,
no se versiona en Git y no se descarga automáticamente.

Esta versión todavía no implementa TTS, wake word ni escucha continua.
