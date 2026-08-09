use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::{Arc, Mutex, Weak};
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;

const MAX_RECORDING_SECONDS: u64 = 30;
const MIN_RECORDING_MILLISECONDS: u64 = 300;
const FFMPEG_TIMEOUT: Duration = Duration::from_secs(30);
const WHISPER_TIMEOUT: Duration = Duration::from_secs(120);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(25);

const FFMPEG_CANDIDATES: [&str; 2] = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"];
const WHISPER_CANDIDATES: [&str; 2] = [
    "/opt/homebrew/bin/whisper-cli",
    "/usr/local/bin/whisper-cli",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum VoiceError {
    AlreadyRecording,
    NotRecording,
    Busy,
    MicrophoneUnavailable,
    UnsupportedInputFormat,
    RecordingInterrupted,
    TooShort,
    FfmpegMissing,
    WhisperMissing,
    ModelMissing,
    TemporaryStorageUnavailable,
    AudioPreparationFailed,
    ConversionFailed,
    ConversionTimedOut,
    TranscriptionFailed,
    TranscriptionTimedOut,
    Cancelled,
    EmptyTranscript,
    Internal,
}

impl VoiceError {
    fn user_message(self) -> &'static str {
        match self {
            Self::AlreadyRecording => "Ya hay una grabación de voz activa.",
            Self::NotRecording => "No hay una grabación de voz activa.",
            Self::Busy => "La transcripción anterior todavía está en curso.",
            Self::MicrophoneUnavailable => {
                "No pude acceder al micrófono. Revisa su permiso en Ajustes del Sistema."
            }
            Self::UnsupportedInputFormat => "El formato de audio del micrófono no es compatible.",
            Self::RecordingInterrupted => {
                "La grabación se interrumpió. Pulsa de nuevo el botón e inténtalo otra vez."
            }
            Self::TooShort => "La grabación fue demasiado corta. Graba durante un momento más.",
            Self::FfmpegMissing => {
                "No encuentro ffmpeg. Instálalo con Homebrew para preparar el audio localmente."
            }
            Self::WhisperMissing => {
                "No encuentro whisper-cli. Instálalo con Homebrew para transcribir localmente."
            }
            Self::ModelMissing => {
                "Falta el modelo local models/whisper/ggml-base.bin de Project BMO."
            }
            Self::TemporaryStorageUnavailable => {
                "No pude preparar un espacio temporal para la grabación."
            }
            Self::AudioPreparationFailed => "No pude preparar la grabación del micrófono.",
            Self::ConversionFailed => "No pude convertir el audio para Whisper.",
            Self::ConversionTimedOut => "La conversión del audio tardó demasiado y se detuvo.",
            Self::TranscriptionFailed => "No pude transcribir el audio localmente.",
            Self::TranscriptionTimedOut => "La transcripción tardó demasiado y se detuvo.",
            Self::Cancelled => "La operación de voz se canceló.",
            Self::EmptyTranscript => "No pude reconocer palabras en la grabación.",
            Self::Internal => "Ocurrió un problema interno con la grabación de voz.",
        }
    }

    fn into_user_message(self) -> String {
        self.user_message().to_owned()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum VoiceStatus {
    Idle,
    Recording,
    Captured,
    Transcribing,
    Cancelling,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum VoiceAction {
    Start,
    WatchdogElapsed,
    Stop,
    Cancel,
    FinishTranscription,
}

fn transition(status: VoiceStatus, action: VoiceAction) -> Result<VoiceStatus, VoiceError> {
    match (status, action) {
        (VoiceStatus::Idle, VoiceAction::Start) => Ok(VoiceStatus::Recording),
        (VoiceStatus::Recording, VoiceAction::WatchdogElapsed) => Ok(VoiceStatus::Captured),
        (VoiceStatus::Recording | VoiceStatus::Captured, VoiceAction::Stop) => {
            Ok(VoiceStatus::Transcribing)
        }
        (VoiceStatus::Idle, VoiceAction::Cancel) => Ok(VoiceStatus::Idle),
        (VoiceStatus::Recording | VoiceStatus::Captured, VoiceAction::Cancel) => {
            Ok(VoiceStatus::Cancelling)
        }
        (VoiceStatus::Transcribing, VoiceAction::Cancel) => Ok(VoiceStatus::Cancelling),
        (VoiceStatus::Cancelling, VoiceAction::Cancel) => Ok(VoiceStatus::Cancelling),
        (VoiceStatus::Transcribing | VoiceStatus::Cancelling, VoiceAction::FinishTranscription) => {
            Ok(VoiceStatus::Idle)
        }
        (VoiceStatus::Recording | VoiceStatus::Captured, VoiceAction::Start) => {
            Err(VoiceError::AlreadyRecording)
        }
        (VoiceStatus::Transcribing, VoiceAction::Start | VoiceAction::Stop) => {
            Err(VoiceError::Busy)
        }
        (VoiceStatus::Cancelling, VoiceAction::Start | VoiceAction::Stop) => Err(VoiceError::Busy),
        (VoiceStatus::Idle, VoiceAction::Stop) => Err(VoiceError::NotRecording),
        _ => Err(VoiceError::Internal),
    }
}

#[derive(Clone)]
struct CapturedAudio {
    samples: Arc<Mutex<Vec<f32>>>,
    stream_failed: Arc<AtomicBool>,
    sample_rate: u32,
    channels: u16,
}

impl CapturedAudio {
    fn snapshot(&self) -> Result<Vec<f32>, VoiceError> {
        if self.stream_failed.load(Ordering::Acquire) {
            return Err(VoiceError::RecordingInterrupted);
        }

        let mut samples = self
            .samples
            .lock()
            .map_err(|_| VoiceError::Internal)?
            .clone();

        let channels = usize::from(self.channels);
        if channels == 0 {
            return Err(VoiceError::AudioPreparationFailed);
        }

        samples.truncate(samples.len() - (samples.len() % channels));
        if !has_minimum_duration(
            samples.len(),
            self.sample_rate,
            self.channels,
            MIN_RECORDING_MILLISECONDS,
        ) {
            return Err(VoiceError::TooShort);
        }

        Ok(samples)
    }
}

struct RecordingSession {
    id: u64,
    audio: CapturedAudio,
    control: Sender<CaptureControl>,
    stopped: Receiver<()>,
}

impl RecordingSession {
    fn finish_capture(&self, control: CaptureControl) -> Result<(), VoiceError> {
        // A failed send means the watchdog has already closed its receiver.
        // Waiting for `stopped` still guarantees that Stream teardown finished.
        let _ = self.control.send(control);
        self.stopped
            .recv()
            .map_err(|_| VoiceError::RecordingInterrupted)
    }
}

#[derive(Clone, Copy)]
enum CaptureControl {
    Stop,
    Cancel,
}

fn create_input_stream() -> Result<(Stream, CapturedAudio), VoiceError> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or(VoiceError::MicrophoneUnavailable)?;
    let supported_config = device
        .default_input_config()
        .map_err(|_| VoiceError::MicrophoneUnavailable)?;

    let sample_format = supported_config.sample_format();
    let sample_rate = supported_config.sample_rate().0;
    let channels = supported_config.channels();
    if sample_rate == 0 || channels == 0 {
        return Err(VoiceError::UnsupportedInputFormat);
    }

    let max_samples = max_sample_count(sample_rate, channels);
    let initial_capacity = one_second_sample_count(sample_rate, channels).min(max_samples);
    let samples = Arc::new(Mutex::new(Vec::with_capacity(initial_capacity)));
    let stream_failed = Arc::new(AtomicBool::new(false));
    let config: StreamConfig = supported_config.into();

    let stream = match sample_format {
        SampleFormat::F32 => {
            let samples = Arc::clone(&samples);
            let stream_failed_for_callback = Arc::clone(&stream_failed);
            device.build_input_stream(
                &config,
                move |data: &[f32], _| append_samples(&samples, data.iter().copied(), max_samples),
                move |_| stream_failed_for_callback.store(true, Ordering::Release),
                None,
            )
        }
        SampleFormat::I16 => {
            let samples = Arc::clone(&samples);
            let stream_failed_for_callback = Arc::clone(&stream_failed);
            device.build_input_stream(
                &config,
                move |data: &[i16], _| {
                    append_samples(
                        &samples,
                        data.iter().map(|sample| f32::from(*sample) / 32_768.0),
                        max_samples,
                    )
                },
                move |_| stream_failed_for_callback.store(true, Ordering::Release),
                None,
            )
        }
        SampleFormat::U16 => {
            let samples = Arc::clone(&samples);
            let stream_failed_for_callback = Arc::clone(&stream_failed);
            device.build_input_stream(
                &config,
                move |data: &[u16], _| {
                    append_samples(
                        &samples,
                        data.iter()
                            .map(|sample| (f32::from(*sample) - 32_768.0) / 32_768.0),
                        max_samples,
                    )
                },
                move |_| stream_failed_for_callback.store(true, Ordering::Release),
                None,
            )
        }
        _ => return Err(VoiceError::UnsupportedInputFormat),
    }
    .map_err(|_| VoiceError::MicrophoneUnavailable)?;

    stream
        .play()
        .map_err(|_| VoiceError::MicrophoneUnavailable)?;

    Ok((
        stream,
        CapturedAudio {
            samples,
            stream_failed,
            sample_rate,
            channels,
        },
    ))
}

struct VoiceInner {
    status: VoiceStatus,
    session: Option<RecordingSession>,
    transcription_cancel: Option<Arc<AtomicBool>>,
    next_session_id: u64,
}

impl Default for VoiceInner {
    fn default() -> Self {
        Self {
            status: VoiceStatus::Idle,
            session: None,
            transcription_cancel: None,
            next_session_id: 1,
        }
    }
}

impl Drop for VoiceInner {
    fn drop(&mut self) {
        if let Some(cancel) = &self.transcription_cancel {
            cancel.store(true, Ordering::Release);
        }
        // Dropping `session` closes the capture-control channel. Its owner
        // thread then drops CPAL's Stream before exiting.
    }
}

#[derive(Clone)]
pub(crate) struct VoiceState {
    inner: Arc<Mutex<VoiceInner>>,
}

impl Default for VoiceState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(VoiceInner::default())),
        }
    }
}

