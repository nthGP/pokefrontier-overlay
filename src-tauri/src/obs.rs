// OBS support.
//
// OBS can't show another program's window with a transparent background, but it can show a
// web page (a "Browser Source"). So the app runs a tiny web server on this computer only
// (127.0.0.1, unreachable from the network) that serves the same overlay page in a read-only
// "display" mode. The app window sends its current screen here after every click, and the page
// in OBS asks for it a few times a second.
//
//   http://127.0.0.1:7373/?view=display      the page for OBS
//   http://127.0.0.1:7373/state              what the app window currently shows (JSON)

use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Manager, State};
use tiny_http::{Header, Response, Server};

const PORTS: std::ops::RangeInclusive<u16> = 7373..=7377;

#[derive(Default)]
pub struct Mirror {
    // (version, JSON of the app window's state). The version goes up on every change.
    state: Mutex<(u64, String)>,
    port: Mutex<Option<u16>>,
}

/// Called by the app window after every change.
#[tauri::command]
pub fn set_overlay_state(state: String, mirror: State<'_, Arc<Mirror>>) {
    let mut current = mirror.state.lock().unwrap();
    if current.1 != state {
        current.0 += 1;
        current.1 = state;
    }
}

/// The address to paste into OBS, or None if no port was free.
#[tauri::command]
pub fn obs_url(mirror: State<'_, Arc<Mirror>>) -> Option<String> {
    mirror
        .port
        .lock()
        .unwrap()
        .map(|port| format!("http://127.0.0.1:{port}/?view=display"))
}

pub fn start_server(app: AppHandle, mirror: Arc<Mirror>) {
    for port in PORTS {
        if let Ok(server) = Server::http(("127.0.0.1", port)) {
            *mirror.port.lock().unwrap() = Some(port);
            thread::spawn(move || serve(server, app, mirror));
            return;
        }
    }
    eprintln!("OBS page disabled: ports 7373-7377 are all in use");
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).unwrap()
}

fn serve(server: Server, app: AppHandle, mirror: Arc<Mirror>) {
    for request in server.incoming_requests() {
        let path = request.url().split('?').next().unwrap_or("/").to_string();

        let (status, body, mime) = if path == "/state" {
            let current = mirror.state.lock().unwrap();
            let state = if current.1.is_empty() { "null" } else { current.1.as_str() };
            let json = format!("{{\"version\":{},\"state\":{}}}", current.0, state);
            (200, json.into_bytes(), "application/json".to_string())
        } else {
            // Everything else is one of the app's own files (the page, sprites map, bundled data)
            let file = if path == "/" { "/index.html".to_string() } else { path };
            match app.asset_resolver().get(file) {
                Some(asset) => (200, asset.bytes().to_vec(), asset.mime_type().to_string()),
                None => (404, b"Not found".to_vec(), "text/plain".to_string()),
            }
        };

        let response = Response::from_data(body)
            .with_status_code(status)
            .with_header(header("Content-Type", &mime))
            .with_header(header("Cache-Control", "no-store"));
        let _ = request.respond(response);
    }
}
