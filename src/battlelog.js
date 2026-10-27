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
//   { type: 'foeMove', species: 'Gulpin', move: 'Water Pulse', hit: true }   (hit: the line shows the damage it did,
//                                                                        "( Psycho -100% )"; heal: it shows a heal,
//                                                                        "( Starmie +42,5% )")
//   { type: 'moveFailed' }   ("But it failed!", "avoided the attack!", "missed", "It doesn't affect", "protected itself!")
//   { type: 'foeItem', species: 'Crobat', item: 'Life Orb' }   (any "The foe's X ... its ITEM!" message)
//   { type: 'won', index: 66 } / { type: 'lost', index: 42 }
//   { type: 'mySentOut', names: ['Skarmory'] }    (your side; names can be nicknames)
//   { type: 'boost', foe: false, name: 'Skarmory', stats: ['atk', 'def'], by: 1 }
//   { type: 'boost', foe: true, name: 'Marowak', stats: ['atk'], set: 6 }   (Belly Drum)
//   { type: 'clearBoosts' }   (Haze)
//   { type: 'turn', n: 3 }                                   ("Turn 3 started!")
//   { type: 'myMove', move: 'Toxic', hits: [{ name: 'Dugtrio', pct: 99 }] }
//                                                            (your side used a move; name can be a nickname. hits: the
//                                                            "( Dugtrio -99% )" part, damage as % of the target's max HP)
//   { type: 'foeWithdrew', index: 245, species: 'Crobat' }
//   { type: 'foeFainted', species: 'Crobat' }
//   { type: 'foeHurt', species: 'Starmie', eot: true }   (poison, burn, sandstorm, hail: end of turn; eot false:
//                                                        "Pointed stones dug into the foe's X!" on entry)
//   { type: 'foeHealed', species: 'Wailord' }            ("The foe's X had its HP restored." after Rest, a berry...)
//   { type: 'cured', name: 'Starmie' }                   ("Starmie was cured of its poisoning.": Natural Cure on the way
//                                                        out, or Rest; no "The foe's", so it can be either side)
//   { type: 'foeStatus', species: 'Tyranitar', status: 'tox' }        (tox / psn / brn / par / slp / frz)
//   { type: 'foeAbility', species: 'Aerodactyl', ability: 'Pressure' } (species null when the log doesn't name it:
//                                                                      "Your team's Attack fell!" = Intimidate;
//                                                                      also Sturdy: "hung on using its Sturdy!")
//   { type: 'itemNoOwner', item: 'Bug Gem', move: 'Bug Bite' }   ("The Bug Gem strengthened Bug Bite's power!": no owner named)
(function (root) {
    // "[21/10/26 22:59:01] [Battle] ..." — the clock follows the player's system settings, so it can also be
    // 12-hour ("[21/10/26 4:38:45 pm]", "PM", "p. m.") or use another date order/separator. Only the time is required.
    const STAMP = /^\[[^\]]*?\d{1,2}:\d{2}(?::\d{2})?[^\]]*\] \[Battle\] ?/;

    const clean = s => s.replace(/\[#[0-9a-fA-F]*\]/g, '').replace(/\s+/g, ' ').trim();
    // Player Pokémon can show as "Alpha X" or "☆Shiny X☆"; strip both just in case
    const monName = s => clean(s).replace(/☆/g, '').replace(/^(Alpha|Shiny)\s+/i, '').replace(/^(Alpha|Shiny)\s+/i, '').trim();

    // Some players add their own tags after a trainer's name, e.g. the IV tier: "Pokefan PEYTON[037](9iv)".
    // Drop a bracketed tag right after the Tower number, and an "(N iv)" tag anywhere it sits glued to a name.
    const stripTags = m => m.replace(/(\[\d+\])\s*\([^)]*\)/g, '$1').replace(/(\S)\(\d+\s*ivs?\)/gi, '$1');

    // Joins wrapped lines back onto their message and drops the timestamp/channel
    function messages(lines) {
        const out = [];
        for (const raw of lines) {
            const line = String(raw).replace(/\r$/, '');
            if (STAMP.test(line)) out.push(line.replace(STAMP, ''));
            else if (out.length && line.trim()) out[out.length - 1] += ' ' + line.trim();
        }
        return out.map(clean).map(stripTags).filter(Boolean);
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
        const r = m.match(/[\ua000-\ua4cf]([^!()\ua000-\ua4cf]+?)\s*(?:\([^)]*\))?(?:!|$|\s+(?:strengthened|weakened|popped))/)
               // a tagged name with more text after it: "'s ꀇLum Berry (Status) cured its poison!"
               || m.match(/[\ua000-\ua4cf]([^!()\ua000-\ua4cf]+?)\s*\([^)]*\)/);
        return r ? r[1].trim() : null;
    }

    // "( Dugtrio -99% )" / "( Poliwhirl -100%, Poliwhirl -100% )" (decimal comma: "-99,2%") -> [{ name, pct }]
    function damageList(s) {
        if (!s) return [];
        return [...s.matchAll(/([^,()]+?)\s+-(\d+(?:[.,]\d+)?)%/g)].map(x => ({ name: monName(x[1]), pct: parseFloat(x[2].replace(',', '.')) }));
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
            } else if ((r = m.match(/^The foe's (.+?) (?:was hurt by (?:poison|its burn)|is buffeted by the sandstorm|is pelted by hail)!$/))) {
                events.push({ type: 'foeHurt', species: monName(r[1]), eot: true });
            } else if ((r = m.match(/^Pointed stones dug into the foe's (.+?)!$/))) {
                events.push({ type: 'foeHurt', species: monName(r[1]), eot: false });
            } else if ((r = m.match(/^The foe's (.+?) had its HP restored\.?$/))) {
                events.push({ type: 'foeHealed', species: monName(r[1]) });
            } else if ((r = m.match(/^(?!The foe's )(.+?) was cured of its (?:poisoning|burn|paralysis|sleep|freezing|freeze)\.?!?$/))) {
                events.push({ type: 'cured', name: monName(r[1]) });
            } else if ((r = m.match(/^The foe's (.+?) used (.+?)!(?: \((.*)\))?$/))) {
                events.push({ type: 'foeMove', species: monName(r[1]), move: clean(r[2]), hit: /-\d/.test(r[3] || ''), heal: /\+\d/.test(r[3] || '') });
            } else if ((r = m.match(/^The foe's (.+?) (foresaw an attack|chose Doom Desire as its destiny)!$/))) {
                // Moves the log reports without "used"
                events.push({ type: 'foeMove', species: monName(r[1]), move: r[2] === 'foresaw an attack' ? 'Future Sight' : 'Doom Desire', hit: false });
            } else if (/^But it failed!$|avoided the attack!$|attack missed!$| missed!$|^It doesn't affect |protected itself!$/.test(m)) {
                events.push({ type: 'moveFailed' });
            } else if ((r = m.match(/^The foe's (.+?) is exerting its pressure!$/i))) {
                events.push({ type: 'foeAbility', species: monName(r[1]), ability: 'Pressure' });
            } else if ((r = m.match(/^The foe's (.+?) traced .+?'s (.+?)!$/))) {
                events.push({ type: 'foeAbility', species: monName(r[1]), ability: 'Trace' });
            } else if ((r = m.match(/^The foe's (.+?) hung on using its Sturdy!$/))) {
                // Same wording as Focus Sash ("hung on using its ꌀFocus Sash"), but an ability, with no item glyph
                events.push({ type: 'foeAbility', species: monName(r[1]), ability: 'Sturdy' });
            } else if ((r = m.match(/^The foe's (.+?) breaks the mold!$/))) {
                events.push({ type: 'foeAbility', species: monName(r[1]), ability: 'Mold Breaker' });
            } else if (WEATHER[m]) {
                // Weather from an ability (no move used): only meaningful right after a send-out, the app checks that
                events.push({ type: 'weather', ability: WEATHER[m] });
            } else if ((r = m.match(/^[^\[]+? used (.+?)!(?: \((.*)\))?$/)) && !m.startsWith("The foe's ")) {
                events.push({ type: 'myMove', move: clean(r[1]), hits: damageList(r[2]) });
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
                    } else if ((r = m.match(/the foe's (.+?)(?:'s .*)?!$/))) {   // also "raised the foe's X's Speed!" 
                        events.push({ type: 'foeItem', species: monName(r[1]), item: it });       // "The Chople Berry weakened the damage to the foe's Blissey!"
                    } else if ((r = m.match(/^The .+ strengthened (.+)'s power!$/))) {
                        events.push({ type: 'itemNoOwner', item: it, move: r[1].trim() });       // Gems: whoever used that move
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

    // A message cut off at its wrap ("The foe's Jynx used" with "Ice Beam! ( ... )" still to come).
    // Every whole battle message ends in ! . ? or a closing bracket.
    function unfinished(lines) {
        const m = messages(lines);
        return m.length > 0 && !/[!.?)\]…]$/.test(m[m.length - 1]);
    }

    // The game writes a long message as two lines, and they can land in different reads of the log: the game
    // writes its log in blocks, so with a busy chat the second line can come seconds after the first.
    // The reader holds back the newest message until the next one starts, or nothing more comes for a moment
    // and the message is whole. A cut-off message waits for its second line however long that takes.
    // `held`: lines to start with (the end of the first read, see split()).
    function reader(waitMs = 1200, held = []) {
        let pending = held.slice(), lastNew = 0;
        return function push(lines, now = Date.now()) {
            if (lines.length) lastNew = now;
            const all = pending.concat(lines);
            let last = -1;
            for (let i = 0; i < all.length; i++) if (STAMP.test(String(all[i]))) last = i;
            if (last <= 0 && !lines.length && all.length && now - lastNew >= waitMs && !unfinished(all)) { pending = []; return parse(all); }
            if (last <= 0) { pending = all; return []; }
            pending = all.slice(last);
            return parse(all.slice(0, last));
        };
    }

    // Splits a first read into the lines to parse now and a cut-off last message to hand to reader()
    function split(lines) {
        let last = -1;
        for (let i = 0; i < lines.length; i++) if (STAMP.test(String(lines[i]))) last = i;
        if (last < 0 || !unfinished(lines.slice(last))) return { done: lines, held: [] };
        return { done: lines.slice(0, last), held: lines.slice(last) };
    }


    // ------------------------------------------------------------
    // Set inference from what the log shows (and doesn't show).
    // tracker({ abilitiesOf(species) -> [ability|null per possible set], typesOf(species) -> ['Fire', ...],
    //           moveInfo(move) -> [type, category, power] | null })
    // .event(e) takes the events above in order and returns facts for the app to apply to its picks:
    //   { species, ability }            the log showed this ability
    //   { species, noAbility: [...] }   an ability that announces itself on entry, and it didn't
    //   { species, item }               an item seen without a "The foe's X" message (Gems)
    //   { species, noItem: [...] }      Choice items (two different moves without switching), Orbs (a full turn, no status),
    //                                   Gems (a hit of that type with no Gem text), Lum and the matching status berry
    //                                   (a status that stayed), Air Balloon (came in without the balloon text),
    //                                   Focus Sash (one of our hits took it from full HP to 0 with no "hung on" text),
    //                                   Life Orb (a hit with no recoil line right after it), Leftovers (an end of turn
    //                                   below full HP with no Leftovers text; Black Sludge too for Poison types)
    //   { species, ability: 'Natural Cure' } cured of its status as it switched out
    //   { species, noAbility: ['Sturdy'] } the same one-hit KO from full HP
    // Item checks stop for a Pokémon once its item has shown up (a used Gem / Lum / popped Balloon is gone and
    // says nothing the next time) or after our Trick / Knock Off.
    // Entry announcements verified in PokeMMO logs (2026-10): Intimidate ("Your team's Attack fell!"),
    // Pressure ("is exerting its pressure!"), Trace ("traced X's Y!"), Sand Stream ("A sandstorm kicked up!").
    const ANNOUNCED = ['Intimidate', 'Pressure', 'Trace'];          // absence rules these out
    const CHOICE = ['Choice Band', 'Choice Specs', 'Choice Scarf'];
    const CALLERS = new Set(['Sleep Talk', 'Metronome', 'Assist', 'Copycat', 'Mirror Move', 'Me First', 'Nature Power']);
    const SWAPS = new Set(['Trick', 'Switcheroo']);
    const OUR_ITEM_MOVES = new Set(['Trick', 'Switcheroo', 'Knock Off', 'Thief', 'Covet', 'Bug Bite', 'Pluck', 'Incinerate']);
    // Moves whose type isn't the one in the dex (Hidden Power shows only as "Hidden Power"), or that never use a Gem
    const NO_GEM_CHECK = new Set(['hiddenpower', 'weatherball', 'naturalgift', 'judgment', 'technoblast', 'struggle', 'fling',
                                  'firepledge', 'grasspledge', 'waterpledge', 'futuresight', 'doomdesire']);
    // Damaging moves with no fixed power in the dex
    const VARIABLE_POWER = new Set(['return', 'frustration', 'gyroball', 'lowkick', 'grassknot', 'heavyslam', 'heatcrash',
                                    'electroball', 'flail', 'reversal', 'crushgrip', 'wringout', 'punishment', 'storedpower', 'magnitude']);
    // Status berries that cure one status (Lum cures them all)
    // Multi-hit moves: the log adds the hits up, so "-100%" from full doesn't mean one hit did it
    const MULTI_HIT = new Set(['armthrust', 'barrage', 'bonerush', 'bonemerang', 'bulletseed', 'cometpunch', 'doublehit',
                               'doublekick', 'doubleslap', 'dualchop', 'furyattack', 'furyswipes', 'geargrind', 'iciclespear',
                               'pinmissile', 'rockblast', 'spikecannon', 'tailslap', 'triplekick', 'twineedle', 'beatup',
                               'dragondarts', 'scaleshot', 'surgingstrikes', 'tripleaxel', 'watershuriken', 'populationbomb']);
    // Fixed-damage moves: no Life Orb boost, so no recoil to expect
    const FIXED_DAMAGE = new Set(['seismictoss', 'nightshade', 'superfang', 'endeavor', 'psywave', 'dragonrage', 'sonicboom',
                                  'counter', 'mirrorcoat', 'metalburst', 'finalgambit', 'bide', 'struggle']);
    // Items that heal their holder (seen: it may be at full HP again, so Leftovers can't be judged until it's hurt again)
    const HEALING_ITEMS = new Set(['leftovers', 'blacksludge', 'shellbell', 'sitrusberry', 'oranberry', 'figyberry', 'wikiberry',
                                   'magoberry', 'aguavberry', 'iapapaberry', 'berryjuice', 'enigmaberry']);
    const STATUS_BERRY = { tox: 'Pecha Berry', psn: 'Pecha Berry', brn: 'Rawst Berry', par: 'Cheri Berry', slp: 'Chesto Berry', frz: 'Aspear Berry' };

    function tracker(opts) {
        const abilitiesOf = opts.abilitiesOf || (() => []);
        const typesOf = opts.typesOf || (() => []);
        const moveInfo = opts.moveInfo || (() => null);
        const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        // gemCheck: a foe's hit waiting to see if a Gem text comes; statusCheck: a status waiting for a berry;
        // gemsBefore: Gem texts that came before the "used" line they belong to
        // orbCheck: a foe's hit waiting to see if Life Orb recoil follows; cured: a "was cured" line waiting to see
        // if the foe switches out next (Natural Cure)
        let mons, entry, turnSeen, faintedThisTurn, lastMove, gemCheck, statusCheck, gemsBefore, orbCheck, cured;
        const reset = () => { mons = new Map(); entry = null; turnSeen = false; faintedThisTurn = false; lastMove = null;
                              gemCheck = null; statusCheck = null; gemsBefore = []; orbCheck = null; cured = null; };
        reset();
        const mon = sp => mons.get(key(sp));
        const couldHave = (sp, ab) => abilitiesOf(sp).some(a => a === null || key(a) === key(ab));
        // A set known to have it (unscouted abilities don't count)
        const knownHave = (sp, ab) => abilitiesOf(sp).some(a => a && key(a) === key(ab));
        // Its item can still be reasoned about from what doesn't happen
        const itemUnknown = m => m && !m.swapped && !m.itemSeen;

        // A message closes the checks waiting on it: the next move, turn, switch or faint
        function settle(out) {
            if (gemCheck) {
                const g = gemCheck; gemCheck = null;
                if (!g.seen && !g.failed && itemUnknown(mon(g.species))) out.push({ species: g.species, noItem: [g.type + ' Gem'] });
            }
            if (statusCheck) {
                const c = statusCheck; statusCheck = null;
                if (!c.cured && itemUnknown(mon(c.species))) out.push({ species: c.species, noItem: ['Lum Berry', STATUS_BERRY[c.status]] });
            }
            if (orbCheck) {
                const c = orbCheck; orbCheck = null;
                const m = mon(c.species);
                if (!c.seen && itemUnknown(m) && !m.lifeOrbOut) { m.lifeOrbOut = true; out.push({ species: c.species, noItem: ['Life Orb'] }); }
            }
        }

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
                // "The foe's X floats in the air with its Air Balloon!" comes as it lands
                if (!e.balloon.has(key(sp)) && itemUnknown(mon(sp))) out.push({ species: sp, noItem: ['Air Balloon'] });
            }
        }

        // Its HP is below full for sure (it took damage and hasn't healed since)
        const hurt = sp => { const m = mon(sp); if (m && m.active) m.hurt = true; };
        const healed = sp => { const m = mon(sp); if (m) { m.hurt = false; m.hurtEot = false; } };

        function event(ev) {
            const out = [];
            const wasCured = cured; cured = null;
            switch (ev.type) {
                case 'challenge': reset(); break;
                case 'won': case 'lost': settle(out); closeEntry(out); reset(); break;
                case 'foeSentOut':
                    settle(out);
                    if (!entry) entry = { species: [], named: new Map(), intimidate: 0, weather: [], balloon: new Set() };
                    for (const sp of ev.species) {
                        entry.species.push(sp);
                        // Orb timing: a lead or a replacement after a faint arrives after this turn's end-of-turn effects;
                        // a mid-turn switch-in is there for them
                        mons.set(key(sp), { species: sp, active: true, armed: turnSeen && !faintedThisTurn,
                                            statused: (mon(sp) || {}).statused || false, first: null, calling: false, swapped: (mon(sp) || {}).swapped || false, choiceOut: (mon(sp) || {}).choiceOut || false,
                                            itemSeen: (mon(sp) || {}).itemSeen || false });
                    }
                    break;
                case 'foeWithdrew': {
                    settle(out);
                    const m = mon(ev.species);
                    if (m) m.active = false;
                    // "X was cured of its poisoning." just before it left: Natural Cure
                    if (wasCured && key(wasCured) === key(ev.species) && !(m && m.traced)) out.push({ species: m ? m.species : ev.species, ability: 'Natural Cure' });
                    break;
                }
                case 'cured': cured = ev.name; break;
                case 'foeHurt': {
                    const m = mon(ev.species);
                    if (!m) break;
                    // End-of-turn damage comes after Leftovers in that same end of turn, so it counts from the next one
                    if (ev.eot) m.hurtEot = true; else hurt(ev.species);
                    break;
                }
                case 'foeHealed': healed(ev.species); break;
                case 'foeFainted': { settle(out); const m = mon(ev.species); if (m) m.active = false; faintedThisTurn = true; break; }
                case 'foeItem': {
                    const m = mon(ev.species);
                    if (orbCheck && key(orbCheck.species) === key(ev.species) && key(ev.item) === 'lifeorb') orbCheck.seen = true;
                    if (HEALING_ITEMS.has(key(ev.item))) healed(ev.species);
                    if (entry && key(ev.item) === 'airballoon') entry.balloon.add(key(ev.species));
                    if (statusCheck && key(statusCheck.species) === key(ev.species)) statusCheck.cured = true;
                    if (m) m.itemSeen = true;
                    break;
                }
                case 'moveFailed': if (gemCheck) gemCheck.failed = true; break;
                case 'foeAbility':
                    // A traced Natural Cure (Porygon copying Chansey's) is no clue to its own ability
                    if (ev.species && ev.ability === 'Trace' && mon(ev.species)) mon(ev.species).traced = true;
                    if (ev.species) {
                        if (entry && entry.species.some(sp => key(sp) === key(ev.species))) {
                            const set = entry.named.get(key(ev.species)) || new Set(); set.add(ev.ability); entry.named.set(key(ev.species), set);
                        } else out.push({ species: ev.species, ability: ev.ability });
                    } else if (ev.ability === 'Intimidate' && entry) entry.intimidate++;
                    break;
                case 'weather': if (entry) entry.weather.push(ev.ability); break;
                case 'foeStatus': {
                    const m = mon(ev.species);
                    if (!m) break;
                    // A berry cures it straight away. Paralysis also shows "is paralyzed" on a turn it can't move:
                    // that's a status that already stuck, so it doesn't start a check.
                    if (!m.statused && STATUS_BERRY[ev.status]) { settle(out); statusCheck = { species: m.species, status: ev.status, cured: false }; }
                    m.statused = true;
                    break;
                }
                case 'turn':
                    settle(out);
                    closeEntry(out);
                    gemsBefore = [];
                    for (const m of mons.values()) {
                        if (!m.active) continue;
                        // A whole end of turn below full HP and no Leftovers text: no Leftovers (Black Sludge for Poison types)
                        if (m.armed && m.hurt && itemUnknown(m) && !m.leftOut) {
                            m.leftOut = true;
                            out.push({ species: m.species, noItem: typesOf(m.species).includes('Poison') ? ['Leftovers', 'Black Sludge'] : ['Leftovers'] });
                        }
                        if (m.hurtEot) { m.hurt = true; m.hurtEot = false; }
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
                    settle(out);
                    closeEntry(out);
                    gemsBefore = [];
                    // A one-hit KO from full HP ("-100%": the shown damage stops at the HP it had) with no "hung on"
                    // text: no Focus Sash, no Sturdy. With either, the line would read -99% and "hung on" would follow.
                    for (const h of ev.hits || []) if (h.pct > 0) hurt(h.name);
                    if (!MULTI_HIT.has(key(ev.move))) {
                        for (const h of ev.hits || []) {
                            const m = mon(h.name);
                            if (!m || !m.active || h.pct < 100) continue;
                            if (itemUnknown(m)) out.push({ species: m.species, noItem: ['Focus Sash'] });
                            out.push({ species: m.species, noAbility: ['Sturdy'] });
                        }
                    }
                    // Our Trick / Knock Off / Thief: the foe's item may have changed, stop guessing about it
                    if (OUR_ITEM_MOVES.has(ev.move)) for (const m of mons.values()) if (m.active) m.swapped = true;
                    lastMove = { foe: false, move: ev.move };
                    break;
                case 'foeMove': {
                    settle(out);
                    closeEntry(out);
                    const m = mon(ev.species);
                    lastMove = { foe: true, species: ev.species, move: ev.move };
                    // A Gem text just before this line, naming this move, was this Pokémon's
                    const before = gemsBefore.find(g => key(g.move) === key(ev.move));
                    gemsBefore = [];
                    if (before) out.push({ species: ev.species, item: before.item });
                    if (!m) break;
                    if (before) m.itemSeen = true;
                    if (ev.heal) healed(ev.species);
                    // A hit that showed its damage, with no "hurt by its Life Orb" after it: no Life Orb.
                    // Magic Guard and Sheer Force (on moves with an effect) stop the recoil, so sets with them are skipped.
                    if (ev.hit && !FIXED_DAMAGE.has(key(ev.move)) && itemUnknown(m) && !m.lifeOrbOut
                        && !knownHave(m.species, 'Magic Guard') && !knownHave(m.species, 'Sheer Force'))
                        orbCheck = { species: m.species, seen: false };
                    // A hit (the line shows the damage) of a type it could have a Gem for, and no Gem text: no Gem
                    const info = moveInfo(ev.move);
                    if (ev.hit && !before && info && !NO_GEM_CHECK.has(key(ev.move)) && (info[2] > 0 || VARIABLE_POWER.has(key(ev.move))) && itemUnknown(m))
                        gemCheck = { species: m.species, move: ev.move, type: info[0], seen: false, failed: false };
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
                    if (gemCheck && (!ev.move || key(ev.move) === key(gemCheck.move))) {
                        gemCheck.seen = true;
                        const m = mon(gemCheck.species); if (m) m.itemSeen = true;
                        out.push({ species: gemCheck.species, item: ev.item });
                    } else if (ev.move && lastMove && lastMove.foe && key(lastMove.move) === key(ev.move)) {
                        const m = mon(lastMove.species); if (m) m.itemSeen = true;
                        out.push({ species: lastMove.species, item: ev.item });
                    } else if (ev.move && lastMove && !lastMove.foe && key(lastMove.move) === key(ev.move)) {
                        // our own Gem
                    } else if (ev.move) gemsBefore.push(ev);        // the "used" line may come after it
                    else if (lastMove && lastMove.foe) out.push({ species: lastMove.species, item: ev.item });
                    break;
            }
            return out;
        }
        return { event };
    }

    const api = { parse, messages, reader, split, tracker };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.BattleLog = api;
})(this);