impl VoiceState {
    fn start(&self) -> Result<(), VoiceError> {
        let weak_inner = Arc::downgrade(&self.inner);
        let mut inner = self.inner.lock().map_err(|_| VoiceError::Internal)?;
        let next_status = transition(inner.status, VoiceAction::Start)?;
        let session_id = inner.next_session_id;
        inner.next_session_id = inner.next_session_id.wrapping_add(1);

        let (control_sender, control_receiver) = mpsc::channel();
        let (stopped_sender, stopped_receiver) = mpsc::channel();
        let (ready_sender, ready_receiver) = mpsc::sync_channel(0);
        thread::Builder::new()
            .name("bmo-voice-capture".to_owned())
            .spawn(move || {
                capture_worker(
                    weak_inner,
                    session_id,
                    control_receiver,
                    stopped_sender,
                    ready_sender,
                )
            })
            .map_err(|_| VoiceError::Internal)?;

        let audio = ready_receiver.recv().map_err(|_| VoiceError::Internal)??;
        inner.status = next_status;
        inner.transcription_cancel = None;
        inner.session = Some(RecordingSession {
            id: session_id,
            audio,
            control: control_sender,
            stopped: stopped_receiver,
        });

        Ok(())
    }

    fn begin_transcription(&self) -> Result<(CapturedAudio, Arc<AtomicBool>), VoiceError> {
        let cancel = Arc::new(AtomicBool::new(false));
        let session = {
            let mut inner = self.inner.lock().map_err(|_| VoiceError::Internal)?;
            let next_status = transition(inner.status, VoiceAction::Stop)?;
            let Some(session) = inner.session.take() else {
                inner.status = VoiceStatus::Idle;
                return Err(VoiceError::Internal);
            };

            inner.status = next_status;
            inner.transcription_cancel = Some(Arc::clone(&cancel));
            session
        };

        if let Err(error) = session.finish_capture(CaptureControl::Stop) {
            Self::finish_operation(&self.inner);
            return Err(error);
        }

        Ok((session.audio, cancel))
    }

