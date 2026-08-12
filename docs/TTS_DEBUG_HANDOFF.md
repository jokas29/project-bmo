# TTS debugging handoff

This file records the current public debugging state for the local TTS integration. It intentionally contains no private voice assets, transcripts, model files, local usernames, or secret paths.

## Branch

`feat/tts-playback-ui`

## Current implementation

- `desktop/src/tts/tts-client.ts` calls the Tauri `tts_synthesize` command.
- `desktop/src/chat-ui.ts` exposes an `onAssistantReply` callback.
- `desktop/src/main.ts` invokes local TTS for assistant replies using the `calm` style.
- `desktop/src-tauri/src/tts.rs` serializes TTS synthesis with a mutex so two local pipelines do not run simultaneously.
- `scripts/tts_pipeline.py` can preserve F5, OpenVoice, and final diagnostic WAVs with `--debug-dir`.
- Debug builds (`tauri dev`) preserve those files below the private TTS runtime directory.
- Playback is **not** wired into the UI yet. The current callback only generates a WAV and logs its path.

## Validation before the PTY fix

- Frontend: `npm test` -> 59 passed, 0 failed.
- TypeScript type-check passed with `tsc --noEmit`.
- Rust: 23 passed, 0 failed after removing temporary diagnostics that were proven unrelated.

The PTY fix adds one macOS-specific Rust unit test, so the expected local Rust count is now 24. It still needs a local compile/test pass.

## Confirmed pipeline behavior

The local F5 -> OpenVoice -> ffmpeg pipeline can produce correct speech when launched manually. F5 alone, OpenVoice conversion, final ffmpeg processing, and the complete manual pipeline have all produced correct audio.

A UI-triggered run preserved all three intermediate WAVs. `01-f5`, `02-openvoice`, and `03-final` all contained noise, proving the corruption begins in F5 rather than OpenVoice or ffmpeg.

## Diagnostics completed

The following hypotheses were tested and rejected:

- **Concurrent TTS requests:** a Rust mutex serialized requests, but app-triggered output still contained noise.
- **BMO/Ollama merely being open:** a manual pipeline run while BMO/Ollama remained open produced correct speech.
- **Immediate Ollama -> F5 transition:** adding a temporary 10-second delay before TTS did not fix the F5 output.
- **MPS/GPU specifically:** forcing F5 to CPU still produced noise when launched through BMO.
- **Inherited Tauri/npm environment:** launching with a reduced environment still produced noise.

Further process-launch tests narrowed the trigger:

- Parent-process capture of stdout/stderr produced noise.
- Full shell environment plus captured stdout/stderr still produced noise.
- A parent process without capture produced correct speech when run from a real terminal.
- Direct shell redirection of stdout/stderr to a file also produced noise.
- Launching the same pipeline through macOS `script -q /dev/null ...` produced correct speech.

This shows the decisive requirement on the current macOS/Apple Silicon F5 setup is not merely "do not capture output". The F5 process must see a real TTY or pseudo-terminal.

## PTY fix now in the branch

On macOS, `desktop/src-tauri/src/tts.rs` now launches the Python pipeline through the system PTY wrapper:

`/usr/bin/script -q /dev/null <python> <pipeline> ...`

Important properties:

- `/usr/bin/script` creates a pseudo-terminal for the Python/F5 process.
- Rust passes every argument directly through `Command`; no shell is invoked and assistant/user text is not interpolated into a shell command.
- The normal process environment and project working directory are preserved.
- Non-macOS targets keep the direct Python launch path.
- A macOS-specific unit test checks that the PTY wrapper and argument prefix are selected.

## Next local verification

1. Pull `feat/tts-playback-ui`.
2. Run `cargo fmt --check`, `cargo check`, and `cargo test`. Expected Rust count on macOS: 24 passed.
3. Start BMO with `npm run tauri dev`.
4. Trigger exactly one short reply such as `Hola.` and wait for TTS to finish.
5. Listen first to the newest `*-01-f5.wav` under the private debug directory.
6. If F5 is good, listen to the matching `*-03-final.wav`.

If both are good, treat the white-noise bug as resolved and continue with actual audio playback integration. If F5 is still bad, the next diagnostic must verify whether `/usr/bin/script` still provides a PTY when its own parent is the Tauri process.

## Privacy notes

Private TTS configuration remains under `.private/` and is gitignored. Voice references, generated WAVs, model checkpoints, and private configuration must not be committed to this public repository.
