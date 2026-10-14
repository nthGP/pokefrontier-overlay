// Auto mode: follows PokeMMO's chat log (the game's own "log chat to disk" option) so the overlay can fill in
// the opponent by itself.
//
// Privacy: the log also holds team, whisper and global chat. Only [Battle] lines (and the wrapped second
// line of a long battle message) ever leave this file; everything else is skipped here and never reaches
// the page, OBS, or anywhere else. Nothing is written or sent.

use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

// Most that one call reads, so a huge log can't stall the app (the rest comes on the next calls)
const MAX_CHUNK: u64 = 4 * 1024 * 1024;

#[derive(Serialize)]
pub struct Chunk {
    /// Log file being followed (file name only)
    file: String,
    /// Where the next call should continue from
    offset: u64,
    /// True when this is a different file from the one asked for (new day, or first call):
    /// the lines then start at the top of that file
    restarted: bool,
    /// More is waiting (the read stopped at the size cap): call again straight away
    more: bool,
    /// Whether the last line read was a battle line, so a wrapped continuation in the next call is kept
    in_battle: bool,
    /// The [Battle] lines read, oldest first
    lines: Vec<String>,
}

/// Starts with "[dd/mm/yy H:MM:SS] " — a new message (anything else continues the previous one)
fn is_message_start(line: &str) -> bool {
    let b = line.as_bytes();
    b.first() == Some(&b'[') && b.get(1).map_or(false, |c| c.is_ascii_digit()) && line.contains("] [")
}

/// Keeps only battle lines. `in_battle` carries over between calls for wrapped messages.
pub fn battle_lines(text: &str, in_battle: &mut bool) -> Vec<String> {
    let mut out = Vec::new();
    for raw in text.split('\n') {
        let line = raw.trim_end_matches('\r');
        if is_message_start(line) {
            *in_battle = line.contains("] [Battle] ");
            if *in_battle {
                out.push(line.to_string());
            }
        } else if *in_battle && !line.is_empty() {
            out.push(line.to_string());
        }
    }
    out
}

/// Newest chat_*.log in the folder
fn newest_log(dir: &Path) -> Option<PathBuf> {
    fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let n = e.file_name().to_string_lossy().to_lowercase();
            n.starts_with("chat_") && n.ends_with(".log")
        })
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .max_by_key(|(t, _)| *t)
        .map(|(_, p)| p)
}

/// Reads what's new in the newest log since `offset` (only whole lines).
pub fn read_new(dir: &str, file: Option<String>, offset: u64, in_battle: bool) -> Result<Chunk, String> {
    let dir = Path::new(dir.trim());
    if !dir.is_dir() {
        return Err("folder not found".into());
    }
    let path = newest_log(dir).ok_or("no chat log in that folder yet")?;
    let name = path.file_name().unwrap().to_string_lossy().to_string();
    let len = fs::metadata(&path).map_err(|e| e.to_string())?.len();

    // A different file (new day / first call) or a shorter one (log cleared): start from its top
    let restarted = file.as_deref() != Some(name.as_str()) || offset > len;
    let start = if restarted { 0 } else { offset };
    let mut in_battle = if restarted { false } else { in_battle };

    let want = (len - start).min(MAX_CHUNK);
    let mut buf = Vec::with_capacity(want as usize);
    let mut f = File::open(&path).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    f.take(want).read_to_end(&mut buf).map_err(|e| e.to_string())?;

    // Stop after the last full line; a line still being written is read next time
    let end = buf.iter().rposition(|&c| c == b'\n').map_or(0, |i| i + 1);
    let text = String::from_utf8_lossy(&buf[..end]);
    let lines = battle_lines(&text, &mut in_battle);
    let more = start + want < len;
    Ok(Chunk { file: name, offset: start + end as u64, restarted, more, in_battle, lines })
}

/// First folder that exists out of the usual install places
pub fn guess_dir() -> Option<String> {
    let mut candidates = vec![
        PathBuf::from(r"C:\Program Files\PokeMMO\log"),
        PathBuf::from(r"C:\Program Files (x86)\PokeMMO\log"),
    ];
    for var in ["LOCALAPPDATA", "APPDATA", "USERPROFILE"] {
        if let Ok(base) = std::env::var(var) {
            candidates.push(Path::new(&base).join("PokeMMO").join("log"));
            candidates.push(Path::new(&base).join("Programs").join("PokeMMO").join("log"));
        }
    }
    candidates.into_iter().find(|p| p.is_dir()).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_chat_log(dir: String, file: Option<String>, offset: u64, in_battle: bool) -> Result<Chunk, String> {
    read_new(&dir, file, offset, in_battle)
}

#[tauri::command]
pub fn guess_chat_log_dir() -> Option<String> {
    guess_dir()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_battle_lines_and_their_wraps() {
        let text = "[14/10/26 9:38:18] [Battle] You are challenged by X[042]!\r\n\
                    [14/10/26 9:38:19] [Team] Mist: hi\r\n\
                    a wrapped team line\r\n\
                    [14/10/26 9:38:33] [Battle] The foe's Gulpin used\r\n\
                    Water Pulse! ( Psycho -100% )\r\n";
        let mut b = false;
        let lines = battle_lines(text, &mut b);
        assert_eq!(lines.len(), 3);
        assert!(lines.iter().all(|l| !l.contains("Mist") && !l.contains("team line")));
        assert!(b);
    }
}