    fn cancel(&self) -> Result<(), VoiceError> {
        let session = {
            let mut inner = self.inner.lock().map_err(|_| VoiceError::Internal)?;
            let current_status = inner.status;
            let next_status = transition(inner.status, VoiceAction::Cancel)?;

            let session = match current_status {
                VoiceStatus::Recording | VoiceStatus::Captured => {
                    let Some(session) = inner.session.take() else {
                        return Err(VoiceError::Internal);
                    };
                    Some(session)
                }
                VoiceStatus::Transcribing | VoiceStatus::Cancelling => {
                    if let Some(cancel) = &inner.transcription_cancel {
                        cancel.store(true, Ordering::Release);
                    }
                    None
                }
                VoiceStatus::Idle => None,
            };
            inner.status = next_status;
            session
        };

        if let Some(session) = session {
            // Cancel still waits for the owner thread to drop CPAL's Stream, but
            // it is intentionally idempotent if the stream already ended.
            let result = session.finish_capture(CaptureControl::Cancel);
            Self::finish_operation(&self.inner);
            result?;
        }
        Ok(())
    }

    pub(crate) fn shutdown(&self) {
        let _ = self.shutdown_with_timeout(SHUTDOWN_TIMEOUT);
    }

    fn shutdown_with_timeout(&self, timeout: Duration) -> bool {
        let started = Instant::now();
        let session = loop {
            match self.inner.try_lock() {
                Ok(mut inner) => {
                    let current_status = inner.status;
                    let next_status = match transition(current_status, VoiceAction::Cancel) {
                        Ok(status) => status,
                        Err(_) => return false,
                    };

                    let session = match current_status {
                        VoiceStatus::Recording | VoiceStatus::Captured => inner.session.take(),
                        VoiceStatus::Transcribing | VoiceStatus::Cancelling => {
                            if let Some(cancel) = &inner.transcription_cancel {
                                cancel.store(true, Ordering::Release);
                            }
                            None
                        }
                        VoiceStatus::Idle => None,
                    };
                    inner.status = next_status;
                    break session;
                }
                Err(std::sync::TryLockError::Poisoned(_)) => return false,
                Err(std::sync::TryLockError::WouldBlock) => {
                    let elapsed = started.elapsed();
                    if elapsed >= timeout {
                        return false;
                    }
                    thread::sleep(PROCESS_POLL_INTERVAL.min(timeout - elapsed));
                }
            }
        };

        if let Some(session) = session {
            let _ = session.control.send(CaptureControl::Cancel);
            let remaining = timeout.saturating_sub(started.elapsed());
            let capture_stopped = !remaining.is_zero()
                && matches!(
                    session.stopped.recv_timeout(remaining),
                    Ok(()) | Err(RecvTimeoutError::Disconnected)
                );

            if !capture_stopped {
                return false;
            }

            loop {
                match self.inner.try_lock() {
                    Ok(mut inner) => {
                        if inner.status != VoiceStatus::Idle {
                            let Ok(next_status) =
                                transition(inner.status, VoiceAction::FinishTranscription)
                            else {
                                return false;
                            };
                            inner.status = next_status;
                            inner.session = None;
                            inner.transcription_cancel = None;
                        }
                        break;
                    }
                    Err(std::sync::TryLockError::Poisoned(_)) => return false,
                    Err(std::sync::TryLockError::WouldBlock) => {
                        let elapsed = started.elapsed();
                        if elapsed >= timeout {
                            return false;
                        }
                        thread::sleep(PROCESS_POLL_INTERVAL.min(timeout - elapsed));
                    }
                }
            }
        }

        loop {
            match self.inner.try_lock() {
                Ok(inner) if inner.status == VoiceStatus::Idle => return true,
                Ok(_) | Err(std::sync::TryLockError::WouldBlock) => {}
                Err(std::sync::TryLockError::Poisoned(_)) => return false,
            }

            let elapsed = started.elapsed();
            if elapsed >= timeout {
                return false;
            }
            thread::sleep(PROCESS_POLL_INTERVAL.min(timeout - elapsed));
        }
    }

    fn finish_operation(inner: &Arc<Mutex<VoiceInner>>) {
        let mut inner = match inner.lock() {
            Ok(inner) => inner,
            Err(poisoned) => poisoned.into_inner(),
        };

        if let Ok(next_status) = transition(inner.status, VoiceAction::FinishTranscription) {
            inner.status = next_status;
            inner.session = None;
            inner.transcription_cancel = None;
        }
    }

