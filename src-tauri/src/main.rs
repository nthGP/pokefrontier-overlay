// Frontier Overlay: a small always-on-top window around src/index.html.
// Everything the user sees lives in the page; this file only sets up the window.

// No console window behind the app on Windows (release builds)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn toggle_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyF)
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// Ctrl+Shift+F: hide the overlay, or bring it back
fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let visible = w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false);
        if visible {
            let _ = w.hide();
        } else {
            show_main(app);
        }
    }
}

fn main() {
    tauri::Builder::default()
        // Starting the app again focuses the running one instead of opening a second window
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        // Remembers window position and size between runs
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Opens the release page in the normal browser
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if shortcut == &toggle_shortcut() && event.state() == ShortcutState::Pressed {
                        toggle_main(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // If another program already owns the shortcut, the app still runs without it
            if let Err(e) = app.global_shortcut().register(toggle_shortcut()) {
                eprintln!("Couldn't register Ctrl+Shift+F: {e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Frontier Overlay");
}
