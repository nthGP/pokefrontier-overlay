// Quick checks for the log parser and the debug log: node scripts/test.js (no dependencies).
// Lines are shaped like real PokeMMO [Battle] lines (colour tags, wrapped second lines, item glyphs).
const assert = require('assert');
const B = require('../src/battlelog.js');
const D = require('../src/debuglog.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };
const L = (t, msg) => `[25/10/26 ${t}] [Battle] ${msg}`;
const tracker = () => B.tracker({ abilitiesOf: () => [null], typesOf: () => [], moveInfo: () => null });
const run = lines => { const t = tracker(); return B.parse(lines).flatMap(e => t.event(e)); };

// ---------------------------------------------------------------- parser: Focus Sash / Sturdy
test('Focus Sash proc is an item', () => {
    const ev = B.parse([L('12:47:53', '[#ff8a00]Gliscor[#] used'), 'Earthquake! ( [#ff8a00]Dugtrio[#] -99% )',
                        L('12:47:57', "The foe's [#ff8a00]Dugtrio[#] hung on using its ꌀFocus Sash (DEF)!")]);
    assert.deepStrictEqual(ev[0], { type: 'myMove', move: 'Earthquake', hits: [{ name: 'Dugtrio', pct: 99 }] });
    assert.deepStrictEqual(ev[1], { type: 'foeItem', species: 'Dugtrio', item: 'Focus Sash' });
});

test('Sturdy hang-on is an ability, not an item', () => {
    const ev = B.parse([L('13:21:46', "The foe's [#ff8a00]Donphan[#] hung on using its Sturdy!")]);
    assert.deepStrictEqual(ev, [{ type: 'foeAbility', species: 'Donphan', ability: 'Sturdy' }]);
});

test('our hit list: decimal comma, several targets', () => {
    const [e] = B.parse([L('1:00:00', 'Alpha Slowking used Scald! ( Poliwhirl -99,2%, Poliwhirl -100% )')]);
    assert.deepStrictEqual(e.hits, [{ name: 'Poliwhirl', pct: 99.2 }, { name: 'Poliwhirl', pct: 100 }]);
});

const KO = [L('1:00:00', 'You are challenged by Expert WESTON[245]!'), L('1:00:01', 'Expert WESTON[245] sent out Blaziken!'),
            L('1:00:02', 'Turn 1 started!')];
test('one-hit KO from full HP rules out Focus Sash and Sturdy', () => {
    const f = run([...KO, L('1:00:03', 'Gliscor used'), 'Earthquake! ( [#ff8a00]Blaziken[#] -100% )', L('1:00:04', "The foe's Blaziken fainted!")]);
    assert(f.some(x => x.species === 'Blaziken' && (x.noItem || []).includes('Focus Sash')));
    assert(f.some(x => x.species === 'Blaziken' && (x.noAbility || []).includes('Sturdy')));
});
test('not from a multi-hit move', () => {
    const f = run([...KO, L('1:00:03', 'Breloom used Bullet Seed! ( Blaziken -100% )')]);
    assert(!f.some(x => (x.noItem || []).includes('Focus Sash')));
});
test('not when it hung on (the hit shows -99%)', () => {
    const f = run([...KO, L('1:00:03', 'Gliscor used Earthquake! ( Blaziken -99% )'),
                   L('1:00:04', "The foe's Blaziken hung on using its ꌀFocus Sash (DEF)!")]);
    assert(!f.some(x => (x.noItem || []).includes('Focus Sash')));
});
test('not for a hit under 100%', () => {
    const f = run([...KO, L('1:00:03', 'Gliscor used Earthquake! ( Blaziken -63,5% )')]);
    assert(!f.some(x => (x.noItem || []).includes('Focus Sash')));
});

const lead = [L('2:00:00', 'You are challenged by Fisherman BAILEY[280]!'), L('2:00:01', 'Fisherman BAILEY[280] sent out Starmie!'),
              L('2:00:02', 'Turn 1 started!')];
test('a hit with no recoil line rules out Life Orb', () => {
    const f = run([...lead, L('2:00:03', "The foe's Starmie used Scald! ( Alpha Slowking -12,4% )"), L('2:00:04', 'Turn 2 started!')]);
    assert(f.some(x => x.species === 'Starmie' && (x.noItem || []).includes('Life Orb')));
});
test('...but not when the recoil line follows', () => {
    const f = run([...lead, L('2:00:03', "The foe's Starmie used Scald! ( Alpha Slowking -12,4% )"),
                   L('2:00:04', "The foe's Starmie is hurt by its \ua005Life Orb (ATK)!"), L('2:00:05', 'Turn 2 started!')]);
    assert(!f.some(x => (x.noItem || []).includes('Life Orb')));
});
test('...nor for Seismic Toss, or a set with Sheer Force', () => {
    assert(!run([...lead, L('2:00:03', "The foe's Starmie used Seismic Toss! ( Chansey -20% )"), L('2:00:04', 'Turn 2 started!')])
        .some(x => (x.noItem || []).includes('Life Orb')));
    const t = B.tracker({ abilitiesOf: () => ['Sheer Force', null], typesOf: () => [], moveInfo: () => null });
    const f = B.parse([...lead, L('2:00:03', "The foe's Starmie used Scald! ( Alpha Slowking -12,4% )"), L('2:00:04', 'Turn 2 started!')]).flatMap(e => t.event(e));
    assert(!f.some(x => (x.noItem || []).includes('Life Orb')));
});
test('an end of turn below full HP with no Leftovers text rules out Leftovers', () => {
    const f = run([...lead, L('2:00:03', 'Gliscor used Earthquake! ( Starmie -30% )'), L('2:00:04', 'Turn 2 started!')]);
    assert(f.some(x => x.species === 'Starmie' && (x.noItem || []).includes('Leftovers')));
});
test('...not at full HP, after a heal, or with poison only from this end of turn', () => {
    const none = lines => !run(lines).some(x => (x.noItem || []).includes('Leftovers'));
    assert(none([...lead, L('2:00:03', 'Gliscor used Protect!'), L('2:00:04', 'Turn 2 started!')]));
    assert(none([...lead, L('2:00:03', 'Gliscor used Earthquake! ( Starmie -30% )'), L('2:00:04', "The foe's Starmie used Recover! ( Starmie +30% )"),
                 L('2:00:05', 'Turn 2 started!')]));
    assert(none([...lead, L('2:00:03', "The foe's Starmie was hurt by poison!"), L('2:00:04', 'Turn 2 started!')]));
    assert(!none([...lead, L('2:00:03', "The foe's Starmie was hurt by poison!"), L('2:00:04', 'Turn 2 started!'), L('2:00:05', 'Turn 3 started!')]));
});
test('cured as it switches out: Natural Cure (not after Rest, not a traced one)', () => {
    const out = [L('2:00:03', 'Starmie was cured of its poisoning.'), L('2:00:04', 'Fisherman BAILEY[280] withdrew Starmie!')];
    assert(run([...lead, ...out]).some(x => x.species === 'Starmie' && x.ability === 'Natural Cure'));
    assert(!run([...lead, L('2:00:03', "The foe's Starmie fell asleep!"), L('2:00:03', 'Starmie was cured of its poisoning.'),
                 L('2:00:04', 'Turn 2 started!')]).some(x => x.ability === 'Natural Cure'));
    const traced = [L('3:00:00', 'You are challenged by Fisherman BAILEY[280]!'), L('3:00:01', 'Fisherman BAILEY[280] sent out Porygon!'),
                    L('3:00:02', "The foe's Porygon traced Chansey's Natural Cure!"), L('3:00:03', 'Turn 1 started!'),
                    L('3:00:04', 'Porygon was cured of its poisoning.'), L('3:00:05', 'Fisherman BAILEY[280] withdrew Porygon!')];
    assert(!run(traced).some(x => x.ability === 'Natural Cure'));
});

// Some players' logs print item names with no icon glyph and no "(Status)" tag (reported 2026-10-27)
const PM = (t, msg) => `[27/10/26 ${t} pm] [Battle] ${msg}`;
test('item texts without the icon glyph: Lum Berry, Chesto, Gems, resist berries, Orbs', () => {
    const one = msg => B.parse([PM('11:44:53', msg)]);
    assert.deepStrictEqual(one("The foe's [#ff8a00]Machamp[#]'s [#ff8a00]Lum Berry[#] cured its poison!"), [{ type: 'foeItem', species: 'Machamp', item: 'Lum Berry' }]);
    assert.deepStrictEqual(one("The foe's [#ff8a00]Wailord[#]'s [#ff8a00]Chesto Berry[#] woke it up!"), [{ type: 'foeItem', species: 'Wailord', item: 'Chesto Berry' }]);
    assert.deepStrictEqual(one("The [#ff8a00]Bug Gem[#] strengthened [#ff8a00]Bug Bite[#]'s power!"), [{ type: 'itemNoOwner', item: 'Bug Gem', move: 'Bug Bite' }]);
    assert.deepStrictEqual(one("The [#ff8a00]Chople Berry[#] weakened the damage to the foe's [#ff8a00]Blissey[#]!"), [{ type: 'foeItem', species: 'Blissey', item: 'Chople Berry' }]);
    assert.deepStrictEqual(one("The foe's [#ff8a00]Ursaring[#] was burned by the [#ff8a00]Flame Orb[#]!")[0], { type: 'foeItem', species: 'Ursaring', item: 'Flame Orb' });
    assert.deepStrictEqual(one("The foe's [#ff8a00]Gengar[#]'s Cursed Body disabled Earthquake!"), []);   // an ability, not an item
});
test('a glyph-less Lum Berry cure no longer rules Lum Berry out', () => {
    const f = run([PM('11:44:50', 'You are challenged by Picnicker MELODY[208]!'), PM('11:44:51', 'Picnicker MELODY[208] sent out Machamp!'),
                   PM('11:44:52', 'Turn 1 started!'), PM('11:44:52', 'Alpha Slowking used Toxic!'),
                   PM('11:44:53', "The foe's [#ff8a00]Machamp[#] was badly poisoned!"),
                   PM('11:44:53', "The foe's [#ff8a00]Machamp[#]'s [#ff8a00]Lum Berry[#] cured its poison!"), PM('11:44:54', 'Turn 2 started!')]);
    assert(!f.some(x => (x.noItem || []).includes('Lum Berry')));
});

// ---------------------------------------------------------------- debug log
const NAME = 'Nithyyy';
function battle(t, idx, extra = []) {
    return [L(t + ':00', `You are challenged by Expert WESTON[${idx}]!`), L(t + ':01', `Expert WESTON[${idx}] sent out Crobat!`),
            L(t + ':02', `${NAME} sent out Gliscor!`), L(t + ':03', 'Turn 1 started!'),
            L(t + ':04', "The foe's Crobat used Air Slash! ( Gliscor -11% )"), ...extra,
            L(t + ":05", `Player defeated [#ff8a00]Expert WESTON[${idx}][#]!`)];
}
// The app's side, minimal: lines go in first, then the events parsed from them (as pollAuto does)
function feed(rec, lines) {
    rec.lines(lines);
    for (const e of B.parse(lines)) {
        if (e.type === 'challenge') rec.start({ trainers: e.trainers });
        rec.step(e, e, [], { picks: [] });
        if (e.type === 'won' || e.type === 'lost') rec.end(e.type);
    }
}

test('keeps Frontier battles only, and removes player names everywhere', () => {
    const rec = D.recorder({ max: 20 });
    feed(rec, [L('9:00:00', 'Oh! A wild Golbat and Bagon appeared!'), L('9:00:01', `${NAME} sent out Shiny Printer!`),
               L('9:00:02', 'Tiuvy, Urii, Rotcoco, and ' + NAME), ...battle('9:01', 245),
               L('9:02:00', 'A wild Solrock appeared!'), L('9:02:01', `${NAME} has forfeited.`)]);
    const f = rec.file({ app: 'test' });
    const text = JSON.stringify(f);
    assert.strictEqual(f.battles.length, 1);
    assert.strictEqual(f.battles[0].result, 'won');
    assert(!text.includes(NAME), 'player name leaked');
    assert(!/Golbat|Solrock|Tiuvy|Printer/.test(text), 'a non-Frontier battle leaked');
    assert(text.includes('<player> sent out Gliscor!'));
});

test('a win and the next challenge in one read: both battles kept, the first one won', () => {
    const rec = D.recorder({ max: 20 });
    feed(rec, [...battle('10:00', 245), ...battle('10:01', 246)]);
    const f = rec.file({});
    assert.deepStrictEqual(f.battles.map(b => [b.trainers[0].index, b.result]), [[245, 'won'], [246, 'won']]);
    assert(f.battles[0].lines.every(l => !l.includes('[246]')));
});

test('a battle with no result line is closed as unfinished by the next challenge', () => {
    const rec = D.recorder({ max: 20 });
    const cut = battle('11:00', 245).slice(0, -1);
    feed(rec, [...cut, ...battle('11:01', 246)]);
    assert.deepStrictEqual(rec.file({}).battles.map(b => b.result), ['unfinished', 'won']);
});

test('keeps the last 20 battles, and stores them between runs', () => {
    let store = null;
    const rec = D.recorder({ max: 20, save: b => { store = JSON.parse(JSON.stringify(b)); } });
    for (let i = 0; i < 25; i++) feed(rec, battle(`12:${String(i).padStart(2, '0')}`, 200 + i));
    assert.strictEqual(store.length, 20);
    assert.strictEqual(store[0].trainers[0].index, 205);
    const again = D.recorder({ max: 20, load: () => store });
    const f = again.file({});
    assert.strictEqual(f.battles.length, 20);
    assert(!JSON.stringify(f).includes(NAME), 'a name stored in an earlier run leaked');
});

test('a name that is part of another word is left alone', () => {
    assert.strictEqual(D.redact('Ash sent out Ashwing; Cash used Ash', ['Ash']), '<player> sent out Ashwing; Cash used <player>');
});

console.log(`\n${n} passed`);