    fn complete_transcription(
        inner: &Arc<Mutex<VoiceInner>>,
        cancel: &Arc<AtomicBool>,
        result: Result<String, VoiceError>,
    ) -> Result<String, VoiceError> {
        let mut inner = match inner.lock() {
            Ok(inner) => inner,
            Err(poisoned) => poisoned.into_inner(),
        };

        let owns_transcription = inner
            .transcription_cancel
            .as_ref()
            .is_some_and(|active| Arc::ptr_eq(active, cancel));
        if !owns_transcription {
            return Err(VoiceError::Internal);
        }

        let was_cancelled = inner.status == VoiceStatus::Cancelling
            || cancel.load(Ordering::Acquire)
            || matches!(&result, Err(VoiceError::Cancelled));
        let next_status =
            transition(inner.status, VoiceAction::FinishTranscription).unwrap_or(VoiceStatus::Idle);
        inner.status = next_status;
        inner.session = None;
        inner.transcription_cancel = None;

        if was_cancelled {
            Err(VoiceError::Cancelled)
        } else {
            result
        }
    }
}

fn capture_worker(
    inner: Weak<Mutex<VoiceInner>>,
    session_id: u64,
    control_receiver: Receiver<CaptureControl>,
    stopped_sender: Sender<()>,
    ready_sender: SyncSender<Result<CapturedAudio, VoiceError>>,
) {
    let (stream, audio) = match create_input_stream() {
        Ok(capture) => capture,
        Err(error) => {
            let _ = ready_sender.send(Err(error));
            return;
        }
    };

    if ready_sender.send(Ok(audio)).is_err() {
        return;
    }

    let exit = control_receiver.recv_timeout(Duration::from_secs(MAX_RECORDING_SECONDS));
    // Closing the receiver makes a racing stop/cancel observe that the worker
    // has already committed to its timeout path instead of waiting for an ack.
    drop(control_receiver);
    // CPAL Stream is deliberately created, owned and dropped on this thread;
    // cpal 0.15 marks Stream as !Send/!Sync across platforms.
    drop(stream);
    let _ = stopped_sender.send(());

    if matches!(exit, Err(RecvTimeoutError::Timeout)) {
        mark_watchdog_capture(inner, session_id);
    }
}

fn mark_watchdog_capture(inner: Weak<Mutex<VoiceInner>>, session_id: u64) {
    let Some(inner) = inner.upgrade() else {
        return;
    };
    let mut inner = match inner.lock() {
        Ok(inner) => inner,
        Err(_) => return,
    };

    if inner.status != VoiceStatus::Recording {
        return;
    }
    if inner.session.as_ref().map(|session| session.id) != Some(session_id) {
        return;
    }

    if let Ok(next_status) = transition(inner.status, VoiceAction::WatchdogElapsed) {
        inner.status = next_status;
    }
}

#[tauri::command]
pub(crate) async fn start_voice_recording(
    state: tauri::State<'_, VoiceState>,
) -> Result<(), String> {
    let voice_state = VoiceState {
        inner: Arc::clone(&state.inner),
    };
    tauri::async_runtime::spawn_blocking(move || voice_state.start())
        .await
        .map_err(|_| VoiceError::Internal.into_user_message())?
        .map_err(VoiceError::into_user_message)
}

#[tauri::command]
pub(crate) async fn stop_voice_recording_and_transcribe(
    app: tauri::AppHandle,
    state: tauri::State<'_, VoiceState>,
) -> Result<String, String> {
    let state_inner = Arc::clone(&state.inner);
    let voice_state = VoiceState {
        inner: Arc::clone(&state.inner),
    };
    let (audio, cancel) =
        match tauri::async_runtime::spawn_blocking(move || voice_state.begin_transcription()).await
        {
            Ok(Ok(capture)) => capture,
            Ok(Err(error)) => return Err(error.into_user_message()),
            Err(_) => {
                VoiceState::finish_operation(&state_inner);
                return Err(VoiceError::Internal.into_user_message());
            }
        };

    let app_data_dir = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(_) => {
            return VoiceState::complete_transcription(
                &state_inner,
                &cancel,
                Err(VoiceError::Internal),
            )
            .map_err(VoiceError::into_user_message);
        }
    };

    let process_cancel = Arc::clone(&cancel);
    let result = tauri::async_runtime::spawn_blocking(move || {
        transcribe_captured_audio(audio, &app_data_dir, &process_cancel)
    })
    .await
    .map_err(|_| VoiceError::Internal)
    .and_then(|result| result);

    VoiceState::complete_transcription(&state_inner, &cancel, result)
        .map_err(VoiceError::into_user_message)
}

#[tauri::command]
pub(crate) async fn cancel_voice_recording(
    state: tauri::State<'_, VoiceState>,
) -> Result<(), String> {
    let voice_state = VoiceState {
        inner: Arc::clone(&state.inner),
    };
    tauri::async_runtime::spawn_blocking(move || voice_state.cancel())
        .await
        .map_err(|_| VoiceError::Internal.into_user_message())?
        .map_err(VoiceError::into_user_message)
}

fn append_samples<I>(samples: &Arc<Mutex<Vec<f32>>>, incoming: I, max_samples: usize)
where
    I: IntoIterator<Item = f32>,
{
    let Ok(mut samples) = samples.lock() else {
        return;
    };
    let remaining = max_samples.saturating_sub(samples.len());
    samples.extend(incoming.into_iter().take(remaining).map(sanitize_sample));
}

fn sanitize_sample(sample: f32) -> f32 {
    if sample.is_finite() {
        sample.clamp(-1.0, 1.0)
    } else {
        0.0
    }
}

