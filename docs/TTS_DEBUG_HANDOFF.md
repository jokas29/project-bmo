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

- Frontend: `npm test` -> 59 passed, 0 failed.
- Rust: `cargo test` -> 23 passed, 0 failed.
- TypeScript type-check passed with `tsc --noEmit`.

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

## Next pending diagnostic

This test had **not** been run at the time of handoff:

1. Start BMO/Tauri normally and leave it open.
2. Make sure no `tts_pipeline.py` process is currently running.
3. From a second terminal, manually run `scripts/tts_pipeline.py` with a short phrase while BMO/Ollama remain open.
4. Listen to that manually generated WAV.

Interpretation:

- If the manual WAV is bad while BMO/Ollama are open, investigate memory/GPU/MPS resource contention between Ollama and F5-TTS.
- If the manual WAV is good while BMO/Ollama are open, investigate the Rust/Tauri process-launch environment and file handling specifically.

## Privacy / restore notes

Private TTS configuration remains under `.private/` and is gitignored. Voice references, generated WAVs, model checkpoints, and private configuration must not be committed to this public repository. On a second computer, restore those assets separately from the encrypted private vault and reinstall the local F5/OpenVoice dependencies before expecting TTS synthesis to work.
