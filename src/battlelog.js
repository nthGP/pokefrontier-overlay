// Turns PokeMMO chat-log [Battle] lines into battle events for auto mode.
// The app (src-tauri/src/chatlog.rs) only ever hands this file [Battle] lines; nothing else from the log.
//
// Line format (game log, 2026-10): "[dd/mm/yy H:MM:SS] [Battle] message", names wrapped in colour tags
// like "[#ff8a00]Gulpin[#]". A long message wraps onto a following line that has no timestamp.
//
// Events:
//   { type: 'challenge', trainer: 'Youngster CONNER', index: 2 }
//   { type: 'foeSentOut', index: 2, species: ['Igglybuff', 'Slugma'] }
//   { type: 'foeMove', species: 'Gulpin', move: 'Water Pulse' }
//   { type: 'foeItem', species: 'Crobat', item: 'Life Orb' }   (any "The foe's X ... its ITEM!" message)
//   { type: 'won', index: 66 } / { type: 'lost', index: 42 }
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

    function parse(lines) {
        const events = [];
        for (const m of messages(lines)) {
            let r;
            if ((r = m.match(/^You are challenged by (.+?)\[(\d+)\]!$/))) {
                events.push({ type: 'challenge', trainer: r[1].trim(), index: +r[2] });
            } else if ((r = m.match(/^(.+?)\[(\d+)\] has defeated (.+)!$/))) {
                events.push({ type: 'lost', index: +r[2] });
            } else if ((r = m.match(/^.+ defeated (.+?)\[(\d+)\]!$/))) {
                events.push({ type: 'won', index: +r[2] });
            } else if ((r = m.match(/^(.+?)\[(\d+)\] sent out (.+)!$/))) {
                events.push({ type: 'foeSentOut', index: +r[2], species: r[3].split(' and ').map(monName).filter(Boolean) });
            } else if ((r = m.match(/^The foe's (.+?) used (.+?)!(?: \(.*\))?$/))) {
                events.push({ type: 'foeMove', species: monName(r[1]), move: clean(r[2]) });
            } else if ((r = m.match(/^The foe's (.+?) (?:is|was|restored|ate|used|consumed|held|became).* its (.+?)!$/))) {
                // Item names carry an icon character and a stat tag: "ꀅLife Orb (ATK)"
                const item = r[2].replace(/[^\x20-\x7e\u00c0-\u024f]/g, '').replace(/\s*\([A-Z]+\)\s*$/, '').trim();
                if (item && !item.includes("'s ")) events.push({ type: 'foeItem', species: monName(r[1]), item });
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

    const api = { parse, messages, reader };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.BattleLog = api;
})(this);