fn max_sample_count(sample_rate: u32, channels: u16) -> usize {
    let count = u64::from(sample_rate)
        .saturating_mul(u64::from(channels))
        .saturating_mul(MAX_RECORDING_SECONDS);
    count.min(usize::MAX as u64) as usize
}

fn one_second_sample_count(sample_rate: u32, channels: u16) -> usize {
    u64::from(sample_rate)
        .saturating_mul(u64::from(channels))
        .min(usize::MAX as u64) as usize
}

fn has_minimum_duration(
    sample_count: usize,
    sample_rate: u32,
    channels: u16,
    minimum_milliseconds: u64,
) -> bool {
    if sample_rate == 0 || channels == 0 {
        return false;
    }

    let available = (sample_count as u128).saturating_mul(1_000);
    let required = u128::from(sample_rate)
        .saturating_mul(u128::from(channels))
        .saturating_mul(u128::from(minimum_milliseconds));
    available >= required
}

fn transcribe_captured_audio(
    audio: CapturedAudio,
    app_data_dir: &Path,
    cancel: &AtomicBool,
) -> Result<String, VoiceError> {
    ensure_not_cancelled(cancel)?;
    let samples = audio.snapshot()?;
    ensure_not_cancelled(cancel)?;
    let model = model_path(app_data_dir);
    ensure_model_exists(&model)?;

    let ffmpeg_candidates = FFMPEG_CANDIDATES.map(Path::new);
    let ffmpeg = resolve_executable(&ffmpeg_candidates).ok_or(VoiceError::FfmpegMissing)?;
    let whisper_candidates = WHISPER_CANDIDATES.map(Path::new);
    let whisper = resolve_executable(&whisper_candidates).ok_or(VoiceError::WhisperMissing)?;

    let workspace = TempWorkspace::new()?;
    ensure_not_cancelled(cancel)?;
    write_capture_wav(
        workspace.captured_wav(),
        &samples,
        audio.sample_rate,
        audio.channels,
    )?;
    ensure_not_cancelled(cancel)?;
    run_ffmpeg(&ffmpeg, &workspace, cancel)?;
    ensure_not_cancelled(cancel)?;
    run_whisper(&whisper, &model, &workspace, cancel)?;
    ensure_not_cancelled(cancel)?;

    let transcript = fs::read_to_string(workspace.transcript_txt())
        .map_err(|_| VoiceError::TranscriptionFailed)?;
    let transcript = clean_transcript(&transcript)?;
    ensure_not_cancelled(cancel)?;
    Ok(transcript)
}

fn ensure_not_cancelled(cancel: &AtomicBool) -> Result<(), VoiceError> {
    if cancel.load(Ordering::Acquire) {
        Err(VoiceError::Cancelled)
    } else {
        Ok(())
    }
}

fn model_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir
        .join("models")
        .join("whisper")
        .join("ggml-base.bin")
}

fn ensure_model_exists(path: &Path) -> Result<(), VoiceError> {
    if path.is_file() {
        Ok(())
    } else {
        Err(VoiceError::ModelMissing)
    }
}

fn resolve_executable(candidates: &[&Path]) -> Option<PathBuf> {
    candidates
        .iter()
        .copied()
        .find(|candidate| is_executable_file(candidate))
        .map(Path::to_path_buf)
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }

    #[cfg(not(unix))]
    {
        true
    }
}

struct TempWorkspace {
    directory: tempfile::TempDir,
    captured_wav: PathBuf,
    converted_wav: PathBuf,
    transcript_base: PathBuf,
    transcript_txt: PathBuf,
}

impl TempWorkspace {
    fn new() -> Result<Self, VoiceError> {
        let directory = tempfile::Builder::new()
            .prefix("project-bmo-voice-")
            .tempdir()
            .map_err(|_| VoiceError::TemporaryStorageUnavailable)?;
        let captured_wav = directory.path().join("captured.wav");
        let converted_wav = directory.path().join("converted.wav");
        let transcript_base = directory.path().join("transcript");
        let transcript_txt = directory.path().join("transcript.txt");

        Ok(Self {
            directory,
            captured_wav,
            converted_wav,
            transcript_base,
            transcript_txt,
        })
    }

    fn root(&self) -> &Path {
        self.directory.path()
    }

    fn captured_wav(&self) -> &Path {
        &self.captured_wav
    }

    fn converted_wav(&self) -> &Path {
        &self.converted_wav
    }

    fn transcript_base(&self) -> &Path {
        &self.transcript_base
    }

    fn transcript_txt(&self) -> &Path {
        &self.transcript_txt
    }
}

fn write_capture_wav(
    path: &Path,
    samples: &[f32],
    sample_rate: u32,
    channels: u16,
) -> Result<(), VoiceError> {
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer =
        hound::WavWriter::create(path, spec).map_err(|_| VoiceError::AudioPreparationFailed)?;
    for sample in samples {
        writer
            .write_sample(sanitize_sample(*sample))
            .map_err(|_| VoiceError::AudioPreparationFailed)?;
    }
    writer
        .finalize()
        .map_err(|_| VoiceError::AudioPreparationFailed)
}

fn ffmpeg_args(input: &Path, output: &Path) -> Vec<OsString> {
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-nostdin".into(),
        "-y".into(),
        "-i".into(),
        input.as_os_str().to_owned(),
        "-vn".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        "16000".into(),
        "-c:a".into(),
        "pcm_s16le".into(),
        output.as_os_str().to_owned(),
    ]
}

