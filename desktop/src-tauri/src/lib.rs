use tauri::Manager;

mod tts;
mod voice;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(voice::VoiceState::default())
        .manage(tts::TtsEngine::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            tts::tts_status,
            tts::tts_synthesize,
            voice::start_voice_recording,
            voice::stop_voice_recording_and_transcribe,
            voice::cancel_voice_recording
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app_handle.state::<voice::VoiceState>().shutdown();
        }
    });
}
