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

## Validation before the latest fix

- Frontend: `npm test` -> 59 passed, 0 failed.
- TypeScript type-check passed with `tsc --noEmit`.
- Rust reached 24 passed, 0 failed while the temporary environment-isolation diagnostic was present.

The latest stdout/stderr fix removes that temporary environment diagnostic test, so the expected Rust count returns to 23. The latest fix still needs one local compile/test pass.

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

The decisive reproduction used a small parent Python process:

- Launching `tts_pipeline.py` with `stdout=subprocess.PIPE` and `stderr=subprocess.PIPE` produced noise.
- This remained true with both a minimal environment and the full shell environment.
- Launching the same pipeline from the same parent process **without capturing stdout/stderr** produced correct speech.

This isolates subprocess output capture as the trigger on the current macOS/Apple Silicon F5 setup.

## Latest fix in the branch

`desktop/src-tauri/src/tts.rs` no longer uses `Command::output()`, because that captures stdout/stderr.

The pipeline now:

- inherits the normal process environment again;
- runs with the project root as its working directory;
- explicitly inherits stdout and stderr;
- waits with `Command::status()` instead of capturing output;
- reports a generic exit-code error if the pipeline fails.

The temporary 10-second delay and temporary environment allowlist were removed because neither addressed the bug.

## Next local verification

1. Pull `feat/tts-playback-ui`.
2. Run `cargo fmt --check`, `cargo check`, and `cargo test`.
3. Start BMO with `npm run tauri dev`.
4. Trigger exactly one short reply such as `Hola.` and wait for TTS to finish.
5. Listen first to the newest `*-01-f5.wav` under the private debug directory.
6. If F5 is good, listen to the matching `*-03-final.wav`.

If both are good, treat the white-noise bug as resolved and continue with actual audio playback integration. If F5 is still bad, preserve that run and investigate any remaining difference between Rust `Command::status()` and the known-good parent-process no-capture reproduction.

## Privacy notes

Private TTS configuration remains under `.private/` and is gitignored. Voice references, generated WAVs, model checkpoints, and private configuration must not be committed to this public repository.
