// Turns PokeMMO chat-log [Battle] lines into battle events for auto mode.
// The app (src-tauri/src/chatlog.rs) only ever hands this file [Battle] lines; nothing else from the log.
//
// Line format (game log, 2026-10): "[dd/mm/yy H:MM:SS] [Battle] message", names wrapped in colour tags
// like "[#ff8a00]Gulpin[#]". A long message wraps onto a following line that has no timestamp.
//
// Events:
//   { type: 'challenge', trainer: 'Youngster CONNER', index: 2, trainers: [{ name, index }, ...] }  (2 in Multi/Co-op)
//       Not every player's log shows the trainer number: "You are challenged by Youngster CONNER!" gives index null
//       and the app finds the trainer by class and name.
//   { type: 'sentOut', who: 'Youngster CONNER', names: [...] }   (a send-out without a trainer number: the app decides
//                                                                 whose it is by comparing "who" with the challenger)
//   { type: 'foeSentOut', index: 2, species: ['Igglybuff', 'Slugma'] }
//   { type: 'foeMove', species: 'Gulpin', move: 'Water Pulse' }
//   { type: 'foeItem', species: 'Crobat', item: 'Life Orb' }   (any "The foe's X ... its ITEM!" message)
//   { type: 'won', index: 66 } / { type: 'lost', index: 42 }
//   { type: 'mySentOut', names: ['Skarmory'] }    (your side; names can be nicknames)
//   { type: 'boost', foe: false, name: 'Skarmory', stats: ['atk', 'def'], by: 1 }
//   { type: 'boost', foe: true, name: 'Marowak', stats: ['atk'], set: 6 }   (Belly Drum)
//   { type: 'clearBoosts' }   (Haze)
//   { type: 'turn', n: 3 }                                   ("Turn 3 started!")
//   { type: 'myMove', move: 'Toxic' }                        (your side used a move; name can be a nickname)
//   { type: 'foeWithdrew', index: 245, species: 'Crobat' }
//   { type: 'foeFainted', species: 'Crobat' }
//   { type: 'foeStatus', species: 'Tyranitar', status: 'tox' }        (tox / psn / brn / par / slp / frz)
//   { type: 'foeAbility', species: 'Aerodactyl', ability: 'Pressure' } (species null when the log doesn't name it:
//                                                                      "Your team's Attack fell!" = Intimidate)
//   { type: 'itemNoOwner', item: 'Bug Gem' }   ("The Bug Gem strengthened Bug Bite's power!": whoever just moved)
(function (root) {
    const STAMP = /^\[\d{1,2}\/\d{1,2}\/\d{2,4} \d{1,2}:\d{2}:\d{2}\] \[Battle\] ?/;

    const clean = s => s.replace(/\[#[0-9a-fA-F]*\]/g, '').replace(/\s+/g, ' ').trim();
    // Player Pokémon can show as "Alpha X" or "☆Shiny X☆"; strip both just in case
    const monName = s => clean(s).replace(/☆/g, '').replace(/^(Alpha|Shiny)\s+/i, '').replace(/^(Alpha|Shiny)\s+/i, '').trim();

    // Joins wrapped lines back onto their message and drops the timestamp/channel
    function messages(lines) {
        const out = [];
        for (const raw of lines) {
            const line = String(raw).replace(/\r$/, '');
            if (STAMP.test(line)) out.push(line.replace(STAMP, ''));
            else if (out.length && line.trim()) out[out.length - 1] += ' ' + line.trim();
        }
        return out.map(clean).filter(Boolean);
    }

    const STAT = { 'attack': 'atk', 'defense': 'def', 'sp. atk': 'spa', 'special attack': 'spa', 'sp. def': 'spd',
                   'special defense': 'spd', 'speed': 'spe' };
    const AMOUNT = { 'rose': 1, 'sharply rose': 2, 'rose sharply': 2, 'rose drastically': 3, 'drastically rose': 3,
                     'fell': -1, 'harshly fell': -2, 'fell harshly': -2, 'severely fell': -3, 'fell severely': -3 };

    // Weather that starts with no move: the setter's ability. Only the sandstorm text is seen in logs so far;
    // the other three are the usual game texts (not yet seen in PokeMMO).
    const WEATHER = { 'A sandstorm kicked up!': 'Sand Stream', 'It started to rain!': 'Drizzle',
                      'The sunlight turned harsh!': 'Drought', 'It started to hail!': 'Snow Warning' };

    // "...its ꀅLife Orb (ATK)!" -> "Life Orb". Item names in battle text start with an icon glyph (Yi block).
    function itemIn(m) {
        const r = m.match(/[\ua000-\ua4cf]([^!()\ua000-\ua4cf]+?)\s*(?:\([^)]*\))?(?:!|$|\s+(?:strengthened|weakened|popped))/);
        return r ? r[1].trim() : null;
    }

    function parse(lines) {
        const events = [];
        for (const m of messages(lines)) {
            let r;
            if ((r = m.match(/^You are challenged by (.+\[\d+\])!$/))) {
                // One trainer, or two in Multi / Co-op ("A[012] and B[034]")
                const trainers = [...r[1].matchAll(/(?:^| and )(.+?)\[(\d+)\]/g)].map(x => ({ name: x[1].trim(), index: +x[2] }));
                events.push({ type: 'challenge', trainer: trainers[0].name, index: trainers[0].index, trainers });
            } else if ((r = m.match(/^You are challenged by (.+)!$/))) {
                const trainers = r[1].split(' and ').map(x => ({ name: x.trim(), index: null }));
                events.push({ type: 'challenge', trainer: trainers[0].name, index: null, trainers });
            } else if ((r = m.match(/^(.+?)\[(\d+)\] (?:has|have) defeated (.+)!$/))) {
                events.push({ type: 'lost', index: +r[2] });
            } else if ((r = m.match(/^.+ defeated (.+?)\[(\d+)\]!$/))) {
                events.push({ type: 'won', index: +r[2] });
            } else if ((r = m.match(/^(.+?) (?:has|have) defeated (.+)!$/))) {
                events.push({ type: 'lost', index: null, name: r[1] });
            } else if ((r = m.match(/^.+? defeated (.+)!$/))) {
                events.push({ type: 'won', index: null, name: r[1] });
            } else if ((r = m.match(/^(.+?)\[(\d+)\] sent out (.+)!$/))) {
                events.push({ type: 'foeSentOut', index: +r[2], species: r[3].split(' and ').map(monName).filter(Boolean) });
            } else if ((r = m.match(/^Go! (.+)!$/))) {
                events.push({ type: 'mySentOut', names: r[1].split(' and ').map(monName).filter(Boolean) });
            } else if ((r = m.match(/^([^\[]+?) sent out (.+)!$/))) {
                events.push({ type: 'sentOut', who: clean(r[1]), names: r[2].split(' and ').map(monName).filter(Boolean) });
            } else if (m === "Your team's Attack fell!") {
                // Intimidate: the log doesn't say whose (seen 2026-10-18/19 right after the foe's send-out)
                events.push({ type: 'foeAbility', species: null, ability: 'Intimidate' });
                events.push({ type: 'boost', foe: false, name: 'Your team', stats: ['atk'], by: -1 });
            } else if (m === 'All stat changes were eliminated!') {
                events.push({ type: 'clearBoosts' });
            } else if ((r = m.match(/^(The foe's )?(.+?) cut its own HP and maximized its Attack!$/))) {
                events.push({ type: 'boost', foe: !!r[1], name: monName(r[2]), stats: ['atk'], set: 6 });
            } else if ((r = m.match(/^(The foe's )?(.+?)'s ((?:Attack|Defense|Sp\. Atk|Sp\. Def|Speed|Special Attack|Special Defense)(?:(?:, | and )(?:Attack|Defense|Sp\. Atk|Sp\. Def|Speed|Special Attack|Special Defense))*) ((?:sharply |harshly |severely |drastically )?(?:rose|fell)(?: sharply| harshly| severely| drastically)?)!$/))) {
                const stats = r[3].split(/, | and /).map(x => STAT[x.toLowerCase()]).filter(Boolean);
                if (stats.length && AMOUNT[r[4]]) events.push({ type: 'boost', foe: !!r[1], name: monName(r[2]), stats, by: AMOUNT[r[4]] });
            } else if ((r = m.match(/^Turn (\d+) started!$/))) {
                events.push({ type: 'turn', n: +r[1] });
            } else if ((r = m.match(/^(.+?)\[(\d+)\] withdrew (.+)!$/))) {
                events.push({ type: 'foeWithdrew', index: +r[2], species: monName(r[3]) });
            } else if ((r = m.match(/^([^\[]+?) withdrew (.+)!$/))) {
                events.push({ type: 'foeWithdrew', index: null, species: monName(r[2]) });    // our own switch reads "X, come back!"
            } else if ((r = m.match(/^The foe's (.+?) fainted!$/))) {
                events.push({ type: 'foeFainted', species: monName(r[1]) });
            } else if ((r = m.match(/^The foe's (.+?) used (.+?)!(?: \(.*\))?$/))) {
                events.push({ type: 'foeMove', species: monName(r[1]), move: clean(r[2]) });
            } else if ((r = m.match(/^The foe's (.+?) is exerting its pressure!$/i))) {
                events.push({ type: 'foeAbility', species: monName(r[1]), ability: 'Pressure' });
            } else if ((r = m.match(/^The foe's (.+?) traced .+?'s (.+?)!$/))) {
                events.push({ type: 'foeAbility', species: monName(r[1]), ability: 'Trace' });
            } else if ((r = m.match(/^The foe's (.+?) breaks the mold!$/))) {
                events.push({ type: 'foeAbility', species: monName(r[1]), ability: 'Mold Breaker' });
            } else if (WEATHER[m]) {
                // Weather from an ability (no move used): only meaningful right after a send-out, the app checks that
                events.push({ type: 'weather', ability: WEATHER[m] });
            } else if ((r = m.match(/^[^\[]+? used (.+?)!(?: \(.*\))?$/)) && !m.startsWith("The foe's ")) {
                events.push({ type: 'myMove', move: clean(r[1]) });
            } else {
                // Item messages: the item name carries an icon character (private-use glyph) and often a tag: "ꀅLife Orb (ATK)"
                const it = itemIn(m);
                if (!it && (r = m.match(/^The foe's (.+?)(?:'s (.+?) popped| (?:is|was|restored|ate|consumed|held|became|floats|hung).* its (.+?))!$/))) {
                    // Some item texts come without the icon glyph ("floats in the air with its Air Balloon!")
                    const item = (r[2] || r[3]).replace(/[^\x20-\x7e\u00c0-\u024f]/g, '').replace(/\s*\([A-Z]+\)\s*$/, '').trim();
                    if (item && !item.includes("'s ")) events.push({ type: 'foeItem', species: monName(r[1]), item });
                }
                if (it) {
                    if ((r = m.match(/^The foe's (.+?)(?:'s | is | was | restored | ate | consumed | held | became | floats | hung )/))) {
                        events.push({ type: 'foeItem', species: monName(r[1]), item: it });
                    } else if ((r = m.match(/the foe's (.+?)!$/))) {
                        events.push({ type: 'foeItem', species: monName(r[1]), item: it });       // "The Chople Berry weakened the damage to the foe's Blissey!"
                    } else if (/^The .+ strengthened .+'s power!$/.test(m)) {
                        events.push({ type: 'itemNoOwner', item: it });                         // Gems: whoever just moved
                    }
                }
            }
            // A status line can also carry its cause ("was burned by ꈆFlame Orb"), so it's checked on its own
            if ((r = m.match(/^The foe's (.+?) (was badly poisoned|was poisoned|was burned|is paralyzed|was paralyzed|fell asleep|was frozen)/))) {
                const st = { 'was badly poisoned': 'tox', 'was poisoned': 'psn', 'was burned': 'brn', 'is paralyzed': 'par', 'was paralyzed': 'par', 'fell asleep': 'slp', 'was frozen': 'frz' }[r[2]];
                events.push({ type: 'foeStatus', species: monName(r[1]), status: st });
            }
        }
        return events;
    }

    // The game writes a long message as two lines, and they can land in different reads of the log.
    // The reader holds back the newest message until the next one starts (or nothing more comes for a moment).
    function reader(waitMs = 1200) {
        let pending = [], lastNew = 0;
        return function push(lines, now = Date.now()) {
            if (lines.length) lastNew = now;
            const all = pending.concat(lines);
            let last = -1;
            for (let i = 0; i < all.length; i++) if (STAMP.test(String(all[i]))) last = i;
            if (last <= 0 && !lines.length && all.length && now - lastNew >= waitMs) { pending = []; return parse(all); }
            if (last <= 0) { pending = all; return []; }
            pending = all.slice(last);
            return parse(all.slice(0, last));
        };
    }


    // ------------------------------------------------------------
    // Set inference from what the log shows (and doesn't show).
    // tracker({ abilitiesOf(species) -> [ability|null per possible set], typesOf(species) -> ['Fire', ...] })
    // .event(e) takes the events above in order and returns facts for the app to apply to its picks:
    //   { species, ability }            the log showed this ability
    //   { species, noAbility: [...] }   an ability that announces itself on entry, and it didn't
    //   { species, item }               an item seen without a "The foe's X" message (Gems)
    //   { species, noItem: [...] }      Choice items (two different moves without switching), Orbs (a full turn, no status)
    // Entry announcements verified in PokeMMO logs (2026-10): Intimidate ("Your team's Attack fell!"),
    // Pressure ("is exerting its pressure!"), Trace ("traced X's Y!"), Sand Stream ("A sandstorm kicked up!").
    const ANNOUNCED = ['Intimidate', 'Pressure', 'Trace'];          // absence rules these out
    const CHOICE = ['Choice Band', 'Choice Specs', 'Choice Scarf'];
    const CALLERS = new Set(['Sleep Talk', 'Metronome', 'Assist', 'Copycat', 'Mirror Move', 'Me First', 'Nature Power']);
    const SWAPS = new Set(['Trick', 'Switcheroo']);
    const OUR_ITEM_MOVES = new Set(['Trick', 'Switcheroo', 'Knock Off', 'Thief', 'Covet', 'Bug Bite', 'Pluck', 'Incinerate']);

    function tracker(opts) {
        const abilitiesOf = opts.abilitiesOf || (() => []);
        const typesOf = opts.typesOf || (() => []);
        const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        let mons, entry, turnSeen, faintedThisTurn, lastMove;
        const reset = () => { mons = new Map(); entry = null; turnSeen = false; faintedThisTurn = false; lastMove = null; };
        reset();
        const mon = sp => mons.get(key(sp));
        const couldHave = (sp, ab) => abilitiesOf(sp).some(a => a === null || key(a) === key(ab));

        function closeEntry(out) {
            if (!entry) return;
            const e = entry; entry = null;
            // Intimidate: the message doesn't name the Pokémon. Pin it only when one newcomer could have it.
            if (e.intimidate) {
                const cands = e.species.filter(sp => couldHave(sp, 'Intimidate'));
                if (cands.length === 1) out.push({ species: cands[0], ability: 'Intimidate' });
                for (const sp of e.species) if (!cands.includes(sp)) out.push({ species: sp, noAbility: ['Intimidate'] });
            }
            for (const w of e.weather) {
                const cands = e.species.filter(sp => abilitiesOf(sp).some(a => a && key(a) === key(w)));
                if (cands.length === 1) out.push({ species: cands[0], ability: w });
            }
            for (const sp of e.species) {
                const seen = e.named.get(key(sp)) || new Set();
                for (const ab of seen) out.push({ species: sp, ability: ab });
                const absent = ANNOUNCED.filter(ab => !seen.has(ab) && !(ab === 'Intimidate' && e.intimidate));
                if (absent.length) out.push({ species: sp, noAbility: absent });
            }
        }

        function event(ev) {
            const out = [];
            switch (ev.type) {
                case 'challenge': reset(); break;
                case 'won': case 'lost': closeEntry(out); reset(); break;
                case 'foeSentOut':
                    if (!entry) entry = { species: [], named: new Map(), intimidate: 0, weather: [] };
                    for (const sp of ev.species) {
                        entry.species.push(sp);
                        // Orb timing: a lead or a replacement after a faint arrives after this turn's end-of-turn effects;
                        // a mid-turn switch-in is there for them
                        mons.set(key(sp), { species: sp, active: true, armed: turnSeen && !faintedThisTurn,
                                            statused: (mon(sp) || {}).statused || false, first: null, calling: false, swapped: (mon(sp) || {}).swapped || false, choiceOut: (mon(sp) || {}).choiceOut || false });
                    }
                    break;
                case 'foeWithdrew': { const m = mon(ev.species); if (m) m.active = false; break; }
                case 'foeFainted': { const m = mon(ev.species); if (m) m.active = false; faintedThisTurn = true; break; }
                case 'foeAbility':
                    if (ev.species) {
                        if (entry && entry.species.some(sp => key(sp) === key(ev.species))) {
                            const set = entry.named.get(key(ev.species)) || new Set(); set.add(ev.ability); entry.named.set(key(ev.species), set);
                        } else out.push({ species: ev.species, ability: ev.ability });
                    } else if (ev.ability === 'Intimidate' && entry) entry.intimidate++;
                    break;
                case 'weather': if (entry) entry.weather.push(ev.ability); break;
                case 'foeStatus': { const m = mon(ev.species); if (m) m.statused = true; break; }
                case 'turn':
                    closeEntry(out);
                    for (const m of mons.values()) {
                        if (!m.active) continue;
                        // It has been through a whole end of turn with no status: no Orb (unless it can't be statused by it)
                        if (m.armed && !m.statused && !m.swapped && !m.orbOut) {
                            const t = typesOf(m.species);
                            const orbs = [];
                            if (!t.includes('Fire')) orbs.push('Flame Orb');
                            if (!t.includes('Poison') && !t.includes('Steel')) orbs.push('Toxic Orb');
                            if (orbs.length) out.push({ species: m.species, noItem: orbs });
                            m.orbOut = true;
                        }
                        m.armed = true;
                    }
                    turnSeen = true; faintedThisTurn = false;
                    break;
                case 'myMove':
                    closeEntry(out);
                    // Our Trick / Knock Off / Thief: the foe's item may have changed, stop guessing about it
                    if (OUR_ITEM_MOVES.has(ev.move)) for (const m of mons.values()) if (m.active) m.swapped = true;
                    lastMove = { foe: false };
                    break;
                case 'foeMove': {
                    closeEntry(out);
                    const m = mon(ev.species);
                    lastMove = { foe: true, species: ev.species };
                    if (!m) break;
                    if (/^struggle$/i.test(ev.move)) break;
                    if (m.calling) { m.calling = false; break; }          // the move Sleep Talk & co. called
                    if (CALLERS.has(ev.move)) m.calling = true;
                    if (m.swapped) break;
                    if (m.first === null) m.first = ev.move;
                    else if (key(m.first) !== key(ev.move) && !m.choiceOut) { m.choiceOut = true; out.push({ species: m.species, noItem: CHOICE }); }
                    if (SWAPS.has(ev.move)) m.swapped = true;
                    break;
                }
                case 'itemNoOwner':
                    if (lastMove && lastMove.foe) out.push({ species: lastMove.species, item: ev.item });
                    break;
            }
            return out;
        }
        return { event };
    }

    const api = { parse, messages, reader, tracker };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.BattleLog = api;
})(this);
