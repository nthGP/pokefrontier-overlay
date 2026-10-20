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

**Battle Tower, Arena and Palace** (same trainers and sets; each keeps its own streak)
1. Pick the facility, then **Singles** (3 Pokémon) or **Doubles** (4). Tower also has **Multi** (with an NPC partner)
   and **Co-op** (with another player): doubles against two trainers, 2 Pokémon each, and you bring 2.
2. Type the opponent's name (or class, or trainer number) and press Enter. In Multi / Co-op pick both opponents, one after the other.
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

**Auto mode** (fills everything in for you)
1. In PokeMMO, turn on the option to log chat to disk.
2. In the app, click **Auto**, tick **Follow the chat log**. The log folder is found by itself (normally
   `C:\Program Files\PokeMMO\log`); if not, paste the game's `log` folder and press Enter.
3. Play. When a trainer challenges you the app picks them (by their Tower number) and sets Singles or Doubles
   (two trainers at once switches to Multi unless you've set Co-op; your Multi partner's Pokémon are ignored); each
   Pokémon they send out is added and the moves they use are marked. Wins and losses go on the streak bar (untick
   **Count wins and losses on the streak** to do that by hand).
- Auto mode also rules sets out by what the log shows, or doesn't show. A line under the Pokémon's name says what it
  worked out:
  - **Abilities:** Intimidate, Pressure and Trace always announce themselves when the Pokémon comes in. If they don't,
    sets with that ability fade. If one does (or Sand Stream starts a sandstorm), sets with a different ability fade.
    In doubles, Intimidate doesn't say whose it is, so it's only pinned when just one of the two could have it.
  - **Choice items:** two different moves without switching out rules out Choice Band, Specs and Scarf.
    Sleep Talk's called moves, Struggle and Trick are ignored.
  - **Orbs:** a whole turn on the field with no status rules out Flame Orb and Toxic Orb. If it was already statused
    (say, you Toxic'd it first), nothing is ruled out. Items seen in the log (Life Orb, Gems, berries, Air Balloon,
    Focus Sash…) are applied too.
- Only battle messages are read. Team, whisper and global chat are skipped inside the app and never shown, saved or sent.
- Tower and Factory still come from the switch at the top: the log doesn't say which facility you're in.
- Everything stays clickable, so you can still fix anything by hand.

**Your team** (bottom of the overlay; **Team** in the bar hides it)
- **Tower:** click **Add a team** / **Edit teams**, give it a name and paste the team from Showdown (Export), or type it
  in the same format. Save as many teams as you like and pick one from the dropdown. Singles shows the first 3, doubles the first 4, Multi / Co-op the first 2.
- **Factory:** click **+ Add rental**, type the Pokémon and pick the set you rented (this round's sets come first).
  Click a rental to swap it after a battle.
- Teams are saved on your PC. Use the main-game item names (as in Showdown); every held item has an icon.

**OBS (streaming)**
1. In the app, click **OBS**. It copies an address like `http://127.0.0.1:7373/?view=display`.
2. In OBS: **Sources → + → Browser**, paste the address as the URL, set the width and height, OK.
3. That source now shows whatever the app shows, without the buttons and with a see-through background.
   Keep the app open while streaming; it's what feeds OBS. Set the source's **width and height to the box it goes in**
   (not a bigger size you then shrink): the overlay scales itself to fill that box without being cut off. To force a fixed
   size instead, add `&scale=0.8` to the address.
   **Theme → Stream panel opacity** lets your layout show through the panels.
4. **Opponent, team and streak in different places:** add a Browser Source for each, with `&part=opponent`,
   `&part=team` or `&part=streak` on the address (the OBS button lists all of them). Move and size each one wherever
   your layout needs it. Add `&cols=2` to the opponent's address to let it pick the number of sets per row that shows
   it biggest. The opponent's own source always fills its box: rows and tiles stretch, each Pokémon keeps a fixed row
   (3 in singles, 4 in doubles) and ones not sent out yet show as "?". The team's own source fills its box the same way,
   in one row or two, whichever is bigger (add `&fill=0` to either address to turn this off).

**Streak** (under your team in the app)
- **Won +1** after each win, **Lost** (click twice) when the streak ends, **Edit** to type the streak, your PB and the WR.
- Each facility, format and level keeps its own numbers. Passing your PB raises it.
- **View → Streak** hides the panel in the app; the OBS streak source keeps showing it.
- In Factory the round follows the streak (7 wins per round).

**Damage calc** (right-hand column; **Calc** in the bar hides it)
- **Ctrl+click** one of the opponent's set tiles to put that set in the calc, and **Ctrl+click** one of your team to
  put it on your side. The tiles in the calc get a dashed outline. You can also pick both from the dropdowns.
- Both move lists show the damage range and each side's speed; click any move to see its full calc and every roll.
- Each side can be edited like any damage calc: nature, item, ability, status (burn, paralysis…), HP %, IVs, EVs,
  boosts, the moves themselves, hits for multi-hit moves (Icicle Spear, Rock Blast…), crit per move, and that side's
  Reflect, Light Screen, Stealth Rock, Spikes, Tailwind, Protect (and Helping Hand / Friend Guard in Doubles).
  Weather and Gravity are at the top. The Stat column shows the real stat; speed includes Choice Scarf, paralysis,
  Tailwind and boosts.
- Changes stay with that Pokémon in the calc only (your team and the set data aren't touched). **Reset** puts the
  side back to the set as scouted.
- In auto mode it follows the battle: whoever is sent out on either side, stat changes the log reports ("…'s Attack rose!")
  and Haze. Your Pokémon are matched by nickname or species, so keep nicknames in your Showdown paste.
- Unscouted parts of a set (nature, item, ability, moves) are listed above the editors; a blank nature is calculated as neutral.
- On stream: a Browser Source with `&part=calc` the same size as the streak's, and switch scenes between them.
- Uses the PokeMMO damage calc engine (nthGP/pokemmo-damage-calc, based on Smogon's calc).

**Window layout**: wider than 1100 px, the app splits in two: the opponent on the left, your team, streak and calc on
the right, each scrolling on its own. Narrower, it's one column. None of this changes what OBS shows.

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
- **Auto mode:** `src-tauri/src/chatlog.rs` reads the newest `chat_*.log` from where it left off and passes on only
  `[Battle]` lines; `src/battlelog.js` turns them into events (challenge, sent out, foe move, won, lost).
- **OBS:** the app runs a tiny web server on `127.0.0.1` only (`src-tauri/src/obs.rs`, ports 7373–7377) that serves
  the same page with `?view=display`. The app window sends its state there after every change; the OBS page polls it.
- **Building:** the [Build workflow](.github/workflows/build.yml) builds the installer on GitHub for every push and
  pull request (download it from the run's *Artifacts*).
- **Releasing:** bump `version` in `src-tauri/tauri.conf.json` (and `package.json`) and merge. Then Actions → Build →
  *Run workflow* → tick *Publish a release* → *Run workflow*. It publishes release `v<version>` with the installer,
  and the app's Update button points users to it.

Building locally needs [Node.js](https://nodejs.org) and [Rust](https://rustup.rs): `npm install`, then `npm run dev`
(opens the app) or `npm run build` (makes the installer in `src-tauri/target/release/bundle/nsis/`).

Fan-made tool, not affiliated with PokeMMO. Pokémon is © Nintendo, Creatures and Game Freak. Pokémon sprites from veekun, item icons from the PokeAPI sprites repository and Smogon's sprites (Showdown).
