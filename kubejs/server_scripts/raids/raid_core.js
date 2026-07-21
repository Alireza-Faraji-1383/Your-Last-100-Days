// priority: 90
// kubejs/server_scripts/raids/raid_core.js
//
// Raid factory engine — KubeJS 1.21.1 NeoForge. Depends on the EnhancedAI
// global (enhancedai_factory.js, priority 100 -> loads first).
//
// Sequential rounds (never overlap), ring-spawn around the target player,
// far-aggro via the farSight preset + a per-tick setTarget loop. No lose
// condition; win = all rounds completed AND all spawned mobs dead -> onWin.
//
// Rhino quirk: const/let inside try{} hoists to a function-scope var and throws
// "redeclaration of var X" on the 2nd call. All function-internal declarations
// use var + indexed for-loops. Top-level (run-once) constants may use const.

(function (global) {
    "use strict";

    const DEBUG          = false;
    const TICK_THROTTLE  = 5;      // drive active instances every N server ticks
    const DEFAULT_MIN_R  = 20;     // ring spawn radius (blocks)
    const DEFAULT_MAX_R  = 40;
    const DEFAULT_BREATHER = 60;   // ticks after an all-dead round before the next
    const DEFAULT_BAR_HOLD  = 300; // ticks the victory/defeat bar lingers before closing (15s)

    function warn(m) { console.warn(`[Raid] ${m}`); }
    function err(m)  { console.error(`[Raid] ${m}`); }
    function info(m) { if (DEBUG) console.info(`[Raid] ${m}`); }

    function getEAI() {
        var EAI = (typeof EnhancedAI !== "undefined") ? EnhancedAI : null;
        if (!EAI) err("EnhancedAI global missing — enhancedai_factory.js not loaded");
        return EAI;
    }

    function playerLevel(player) {
        return (typeof player.level === "function") ? player.level() : player.level;
    }

    function isAirBlock(b) {
        if (!b) return true;
        try { if (typeof b.isAir === "function") return b.isAir(); } catch (e) {}
        try { return String(b.id) === "minecraft:air"; } catch (e2) {}
        return false;
    }

    // ---------- Boss bar (server CustomBossEvents) --------------------------
    // Bars live in the server's CustomBossEvents registry under the "raidfactory"
    // namespace so they're enumerable + survive a /reload or crash. That lets
    // stopall + a load-time sweep nuke EVERY raid bar, including ones orphaned
    // when a reload wiped the script state (a plain ServerBossEvent reference is
    // lost on reload and can never be removed -> bar sticks on the client).

    const BAR_NS = "raidfactory";
    var _barCls = null;
    function barClasses() {
        if (_barCls) return _barCls;
        try {
            _barCls = {
                Color:   Java.loadClass("net.minecraft.world.BossEvent$BossBarColor"),
                Overlay: Java.loadClass("net.minecraft.world.BossEvent$BossBarOverlay"),
                RL:      Java.loadClass("net.minecraft.resources.ResourceLocation")
            };
        } catch (e) { err("boss bar classes unavailable: " + e); _barCls = {}; }
        return _barCls;
    }
    function enumVal(cls, name, fallback) {
        try { return cls.valueOf(name); } catch (e) {}
        try { return cls.valueOf(fallback); } catch (e2) {}
        return null;
    }
    function barRL(path) {
        var C = barClasses();
        if (!C.RL) return null;
        var p = String(path).toLowerCase().replace(/[^a-z0-9._\-\/]/g, "_");
        try { return C.RL.fromNamespaceAndPath(BAR_NS, p); }
        catch (e) { try { return C.RL.tryParse(BAR_NS + ":" + p); } catch (e2) { return null; } }
    }
    function customBars(server) {
        if (!server || typeof server.getCustomBossEvents !== "function") return null;
        try { return server.getCustomBossEvents(); } catch (e) { return null; }
    }
    function makeBar(server, idPath, title, colorName, overlayName) {
        var C = barClasses();
        var ce = customBars(server);
        if (!ce) { warn("makeBar: no CustomBossEvents (server unavailable)"); return null; }
        var rl = barRL(idPath);
        if (!rl) return null;
        try {
            var existing = ce.get(rl);
            if (existing) { try { existing.removeAllPlayers(); ce.remove(existing); } catch (eR) {} }
            var bar = ce.create(rl, Text.of(title || "Raid"));
            try { bar.setColor(enumVal(C.Color, colorName || "RED", "RED")); } catch (e1) {}
            try { if (typeof bar.setOverlay === "function") bar.setOverlay(enumVal(C.Overlay, overlayName || "NOTCHED_10", "PROGRESS")); } catch (e2) {}
            try { bar.setProgress(1.0); } catch (e3) {}
            return bar;
        } catch (e) { warn("makeBar: " + e); return null; }
    }
    function entHealth(e) {
        try { if (e && e.isAlive && !e.isAlive()) return 0; } catch (x) {}
        try { if (typeof e.getHealth === "function") return e.getHealth(); } catch (x) {}
        try { return e.health; } catch (x) {}
        return 0;
    }
    function entMaxHealth(e) {
        try { if (typeof e.getMaxHealth === "function") return e.getMaxHealth(); } catch (x) {}
        try { return e.maxHealth; } catch (x) {}
        return 0;
    }
    function sumHealth(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += entHealth(arr[i]); return s; }
    function sumMax(arr)    { var s = 0; for (var i = 0; i < arr.length; i++) s += entMaxHealth(arr[i]); return s; }
    function fmtTicks(t) {
        var s = Math.ceil(t / 20); if (s < 0) s = 0;
        var m = Math.floor(s / 60), r = s % 60;
        return m + ":" + (r < 10 ? "0" : "") + r;
    }
    function prettyId(id) {
        var parts = String(id).split("_"), out = [];
        for (var i = 0; i < parts.length; i++) { var w = parts[i]; if (w) out.push(w.charAt(0).toUpperCase() + w.slice(1)); }
        return out.join(" ");
    }
    // Vec3 coords off player.position() can surface as java.lang.Double, which
    // has no toFixed — Number() first, always.
    function fmt1(v) { return Number(v).toFixed(1); }
    // KubeJS 1.21 has no playSound(String, float, float) overload on the player
    // wrapper — that call throws and used to be silently swallowed, so no raid
    // sound ever played. Vanilla /playsound via runCommandSilent (the same
    // proven path spawnPoof uses) targets just the named player.
    function playSnd(player, s) {
        if (!player || !s || !s.id) return;
        var vol = (s.vol != null ? s.vol : 1.0), pitch = (s.pitch != null ? s.pitch : 1.0);
        try {
            var server = player.server;
            if (server && typeof server.runCommandSilent === "function") {
                var p = player.position();
                server.runCommandSilent(
                    "playsound " + s.id + " master " + player.username + " " +
                    fmt1(p.x) + " " + fmt1(p.y) + " " + fmt1(p.z) + " " +
                    vol + " " + pitch);
                return;
            }
        } catch (e) { warn("playSnd(" + s.id + "): " + e); }
        try { player.playSound(s.id, vol, pitch); } catch (e2) {}
    }
    // Play s to the center player plus every same-dimension player within radius
    // blocks. One-shot (raid start only) — findOnlinePlayer is abused as a
    // forEach by always returning false from the predicate.
    const RAIDSTART_RADIUS = 64;
    function broadcastSnd(server, center, s, radius) {
        if (!center || !s || !s.id) return;
        playSnd(center, s);
        if (!server) return;
        var cp, cdim = "";
        try { cp = center.position(); } catch (e) { return; }
        try { cdim = String(playerLevel(center).dimension); } catch (e2) {}
        var r2 = radius * radius;
        findOnlinePlayer(server, function (p) {
            try {
                if (String(p.uuid) === String(center.uuid)) return false;
                var pdim = "";
                try { pdim = String(playerLevel(p).dimension); } catch (eD) {}
                if (cdim && pdim && pdim !== cdim) return false;
                var pp = p.position();
                var dx = pp.x - cp.x, dy = pp.y - cp.y, dz = pp.z - cp.z;
                if (dx * dx + dy * dy + dz * dz <= r2) playSnd(p, s);
            } catch (e3) {}
            return false;
        });
    }
    // Title flash via /title (subtitle set first so the title displays both).
    function showTitle(player, title, subtitle, color) {
        if (!player) return;
        try {
            var server = player.server;
            if (!server || typeof server.runCommandSilent !== "function") return;
            var name = player.username;
            server.runCommandSilent('title ' + name + ' subtitle {"text":"' + String(subtitle || "") + '","color":"gray"}');
            server.runCommandSilent('title ' + name + ' title {"text":"' + String(title) + '","color":"' + (color || "white") + '"}');
        } catch (e) {}
    }
    // Victory particle burst around the player.
    function victoryBurst(player) {
        if (!player) return;
        try {
            var server = player.server;
            if (!server || typeof server.runCommandSilent !== "function") return;
            var p = player.position();
            server.runCommandSilent(
                "particle minecraft:totem_of_undying " +
                fmt1(p.x) + " " + fmt1(p.y + 1.0) + " " + fmt1(p.z) +
                " 1 1 1 0.4 80 force");
        } catch (e) {}
    }
    // Shallow-copy a plain object (null otherwise). Lets a reusable archetype's
    // equip/nbt be referenced by many raids without a later .equip()/.nbt() chain
    // mutating the shared source object.
    function shallowCopy(o) {
        if (!o || typeof o !== "object") return null;
        var r = {}; for (var k in o) r[k] = o[k]; return r;
    }

    // ---------- Registry ----------------------------------------------------

    const RAIDS = {};
    const Registry = {
        register: function (def) {
            if (!def || !def.id) { err("register: def missing id"); return false; }
            if (RAIDS[def.id]) warn(`overwriting raid "${def.id}"`);
            RAIDS[def.id] = def;
            info(`registered raid "${def.id}" (${def.rounds.length} rounds)`);
            return true;
        },
        get:  function (id) { return RAIDS[id] || null; },
        has:  function (id) { return !!RAIDS[id]; },
        list: function () { return Object.keys(RAIDS); }
    };

    // ---------- Builder -----------------------------------------------------

    function numberOr(value, fallback) {
        if (value == null) return fallback;
        var n = Number(value);
        return isFinite(n) ? n : fallback;
    }
    function nonNegativeOr(value, fallback) {
        var n = numberOr(value, fallback);
        return n < 0 ? 0 : n;
    }
    function positiveIntOr(value, fallback) {
        var n = parseInt(value, 10);
        if (!isFinite(n) || n < 1) return fallback;
        return n;
    }
    function optionalNonNegative(value) {
        if (value == null) return null;
        return nonNegativeOr(value, 0);
    }
    function normalizedSpawn(minR, maxR) {
        var min = nonNegativeOr(minR, DEFAULT_MIN_R);
        var max = nonNegativeOr(maxR, DEFAULT_MAX_R);
        if (max < min) { var tmp = min; min = max; max = tmp; }
        return { minRadius: min, maxRadius: max };
    }
    function normalizeMobSpec(typeOrSpec) {
        if (typeOrSpec && typeof typeOrSpec === "object") {
            var s = typeOrSpec;
            return {
                type:       String(s.type || s.id || ""),
                count:      positiveIntOr(s.count, 1),
                presets:    Array.isArray(s.presets) ? s.presets.slice() : [],
                extraArgs:  Array.isArray(s.extraArgs) ? s.extraArgs.slice() : [],
                noDefaults: !!s.noDefaults,
                equip:      shallowCopy(s.equip),   // copied so a shared archetype isn't mutated
                nbt:        shallowCopy(s.nbt)
            };
        }
        return { type: String(typeOrSpec || ""), count: 1, presets: [], extraArgs: [], noDefaults: false, equip: null, nbt: null };
    }

    function RaidBuilder(id) {
        this.def = {
            id: String(id || ""),
            spawn: normalizedSpawn(DEFAULT_MIN_R, DEFAULT_MAX_R),
            spawnPattern: "ring",   // "ring" (spread around player) | "horde" (one cluster, one direction)
            hordeAngle: null,       // degrees: fixed horde direction; null -> per-round deterministic pick
            defaultPresets: [],
            rounds: [],
            callbacks: {},
            title: null,            // boss bar label (null -> prettified id)
            bossBar: true,          // show a vanilla-style raid boss bar
            barColor: "RED",        // BossBarColor enum name
            barOverlay: "NOTCHED_10",// BossBarOverlay enum name
            barHold: DEFAULT_BAR_HOLD,// ticks victory/defeat bar lingers
            waterproof: true,        // raid mobs swim fast + never drown (attributes/water_movement_efficiency + oxygen_bonus)
            aggroRadius: 20,         // blocks: mobs proactively attack players/villagers/golems within this
            followRange: null,       // blocks: player detection + chase range (sets attributes/follow_range on every mob)
            sounds: {                // played to the target player (id null/"" = silent)
                raidStart:  { id: "minecraft:entity.wither.spawn",         vol: 0.7, pitch: 1.0 }, // once at raid start, broadcast to nearby players
                roundStart: { id: "minecraft:block.bell.use",              vol: 1.0, pitch: 0.8 }, // per-wave cue (skipped on wave 1 — raidStart covers it)
                roundEnd:   { id: "minecraft:entity.player.levelup",       vol: 1.0, pitch: 1.2 }, // wave-clear stinger (non-final waves)
                win:        { id: "minecraft:ui.toast.challenge_complete", vol: 1.0, pitch: 1.0 },
                lose:       { id: "minecraft:entity.elder_guardian.curse", vol: 1.0, pitch: 0.9 }
            }
        };
        this._round = null;   // current round being configured
        this._mob   = null;   // current mob group being configured
    }
    RaidBuilder.prototype.spawn = function (minR, maxR) {
        this.def.spawn = normalizedSpawn(minR, maxR);
        return this;
    };
    // "ring" (default): mobs evenly spaced around the player.
    // "horde": the whole round clusters at one anchor point in one direction.
    RaidBuilder.prototype.spawnPattern = function (p) {
        var s = String(p || "").toLowerCase();
        if (s !== "ring" && s !== "horde") { warn(`spawnPattern("${p}") unknown — using "ring"`); s = "ring"; }
        this.def.spawnPattern = s;
        return this;
    };
    // Fixed horde direction in degrees (0 = +X / east, 90 = +Z / south).
    // Overrides the per-round deterministic angle pick. Only used by "horde".
    RaidBuilder.prototype.hordeAngle = function (deg) {
        var n = Number(deg);
        this.def.hordeAngle = isFinite(n) ? n : null;
        if (!isFinite(n)) warn(`hordeAngle("${deg}") not a number — auto angle`);
        return this;
    };
    RaidBuilder.prototype.defaultPresets = function () {
        for (var i = 0; i < arguments.length; i++) this.def.defaultPresets.push(String(arguments[i]));
        return this;
    };
    RaidBuilder.prototype.round = function (name) {
        this._round = {
            name: name || ("Round " + (this.def.rounds.length + 1)),
            breather: DEFAULT_BREATHER,
            timeLimit: null,
            mobs: []
        };
        this._mob = null;
        this.def.rounds.push(this._round);
        return this;
    };
    RaidBuilder.prototype.breather = function (ticks) {
        if (this._round) this._round.breather = nonNegativeOr(ticks, DEFAULT_BREATHER); else warn("breather() before round()");
        return this;
    };
    RaidBuilder.prototype.timeLimit = function (ticks) {
        if (this._round) this._round.timeLimit = optionalNonNegative(ticks); else warn("timeLimit() before round()");
        return this;
    };
    // Accepts a type id string OR a full spec object:
    //   .mob({ type, count, presets, extraArgs, noDefaults, equip, nbt })
    // Modded mobs work as long as type carries a namespace ("modid:mob").
    RaidBuilder.prototype.mob = function (typeOrSpec) {
        if (!this._round) { warn("mob() before round(); opening a default round"); this.round(null); }
        this._mob = normalizeMobSpec(typeOrSpec);
        this._round.mobs.push(this._mob);
        return this;
    };
    RaidBuilder.prototype.count = function (n) {
        if (this._mob) this._mob.count = positiveIntOr(n, 1); else warn("count() before mob()");
        return this;
    };
    RaidBuilder.prototype.presets = function () {
        if (!this._mob) { warn("presets() before mob()"); return this; }
        for (var i = 0; i < arguments.length; i++) this._mob.presets.push(String(arguments[i]));
        return this;
    };
    RaidBuilder.prototype.extraArgs = function () {
        if (!this._mob) { warn("extraArgs() before mob()"); return this; }
        for (var i = 0; i < arguments.length; i++) this._mob.extraArgs.push(arguments[i]);
        return this;
    };
    RaidBuilder.prototype.noDefaults = function () {
        if (this._mob) this._mob.noDefaults = true; else warn("noDefaults() before mob()");
        return this;
    };
    // Equipment — item id strings ("minecraft:bow"), "count id", or {id,count}.
    // Slots: mainhand/offhand/head(helmet)/chest(chestplate)/legs(leggings)/feet(boots).
    RaidBuilder.prototype.equip = function (obj) {
        if (!this._mob) { warn("equip() before mob()"); return this; }
        if (!this._mob.equip) this._mob.equip = {};
        for (var k in obj) this._mob.equip[k] = obj[k];
        return this;
    };
    RaidBuilder.prototype.mainHand   = function (it) { return this.equip({ mainhand: it }); };
    RaidBuilder.prototype.offHand    = function (it) { return this.equip({ offhand: it }); };
    RaidBuilder.prototype.helmet     = function (it) { return this.equip({ head: it }); };
    RaidBuilder.prototype.chestplate = function (it) { return this.equip({ chest: it }); };
    RaidBuilder.prototype.leggings   = function (it) { return this.equip({ legs: it }); };
    RaidBuilder.prototype.boots      = function (it) { return this.equip({ feet: it }); };
    RaidBuilder.prototype.armor      = function (h, c, l, f) { return this.equip({ head: h, chest: c, legs: l, feet: f }); };
    // Raw entity NBT merged pre-spawn — variants/"skins", baby flag, mod data, etc.
    RaidBuilder.prototype.nbt = function (obj) {
        if (!this._mob) { warn("nbt() before mob()"); return this; }
        if (!this._mob.nbt) this._mob.nbt = {};
        for (var k in obj) this._mob.nbt[k] = obj[k];
        return this;
    };
    RaidBuilder.prototype.title      = function (s) { this.def.title = String(s); return this; };
    RaidBuilder.prototype.bossBar    = function (on) { this.def.bossBar = (on !== false); return this; };
    RaidBuilder.prototype.barColor   = function (c) { this.def.barColor = String(c); return this; };
    RaidBuilder.prototype.barOverlay = function (o) { this.def.barOverlay = String(o); return this; };
    RaidBuilder.prototype.barHold    = function (t) { this.def.barHold = nonNegativeOr(t, DEFAULT_BAR_HOLD); return this; };
    // Water handling (default ON): full-speed water movement + no drowning for
    // every mob of the raid. .waterproof(false) restores vanilla water behavior.
    RaidBuilder.prototype.waterproof = function (on) { this.def.waterproof = (on !== false); return this; };
    RaidBuilder.prototype.aggroRadius = function (n) { this.def.aggroRadius = nonNegativeOr(n, 20); return this; };
    RaidBuilder.prototype.followRange = function (n) { this.def.followRange = optionalNonNegative(n); return this; };
    function _snd(id, vol, pitch) {
        return {
            id: (id == null ? "" : String(id)),
            vol: numberOr(vol, 1.0),
            pitch: numberOr(pitch, 1.0)
        };
    }
    RaidBuilder.prototype.raidStartSound  = function (id, vol, pitch) { this.def.sounds.raidStart  = _snd(id, vol, pitch); return this; };
    RaidBuilder.prototype.roundStartSound = function (id, vol, pitch) { this.def.sounds.roundStart = _snd(id, vol, pitch); return this; };
    RaidBuilder.prototype.roundEndSound   = function (id, vol, pitch) { this.def.sounds.roundEnd   = _snd(id, vol, pitch); return this; };
    RaidBuilder.prototype.winSound        = function (id, vol, pitch) { this.def.sounds.win        = _snd(id, vol, pitch); return this; };
    RaidBuilder.prototype.loseSound       = function (id, vol, pitch) { this.def.sounds.lose       = _snd(id, vol, pitch); return this; };
    RaidBuilder.prototype.onStart      = function (fn) { this.def.callbacks.onStart = fn; return this; };
    RaidBuilder.prototype.onRoundStart = function (fn) { this.def.callbacks.onRoundStart = fn; return this; };
    RaidBuilder.prototype.onRoundEnd   = function (fn) { this.def.callbacks.onRoundEnd = fn; return this; };
    RaidBuilder.prototype.onWin        = function (fn) { this.def.callbacks.onWin = fn; return this; };
    RaidBuilder.prototype.onLose       = function (fn) { this.def.callbacks.onLose = fn; return this; };
    RaidBuilder.prototype.build = function () {
        var d = this.def;
        if (!validateDef(d)) { err(`raid "${d.id}" failed validation — not registered`); return null; }
        Registry.register(d);
        return d;
    };

    function validateDef(d) {
        if (!d.id || typeof d.id !== "string") { err("def id missing/not a string"); return false; }
        if (!d.spawn || !(d.spawn.minRadius >= 0) || !(d.spawn.maxRadius >= d.spawn.minRadius)) {
            err(`raid "${d.id}": bad spawn radius (${d.spawn && d.spawn.minRadius}, ${d.spawn && d.spawn.maxRadius})`);
            return false;
        }
        if (d.spawnPattern !== "ring" && d.spawnPattern !== "horde") { err(`raid "${d.id}": bad spawnPattern "${d.spawnPattern}"`); return false; }
        if (d.hordeAngle != null && !isFinite(Number(d.hordeAngle))) { err(`raid "${d.id}": bad hordeAngle "${d.hordeAngle}"`); return false; }
        if (!(d.aggroRadius >= 0)) { err(`raid "${d.id}": bad aggroRadius "${d.aggroRadius}"`); return false; }
        if (d.followRange != null && !(d.followRange >= 0)) { err(`raid "${d.id}": bad followRange "${d.followRange}"`); return false; }
        if (!(d.barHold >= 0)) { err(`raid "${d.id}": bad barHold "${d.barHold}"`); return false; }
        if (!d.rounds || d.rounds.length === 0) { err(`raid "${d.id}": no rounds`); return false; }
        var EAI = getEAI();
        var presetMap = (EAI && EAI.presets) ? EAI.presets : {};
        for (var i = 0; i < d.rounds.length; i++) {
            var r = d.rounds[i];
            if (!(r.breather >= 0)) { err(`raid "${d.id}" round ${i}: bad breather "${r.breather}"`); return false; }
            if (r.timeLimit != null && !(r.timeLimit >= 0)) { err(`raid "${d.id}" round ${i}: bad timeLimit "${r.timeLimit}"`); return false; }
            if (!r.mobs || r.mobs.length === 0) { err(`raid "${d.id}" round ${i} "${r.name}": no mobs`); return false; }
            for (var j = 0; j < r.mobs.length; j++) {
                var m = r.mobs[j];
                if (!m.type || m.type.indexOf(":") === -1) { err(`raid "${d.id}" round ${i}: bad mob type "${m.type}"`); return false; }
                if (!(m.count >= 1)) { err(`raid "${d.id}" round ${i}: mob "${m.type}" count < 1`); return false; }
                var names = m.noDefaults ? m.presets : d.defaultPresets.concat(m.presets);
                for (var k = 0; k < names.length; k++) {
                    if (!presetMap[names[k]]) warn(`raid "${d.id}": unknown preset "${names[k]}" (mob ${m.type}) — EAI will skip it`);
                }
            }
        }
        return true;
    }

    // Effective EAI preset names for a mob = (noDefaults ? [] : defaultPresets) + mob presets.
    function mobPresetNames(def, mob) {
        return mob.noDefaults ? mob.presets.slice() : def.defaultPresets.concat(mob.presets);
    }

    // ---------- Spawner -----------------------------------------------------

    const SPAWN_TRIES  = 10;   // candidate positions tried per mob before fallback
    const SPAWN_Y_SCAN = 16;   // vertical search range (blocks) around the player's Y

    // Hard cap on the follow_range actually applied to raid mobs. Vanilla path
    // search cost scales with follow_range (it bounds the A* search region per
    // repath), so followRange(300) made EVERY repath of EVERY mob scan a huge
    // region — the dominant lag with 40+ mobs. Detection/chase does NOT need it:
    // aggro() setTarget has no range limit and re-pulls mobs every 5 ticks, and
    // a partial path still walks the mob toward a target beyond this cap.
    const FOLLOW_RANGE_CAP = 48;

    // Blocks a mob must not stand ON (instant damage / sink / suffocate-adjacent).
    var _dangerBelow = {
        "minecraft:lava": 1, "minecraft:water": 1, "minecraft:magma_block": 1,
        "minecraft:cactus": 1, "minecraft:fire": 1, "minecraft:soul_fire": 1,
        "minecraft:campfire": 1, "minecraft:soul_campfire": 1,
        "minecraft:powder_snow": 1, "minecraft:sweet_berry_bush": 1
    };
    // Non-air blocks a mob may still stand IN (replaceable plants, thin snow).
    var _passable = {
        "minecraft:short_grass": 1, "minecraft:grass": 1, "minecraft:tall_grass": 1,
        "minecraft:fern": 1, "minecraft:large_fern": 1, "minecraft:snow": 1,
        "minecraft:dead_bush": 1, "minecraft:dandelion": 1, "minecraft:poppy": 1
    };
    function blockId(b) { try { return String(b.id); } catch (e) { return ""; } }
    function isPassable(b)  { return isAirBlock(b) || !!_passable[blockId(b)]; }
    function isSafeFloor(b) { return b && !isAirBlock(b) && !_passable[blockId(b)] && !_dangerBelow[blockId(b)]; }

    // Ground Y near the player's elevation: from playerY outward (0,+1,-1,+2,-2…)
    // find solid safe floor with 2 passable blocks above. Nearest-to-player-Y wins,
    // so mobs spawn on the player's terrace, not a cliff top or cave roof above.
    // Returns null when the column has no safe spot (caller tries another column).
    function groundY(level, x, baseY, z) {
        try {
            var bx = Math.floor(x), bz = Math.floor(z), py = Math.floor(baseY);
            for (var off = 0; off <= SPAWN_Y_SCAN; off++) {
                for (var s = 0; s < (off === 0 ? 1 : 2); s++) {
                    var y = py + (s === 0 ? off : -off);
                    var below = level.getBlock(bx, y - 1, bz);
                    if (!isSafeFloor(below)) continue;
                    if (isPassable(level.getBlock(bx, y, bz)) && isPassable(level.getBlock(bx, y + 1, bz))) return y;
                }
            }
        } catch (e) { warn(`groundY: ${e}`); }
        return null;
    }

    // Pick a safe ring position for global mob index idx (of total). Base angle is
    // evenly spaced; each retry nudges angle + radius deterministically (no
    // Math.random — Rhino-safe and reproducible). Falls back to minR at the base
    // angle on the player's Y if every candidate column is unsafe (mid-ocean, void).
    function findSpawnPos(level, pp, def, idx, total) {
        var minR = def.spawn.minRadius, maxR = def.spawn.maxRadius;
        var span = Math.max(1, maxR - minR + 1);
        var baseAng = (idx / total) * Math.PI * 2;
        for (var t = 0; t < SPAWN_TRIES; t++) {
            var ang = baseAng + t * 0.618 * (t % 2 === 0 ? 1 : -1) * 0.35;
            var rad = minR + ((idx * 13 + t * 7) % span);
            var x = pp.x + Math.cos(ang) * rad;
            var z = pp.z + Math.sin(ang) * rad;
            var y = groundY(level, x, pp.y, z);
            if (y != null) return { x: x, y: y, z: z };
        }
        warn("findSpawnPos: no safe column after " + SPAWN_TRIES + " tries — fallback at player Y");
        return {
            x: pp.x + Math.cos(baseAng) * minR,
            y: Math.floor(pp.y),
            z: pp.z + Math.sin(baseAng) * minR
        };
    }

    // ---- Horde pattern ------------------------------------------------------
    // All mobs of a round cluster around one anchor point in one direction from
    // the player. Anchor angle: fixed via def.hordeAngle, else a deterministic
    // per-round pick hashed from instanceId + round index (no Math.random).

    const HORDE_ZONE_R    = 2;  // landing-zone sample radius around the anchor
    const HORDE_SPREAD_MAX = 4; // max blocks a mob offsets from the anchor
    const GOLDEN_ANG      = 2.399963; // radians — spreads cluster offsets evenly

    function hashStr(s) {
        var h = 5381;
        for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) & 0x7fffffff;
        return h;
    }

    // Validate a whole landing zone, not just one column: anchor + 4 side samples
    // at HORDE_ZONE_R must all have safe floor (same rules as groundY) at a
    // similar elevation. Returns the anchor Y, or null if the zone is unusable.
    function hordeZoneY(level, pp, ax, az) {
        var ay = groundY(level, ax, pp.y, az);
        if (ay == null) return null;
        var samples = [[HORDE_ZONE_R, 0], [-HORDE_ZONE_R, 0], [0, HORDE_ZONE_R], [0, -HORDE_ZONE_R]];
        for (var i = 0; i < samples.length; i++) {
            var sy = groundY(level, ax + samples[i][0], ay, az + samples[i][1]);
            if (sy == null || Math.abs(sy - ay) > 3) return null;
        }
        return ay;
    }

    // Find the horde anchor: try the base angle, then rotate 45° per retry
    // through the other 7 directions. Falls back to the base angle at the
    // player's Y if no direction validates (mid-ocean, void).
    function findHordeAnchor(level, pp, def, instanceId, roundIdx) {
        var rad = (def.spawn.minRadius + def.spawn.maxRadius) / 2;
        var baseAng = (def.hordeAngle != null)
            ? def.hordeAngle * Math.PI / 180
            : ((hashStr(String(instanceId) + "#" + roundIdx) % 360) * Math.PI / 180);
        for (var d = 0; d < 8; d++) {
            var ang = baseAng + d * (Math.PI / 4);
            var ax = pp.x + Math.cos(ang) * rad;
            var az = pp.z + Math.sin(ang) * rad;
            var ay = hordeZoneY(level, pp, ax, az);
            if (ay != null) return { x: ax, y: ay, z: az };
        }
        warn("findHordeAnchor: no valid zone in 8 directions — fallback at player Y");
        return {
            x: pp.x + Math.cos(baseAng) * rad,
            y: Math.floor(pp.y),
            z: pp.z + Math.sin(baseAng) * rad
        };
    }

    // Deterministic small offset around the anchor for cluster mob idx:
    // golden-angle direction, radius scaled to the wave size so big hordes
    // don't cram into a 4-block ring and jam each other (collision shoving
    // freezes pathing). ~sqrt(total) keeps density roughly constant. Per-column
    // ground lookup; anchor Y is the fallback when a column is unsafe.
    function hordeMobPos(level, anchor, idx, total) {
        var spread = Math.max(HORDE_SPREAD_MAX, Math.ceil(Math.sqrt(total || 1) * 1.5));
        var ang = idx * GOLDEN_ANG;
        var rad = 1 + ((idx * 5) % spread);
        var x = anchor.x + Math.cos(ang) * rad;
        var z = anchor.z + Math.sin(ang) * rad;
        var y = groundY(level, x, anchor.y, z);
        return { x: x, y: (y != null ? y : anchor.y), z: z };
    }

    // ---- Water assist -------------------------------------------------------
    // Runs on the throttle tick for waterproof raids. Attributes handle the
    // speed + oxygen; this covers what attributes can't:
    //   - air topped up (belt-and-suspenders vs oxygen_bonus edge cases)
    //   - zombie -> drowned conversion blocked (InWaterTime reset; the 600-tick
    //     timer never accumulates across our 5-tick cadence)
    //   - a short dolphins_grace pulse so pathing through water keeps pace
    function waterAssist(inst) {
        if (inst.def.waterproof === false) return;
        eachMob(inst, function (m) {
            var raw = rawMobOf(m);
            if (!raw) return;
            var inWater = false;
            try { inWater = (typeof raw.isInWater === "function") && raw.isInWater(); } catch (e) {}
            if (!inWater) return;
            try {
                if (typeof raw.setAirSupply === "function" && typeof raw.getMaxAirSupply === "function")
                    raw.setAirSupply(raw.getMaxAirSupply());
            } catch (e1) {}
            try { m.mergeNbt({ InWaterTime: -1, DrownedConversionTime: -1 }); } catch (e2) {}
            try { m.potionEffects.add("minecraft:dolphins_grace", 40, 0, false, false); } catch (e3) {}
        });
    }

    // Rotate a freshly spawned mob to face the player (cosmetic, best-effort).
    function facePlayer(entity, pos, pp) {
        try {
            var yaw = (Math.atan2(pp.z - pos.z, pp.x - pos.x) * 180 / Math.PI) - 90;
            if (typeof entity.setRotation === "function") entity.setRotation(yaw, 0);
        } catch (e) {}
    }

    // Colored glow outline: every raid mob joins the "raidmobs" scoreboard team
    // (dark_red). The vanilla glowing effect renders its outline in the team
    // color, so glowing raid mobs are instantly tellable from ambient mobs.
    // Team creation is idempotent ("team add" on an existing team just fails
    // silently); _teamReady only skips the redundant setup calls.
    var _teamReady = false;
    function joinRaidTeam(server, entity) {
        if (!server || typeof server.runCommandSilent !== "function" || !entity) return;
        if (!_teamReady) {
            try { server.runCommandSilent("team add raidmobs"); } catch (e) {}
            try { server.runCommandSilent("team modify raidmobs color dark_red"); } catch (e2) {}
            _teamReady = true;
        }
        try { server.runCommandSilent("team join raidmobs " + String(entity.uuid)); } catch (e3) {}
    }

    // Spawn telegraph: cloud puff at the spot so waves read as "arriving".
    function spawnPoof(player, pos) {
        if (!player) return;
        try {
            var server = player.server;
            if (!server || typeof server.runCommandSilent !== "function") return;
            server.runCommandSilent(
                "particle minecraft:cloud " +
                pos.x.toFixed(1) + " " + (pos.y + 0.5).toFixed(1) + " " + pos.z.toFixed(1) +
                " 0.3 0.5 0.3 0.02 12 force");
        } catch (e) {}
    }

    // Steer the mob toward the player ONLY when it has no valid target of its
    // own. Lets natural AI win when it kicks in: HurtByTargetGoal (retaliate vs
    // whoever attacks it), raider villager-hunting, other players. Player is the
    // fallback that re-aggros an idle mob, so the wave always drifts inward.
    function forceTarget(entity, player) {
        if (!player) return;
        try {
            var EAI = getEAI();
            var raw = EAI ? EAI.rawMob(entity) : entity;
            if (!raw || typeof raw.setTarget !== "function") return;
            var cur = null;
            try { cur = (typeof raw.getTarget === "function") ? raw.getTarget() : null; } catch (eGt) {}
            var hasValid = false;
            if (cur) { try { hasValid = (!cur.isAlive || cur.isAlive()); } catch (eAl) { hasValid = true; } }
            if (!hasValid) raw.setTarget(player);
        } catch (e) { /* mob may be dead/unloaded */ }
    }

    // ---------- Targeting engine (mod-agnostic) -----------------------------
    // Drives every raid mob's target each throttle tick so behavior is identical
    // for vanilla and modded mobs (no reliance on a mob having HurtByTargetGoal
    // or a villager-targeting goal). Priority per mob:
    //   1. retaliate vs whoever last hurt it (any player/mob, not a raid ally)
    //   2. keep its current non-player victim until that victim dies
    //   3. nearest player/villager/golem within aggroRadius
    //   4. fall back to the main player (the long pull inward)
    //   5. main player dead/offline -> only (3); idle until they respawn

    var _rc = {};
    function RC(fqn) {
        if (_rc[fqn] !== undefined) return _rc[fqn];
        try { _rc[fqn] = Java.loadClass(fqn); } catch (e) { _rc[fqn] = null; }
        return _rc[fqn];
    }
    var _aggroCls = null;
    function aggroClasses() {
        if (_aggroCls) return _aggroCls;
        _aggroCls = {
            Living:   RC("net.minecraft.world.entity.LivingEntity"),
            Player:   RC("net.minecraft.world.entity.player.Player"),
            Villager: RC("net.minecraft.world.entity.npc.AbstractVillager"),
            Golem:    RC("net.minecraft.world.entity.animal.IronGolem"),
            AABB:     RC("net.minecraft.world.phys.AABB"),
            Slot:     RC("net.minecraft.world.entity.EquipmentSlot")
        };
        return _aggroCls;
    }

    function rawMobOf(entity) {
        var EAI = getEAI();
        try { return EAI ? EAI.rawMob(entity) : entity; } catch (e) { return entity; }
    }
    function unwrapPlayer(p) {
        if (!p) return null;
        try { if (p.minecraftEntity) return p.minecraftEntity; } catch (e) {}
        try { if (typeof p.unwrap === "function") return p.unwrap(); } catch (e2) {}
        return p;
    }
    function isLiveEnt(e) { try { return e && (!e.isAlive || e.isAlive()); } catch (x) { return false; } }
    function isAlly(e)    { try { var t = e.getTags(); return t && t.contains("raid_mob"); } catch (x) { return false; } }
    function sameEnt(a, b) {
        if (!a || !b) return false;
        try { if (typeof a.is === "function") return a.is(b); } catch (x) {}
        try { return String(a.getUUID()) === String(b.getUUID()); } catch (y) {}
        return a === b;
    }
    function canHit(raw, t) {
        try { if (typeof raw.canAttack === "function") return raw.canAttack(t); } catch (x) {}
        return true;
    }
    function validVictim(raw, t) {
        if (!isLiveEnt(t) || sameEnt(raw, t) || isAlly(t)) return false;
        var C = aggroClasses();
        try {
            if (C.Player && C.Player.isInstance(t)) {
                if (typeof t.isSpectator === "function" && t.isSpectator()) return false;
                if (typeof t.isCreative === "function" && t.isCreative()) return false;
            }
        } catch (x) {}
        return canHit(raw, t);
    }
    function isVictimClass(e) {
        var C = aggroClasses();
        try { if (C.Player   && C.Player.isInstance(e))   return true; } catch (x) {}
        try { if (C.Villager && C.Villager.isInstance(e)) return true; } catch (y) {}
        try { if (C.Golem    && C.Golem.isInstance(e))    return true; } catch (z) {}
        return false;
    }
    // Mob-independent half of validVictim (live, not a raid ally, victim class,
    // not spectator/creative). Checked ONCE per candidate per aggro pass; the
    // per-mob half (sameEnt/canHit) stays in nearestFrom.
    function victimEligible(e) {
        if (!isLiveEnt(e) || isAlly(e) || !isVictimClass(e)) return false;
        var C = aggroClasses();
        try {
            if (C.Player && C.Player.isInstance(e)) {
                if (typeof e.isSpectator === "function" && e.isSpectator()) return false;
                if (typeof e.isCreative === "function" && e.isCreative()) return false;
            }
        } catch (x) {}
        return true;
    }
    // ONE entity query per instance per aggro pass, shared by every mob (was one
    // AABB scan per mob — quadratic with big waves). Box is centered on the main
    // player (or a live mob when they're dead/offline) and covers the spawn ring
    // plus the aggro radius, so victims near stragglers are still found.
    function collectVictims(inst, centerRaw, radius) {
        var C = aggroClasses();
        if (!C.Living || !centerRaw) return [];
        var level = null;
        try { level = (typeof centerRaw.level === "function") ? centerRaw.level() : centerRaw.level; } catch (eL) {}
        if (!level || typeof level.getEntitiesOfClass !== "function") return [];
        var box;
        try { box = centerRaw.getBoundingBox().inflate(radius + inst.def.spawn.maxRadius + 16); } catch (e) { return []; }
        var list;
        try { list = level.getEntitiesOfClass(C.Living, box); } catch (e2) { return []; }
        var out = [];
        try {
            var it = list.iterator();
            while (it.hasNext()) {
                var e = it.next();
                if (victimEligible(e)) out.push(e);
            }
        } catch (e3) {}
        return out;
    }
    function nearestFrom(raw, victims, radiusSqr) {
        var best = null, bestD = radiusSqr;
        for (var i = 0; i < victims.length; i++) {
            var e = victims[i];
            if (sameEnt(raw, e)) continue;
            var d;
            try { d = raw.distanceToSqr(e); } catch (x) { continue; }
            if (d <= bestD && canHit(raw, e)) { bestD = d; best = e; }
        }
        return best;
    }
    function decideTarget(raw, mainRaw, victims, radiusSqr) {
        var atk = null;
        try { atk = (typeof raw.getLastHurtByMob === "function") ? raw.getLastHurtByMob() : null; } catch (x) {}
        if (validVictim(raw, atk)) return atk;                       // 1 retaliate

        var cur = null;
        try { cur = (typeof raw.getTarget === "function") ? raw.getTarget() : null; } catch (y) {}
        if (cur && validVictim(raw, cur) && !(mainRaw && sameEnt(cur, mainRaw))) return cur; // 2 keep victim

        var v = nearestFrom(raw, victims, radiusSqr);                // 3 nearest in radius
        if (v) return v;

        if (mainRaw && validVictim(raw, mainRaw)) return mainRaw;    // 4 main player
        return null;                                                 // 5 idle
    }

    // ---- Anti-stuck ---------------------------------------------------------
    // A mob that has a target but hasn't moved between aggro passes first gets a
    // navigation recompute; if it stays frozen ~8s while far from its target it
    // teleports onto safe ground near the target. Standstills inside STUCK_NEAR
    // are legit (melee crowd, bow/skirmisher hold range) and never count as
    // stuck, so ranged kiting and EAI digging/fishing goals aren't disturbed.
    const STUCK_MOVE_SQ = 0.25; // blocks² moved per pass below this = "not moving"
    const STUCK_NEAR_SQ = 576;  // 24² blocks — inside this idling is allowed
    const STUCK_KICK    = 4;    // idle passes before a nav recompute (repeats every 4)
    const STUCK_TP      = 32;   // idle passes (~8s at 5-tick cadence) before hard teleport
    const STUCK_TP_R    = 12;   // teleport ring radius around the target

    function unstick(inst, raw, target) {
        var key;
        try { key = String(raw.getStringUUID()); }
        catch (e) { try { key = String(raw.getUUID()); } catch (e2) { return; } }
        var x, y, z;
        try { x = raw.getX(); y = raw.getY(); z = raw.getZ(); } catch (e3) { return; }
        var st = inst._mobState[key];
        if (!st) { inst._mobState[key] = { x: x, y: y, z: z, idle: 0, tp: 0 }; return; }
        var dx = x - st.x, dy = y - st.y, dz = z - st.z;
        var movedSq = dx * dx + dy * dy + dz * dz;
        st.x = x; st.y = y; st.z = z;
        var distSq;
        try { distSq = raw.distanceToSqr(target); } catch (e4) { return; }
        if (movedSq > STUCK_MOVE_SQ || distSq < STUCK_NEAR_SQ) { st.idle = 0; return; }
        st.idle++;
        if (st.idle >= STUCK_TP) {
            st.idle = 0; st.tp++;
            var ang = ((hashStr(key) % 360) * Math.PI / 180) + st.tp * GOLDEN_ANG;
            try {
                var lvl = (typeof raw.level === "function") ? raw.level() : raw.level;
                var tx = target.getX() + Math.cos(ang) * STUCK_TP_R;
                var tz = target.getZ() + Math.sin(ang) * STUCK_TP_R;
                var ty = groundY(lvl, tx, target.getY(), tz);
                if (ty != null) {
                    if (typeof raw.teleportTo === "function") raw.teleportTo(Math.floor(tx) + 0.5, ty, Math.floor(tz) + 0.5);
                    else raw.setPos(Math.floor(tx) + 0.5, ty, Math.floor(tz) + 0.5);
                }
            } catch (e5) {}
            return;
        }
        // Gentle kick: recompute a path only when navigation is idle, so active
        // paths and custom EAI goals (miner digging, fisher casting) keep control.
        if (st.idle % STUCK_KICK === 0) {
            try {
                var nav = (typeof raw.getNavigation === "function") ? raw.getNavigation() : null;
                if (nav && (typeof nav.isDone !== "function" || nav.isDone())) nav.moveTo(target, 1.0);
            } catch (e6) {}
        }
    }

    // ---------- Equipment / NBT --------------------------------------------

    var _slotMap = {
        mainhand: "MAINHAND", main: "MAINHAND", offhand: "OFFHAND", off: "OFFHAND",
        head: "HEAD", helmet: "HEAD", chest: "CHEST", chestplate: "CHEST",
        legs: "LEGS", leggings: "LEGS", feet: "FEET", boots: "FEET"
    };
    function makeStack(spec) {
        if (spec == null) return null;
        try {
            if (typeof spec === "string") return Item.of(spec);
            if (typeof spec === "object") {
                var st = Item.of(spec.id || spec.item || spec.type);
                if (st && spec.count != null && typeof st.setCount === "function") st.setCount(parseInt(spec.count, 10) || 1);
                return st;
            }
        } catch (e) { warn("makeStack(" + spec + "): " + e); }
        return null;
    }
    // Walk the class hierarchy for a no-arg method (e.g. Skeleton.reassessWeaponGoal,
    // needed so a bow equipped post-spawn actually enables the ranged attack goal).
    function invokeNoArg(obj, name) {
        try {
            var cls = obj.getClass();
            while (cls) {
                var m = null;
                try { m = cls.getDeclaredMethod(name); } catch (e) { m = null; }
                if (m) { try { m.setAccessible(true); m.invoke(obj); return true; } catch (e2) { return false; } }
                cls = cls.getSuperclass();
            }
        } catch (e3) {}
        return false;
    }
    function equipMob(entity, equip) {
        if (!equip) return;
        var raw = rawMobOf(entity);
        var ES = aggroClasses().Slot;
        if (!raw || !ES || typeof raw.setItemSlot !== "function") return;
        var any = false;
        for (var k in equip) {
            var slotName = _slotMap[String(k).toLowerCase()];
            if (!slotName) continue;
            var stack = makeStack(equip[k]);
            if (stack == null) continue;
            var slot = null;
            try { slot = ES.valueOf(slotName); } catch (e) { continue; }
            try { raw.setItemSlot(slot, stack); any = true; } catch (e2) { warn("setItemSlot " + k + ": " + e2); continue; }
            try { if (typeof raw.setDropChance === "function") raw.setDropChance(slot, 0.0); } catch (e3) {}
        }
        if (any) invokeNoArg(raw, "reassessWeaponGoal");   // no-op on mobs without it
    }
    function applyEntityNbt(entity, nbt) {
        if (!nbt) return;
        try { if (typeof entity.mergeNbt === "function") entity.mergeNbt(nbt); }
        catch (e) { warn("mergeNbt(entity): " + e); }
    }

    // Spawn every mob of a round in a ring around the player. Returns entity refs.
    function spawnRound(level, player, def, round, instanceId) {
        var EAI = getEAI();
        if (!EAI || !player) return [];
        var out = [];
        var pp = null;
        try { pp = player.position(); } catch (ePp) { warn(`spawnRound: player.position() failed: ${ePp}`); return []; }
        var server = null;
        try { server = player.server; } catch (eSv) {}
        // total mob count -> evenly spaced ring angle by global index (no Math.random).
        var total = 0;
        for (var ti = 0; ti < round.mobs.length; ti++) total += round.mobs[ti].count;
        if (total < 1) total = 1;
        var idx = 0;

        // Horde pattern: resolve the shared anchor once for the whole round.
        var anchor = null;
        if (def.spawnPattern === "horde") {
            var roundIdx = def.rounds.indexOf(round);
            anchor = findHordeAnchor(level, pp, def, instanceId, roundIdx);
        }

        for (var gi = 0; gi < round.mobs.length; gi++) {
            var mob = round.mobs[gi];
            var names = mobPresetNames(def, mob);
            // Per-raid followRange overrides any preset follow_range (last write wins
            // in applyAttributes), clamped to FOLLOW_RANGE_CAP (see const above).
            var xtra = mob.extraArgs;
            var fr = def.followRange;
            if (fr == null) fr = FOLLOW_RANGE_CAP;            // also caps preset values (farSight=100)
            if (fr > FOLLOW_RANGE_CAP) fr = FOLLOW_RANGE_CAP;
            xtra = xtra.concat(["attributes/follow_range=" + fr]);
            // Zombie-family reinforcements: every hit rolls a chance to spawn an
            // extra zombie — with 40+ raid zombies that snowballs mob count (and
            // spawns untagged, unmanaged mobs). Off for raid mobs.
            if (/zombie|husk|drowned|zombified/.test(mob.type)) {
                xtra = xtra.concat(["attributes/spawn_reinforcements_chance=0"]);
            }
            // Waterproof: full walk speed in water (1.0 = no slowdown) + oxygen
            // bonus so air ~never depletes. Vanilla 1.21 attributes, same
            // applyAttributes path as follow_range. Drowned conversion still
            // guarded by the per-tick air refill in aggro().
            if (def.waterproof !== false) {
                xtra = xtra.concat([
                    "attributes/water_movement_efficiency=1.0",
                    "attributes/oxygen_bonus=1000"
                ]);
            }
            for (var c = 0; c < mob.count; c++) {
                var pos = anchor ? hordeMobPos(level, anchor, idx, total)
                                 : findSpawnPos(level, pp, def, idx, total);
                idx++;

                var entity = EAI.fromPresets(level, mob.type, names, xtra);
                if (!entity) { err(`spawnRound: fromPresets returned null for ${mob.type}`); continue; }
                try { entity.setPos(Math.floor(pos.x) + 0.5, pos.y, Math.floor(pos.z) + 0.5); } catch (eP) { warn(`setPos: ${eP}`); }
                facePlayer(entity, pos, pp);
                try { entity.addTag("raid_mob"); } catch (e1) {}
                try { entity.addTag("raid_" + instanceId); } catch (e2) {}
                try { entity.setPersistenceRequired(); } catch (e3) {}
                try { entity.setCustomName(Text.of("[" + round.name + "]")); } catch (e4) {}
                applyEntityNbt(entity, mob.nbt);   // variants/skins/baby/mod data — pre-spawn
                try { entity.spawn(); }
                catch (eSp) { err(`spawn failed ${mob.type}: ${eSp}`); continue; }
                try { EAI.applyDeferred(level, entity, EAI.resolveArgs(names, xtra)); }
                catch (eD) { warn(`applyDeferred: ${eD}`); }
                equipMob(entity, mob.equip);        // weapons/armor — post-spawn
                joinRaidTeam(server, entity);       // colored glow outline team
                forceTarget(entity, player);
                spawnPoof(player, pos);
                out.push(entity);
            }
        }
        return out;
    }

    // ---------- Instance (state machine) ------------------------------------
    // Phases: SPAWNING -> FIGHTING -> BREATHER -> ... -> WIN_WAIT -> DONE.

    function RaidInstance(id, def, level, player) {
        this.id        = id;
        this.defId     = def.id;
        this.def       = def;
        this.level     = level;
        this.playerUuid = String(player.uuid);
        this._ctxPlayer = player;     // fallback if live lookup fails
        this.roundIdx     = 0;
        this.phase        = "SPAWNING";
        this.breatherLeft = 0;
        this.roundTimeLeft = null;
        this.roundMobs = [];          // live mobs of the current round
        this.carryover = [];          // live survivors carried from timed-out rounds
        this.bar       = null;        // ServerBossEvent (or null if disabled/unavailable)
        this.barBase   = def.title || prettyId(def.id);
        this.roundTotalHealth = 1;    // sum of max-health for the current wave (bar denominator)
        this.endLeft   = 0;           // ENDING-phase linger countdown (victory/defeat bar)
        this._mobState = {};          // uuid -> {x,y,z,idle,tp} anti-stuck tracking
        this._assistTick = 0;         // aggro pass counter (waterAssist throttling)
    }
    // Freeze the bar on an end state (victory green / defeat red) before it closes.
    RaidInstance.prototype.barEnd = function (name, colorName, progress) {
        if (!this.bar) return;
        this._barText = name;   // keep the setBarName cache in sync
        try { this.bar.setName(Text.of(name)); } catch (e) {}
        if (colorName) { var C = barClasses(); try { this.bar.setColor(enumVal(C.Color, colorName, "RED")); } catch (e2) {} }
        try { this.bar.setProgress(progress); } catch (e3) {}
    };
    RaidInstance.prototype.barColorSet = function (name) {
        if (!this.bar) return;
        var C = barClasses();
        try { this.bar.setColor(enumVal(C.Color, name, "RED")); } catch (e) {}
    };
    // Straggler highlight: glow every live raid mob during the second half of
    // EVERY round's timer (and all of WIN_WAIT) so raid mobs read apart from
    // ambient mobs and stuck ones are findable through terrain. Outline renders
    // in the raid team color (see joinRaidTeam). Refreshed every 4th aggro pass
    // (~1s) — same cadence as waterAssist, offset so both don't share a pass.
    RaidInstance.prototype.glowStragglers = function () {
        if ((this._assistTick & 3) !== 2) return;
        var glow = (this.phase === "WIN_WAIT");
        if (!glow && this.phase === "FIGHTING") {
            var tl = this.def.rounds[this.roundIdx].timeLimit;
            glow = (tl != null && this.roundTimeLeft != null && this.roundTimeLeft < tl / 2);
        }
        if (!glow) return;
        eachMob(this, function (m) {
            try { m.potionEffects.add("minecraft:glowing", 120, 0, false, false); } catch (e) {}
        });
    };
    RaidInstance.prototype.lose = function (player) {
        killMobs(this);
        playSnd(player, this.def.sounds.lose);
        showTitle(player, "DEFEAT", this.barBase, "dark_red");
        fireCb(this.def, "onLose", [this.ctx(player)]);
        this.barEnd("§4§l✖ DEFEATED", "RED", 0.0);
        this.endLeft = this.def.barHold || DEFAULT_BAR_HOLD;
        this.phase = "ENDING";
    };
    // Set the bar name only when the rendered text actually changed — the live
    // FIGHTING text refreshes every throttle tick but the string only changes
    // ~once a second (timer tick / kill), so packet traffic stays minimal.
    RaidInstance.prototype.setBarName = function (txt) {
        if (!this.bar || txt === this._barText) return;
        this._barText = txt;
        try { this.bar.setName(Text.of(txt)); } catch (e) {}
    };
    // Live combat bar: title — wave (i/n) • ⚔ alive • ⌛ m:ss (red in the last minute).
    RaidInstance.prototype.barFight = function (round) {
        var n = this.def.rounds.length;
        var alive = this.roundMobs.length + this.carryover.length;
        var txt = "§c" + this.barBase + " §7— " + round.name + " §8(" + (this.roundIdx + 1) + "/" + n + ")" +
                  " §7• §f⚔ " + alive;
        if (this.roundTimeLeft != null) {
            var col = (this.roundTimeLeft <= 1200) ? "§c" : "§e";
            txt += " §7• " + col + "⌛ " + fmtTicks(this.roundTimeLeft);
        }
        this.setBarName(txt);
    };
    RaidInstance.prototype.updateBar = function (player) {
        if (!this.bar) return;
        if (player) { try { if (!this.bar.getPlayers().contains(player)) this.bar.addPlayer(player); } catch (e) {} }
        var alive = sumHealth(this.roundMobs) + sumHealth(this.carryover);
        var total = this.roundTotalHealth > 0 ? this.roundTotalHealth : 1;
        var p = alive / total; if (p < 0) p = 0; if (p > 1) p = 1;
        try { this.bar.setProgress(p); } catch (e) {}
    };
    RaidInstance.prototype.closeBar = function () {
        if (!this.bar) return;
        try { this.bar.setVisible(false); } catch (e) {}
        try { this.bar.removeAllPlayers(); } catch (e2) {}   // sends client remove packet
        try { var ce = customBars(Manager._server); if (ce) ce.remove(this.bar); } catch (e3) {} // delete from registry (no reload ghost)
        this.bar = null;
    };
    RaidInstance.prototype.ctx = function (player) {
        return { player: player || resolvePlayer(this) || this._ctxPlayer, level: this.level, raid: this.def, instance: this };
    };
    RaidInstance.prototype.aggro = function (player) {
        // mainRaw = the live, *alive* main player (null while dead/offline so mobs
        // fall through to attacking nearby villagers/players until they respawn).
        var mainRaw = null;
        if (player) {
            var pAlive = true;
            try { pAlive = (typeof player.isAlive === "function") ? player.isAlive() : player.isAlive; } catch (e) {}
            if (pAlive) mainRaw = unwrapPlayer(player);
        }
        // Water upkeep every 4th pass (~1s): mergeNbt is a full entity NBT
        // save/load — too heavy per water mob at the 5-tick cadence. Drowned
        // conversion needs 600 in-water ticks, so a 20-tick reset is plenty.
        this._assistTick++;
        if ((this._assistTick & 3) === 0) waterAssist(this);
        this.glowStragglers();
        var radius = (this.def.aggroRadius != null) ? this.def.aggroRadius : 20;
        if (this.def.spawnPattern === "horde") radius += 8;   // cluster sits in one spot — widen detection
        var center = mainRaw || firstRaw(this);
        var victims = collectVictims(this, center, radius);
        var radiusSqr = radius * radius;
        var inst = this;
        eachMob(this, function (m) {
            var raw = rawMobOf(m);
            if (!raw || typeof raw.setTarget !== "function") return;
            var t = decideTarget(raw, mainRaw, victims, radiusSqr);
            if (!t) return;
            // setTarget only on an actual change — re-setting the same target
            // every pass fires target-change events + goal re-evaluation on
            // every mob, and constantly restarts pathing (the "stuck" jitter).
            var cur = null;
            try { cur = (typeof raw.getTarget === "function") ? raw.getTarget() : null; } catch (eG) {}
            if (!cur || !sameEnt(cur, t)) { try { raw.setTarget(t); } catch (eS) {} }
            unstick(inst, raw, t);
        });
    };
    RaidInstance.prototype.aliveCount = function () {
        return pruneDead(this.roundMobs).length + pruneDead(this.carryover).length;
    };
    RaidInstance.prototype.startRound = function (idx, player) {
        var round = this.def.rounds[idx];
        info(`raid ${this.id}: start round ${idx} "${round.name}"`);
        this._mobState = {};   // drop stale anti-stuck entries from the previous wave
        this.roundMobs = spawnRound(this.level, player, this.def, round, this.id);
        this.roundTimeLeft = (round.timeLimit != null) ? round.timeLimit : null;
        this.roundTotalHealth = Math.max(1, sumMax(this.roundMobs) + sumMax(this.carryover));
        this.barFight(round);
        this.barColorSet(this.def.barColor);   // back from BREATHER yellow
        this.updateBar(player);
        if (idx > 0) playSnd(player, this.def.sounds.roundStart);   // wave 1 covered by raidStart
        fireCb(this.def, "onRoundStart", [this.ctx(player), round, idx]);
        this.phase = "FIGHTING";
    };
    RaidInstance.prototype.tick = function () {
        var player = resolvePlayer(this);   // live player wrapper, or null if offline
        var round  = this.def.rounds[this.roundIdx];

        // No player-death loss: if the main player dies the mobs switch to nearby
        // villagers/players (see aggro) and re-aggro the player on respawn. The
        // only loss is the final round's timer expiring (see FIGHTING below).

        switch (this.phase) {

            case "ENDING":
                this.endLeft -= TICK_THROTTLE;
                if (this.endLeft <= 0) { this.closeBar(); this.phase = "DONE"; }
                break;
            case "SPAWNING":
                // Need a live player to ring-spawn around. Offline -> wait (raid
                // keeps running, just doesn't spawn the next round until they return).
                if (!player) return;
                this.startRound(this.roundIdx, player);
                break;

            case "FIGHTING":
                this.roundMobs = pruneDead(this.roundMobs);
                this.carryover = pruneDead(this.carryover);
                this.aggro(player);
                this.barFight(round);
                this.updateBar(player);

                if (this.roundMobs.length === 0) {
                    fireCb(this.def, "onRoundEnd", [this.ctx(player), round, this.roundIdx]);
                    if (this.roundIdx + 1 < this.def.rounds.length) {
                        playSnd(player, this.def.sounds.roundEnd);   // wave-clear stinger (final wave -> win sound instead)
                        this.breatherLeft = round.breather;
                        this.barColorSet("YELLOW");                  // breather lull; startRound restores
                        this.phase = "BREATHER";
                    } else {
                        this.phase = "WIN_WAIT";
                    }
                } else if (this.roundTimeLeft != null) {
                    this.roundTimeLeft -= TICK_THROTTLE;
                    if (this.roundTimeLeft <= 0) {
                        if (this.roundIdx + 1 < this.def.rounds.length) {
                            // non-final round timed out: survivors carry into next round
                            for (var i = 0; i < this.roundMobs.length; i++) this.carryover.push(this.roundMobs[i]);
                            this.roundMobs = [];
                            fireCb(this.def, "onRoundEnd", [this.ctx(player), round, this.roundIdx]);
                            this.roundIdx++;
                            this.phase = "SPAWNING";   // no breather on a timer force-advance
                        } else {
                            // FINAL round not cleared in time -> defeat, no prize.
                            fireCb(this.def, "onRoundEnd", [this.ctx(player), round, this.roundIdx]);
                            this.lose(player);
                        }
                    }
                }
                break;

            case "BREATHER":
                this.carryover = pruneDead(this.carryover);
                this.aggro(player);
                this.setBarName("§e" + this.barBase + " §7— next wave in §f" + Math.ceil(this.breatherLeft / 20) + "s§7…");
                this.updateBar(player);
                this.breatherLeft -= TICK_THROTTLE;
                if (this.breatherLeft <= 0) {
                    this.roundIdx++;
                    this.phase = "SPAWNING";
                }
                break;

            case "WIN_WAIT":
                this.roundMobs = pruneDead(this.roundMobs);
                this.carryover = pruneDead(this.carryover);
                this.aggro(player);
                this.setBarName("§6" + this.barBase + " §7— §f⚔ " + (this.roundMobs.length + this.carryover.length) + " §7stragglers §e(glowing!)");
                this.updateBar(player);
                if (this.roundMobs.length === 0 && this.carryover.length === 0) {
                    fireCb(this.def, "onWin", [this.ctx(player)]);
                    playSnd(player, this.def.sounds.win);
                    showTitle(player, "VICTORY", this.barBase, "green");
                    victoryBurst(player);
                    this.barEnd("§a§l✔ VICTORY", "GREEN", 1.0);
                    this.endLeft = this.def.barHold || DEFAULT_BAR_HOLD;
                    this.phase = "ENDING";
                }
                break;
        }
    };

    function pruneDead(arr) {
        var alive = [];
        for (var i = 0; i < arr.length; i++) {
            var e = arr[i];
            try { if (e && (!e.isAlive || e.isAlive())) alive.push(e); } catch (eA) {}
        }
        return alive;
    }

    // First live raw mob across both lists — aggro scan center when the main
    // player is dead/offline.
    function firstRaw(inst) {
        var lists = [inst.roundMobs, inst.carryover];
        for (var li = 0; li < lists.length; li++) {
            for (var i = 0; i < lists[li].length; i++) {
                var r = rawMobOf(lists[li][i]);
                if (r) return r;
            }
        }
        return null;
    }

    // Apply fn(entity) to every mob across both the round + carryover lists.
    function eachMob(inst, fn) {
        var lists = [inst.roundMobs, inst.carryover];
        for (var li = 0; li < lists.length; li++) {
            var arr = lists[li];
            for (var i = 0; i < arr.length; i++) fn(arr[i]);
        }
    }

    function fireCb(def, name, cbArgs) {
        var fn = def.callbacks[name];
        if (typeof fn !== "function") return;
        try { fn.apply(null, cbArgs); }
        catch (e) { err(`callback ${name} threw: ${e}`); }
    }

    // Iterate the live server player list; return the first match for pred, or null.
    function findOnlinePlayer(server, pred) {
        if (!server || !server.players) return null;
        try {
            var it = server.players.iterator();
            while (it.hasNext()) { var p = it.next(); if (p && pred(p)) return p; }
        } catch (e) {}
        return null;
    }

    // Live player by UUID from the current server player list; null if offline.
    function resolvePlayer(inst) {
        // offline / not found returns null — callers handle it (SPAWNING waits, aggro no-ops).
        return findOnlinePlayer(Manager._server, function (p) {
            return String(p.uuid) === inst.playerUuid;
        });
    }

    // ---------- Manager -----------------------------------------------------

    const _active = {};        // instanceId -> RaidInstance
    var _idSeq    = 0;
    var _tickAccum = 0;

    function newInstanceId(defId) { _idSeq++; return defId + "_" + _idSeq; }

    // ENDING counts as "raid over" — fight is done, the instance only lets the
    // victory/defeat bar linger. Not blocking here lets a new raid start
    // immediately after a win/loss instead of waiting out barHold.
    function playerInRaid(playerUuid) {
        for (var k in _active) {
            var ph = _active[k].phase;
            if (_active[k].playerUuid === playerUuid && ph !== "DONE" && ph !== "ENDING") return _active[k];
        }
        return null;
    }

    function killMobs(inst) {
        eachMob(inst, function (e) {
            try { if (e && e.isAlive && e.isAlive()) e.kill(); } catch (x) {}
        });
        inst.roundMobs = []; inst.carryover = [];
    }

    function cleanupMobs(inst) {
        killMobs(inst);
        inst.closeBar();
    }

    // True if a raw entity carries a raid_<id> tag of a still-running instance.
    function ownedByActive(entity) {
        try {
            var tags = entity.getTags();
            if (!tags) return false;
            for (var k in _active) {
                if (_active[k].phase === "DONE") continue;
                if (tags.contains("raid_" + _active[k].id)) return true;
            }
        } catch (e) {}
        return false;
    }

    // Bug #1: spawned mobs are persistenceRequired + tagged. A crash/restart
    // mid-raid loses _active, orphaning those mobs forever. Sweep every loaded
    // level on server load and discard raid_mob-tagged entities not owned by a
    // live instance (on a fresh boot that's all of them).
    function sweepOrphans(server) {
        if (!server || typeof server.getAllLevels !== "function") return 0;
        var killed = 0;
        try {
            var lit = server.getAllLevels().iterator();
            while (lit.hasNext()) {
                var lvl = lit.next();
                var getter = null;
                try { getter = lvl.getEntities(); } catch (eg) { continue; }
                if (!getter || typeof getter.getAll !== "function") continue;
                var toKill = [];
                var eit = getter.getAll().iterator();
                while (eit.hasNext()) {
                    var en = eit.next();
                    try {
                        var tags = en.getTags();
                        if (tags && tags.contains("raid_mob") && !ownedByActive(en)) toKill.push(en);
                    } catch (x) {}
                }
                for (var i = 0; i < toKill.length; i++) { try { toKill[i].discard(); killed++; } catch (y) {} }
            }
        } catch (e) { warn("sweepOrphans: " + e); }
        if (killed) info("sweepOrphans removed " + killed + " stray raid mob(s)");
        return killed;
    }

    // A raidfactory bar is "owned" if its path matches a still-running instance id.
    function barOwnedByActive(rl) {
        try {
            var path = String(rl.getPath());
            for (var k in _active) {
                if (_active[k].phase !== "DONE" && String(_active[k].id) === path) return true;
            }
        } catch (e) {}
        return false;
    }

    // Remove every raidfactory boss bar not owned by a live instance — clears
    // bars orphaned by a reload/crash. Called on server load and from stopall.
    function sweepBars(server) {
        var ce = customBars(server);
        if (!ce || typeof ce.getEvents !== "function") return 0;
        var removed = 0;
        try {
            var toRemove = [];
            var it = ce.getEvents().iterator();
            while (it.hasNext()) {
                var ev = it.next();
                var rl = null;
                try { rl = ev.getTextId(); } catch (eId) { continue; }
                if (rl && String(rl.getNamespace()) === BAR_NS && !barOwnedByActive(rl)) toRemove.push(ev);
            }
            for (var i = 0; i < toRemove.length; i++) {
                try { toRemove[i].removeAllPlayers(); ce.remove(toRemove[i]); removed++; } catch (eRm) {}
            }
        } catch (e) { warn("sweepBars: " + e); }
        if (removed) info("sweepBars removed " + removed + " stray raid bar(s)");
        return removed;
    }

    const Manager = {
        _server: null,

        // Shared utilities reused by raid_commands.js (avoids duplicating them there).
        playerLevel: playerLevel,
        findOnlinePlayer: findOnlinePlayer,

        start: function (level, player, defId) {
            var def = Registry.get(defId);
            if (!def) { err(`start: unknown raid "${defId}"`); return null; }
            if (!player) { err("start: no player"); return null; }
            var puid = String(player.uuid);
            if (playerInRaid(puid)) { warn(`start: ${player.username} already in a raid`); return null; }
            var id = newInstanceId(defId);
            var inst = new RaidInstance(id, def, level || playerLevel(player), player);
            if (!Manager._server) { try { Manager._server = player.server; } catch (eSv) {} }
            if (def.bossBar !== false) {
                inst.bar = makeBar(Manager._server, inst.id, inst.barBase, def.barColor, def.barOverlay);
                if (inst.bar) { try { inst.bar.addPlayer(player); } catch (eB) {} }
            }
            _active[id] = inst;
            broadcastSnd(Manager._server, player, def.sounds.raidStart, RAIDSTART_RADIUS);
            showTitle(player, "RAID INCOMING", inst.barBase, "red");
            try { player.tell(Text.of("§c⚔ " + inst.barBase + " begins...")); } catch (eT) {}
            fireCb(def, "onStart", [inst.ctx(player)]);
            info(`started "${defId}" as ${id} for ${player.username}`);
            return id;
        },

        // True when the player has a raid still fighting (ENDING/DONE excluded).
        isInRaid: function (player) {
            try { return !!playerInRaid(String(player.uuid)); } catch (e) { return false; }
        },

        stop: function (idOrPlayer) {
            var inst = null;
            if (typeof idOrPlayer === "string") inst = _active[idOrPlayer];
            else if (idOrPlayer && idOrPlayer.uuid) inst = playerInRaid(String(idOrPlayer.uuid));
            if (!inst) return false;
            cleanupMobs(inst);
            delete _active[inst.id];
            info(`stopped raid ${inst.id}`);
            return true;
        },

        stopAll: function () {
            var n = 0;
            for (var k in _active) { cleanupMobs(_active[k]); delete _active[k]; n++; }
            sweepBars(Manager._server);   // also clears bars orphaned by a prior reload/crash
            return n;
        },

        sweepOrphans: function () { var m = sweepOrphans(Manager._server); sweepBars(Manager._server); return m; },

        getActive: function () {
            var out = [];
            for (var k in _active) {
                var i = _active[k];
                out.push({ id: i.id, defId: i.defId,
                           round: (i.roundIdx + 1) + "/" + i.def.rounds.length,
                           phase: i.phase, alive: i.aliveCount() });
            }
            return out;
        },

        _drive: function (server) {
            Manager._server = server;
            _tickAccum++;
            if (_tickAccum < TICK_THROTTLE) return;
            _tickAccum = 0;
            var done = [];
            for (var k in _active) {
                var inst = _active[k];
                try { inst.tick(); } catch (e) { err(`instance ${k} tick: ${e}`); }
                if (inst.phase === "DONE") done.push(k);
            }
            for (var d = 0; d < done.length; d++) delete _active[done[d]];
        }
    };

    // ---------- Tick driver -------------------------------------------------

    ServerEvents.tick(function (event) {
        Manager._drive(event.server);
    });

    // Clean up mobs + boss bars orphaned by a crash/restart/reload (bug #1).
    ServerEvents.loaded(function (event) {
        Manager._server = event.server;
        sweepOrphans(event.server);
        sweepBars(event.server);
    });

    // ---------- Export ------------------------------------------------------

    global.Raid         = function (id) { return new RaidBuilder(id); };
    global.RaidManager  = Manager;
    global.RaidRegistry = Registry;
    global.RAIDS        = RAIDS;

    console.info("[Raid] core loaded — Raid(), RaidManager, RAIDS ready");
})(this);
