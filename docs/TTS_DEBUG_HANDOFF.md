# TTS debugging handoff

This file records the current public debugging state for the local TTS integration. It intentionally contains no private voice assets, transcripts, model files, local usernames, or secret paths.

## Branch

`feat/tts-playback-ui`

## Current implementation

- `desktop/src/tts/tts-client.ts` calls the Tauri `tts_synthesize` command.
- `desktop/src/chat-ui.ts` exposes an `onAssistantReply` callback.
- `desktop/src/main.ts` invokes local TTS for assistant replies using the `calm` style.
- `desktop/src-tauri/src/tts.rs` serializes TTS synthesis with a mutex so two local pipelines do not run simultaneously.
- Playback is **not** wired into the UI yet. The current callback only generates a WAV and logs its path.

## Tests at handoff

Before the latest diagnostic-only change:

- Frontend: `npm test` -> 59 passed, 0 failed.
- Rust: `cargo test` -> 23 passed, 0 failed.
- TypeScript type-check passed with `tsc --noEmit`.

The diagnostic preservation change still needs one local compile/test pass after restoring the project on the target development computer.

## What is confirmed working

The local pipeline itself can produce correct speech when run manually in isolation.

Manual checks that sounded correct:

1. F5-TTS output by itself.
2. OpenVoice conversion of that F5 output.
3. Final ffmpeg `atempo=1.05` output.
4. A diagnostic run that executed F5 -> OpenVoice -> ffmpeg sequentially and preserved all three intermediate WAV files; all three sounded correct.
5. The complete `scripts/tts_pipeline.py` run manually with short texts such as `Hola.` and `Uno.`; output sounded correct.

## Current bug

WAV files generated through the running Tauri application sound like white noise / corrupted audio even though the same text and same public pipeline produce correct speech when run manually.

Additional observations:

- Cleaning inherited `BMO_*` environment variables before starting Tauri did not fix the bad output.
- Two UI-triggered TTS requests were serialized by the Rust mutex and produced separate WAV files, but both sounded bad. Therefore concurrency alone did not solve the bug.
- The bad result is not specific to the text `Uno.` because `Uno.` works when generated manually.
- Because manual F5, OpenVoice, ffmpeg, and the complete manual pipeline all work, the remaining investigation should focus on what differs when the pipeline is launched through the running Tauri application.

## Diagnostic instrumentation now in the branch

The branch now supports preserving the intermediate audio of an app-triggered pipeline run:

- `scripts/tts_pipeline.py` accepts an optional `--debug-dir` and copies the F5, OpenVoice, and final WAVs there before its temporary workspace is deleted.
- `desktop/src-tauri/src/tts.rs` automatically enables this in debug builds (`tauri dev`) and writes the copies below the already-private TTS output directory in a `debug/` subdirectory.
- A `BMO_TTS_DEBUG_DIR` environment variable can override that location when needed.
- Release builds do not enable preservation by default.
- These generated files remain under `.private/` and must never be committed.

For one app-generated output named `bmo-<id>.wav`, the diagnostic directory should contain:

- `bmo-<id>-01-f5.wav`
- `bmo-<id>-02-openvoice.wav`
- `bmo-<id>-03-final.wav`

## Next local diagnostic

After restoring the project and private TTS assets on the development computer:

1. Pull `feat/tts-playback-ui`.
2. Run the Rust compile/tests and frontend tests once.
3. Start BMO with `npm run tauri dev`.
4. Trigger one very short assistant reply and wait until TTS finishes.
5. Listen to the three matching WAVs in `.private/tts-runtime/debug/`.

Interpretation:

- If `01-f5` is already bad, focus on F5/MPS behavior when spawned from the Tauri process and GPU/unified-memory contention with the running app/Ollama.
- If `01-f5` is good but `02-openvoice` is bad, focus on the OpenVoice child-process environment.
- If `01-f5` and `02-openvoice` are good but `03-final` is bad, focus on the ffmpeg child-process environment.
- If all three debug WAVs are good, compare the copied final WAV with the top-level output byte-for-byte and verify that playback is selecting the intended newest file.

A secondary diagnostic remains useful if F5 is the first bad stage: manually run `scripts/tts_pipeline.py` while BMO/Ollama remain open. If that manual WAV is also bad, resource contention is the leading hypothesis; if it is good, focus specifically on the Tauri/Rust launch context.

## Privacy / restore notes

Private TTS configuration remains under `.private/` and is gitignored. Voice references, generated WAVs, model checkpoints, and private configuration must not be committed to this public repository. On a second computer, restore those assets separately from the encrypted private vault and reinstall the local F5/OpenVoice dependencies before expecting TTS synthesis to work.
