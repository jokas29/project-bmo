//! Text-to-speech support for Project BMO.
//!
//! Private voice references, model files, and generated audio remain outside
//! the public repository. The desktop backend calls the local TTS pipeline as
//! a separate process so F5-TTS and OpenVoice do not need to stay loaded in
//! the Tauri process.

use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

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

    fn parse(value: &str) -> Option<Self> {
        match value {
            "cheerful" => Some(Self::Cheerful),
            "calm" => Some(Self::Calm),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct TtsEngine {
    project_root: PathBuf,
    pipeline_python: PathBuf,
    pipeline_script: PathBuf,
    output_dir: PathBuf,
    debug_dir: Option<PathBuf>,
    pipeline_lock: Arc<Mutex<()>>,
}

impl TtsEngine {
    pub(crate) fn new() -> Self {
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");

        let pipeline_python = std::env::var_os("BMO_TTS_PIPELINE_PYTHON")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/opt/homebrew/bin/python3"));

        let pipeline_script = std::env::var_os("BMO_TTS_PIPELINE_SCRIPT")
            .map(PathBuf::from)
            .unwrap_or_else(|| project_root.join("scripts/tts_pipeline.py"));

        let output_dir = std::env::var_os("BMO_TTS_OUTPUT_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| project_root.join(".private/tts-runtime"));

        let debug_dir = std::env::var_os("BMO_TTS_DEBUG_DIR")
            .map(PathBuf::from)
            .or_else(|| cfg!(debug_assertions).then(|| output_dir.join("debug")));

        Self {
            project_root,
            pipeline_python,
            pipeline_script,
            output_dir,
            debug_dir,
            pipeline_lock: Arc::new(Mutex::new(())),
        }
    }

    fn supported_styles(&self) -> Vec<String> {
        [TtsStyle::Cheerful, TtsStyle::Calm]
            .into_iter()
            .map(|style| style.as_str().to_owned())
            .collect()
    }

    fn synthesize(&self, text: String, style: String) -> Result<String, String> {
        let text = text.trim();

        if text.is_empty() {
            return Err("El texto para TTS está vacío.".to_owned());
        }

        let style =
            TtsStyle::parse(&style).ok_or_else(|| "El estilo TTS no es válido.".to_owned())?;

        let _pipeline_guard = self
            .pipeline_lock
            .lock()
            .map_err(|_| "El bloqueo interno de TTS quedó en un estado inválido.".to_owned())?;

        if !self.pipeline_python.is_file() {
            return Err(format!(
                "No encuentro Python para el pipeline TTS: {}",
                self.pipeline_python.display()
            ));
        }

        if !self.pipeline_script.is_file() {
            return Err(format!(
                "No encuentro el pipeline TTS: {}",
                self.pipeline_script.display()
            ));
        }

        fs::create_dir_all(&self.output_dir)
            .map_err(|_| "No pude crear la carpeta temporal de TTS.".to_owned())?;

        if let Some(debug_dir) = &self.debug_dir {
            fs::create_dir_all(debug_dir)
                .map_err(|_| "No pude crear la carpeta privada de diagnóstico TTS.".to_owned())?;
        }

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "No pude crear un nombre temporal para el audio.".to_owned())?
            .as_nanos();

        let output_path = self
            .output_dir
            .join(format!("bmo-{}-{timestamp}.wav", std::process::id()));

        let mut command = Command::new(&self.pipeline_python);
        command
            .current_dir(&self.project_root)
            .arg(&self.pipeline_script)
            .arg("--style")
            .arg(style.as_str())
            .arg("--text")
            .arg(text)
            .arg("--output")
            .arg(&output_path);

        if let Some(debug_dir) = &self.debug_dir {
            command.arg("--debug-dir").arg(debug_dir);
        }

        // F5-TTS on the current macOS/Apple Silicon setup produces corrupted
        // audio when the parent captures stdout/stderr with Command::output().
        // Keeping the streams inherited matches the known-good manual launch.
        let status = command
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .map_err(|_| "No pude iniciar el pipeline TTS local.".to_owned())?;

        if !status.success() {
            let detail = status
                .code()
                .map(|code| format!(" (código {code})"))
                .unwrap_or_default();
            return Err(format!("El pipeline TTS local falló{detail}."));
        }

        if !output_path.is_file() {
            return Err("El pipeline terminó sin crear el audio.".to_owned());
        }

        Ok(output_path.to_string_lossy().into_owned())
    }
}

#[tauri::command]
pub(crate) fn tts_status(engine: tauri::State<'_, TtsEngine>) -> Vec<String> {
    engine.supported_styles()
}

#[tauri::command]
pub(crate) async fn tts_synthesize(
    engine: tauri::State<'_, TtsEngine>,
    text: String,
    style: String,
) -> Result<String, String> {
    let engine = engine.inner().clone();

    tauri::async_runtime::spawn_blocking(move || engine.synthesize(text, style))
        .await
        .map_err(|_| "El proceso TTS terminó inesperadamente.".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_tts_styles() {
        assert_eq!(TtsStyle::parse("cheerful"), Some(TtsStyle::Cheerful));
        assert_eq!(TtsStyle::parse("calm"), Some(TtsStyle::Calm));
    }

    #[test]
    fn rejects_unknown_tts_style() {
        assert_eq!(TtsStyle::parse("angry"), None);
        assert_eq!(TtsStyle::parse(""), None);
    }

    #[test]
    fn rejects_empty_tts_text_before_starting_pipeline() {
        let engine = TtsEngine::new();

        let result = engine.synthesize("   ".to_owned(), "calm".to_owned());

        assert_eq!(result, Err("El texto para TTS está vacío.".to_owned()));
    }
}
