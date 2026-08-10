//! Text-to-speech support for Project BMO.
//!
//! Private voice references, model files, and generated audio must remain
//! outside the public repository. Concrete local backends will be connected
//! here behind a small interface.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TtsStyle {
    Cheerful,
    Calm,
}

impl TtsStyle {
    fn as_str(self) -> &'static str {
        match self {
            Self::Cheerful => "cheerful",
            Self::Calm => "calm",
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct TtsEngine;

impl TtsEngine {
    pub(crate) fn new() -> Self {
        Self
    }

    fn supported_styles(&self) -> Vec<String> {
        [TtsStyle::Cheerful, TtsStyle::Calm]
            .into_iter()
            .map(|style| style.as_str().to_owned())
            .collect()
    }
}

#[tauri::command]
pub(crate) fn tts_status(engine: tauri::State<'_, TtsEngine>) -> Vec<String> {
    engine.supported_styles()
}
