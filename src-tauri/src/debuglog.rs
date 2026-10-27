// Debug log for auto mode (see src/debuglog.js for what's in it and what's kept out).
//
// The page keeps the last 20 Frontier battles; this file only stores them between runs, in the app's own data
// folder (debug-log.json, overwritten each time), and writes a copy the user can send when they ask for one.
// Nothing is ever sent anywhere by the app.

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const STORE: &str = "debug-log.json";

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(STORE))
}

/// The stored battles (JSON), or nothing on a first run
#[tauri::command]
pub fn debug_log_load(app: AppHandle) -> Option<String> {
    fs::read_to_string(store_path(&app).ok()?).ok()
}

#[tauri::command]
pub fn debug_log_save(app: AppHandle, contents: String) -> Result<(), String> {
    let path = store_path(&app)?;
    // Write a temp file and swap it in, so a crash mid-write can't leave half a file
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Saves the file to send in Downloads (or the Desktop / home folder), shows it in Explorer,
/// and returns where it went
#[tauri::command]
pub fn debug_log_export(app: AppHandle, contents: String, name: String) -> Result<String, String> {
    // Only a plain file name from the page, never a path
    let name: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || "-_.".contains(*c)).collect();
    if name.is_empty() || !name.ends_with(".json") {
        return Err("bad file name".into());
    }
    let p = app.path();
    let dir = p.download_dir().or_else(|_| p.desktop_dir()).or_else(|_| p.home_dir()).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    fs::write(&path, contents).map_err(|e| e.to_string())?;
    let _ = tauri_plugin_opener::reveal_item_in_dir(&path);
    Ok(path.to_string_lossy().to_string())
}
