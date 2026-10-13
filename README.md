# Frontier Overlay

A small always-on-top window for PokeMMO's Battle Tower and Battle Factory. Type the opponent's name, pick the
Pokémon they send out, and see every set it can be running: item, nature, ability, EVs and moves, coloured by type.

Data comes live from [pokefrontier.egpr.cloud](https://pokefrontier.egpr.cloud), the community's trainer pool and set database.

## Install

1. Open the [latest release](https://github.com/nthGP/pokefrontier-overlay/releases/latest).
2. Download `Frontier.Overlay_<version>_x64-setup.exe` and run it.
3. Windows may show **"Windows protected your PC"** because the app isn't code-signed. Click **More info** → **Run anyway**.

Windows 10 or 11. The app is about 5 MB and installs for your user only (no admin needed).
When a new version is out, an **Update** button appears in the top bar.

## Use

**Battle Tower**
1. Pick **Singles** (3 Pokémon) or **Doubles** (4).
2. Type the opponent's name (or class, or trainer number) and press Enter.
3. Click the Pokémon they send out, or type its name in *Add Pokémon…* and press Enter.
   Each row shows only the sets that trainer can bring.

**Battle Factory**
1. Pick **Lv 50** or **Lv 100** and the round (press **+** after each win).
2. Type the opponent's Pokémon. Only the sets that can appear in that round are shown.

**During the battle**
- **Click a move** when the opponent uses it. Sets that can't have that move fade out. Sets with unscouted move slots
  that could still have it fade halfway.
- **Click a set** to lock it in once you know which one it is.
- **Esc** or **Clear** starts the next battle.

**Your team** (bottom of the overlay; **Team** in the bar hides it)
- **Tower:** click **Add a team** / **Edit teams**, give it a name and paste the team from Showdown (Export), or type it
  in the same format. Save as many teams as you like and pick one from the dropdown. Singles shows the first 3, doubles the first 4.
- **Factory:** click **+ Add rental**, type the Pokémon and pick the set you rented (this round's sets come first).
  Click a rental to swap it after a battle.
- Teams are saved on your PC. PokeMMO's renamed items (e.g. Assault Gear) get the right icon.

**OBS (streaming)**
1. In the app, click **OBS**. It copies an address like `http://127.0.0.1:7373/?view=display`.
2. In OBS: **Sources → + → Browser**, paste the address as the URL, set the size (e.g. 1000 × 900), OK.
3. That source now shows whatever the app shows, without the buttons and with a see-through background.
   Keep the app open while streaming; it's what feeds OBS. Add `&scale=0.8` to the end of the address to shrink it.
   **Theme → Stream panel opacity** lets your layout show through the panels.

**Theme**: click **Theme** for six presets, or pick your own accent and background colours.

**Window**
- **Ctrl+Shift+F** hides or shows the overlay from anywhere, including in-game.
- **Pin** keeps it on top of the game. This works in windowed and borderless mode, not exclusive fullscreen.
- Drag it by the empty part of the top bar. **A− / A+** (or Ctrl −/+) change the size.

"Unknown" or "?" means that part of the set hasn't been scouted yet, never a guess.

## How it works (for contributors)

The window is a [Tauri](https://tauri.app) app: a tiny Rust program (`src-tauri/`) that opens a window using the web
engine built into Windows and shows `src/index.html`. All the features are in that one page.

- **Data:** on every start the page downloads `trainers.json`, `sets.json` and `dex.json` from the site and saves a copy,
  so it keeps working offline. A snapshot is also bundled into each build for a first offline start.
  Set *contents* change on the site nightly; the app never needs a new version for data changes.
- **OBS:** the app runs a tiny web server on `127.0.0.1` only (`src-tauri/src/obs.rs`, ports 7373–7377) that serves
  the same page with `?view=display`. The app window sends its state there after every change; the OBS page polls it.
- **Building:** the [Build workflow](.github/workflows/build.yml) builds the installer on GitHub for every push and
  pull request (download it from the run's *Artifacts*).
- **Releasing:** bump `version` in `src-tauri/tauri.conf.json` (and `package.json`) and merge. Then Actions → Build →
  *Run workflow* → tick *Publish a release* → *Run workflow*. It publishes release `v<version>` with the installer,
  and the app's Update button points users to it.

Building locally needs [Node.js](https://nodejs.org) and [Rust](https://rustup.rs): `npm install`, then `npm run dev`
(opens the app) or `npm run build` (makes the installer in `src-tauri/target/release/bundle/nsis/`).

Fan-made tool, not affiliated with PokeMMO. Pokémon is © Nintendo, Creatures and Game Freak. Pokémon sprites from veekun, item icons from the PokeAPI sprites repository.