fn run_ffmpeg(
    executable: &Path,
    workspace: &TempWorkspace,
    cancel: &AtomicBool,
) -> Result<(), VoiceError> {
    run_child_command(
        executable,
        ffmpeg_args(workspace.captured_wav(), workspace.converted_wav()),
        workspace.root(),
        cancel,
        FFMPEG_TIMEOUT,
        VoiceError::ConversionFailed,
        VoiceError::ConversionTimedOut,
    )?;

    if workspace.converted_wav().is_file() {
        Ok(())
    } else {
        Err(VoiceError::ConversionFailed)
    }
}

fn whisper_args(model: &Path, input: &Path, output_base: &Path) -> Vec<OsString> {
    vec![
        "-m".into(),
        model.as_os_str().to_owned(),
        "-f".into(),
        input.as_os_str().to_owned(),
        "-l".into(),
        "es".into(),
        "-nt".into(),
        "-otxt".into(),
        "-of".into(),
        output_base.as_os_str().to_owned(),
        "--prompt".into(),
        "BMO".into(),
    ]
}

fn run_whisper(
    executable: &Path,
    model: &Path,
    workspace: &TempWorkspace,
    cancel: &AtomicBool,
) -> Result<(), VoiceError> {
    run_child_command(
        executable,
        whisper_args(
            model,
            workspace.converted_wav(),
            workspace.transcript_base(),
        ),
        workspace.root(),
        cancel,
        WHISPER_TIMEOUT,
        VoiceError::TranscriptionFailed,
        VoiceError::TranscriptionTimedOut,
    )?;

    if workspace.transcript_txt().is_file() {
        Ok(())
    } else {
        Err(VoiceError::TranscriptionFailed)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProcessStopReason {
    Cancelled,
    TimedOut,
}

fn process_stop_reason(
    cancel: &AtomicBool,
    elapsed: Duration,
    timeout: Duration,
) -> Option<ProcessStopReason> {
    if cancel.load(Ordering::Acquire) {
        Some(ProcessStopReason::Cancelled)
    } else if elapsed >= timeout {
        Some(ProcessStopReason::TimedOut)
    } else {
        None
    }
}

fn run_child_command(
    executable: &Path,
    args: Vec<OsString>,
    working_directory: &Path,
    cancel: &AtomicBool,
    timeout: Duration,
    failed_error: VoiceError,
    timeout_error: VoiceError,
) -> Result<(), VoiceError> {
    ensure_not_cancelled(cancel)?;
    let mut child = Command::new(executable)
        .args(args)
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| failed_error)?;
    let started = Instant::now();

    loop {
        if matches!(
            process_stop_reason(cancel, Duration::ZERO, timeout),
            Some(ProcessStopReason::Cancelled)
        ) {
            terminate_child(&mut child);
            return Err(VoiceError::Cancelled);
        }

        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => return Err(failed_error),
            Ok(None) => {}
            Err(_) => {
                terminate_child(&mut child);
                return Err(failed_error);
            }
        }

        if matches!(
            process_stop_reason(cancel, started.elapsed(), timeout),
            Some(ProcessStopReason::TimedOut)
        ) {
            terminate_child(&mut child);
            return Err(timeout_error);
        }

        thread::sleep(PROCESS_POLL_INTERVAL);
    }
}

fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn clean_transcript(raw: &str) -> Result<String, VoiceError> {
    let transcript = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if transcript.is_empty() {
        Err(VoiceError::EmptyTranscript)
    } else {
        Ok(transcript)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(args: Vec<OsString>) -> Vec<String> {
        args.into_iter()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn state_machine_rejects_invalid_and_concurrent_operations() {
        assert_eq!(
            transition(VoiceStatus::Idle, VoiceAction::Stop),
            Err(VoiceError::NotRecording)
        );
        assert_eq!(
            transition(VoiceStatus::Recording, VoiceAction::Start),
            Err(VoiceError::AlreadyRecording)
        );
        assert_eq!(
            transition(VoiceStatus::Transcribing, VoiceAction::Stop),
            Err(VoiceError::Busy)
        );
        assert_eq!(
            transition(VoiceStatus::Transcribing, VoiceAction::Cancel),
            Ok(VoiceStatus::Cancelling)
        );
        assert_eq!(
            transition(VoiceStatus::Cancelling, VoiceAction::Start),
            Err(VoiceError::Busy)
        );
    }

    #[test]
    fn watchdog_capture_can_be_stopped_or_cancelled_once() {
        let captured = transition(VoiceStatus::Recording, VoiceAction::WatchdogElapsed).unwrap();
        assert_eq!(captured, VoiceStatus::Captured);
        assert_eq!(
            transition(captured, VoiceAction::Stop),
            Ok(VoiceStatus::Transcribing)
        );
        assert_eq!(
            transition(captured, VoiceAction::Cancel),
            Ok(VoiceStatus::Cancelling)
        );
        assert_eq!(
            transition(VoiceStatus::Cancelling, VoiceAction::FinishTranscription),
            Ok(VoiceStatus::Idle)
        );
    }

    #[test]
    fn cancelling_a_transcription_sets_the_token_until_completion() {
        let state = VoiceState::default();
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut inner = state.inner.lock().unwrap();
            inner.status = VoiceStatus::Transcribing;
            inner.transcription_cancel = Some(Arc::clone(&cancel));
        }

        state.cancel().unwrap();
        assert!(cancel.load(Ordering::Acquire));
        assert_eq!(state.inner.lock().unwrap().status, VoiceStatus::Cancelling);

        let result = VoiceState::complete_transcription(
            &state.inner,
            &cancel,
            Ok("resultado tardío".to_owned()),
        );
        assert_eq!(result, Err(VoiceError::Cancelled));
        assert_eq!(state.inner.lock().unwrap().status, VoiceStatus::Idle);
    }

    #[test]
    fn capture_stays_cancelling_until_the_owner_confirms_teardown() {
        let state = VoiceState::default();
        let (control_sender, control_receiver) = mpsc::channel();
        let (stopped_sender, stopped_receiver) = mpsc::channel();
        let (control_seen_sender, control_seen_receiver) = mpsc::channel();
        let (release_sender, release_receiver) = mpsc::channel();

        {
            let mut inner = state.inner.lock().unwrap();
            inner.status = VoiceStatus::Recording;
            inner.session = Some(RecordingSession {
                id: 1,
                audio: CapturedAudio {
                    samples: Arc::new(Mutex::new(Vec::new())),
                    stream_failed: Arc::new(AtomicBool::new(false)),
                    sample_rate: 48_000,
                    channels: 1,
                },
                control: control_sender,
                stopped: stopped_receiver,
            });
        }

        let owner = thread::spawn(move || {
            assert!(matches!(
                control_receiver.recv(),
                Ok(CaptureControl::Cancel)
            ));
            control_seen_sender.send(()).unwrap();
            release_receiver.recv().unwrap();
            stopped_sender.send(()).unwrap();
        });
        let cancelling_state = state.clone();
        let cancellation = thread::spawn(move || cancelling_state.cancel());

        control_seen_receiver.recv().unwrap();
        assert_eq!(state.inner.lock().unwrap().status, VoiceStatus::Cancelling);
        assert_eq!(
            transition(VoiceStatus::Cancelling, VoiceAction::Start),
            Err(VoiceError::Busy)
        );

        release_sender.send(()).unwrap();
        assert_eq!(cancellation.join().unwrap(), Ok(()));
        owner.join().unwrap();
        assert_eq!(state.inner.lock().unwrap().status, VoiceStatus::Idle);
    }

    #[test]
    fn shutdown_waits_for_capture_owner_teardown() {
        let state = VoiceState::default();
        let (control_sender, control_receiver) = mpsc::channel();
        let (stopped_sender, stopped_receiver) = mpsc::channel();
        let (control_seen_sender, control_seen_receiver) = mpsc::channel();
        let (release_sender, release_receiver) = mpsc::channel();

        {
            let mut inner = state.inner.lock().unwrap();
            inner.status = VoiceStatus::Recording;
            inner.session = Some(RecordingSession {
                id: 1,
                audio: CapturedAudio {
                    samples: Arc::new(Mutex::new(Vec::new())),
                    stream_failed: Arc::new(AtomicBool::new(false)),
                    sample_rate: 48_000,
                    channels: 1,
                },
                control: control_sender,
                stopped: stopped_receiver,
            });
        }

        let owner = thread::spawn(move || {
            assert!(matches!(
                control_receiver.recv(),
                Ok(CaptureControl::Cancel)
            ));
            control_seen_sender.send(()).unwrap();
            release_receiver.recv().unwrap();
            stopped_sender.send(()).unwrap();
        });
        let shutdown_state = state.clone();
        let shutdown =
            thread::spawn(move || shutdown_state.shutdown_with_timeout(Duration::from_secs(1)));

        control_seen_receiver.recv().unwrap();
        assert_eq!(state.inner.lock().unwrap().status, VoiceStatus::Cancelling);
        release_sender.send(()).unwrap();
        assert!(shutdown.join().unwrap());
        owner.join().unwrap();
        assert_eq!(state.inner.lock().unwrap().status, VoiceStatus::Idle);
    }

    #[test]
    fn shutdown_waits_for_transcription_cleanup() {
        let state = VoiceState::default();
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut inner = state.inner.lock().unwrap();
            inner.status = VoiceStatus::Transcribing;
            inner.transcription_cancel = Some(Arc::clone(&cancel));
        }

        let workspace = TempWorkspace::new().unwrap();
        let root = workspace.root().to_path_buf();
        fs::write(workspace.captured_wav(), b"temporary audio").unwrap();
        let worker_state = state.clone();
        let worker_cancel = Arc::clone(&cancel);
        let worker = thread::spawn(move || {
            while !worker_cancel.load(Ordering::Acquire) {
                thread::sleep(Duration::from_millis(1));
            }
            drop(workspace);
            let _ = VoiceState::complete_transcription(
                &worker_state.inner,
                &worker_cancel,
                Err(VoiceError::Cancelled),
            );
        });

        assert!(state.shutdown_with_timeout(Duration::from_secs(1)));
        assert!(!root.exists());
        worker.join().unwrap();
        assert_eq!(state.inner.lock().unwrap().status, VoiceStatus::Idle);
    }

    #[test]
    fn shutdown_timeout_includes_state_lock_contention() {
        let state = VoiceState::default();
        let state_for_shutdown = state.clone();
        let guard = state.inner.lock().unwrap();
        let started = Instant::now();
        let shutdown = thread::spawn(move || {
            state_for_shutdown.shutdown_with_timeout(Duration::from_millis(30))
        });

        assert!(!shutdown.join().unwrap());
        assert!(started.elapsed() < Duration::from_secs(1));
        drop(guard);
    }

    #[test]
    fn dropping_voice_state_requests_process_cancellation() {
        let cancel = Arc::new(AtomicBool::new(false));
        let inner = VoiceInner {
            status: VoiceStatus::Transcribing,
            session: None,
            transcription_cancel: Some(Arc::clone(&cancel)),
            next_session_id: 1,
        };
        drop(inner);
        assert!(cancel.load(Ordering::Acquire));
    }

    #[test]
    fn process_stop_reason_prioritizes_cancel_and_enforces_timeout() {
        let cancel = AtomicBool::new(false);
        assert_eq!(
            process_stop_reason(&cancel, Duration::from_secs(29), FFMPEG_TIMEOUT),
            None
        );
        assert_eq!(
            process_stop_reason(&cancel, FFMPEG_TIMEOUT, FFMPEG_TIMEOUT),
            Some(ProcessStopReason::TimedOut)
        );

        cancel.store(true, Ordering::Release);
        assert_eq!(
            process_stop_reason(&cancel, FFMPEG_TIMEOUT, FFMPEG_TIMEOUT),
            Some(ProcessStopReason::Cancelled)
        );
    }

    #[test]
    fn duration_validation_enforces_the_short_recording_threshold() {
        assert!(!has_minimum_duration(14_399, 48_000, 1, 300));
        assert!(has_minimum_duration(14_400, 48_000, 1, 300));
        assert!(!has_minimum_duration(1, 0, 1, 300));
    }

    #[test]
    fn sample_buffer_never_exceeds_the_hard_limit() {
        let samples = Arc::new(Mutex::new(Vec::new()));
        let maximum = max_sample_count(10, 1);
        append_samples(&samples, std::iter::repeat_n(0.5, maximum + 25), maximum);
        assert_eq!(samples.lock().unwrap().len(), maximum);
    }

    #[test]
    fn initial_buffer_capacity_is_only_one_second() {
        assert_eq!(one_second_sample_count(48_000, 2), 96_000);
        assert_eq!(max_sample_count(48_000, 2), 2_880_000);
    }

    #[test]
    fn model_path_is_scoped_to_the_application_data_directory() {
        assert_eq!(
            model_path(Path::new("/app-data")),
            PathBuf::from("/app-data/models/whisper/ggml-base.bin")
        );
    }

    #[test]
    fn missing_model_error_does_not_expose_an_internal_path() {
        let workspace = tempfile::tempdir().unwrap();
        let missing = workspace.path().join("private-model.bin");
        let error = ensure_model_exists(&missing).unwrap_err();
        assert_eq!(error, VoiceError::ModelMissing);
        assert!(!error
            .user_message()
            .contains(&missing.to_string_lossy()[..]));
    }

    #[cfg(unix)]
    #[test]
    fn executable_resolution_uses_order_and_requires_execute_permission() {
        use std::os::unix::fs::PermissionsExt;

        let workspace = tempfile::tempdir().unwrap();
        let first = workspace.path().join("first");
        let second = workspace.path().join("second");
        fs::write(&first, b"first").unwrap();
        fs::write(&second, b"second").unwrap();
        fs::set_permissions(&first, fs::Permissions::from_mode(0o644)).unwrap();
        fs::set_permissions(&second, fs::Permissions::from_mode(0o755)).unwrap();

        assert_eq!(
            resolve_executable(&[first.as_path(), second.as_path()]),
            Some(second.clone())
        );

        fs::set_permissions(&first, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            resolve_executable(&[first.as_path(), second.as_path()]),
            Some(first)
        );
    }

    #[test]
    fn ffmpeg_arguments_force_mono_16khz_pcm16_audio() {
        assert_eq!(
            strings(ffmpeg_args(
                Path::new("/tmp/input con espacios;$(sin-shell).wav"),
                Path::new("/tmp/output & final.wav")
            )),
            vec![
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-y",
                "-i",
                "/tmp/input con espacios;$(sin-shell).wav",
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                "/tmp/output & final.wav",
            ]
        );
    }

    #[test]
    fn whisper_arguments_select_spanish_text_without_timestamps_and_prompt_bmo() {
        assert_eq!(
            strings(whisper_args(
                Path::new("/app/model con espacios.bin"),
                Path::new("/tmp/input;sin-shell.wav"),
                Path::new("/tmp/transcript & final")
            )),
            vec![
                "-m",
                "/app/model con espacios.bin",
                "-f",
                "/tmp/input;sin-shell.wav",
                "-l",
                "es",
                "-nt",
                "-otxt",
                "-of",
                "/tmp/transcript & final",
                "--prompt",
                "BMO",
            ]
        );
    }

    #[test]
    fn transcript_is_trimmed_and_must_not_be_empty() {
        assert_eq!(clean_transcript("  hola BMO\n").unwrap(), "hola BMO");
        assert_eq!(
            clean_transcript("hola\nBMO\tamigo").unwrap(),
            "hola BMO amigo"
        );
        assert_eq!(clean_transcript(" \n\t"), Err(VoiceError::EmptyTranscript));
    }

    #[test]
    fn temporary_workspace_is_removed_on_drop() {
        let workspace = TempWorkspace::new().unwrap();
        let root = workspace.root().to_path_buf();
        fs::write(workspace.captured_wav(), b"temporary audio").unwrap();
        assert!(root.is_dir());
        drop(workspace);
        assert!(!root.exists());
    }

    #[test]
    fn capture_wav_uses_the_native_rate_channels_and_float_samples() {
        let workspace = TempWorkspace::new().unwrap();
        write_capture_wav(
            workspace.captured_wav(),
            &[0.0, 0.25, -0.25, 1.0],
            48_000,
            2,
        )
        .unwrap();

        let reader = hound::WavReader::open(workspace.captured_wav()).unwrap();
        assert_eq!(reader.spec().sample_rate, 48_000);
        assert_eq!(reader.spec().channels, 2);
        assert_eq!(reader.spec().bits_per_sample, 32);
        assert_eq!(reader.spec().sample_format, hound::SampleFormat::Float);
        assert_eq!(reader.duration(), 2);
    }
}
