// Debug log for auto mode: keeps what the app read and decided for the last 20 Frontier battles, so a user can
// save it to a file and send it when auto mode got something wrong (wrong set, a move not picked up...).
//
// Privacy (what can end up in the file):
//   - Only [Battle] lines reach the page at all (src-tauri/src/chatlog.rs drops team, whisper, global chat...).
//   - Of those, only lines from Frontier battles are kept: from "You are challenged by <trainer>[number]" (or a
//     trainer the app found by name) to the win or loss. Wild battles, hordes and battles against other players
//     are never kept.
//   - Player names (yours, a Co-op partner's) are replaced with "<player>" everywhere in the file. They're learned
//     from "<name> sent out ..." / "<name> has forfeited" lines, which never carry a Tower number.
//   - No folder path, no PC name, no chat. Pokémon nicknames stay: the log needs them to tell your side's moves apart.
//
// Usage (index.html):
//   const rec = DebugLog.recorder({ max: 20, load: () => array|null, save: array => {} });
//   rec.lines(rawLines)                      every [Battle] line read, in order
//   rec.start(info) / rec.end(result)        a Frontier battle starts (challenge resolved) / ends (won / lost / ...)
//   rec.step(rawEvent, event, facts, picks)  one event as parsed, as the app resolved it, the set facts it gave,
//                                            and the picks afterwards (only when they changed)
//   rec.manual(picks)                        the user changed something by hand mid-battle
//   rec.file(meta)                           the whole file (an object), names already removed
//   opts.unreadOf(lines) -> [messages]       optional: messages the parser got nothing from (see index.html)
(function (root) {
    const STAMP = /^\[[^\]]*?\d{1,2}:\d{2}(?::\d{2})?[^\]]*\] \[Battle\] ?/;
    const CHALLENGE = /^\[[^\]]*\] \[Battle\] You are challenged by /;
    const WILD = /^\[[^\]]*\] \[Battle\] (?:Oh! )?A wild |^\[[^\]]*\] \[Battle\] A horde /;
    // The win / loss line ("Player defeated Expert WESTON[245]!", "X[245] has defeated ...")
    // (tested on the line without its colour tags: "defeated [#ff8a00]Expert WESTON[245][#]!")
    const RESULT_TEXT = /^\[[^\]]*\] \[Battle\] .*(?: defeated .+\[\d+\]!|\[\d+\] (?:has|have) defeated .+!)$/;
    const clean = s => String(s).replace(/\[#[0-9a-fA-F]*\]/g, '').replace(/\s+/g, ' ').trim();
    const isResult = line => RESULT_TEXT.test(clean(line));
    const LINES_MAX = 3000;      // one battle's lines, at most (a 90-turn battle is ~1000)

    // Names of players (never a trainer with a Tower number) from one line
    function playerNamesIn(line) {
        const m = clean(String(line).replace(STAMP, ''));
        const out = [];
        let r;
        if ((r = m.match(/^(.+?) sent out /)) && !/\[\d+\]/.test(r[1]) && !/^The foe's /.test(r[1])) out.push(r[1]);
        if ((r = m.match(/^(.+?) has forfeited\.?$/))) out.push(r[1]);
        return out.map(s => s.trim()).filter(s => s.length >= 2);
    }

    const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Replaces every learned player name, as a whole word, in any text (JSON included)
    function redact(text, names) {
        let out = text;
        for (const n of [...names].sort((a, b) => b.length - a.length)) {
            out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(n)}(?=$|[^\\p{L}\\p{N}])`, 'gu'), '$1<player>');
        }
        return out;
    }

    function recorder(opts = {}) {
        const max = opts.max || 20;
        let battles = [];
        try { battles = (opts.load && opts.load()) || []; } catch (e) { battles = []; }
        if (!Array.isArray(battles)) battles = [];
        const names = new Set();
        for (const b of battles) for (const n of b.players || []) names.add(n);
        // closing: a battle whose result line was read, waiting for the app's won/lost event (lines after it
        // belong to whatever comes next)
        // pending: lines from each "You are challenged by" not yet matched to a battle the app started (a read can
        // hold a whole battle before its events are applied). Only Frontier ones are ever taken; the rest are dropped.
        let pending = [], current = null, closing = null, dirty = false, lastPicks = null;

        const persist = () => {
            dirty = false;
            try { opts.save && opts.save(battles); } catch (e) {}
        };
        const learn = line => { for (const n of playerNamesIn(line)) { names.add(n); if (current && !current.players.includes(n)) current.players.push(n); } };

        function lines(raw) {
            for (const line of raw) {
                const s = String(line);
                learn(s);
                if (CHALLENGE.test(s)) {
                    // A new challenge: a battle still open never got its result line (app closed, log cut)
                    if (current) end('unfinished');
                    pending.push({ lines: [s], open: true });
                    if (pending.length > 5) pending.shift();
                    continue;
                }
                const last = pending[pending.length - 1];
                if (WILD.test(s)) {
                    if (current) end('unfinished');
                    if (last) last.open = false;
                    continue;
                }
                if (current) {
                    if (current.lines.length < LINES_MAX) current.lines.push(s);
                    dirty = true;
                    if (isResult(s)) { closing = current; current = null; }
                } else if (last && last.open) {
                    if (last.lines.length < LINES_MAX) last.lines.push(s);
                    if (isResult(s)) last.open = false;
                }
            }
        }

        // info.trainers[0].name picks the right pending challenge (a battle against another player is skipped)
        function start(info) {
            if (current || closing) end('unfinished');
            const who = clean(((info.trainers || [])[0] || {}).name || '').toLowerCase();
            const i = pending.findIndex(p => clean(p.lines[0]).toLowerCase().includes(who));
            const got = i >= 0 ? pending[i] : null;
            pending = i >= 0 ? pending.slice(i + 1) : pending;
            // Lines read after the challenge but before this call that belong to it are in got; any later ones
            // (another challenge) stay pending
            const lines = got ? got.lines : [];
            const rec = { started: new Date().toISOString(), ...info, players: [...names].filter(n => lines.some(l => l.includes(n))),
                          lines: lines.slice(), steps: [], result: null };
            // Its result line was already read: it only waits for the app's won/lost event
            if (got && !got.open && lines.some(l => isResult(l))) closing = rec; else current = rec;
            lastPicks = null;
            battles.push(rec);
            while (battles.length > max) battles.shift();
            persist();
        }

        function end(result) {
            const b = current || closing;
            if (!b) return;
            b.result = result;
            b.ended = new Date().toISOString();
            if (b === current) current = null;
            closing = null;
            lastPicks = null;
            persist();
        }

        function step(raw, ev, facts, picks) {
            const b = current || closing;
            if (!b) return;
            const s = { raw };
            if (ev !== raw) s.event = ev;
            if (facts && facts.length) s.facts = facts;
            const p = picks ? JSON.stringify(picks) : null;
            // a copy: the app keeps changing the same objects
            if (p && p !== lastPicks) { s.picks = JSON.parse(p); lastPicks = p; }
            b.steps.push(s);
            dirty = true;
        }

        function manual(picks) {
            if (!current || !picks) return;
            const p = JSON.stringify(picks);
            if (p === lastPicks) return;
            lastPicks = p;
            current.steps.push({ manual: true, picks: JSON.parse(p) });
            dirty = true;
        }

        // Saves now and then while a battle runs, so a crash keeps most of it
        function flush() { if (dirty) persist(); }

        function file(meta) {
            const all = new Set(names);
            for (const b of battles) for (const n of b.players || []) all.add(n);
            const body = { kind: 'frontier-overlay-debug', version: 1, saved: new Date().toISOString(), ...meta,
                           battles: battles.map(b => ({ ...b, players: undefined, playerCount: (b.players || []).length,
                                                        unread: opts.unreadOf ? opts.unreadOf(b.lines) : undefined })) };
            return JSON.parse(redact(JSON.stringify(body), all));
        }

        return { lines, start, end, step, manual, flush, file, active: () => !!current, count: () => battles.length,
                 clear: () => { battles = []; current = null; closing = null; pending = []; persist(); } };
    }

    const api = { recorder, redact, playerNamesIn };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.DebugLog = api;
})(this);
