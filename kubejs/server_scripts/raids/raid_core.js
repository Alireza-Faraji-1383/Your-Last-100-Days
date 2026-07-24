// priority: 90
// kubejs/server_scripts/raids/raid_core.js
//
// Raid factory engine — KubeJS 1.21.1 NeoForge. Depends on the EnhancedAI
// global (enhancedai_factory.js, priority 100 -> loads first).
//
// Sequential rounds (never overlap), ring-spawn around the target player,
// far-aggro via the farSight preset + a throttled hard-target loop. Intermediate
// survivors carry forward; final win requires every spawned raid mob to be dead.
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
    const MIN_ROUND_MOBS = 22;     // every authored wave must meet this floor
    const MAX_ROUND_MINIBOSSES = 3;// absolute cap; difficulty tiers may lower it
    // Active raid snapshots are tiny JSON records in the world's persistent
    // data. One write every five seconds, plus logout/shutdown, avoids per-tick
    // NBT work while keeping a crash rollback bounded to at most five seconds.
    const ACTIVE_STATE_KEY = "raidfactory_active_v1";
    const ACTIVE_SAVE_EVERY = 100;
    const RESTORE_LOGIN_DELAY = 40; // let the returning player's chunks load first
    const RESTORE_MOB_WAIT = 200;   // wait up to 10s for persistent mobs to load
    const BANNED_RAID_MOB_TYPES = {
        "cataclysm:netherite_ministrosity": true // stationary encounter construct
    };
    // These Cataclysm mobs spawn with their own dormant AI state. Wake them
    // once, after finalizeSpawn, so the normal raid target/navigation logic
    // can take over without adding another tick scan.
    const FORCE_AWAKE_RAID_MOB_TYPES = {
        "cataclysm:kobolediator": "cataclysm_sleep",
        "cataclysm:wadjet": "cataclysm_sleep",
        "cataclysm:ender_golem": "cataclysm_awaken",
        "mowziesmobs:umvuthana": "active",
        "mowziesmobs:umvuthana_crane": "active",
        "mowziesmobs:umvuthana_raptor": "active"
    };
    const BOSSES_RISE_NS = "block_factorys_bosses:";
    // Bosses' Rise also registers props, projectiles, arena pieces and summons
    // as entity types. Only these independently mobile soldiers may enter raids.
    const ALLOWED_BOSSES_RISE_RAID_MOBS = {
        "block_factorys_bosses:soul_skeleton": true,
        "block_factorys_bosses:soul_knight_wither_skeleton": true,
        "block_factorys_bosses:dragon_guard_sword": true,
        "block_factorys_bosses:flaming_skeleton_guard_sword": true,
        "block_factorys_bosses:flaming_skeleton_guard_fireball": true,
        "block_factorys_bosses:pirate_rook": true,
        "block_factorys_bosses:crossbow_pirate": true,
        "block_factorys_bosses:pirate_captain": true
    };
    const DEFEAT_PENALTY_TICKS = 6000; // 5 minutes
    const DEFEAT_PENALTY_AMP   = 3;    // zero-based amplifier 3 = effect level IV
    const FINAL_GLOW_AFTER_TICKS = 3600; // reveal every final-wave mob after 3 minutes
    const LIFESTEALER_ID = "born_in_chaos_v1:lifestealer";
    const LIFESTEALER_TRUE_FORM_ID = "born_in_chaos_v1:lifestealer_true_form";
    const LIFESTEALER_TRANSFORM_RADIUS_SQR = 16; // true form is created at the old mob's position
    const LIFESTEALER_TRANSFORM_RETRY_TICKS = 40;
    const DARK_DOPPELGANGER_ID = "darkdoppelganger:dark_doppelganger";
    const DARK_DOPPELGANGER_MINION_ID = "darkdoppelganger:dark_doppelganger_minion";
    // Boss minions are created within two blocks of their owner. A slightly
    // wider one-shot match tolerates knockback during the synchronous spawn
    // callback without ever scanning the world or touching player minions.
    const DARK_DOPPELGANGER_MINION_ADOPT_RADIUS_SQR = 36;
    const RAID_VICTORY_ADVANCEMENTS = {
        day10_rotting_dawn:       "y100d:raid_victories/day10_rotting_dawn",
        day20_night_of_bones:     "y100d:raid_victories/day20_night_of_bones",
        day30_warband:            "y100d:raid_victories/day30_warband",
        day40_night_of_spirits:   "y100d:raid_victories/day40_night_of_spirits",
        day50_arcane_covenant:    "y100d:raid_victories/day50_arcane_covenant",
        day60_rise_of_the_deep:   "y100d:raid_victories/day60_rise_of_the_deep",
        day70_rotten_legion:      "y100d:raid_victories/day70_rotten_legion",
        day80_burning_siege:      "y100d:raid_victories/day80_burning_siege",
        day90_dark_concord:       "y100d:raid_victories/day90_dark_concord",
        day100_last_dawn:         "y100d:raid_victories/day100_last_dawn"
    };
    const RAID_FLAWLESS_ADVANCEMENTS = {
        day10_rotting_dawn:       "y100d:raid_victories/day10_rotting_dawn_flawless",
        day20_night_of_bones:     "y100d:raid_victories/day20_night_of_bones_flawless",
        day30_warband:            "y100d:raid_victories/day30_warband_flawless",
        day40_night_of_spirits:   "y100d:raid_victories/day40_night_of_spirits_flawless",
        day50_arcane_covenant:    "y100d:raid_victories/day50_arcane_covenant_flawless",
        day60_rise_of_the_deep:   "y100d:raid_victories/day60_rise_of_the_deep_flawless",
        day70_rotten_legion:      "y100d:raid_victories/day70_rotten_legion_flawless",
        day80_burning_siege:      "y100d:raid_victories/day80_burning_siege_flawless",
        day90_dark_concord:       "y100d:raid_victories/day90_dark_concord_flawless",
        day100_last_dawn:         "y100d:raid_victories/day100_last_dawn_flawless"
    };
    // Explicit screen coordinates avoid Minecraft's hash-set child ordering.
    // UI Y grows downward: day 100 is the top entry and day 10 the bottom.
    const RAID_ADVANCEMENT_LAYOUT = [
        ["y100d:raid_victories/day100_last_dawn", 0],
        ["y100d:raid_victories/day90_dark_concord", 1],
        ["y100d:raid_victories/day80_burning_siege", 2],
        ["y100d:raid_victories/day70_rotten_legion", 3],
        ["y100d:raid_victories/day60_rise_of_the_deep", 4],
        ["y100d:raid_victories/day50_arcane_covenant", 5],
        ["y100d:raid_victories/day40_night_of_spirits", 6],
        ["y100d:raid_victories/day30_warband", 7],
        ["y100d:raid_victories/day20_night_of_bones", 8],
        ["y100d:raid_victories/day10_rotting_dawn", 9]
    ];

    function warn(m) { console.warn(`[Raid] ${m}`); }
    function err(m)  { console.error(`[Raid] ${m}`); }
    function info(m) { if (DEBUG) console.info(`[Raid] ${m}`); }

    function setAdvancementLocation(manager, RL, id, x, y) {
        var holder = manager.get(RL.parse(id));
        if (!holder) { warn("advancement layout missing " + id); return; }
        var display = holder.value().display();
        if (!display.isPresent()) { warn("advancement layout has no display " + id); return; }
        display.get().setLocation(x, y);
    }

    // Runs once per server start; no tick handler and no runtime raid overhead.
    function layoutRaidAdvancements(server) {
        try {
            var RL = Java.loadClass("net.minecraft.resources.ResourceLocation");
            var manager = server.getAdvancements();
            setAdvancementLocation(manager, RL, "y100d:raid_victories/root", 0, 4.5);
            for (var i = 0; i < RAID_ADVANCEMENT_LAYOUT.length; i++) {
                var entry = RAID_ADVANCEMENT_LAYOUT[i];
                setAdvancementLocation(manager, RL, entry[0], 1, entry[1]);
                setAdvancementLocation(manager, RL, entry[0] + "_flawless", 2, entry[1]);
            }
        } catch (e) {
            warn("could not apply raid advancement layout: " + e);
        }
    }

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
            var isBoss = !!s.boss;
            var isMiniboss = !!s.miniboss;
            return {
                type:       String(s.type || s.id || ""),
                count:      positiveIntOr(s.count, 1),
                presets:    Array.isArray(s.presets) ? s.presets.slice() : [],
                extraArgs:  Array.isArray(s.extraArgs) ? s.extraArgs.slice() : [],
                noDefaults: !!s.noDefaults,
                boss:       isBoss,
                miniboss:   isMiniboss,
                breacher:   !!s.breacher || isBoss || isMiniboss,
                equip:      shallowCopy(s.equip),   // copied so a shared archetype isn't mutated
                nbt:        shallowCopy(s.nbt)
            };
        }
        return { type: String(typeOrSpec || ""), count: 1, presets: [], extraArgs: [], noDefaults: false,
                 boss: false, miniboss: false, breacher: false, equip: null, nbt: null };
    }

    function RaidBuilder(id) {
        this.def = {
            id: String(id || ""),
            spawn: normalizedSpawn(DEFAULT_MIN_R, DEFAULT_MAX_R),
            spawnPattern: "ring",   // "ring" (spread around player) | "horde" (one cluster, one direction)
            hordeAngle: null,       // degrees: optional wave-1 direction; later waves rotate automatically
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
    // Starting horde direction in degrees (0 = +X / east, 90 = +Z / south).
    // Later waves still rotate to another side. Only used by "horde".
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
    //   .mob({ type, count, presets, extraArgs, noDefaults, boss, miniboss, breacher, equip, nbt })
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
    RaidBuilder.prototype.breacher = function (on) {
        if (this._mob) this._mob.breacher = (on !== false); else warn("breacher() before mob()");
        return this;
    };
    RaidBuilder.prototype.boss = function (on) {
        if (this._mob) {
            this._mob.boss = (on !== false);
            if (on !== false) this._mob.breacher = true;
        } else warn("boss() before mob()");
        return this;
    };
    RaidBuilder.prototype.miniboss = function (on) {
        if (this._mob) {
            this._mob.miniboss = (on !== false);
            if (on !== false) this._mob.breacher = true;
        } else warn("miniboss() before mob()");
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
        // Authored raid ids begin with dayNN_. Earlier raids deliberately allow
        // fewer minibosses; unknown/custom ids retain the absolute safe cap.
        var dayMatch = /^day(\d+)(?:_|$)/.exec(d.id);
        var raidDay = dayMatch ? parseInt(dayMatch[1], 10) : null;
        var roundMinibossLimit = raidDay != null && raidDay <= 40 ? 1 :
                                 raidDay != null && raidDay <= 60 ? 2 :
                                 MAX_ROUND_MINIBOSSES;
        for (var i = 0; i < d.rounds.length; i++) {
            var r = d.rounds[i];
            var roundMobCount = 0;
            var roundMinibossCount = 0;
            var finalHasBoss = false;
            var finalHasMiniboss = false;
            if (!(r.breather >= 0)) { err(`raid "${d.id}" round ${i}: bad breather "${r.breather}"`); return false; }
            if (r.timeLimit != null && !(r.timeLimit >= 0)) { err(`raid "${d.id}" round ${i}: bad timeLimit "${r.timeLimit}"`); return false; }
            if (!r.mobs || r.mobs.length === 0) { err(`raid "${d.id}" round ${i} "${r.name}": no mobs`); return false; }
            for (var j = 0; j < r.mobs.length; j++) {
                var m = r.mobs[j];
                if (!m.type || m.type.indexOf(":") === -1) { err(`raid "${d.id}" round ${i}: bad mob type "${m.type}"`); return false; }
                if (!(m.count >= 1)) { err(`raid "${d.id}" round ${i}: mob "${m.type}" count < 1`); return false; }
                if (BANNED_RAID_MOB_TYPES[m.type]) {
                    err(`raid "${d.id}" round ${i}: banned immobile mob "${m.type}"`);
                    return false;
                }
                if (m.type.indexOf(BOSSES_RISE_NS) === 0 && !ALLOWED_BOSSES_RISE_RAID_MOBS[m.type]) {
                    err(`raid "${d.id}" round ${i}: Bosses' Rise entity is not raid-safe "${m.type}"`);
                    return false;
                }
                roundMobCount += m.count;
                if (m.miniboss) roundMinibossCount += m.count;
                if (i === d.rounds.length - 1) {
                    if (m.boss) finalHasBoss = true;
                    if (m.miniboss) finalHasMiniboss = true;
                }
                var names = m.noDefaults ? m.presets : d.defaultPresets.concat(m.presets);
                for (var k = 0; k < names.length; k++) {
                    if (!presetMap[names[k]]) warn(`raid "${d.id}": unknown preset "${names[k]}" (mob ${m.type}) — EAI will skip it`);
                }
            }
            if (finalHasBoss && finalHasMiniboss) {
                err(`raid "${d.id}" final round "${r.name}": a main boss cannot share the wave with a miniboss`);
                return false;
            }
            if (roundMinibossCount > roundMinibossLimit) {
                err(`raid "${d.id}" round ${i} "${r.name}": ${roundMinibossCount} minibosses, tier maximum is ${roundMinibossLimit}`);
                return false;
            }
            if (roundMobCount < MIN_ROUND_MOBS) {
                err(`raid "${d.id}" round ${i} "${r.name}": ${roundMobCount} mobs, minimum is ${MIN_ROUND_MOBS}`);
                return false;
            }
        }
        return true;
    }

    // Effective EAI preset names for a mob = (noDefaults ? [] : defaultPresets) + mob presets.
    function mobPresetNames(def, mob) {
        return mob.noDefaults ? mob.presets.slice() : def.defaultPresets.concat(mob.presets);
    }

    // ---------- Spawner -----------------------------------------------------

    const SPAWN_Y_SCAN           = 16;  // ceiling-dimension / API fallback only
    const SPAWN_EMERGENCY_TRIES  = 16;  // paid only once when a whole plan needs rescue
    const SPAWN_EMERGENCY_Y_SCAN = 64;  // bounded fallback in ceiling dimensions
    const SPAWN_RETRY_TICKS      = 200; // no-safe-ground retry interval (10 seconds)

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
    function isWaterBlock(b) { return blockId(b) === "minecraft:water"; }
    function isPassable(b)  { return isAirBlock(b) || !!_passable[blockId(b)]; }
    function isSafeFloor(b) { return b && !isAirBlock(b) && !_passable[blockId(b)] && !_dangerBelow[blockId(b)]; }

    function safeSpawnY(level, bx, y, bz, allowWater) {
        var below = level.getBlock(bx, y - 1, bz);
        if (!isSafeFloor(below)) return null;
        var feet = level.getBlock(bx, y, bz);
        var head = level.getBlock(bx, y + 1, bz);
        var feetClear = isPassable(feet) || (allowWater && isWaterBlock(feet));
        var headClear = isPassable(head) || (allowWater && isWaterBlock(head));
        return (feetClear && headClear) ? y : null;
    }

    var _heightTypes = null;
    var _heightTypesTried = false;
    var _heightRuntimeBroken = false;
    function heightTypes() {
        if (_heightTypesTried) return _heightTypes;
        _heightTypesTried = true;
        try { _heightTypes = Java.loadClass("net.minecraft.world.level.levelgen.Heightmap$Types"); }
        catch (e) { _heightTypes = null; }
        return _heightTypes;
    }

    function heightLevel(level) {
        if (!level) return null;
        try { if (typeof level.getHeight === "function") return level; } catch (e) {}
        try {
            var raw = (typeof level.getLevel === "function") ? level.getLevel() : null;
            if (raw && typeof raw.getHeight === "function") return raw;
        } catch (e2) {}
        try { if (level.minecraftLevel && typeof level.minecraftLevel.getHeight === "function") return level.minecraftLevel; }
        catch (e3) {}
        return null;
    }

    function levelHasCeiling(rawLevel) {
        try {
            var dt = (typeof rawLevel.dimensionType === "function") ? rawLevel.dimensionType() : null;
            return !!(dt && typeof dt.hasCeiling === "function" && dt.hasCeiling());
        } catch (e) { return false; }
    }

    // Returns {supported, y}. In normal dimensions this reads the world's
    // heightmap, so an underground player still gets an above-ground raid.
    // OCEAN_FLOOR is allowed only for waterproof raids.
    function surfaceGroundY(level, x, z, allowWater) {
        if (_heightRuntimeBroken) return { supported: false, y: null };
        var Types = heightTypes();
        var raw = heightLevel(level);
        if (!Types || !raw || levelHasCeiling(raw)) return { supported: false, y: null };
        var bx = Math.floor(x), bz = Math.floor(z);
        var offsets = [0, 1, -1, 2, -2];
        try {
            var top = Number(raw.getHeight(Types.MOTION_BLOCKING_NO_LEAVES, bx, bz));
            for (var i = 0; i < offsets.length; i++) {
                var sy = safeSpawnY(level, bx, top + offsets[i], bz, false);
                if (sy != null) return { supported: true, y: sy };
            }
            if (allowWater) {
                var ocean = Number(raw.getHeight(Types.OCEAN_FLOOR, bx, bz));
                for (var j = 0; j < offsets.length; j++) {
                    var oy = safeSpawnY(level, bx, ocean + offsets[j], bz, true);
                    if (oy != null) return { supported: true, y: oy };
                }
            }
            return { supported: true, y: null };
        } catch (e) {
            _heightRuntimeBroken = true;
            warn("surfaceGroundY: " + e);
            return { supported: false, y: null };
        }
    }

    // Local Y fallback for ceiling dimensions (Nether-like) or an unavailable
    // heightmap API. Normal dimensions use surfaceGroundY and never choose a
    // cave merely because it is close to the player's current Y.
    function groundYRange(level, x, baseY, z, scan, allowWater) {
        try {
            var bx = Math.floor(x), bz = Math.floor(z), py = Math.floor(baseY);
            for (var off = 0; off <= scan; off++) {
                for (var s = 0; s < (off === 0 ? 1 : 2); s++) {
                    var y = py + (s === 0 ? off : -off);
                    if (safeSpawnY(level, bx, y, bz, allowWater) != null) return y;
                }
            }
        } catch (e) { warn(`groundY: ${e}`); }
        return null;
    }
    function groundY(level, x, baseY, z, allowWater) {
        var surface = surfaceGroundY(level, x, z, allowWater);
        if (surface.supported) return surface.y;
        return groundYRange(level, x, baseY, z, SPAWN_Y_SCAN, allowWater);
    }
    function emergencyGroundY(level, x, baseY, z, allowWater) {
        var surface = surfaceGroundY(level, x, z, allowWater);
        if (surface.supported) return surface.y;
        return groundYRange(level, x, baseY, z, SPAWN_EMERGENCY_Y_SCAN, allowWater);
    }

    // Rare rescue path shared by every failed position in a wave. It expands
    // horizontal candidates; only ceiling/API fallbacks pay the wider Y scan.
    // It runs at most once per plan and returns only fully validated positions.
    function findEmergencyAnchor(level, pp, def, seed) {
        var minR = Math.max(6, def.spawn.minRadius);
        var maxR = Math.max(minR, def.spawn.maxRadius + 16);
        var span = Math.max(1, maxR - minR + 1);
        var baseAng = ((seed || 0) % 360) * Math.PI / 180;
        for (var t = 0; t < SPAWN_EMERGENCY_TRIES; t++) {
            var ang = baseAng + t * GOLDEN_ANG;
            var rad = minR + ((t * 11 + (seed || 0)) % span);
            var x = pp.x + Math.cos(ang) * rad;
            var z = pp.z + Math.sin(ang) * rad;
            var y = emergencyGroundY(level, x, pp.y, z, def.waterproof !== false);
            if (y != null) return { x: x, y: y, z: z };
        }
        return null;
    }

    // ---- Horde pattern ------------------------------------------------------
    // All mobs of a round cluster around one anchor point in one direction from
    // the player. The first direction is deterministic (or set by hordeAngle);
    // every later wave advances through a different one of eight sectors.

    const HORDE_ZONE_R    = 2;  // landing-zone sample radius around the anchor
    const HORDE_SPREAD_MAX = 4; // max blocks a mob offsets from the anchor
    const HORDE_DIRECTION_COUNT = 8;
    const HORDE_WAVE_DIRECTION_STEP = 3; // 3/8 turn = 135°; coprime with 8, so no repeats for 8 waves
    const GOLDEN_ANG      = 2.399963; // radians — spreads cluster offsets evenly

    function hashStr(s) {
        var h = 5381;
        for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) & 0x7fffffff;
        return h;
    }

    function hordeWaveBaseAngle(def, instanceId, roundIdx) {
        var startDeg = (def.hordeAngle != null)
            ? Number(def.hordeAngle)
            : (hashStr(String(instanceId) + "#horde-origin") % 360);
        var sector = ((roundIdx || 0) * HORDE_WAVE_DIRECTION_STEP) % HORDE_DIRECTION_COUNT;
        return (startDeg + sector * (360 / HORDE_DIRECTION_COUNT)) * Math.PI / 180;
    }

    // ---- Ring pattern: multiple assault groups ----------------------------
    // A ring wave becomes 4-5 compact squads in different player-facing
    // sectors. All work happens once while planning the spawn; there is no new
    // tick handler, entity scan or pathfinding pass.
    const RING_GROUP_ANCHOR_TRIES = 6;
    const RING_GROUP_SPREAD_MAX   = 6;
    const RING_GROUP_ANGLE_STEP   = Math.PI / 12;
    const RING_GROUP_MIN_SIZE     = 5;
    const RING_GROUP_MIN_COUNT    = 4;
    const RING_GROUP_MAX_COUNT    = 5;

    function wantedRingGroups(total) {
        // floor(total / 5) guarantees the smallest squad still has at least
        // five members: 22-24 mobs -> 4 squads; 25+ -> 5 squads.
        var byMinSize = Math.floor(total / RING_GROUP_MIN_SIZE);
        return Math.max(RING_GROUP_MIN_COUNT, Math.min(RING_GROUP_MAX_COUNT, byMinSize));
    }

    // Deterministic per-wave rotation keeps attack directions varied without
    // Math.random. Unsafe sectors are skipped rather than forcing a bad column.
    function findRingGroupAnchors(level, pp, def, total, instanceId, roundIdx) {
        var wanted = wantedRingGroups(total);
        var anchors = [];
        var minR = def.spawn.minRadius, maxR = def.spawn.maxRadius;
        var span = Math.max(1, maxR - minR + 1);
        var seed = hashStr(String(instanceId) + "#" + roundIdx + "#groups");
        var rotation = (seed % 360) * Math.PI / 180;
        var allowWater = def.waterproof !== false;

        for (var g = 0; g < wanted; g++) {
            var baseAng = rotation + (g / wanted) * Math.PI * 2;
            var found = null;
            for (var t = 0; t < RING_GROUP_ANCHOR_TRIES; t++) {
                var step = Math.ceil(t / 2) * RING_GROUP_ANGLE_STEP;
                var ang = baseAng + (t === 0 ? 0 : (t % 2 === 1 ? step : -step));
                var rad = minR + ((seed + g * 17 + t * 11) % span);
                var x = pp.x + Math.cos(ang) * rad;
                var z = pp.z + Math.sin(ang) * rad;
                var y = groundY(level, x, pp.y, z, allowWater);
                if (y != null) { found = { x: x, y: y, z: z }; break; }
            }
            if (found) anchors.push(found);
        }
        return anchors;
    }

    // Global mob indices are distributed round-robin, so each squad receives a
    // mixture of the wave's roles. Golden-angle offsets prevent collision piles.
    function ringGroupMobPos(level, anchors, idx, total, allowWater) {
        if (!anchors || anchors.length === 0) return null;
        var group = idx % anchors.length;
        var localIdx = Math.floor(idx / anchors.length);
        var groupSize = Math.ceil((total - group) / anchors.length);
        var anchor = anchors[group];
        if (localIdx === 0) return anchor;

        var spread = Math.min(RING_GROUP_SPREAD_MAX, Math.max(3, Math.ceil(Math.sqrt(groupSize) * 1.6)));
        var ang = localIdx * GOLDEN_ANG + group * 0.73;
        var rad = 1 + ((localIdx * 3 + group * 2) % spread);
        var x = anchor.x + Math.cos(ang) * rad;
        var z = anchor.z + Math.sin(ang) * rad;
        var y = groundY(level, x, anchor.y, z, allowWater);
        if (y != null) return { x: x, y: y, z: z };
        return anchor;
    }

    // Validate a whole landing zone, not just one column: anchor + 4 side samples
    // at HORDE_ZONE_R must all have safe floor (same rules as groundY) at a
    // similar elevation. Returns the anchor Y, or null if the zone is unusable.
    function hordeZoneY(level, pp, def, ax, az) {
        var allowWater = def.waterproof !== false;
        var ay = groundY(level, ax, pp.y, az, allowWater);
        if (ay == null) return null;
        var samples = [[HORDE_ZONE_R, 0], [-HORDE_ZONE_R, 0], [0, HORDE_ZONE_R], [0, -HORDE_ZONE_R]];
        for (var i = 0; i < samples.length; i++) {
            var sy = groundY(level, ax + samples[i][0], ay, az + samples[i][1], allowWater);
            if (sy == null || Math.abs(sy - ay) > 3) return null;
        }
        return ay;
    }

    // Find the horde anchor: try the base angle, then rotate 45° per retry
    // through the other 7 directions. No unvalidated fallback is returned.
    function findHordeAnchor(level, pp, def, instanceId, roundIdx) {
        var rad = (def.spawn.minRadius + def.spawn.maxRadius) / 2;
        var baseAng = hordeWaveBaseAngle(def, instanceId, roundIdx);
        for (var d = 0; d < 8; d++) {
            var ang = baseAng + d * (Math.PI / 4);
            var ax = pp.x + Math.cos(ang) * rad;
            var az = pp.z + Math.sin(ang) * rad;
            var ay = hordeZoneY(level, pp, def, ax, az);
            if (ay != null) return { x: ax, y: ay, z: az };
        }
        return null;
    }

    // Deterministic small offset around the anchor for cluster mob idx:
    // golden-angle direction, radius scaled to the wave size so big hordes
    // don't cram into a 4-block ring and jam each other (collision shoving
    // freezes pathing). ~sqrt(total) keeps density roughly constant. Per-column
    // ground lookup; an unsafe offset collapses to the already validated anchor
    // column instead of mixing unsafe X/Z with anchor Y.
    function hordeMobPos(level, anchor, idx, total, allowWater) {
        var spread = Math.max(HORDE_SPREAD_MAX, Math.ceil(Math.sqrt(total || 1) * 1.5));
        var ang = idx * GOLDEN_ANG;
        var rad = 1 + ((idx * 5) % spread);
        var x = anchor.x + Math.cos(ang) * rad;
        var z = anchor.z + Math.sin(ang) * rad;
        var y = groundY(level, x, anchor.y, z, allowWater);
        if (y != null) return { x: x, y: y, z: z };
        return { x: anchor.x, y: anchor.y, z: anchor.z };
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

    // Some modded undead ignore equipped helmets and still ignite in sunlight.
    // Use the mob's native ServerLevel for sky/weather checks: the KubeJS level
    // wrapper does not expose canSeeSky consistently for modded entities. This
    // runs inside the existing 5-tick aggro pass and grants no fire resistance,
    // so fire attacks and burning-themed raid balance remain intact.
    function clearDaylightFire(level, raw) {
        if (!raw) return;
        var burning = false;
        try { if (typeof raw.isOnFire === "function") burning = !!raw.isOnFire(); }
        catch (e) {}
        if (!burning) {
            try {
                if (typeof raw.getRemainingFireTicks === "function")
                    burning = raw.getRemainingFireTicks() > 0;
            } catch (e1) {}
        }
        if (!burning) return;

        var nativeLevel = null;
        try { if (typeof raw.level === "function") nativeLevel = raw.level(); } catch (e2) {}
        if (!nativeLevel) {
            try { if (raw.level && typeof raw.level.canSeeSky === "function") nativeLevel = raw.level; } catch (e3) {}
        }
        if (!nativeLevel) nativeLevel = heightLevel(level);
        if (!nativeLevel) return;

        try { if (typeof nativeLevel.isDay === "function" && !nativeLevel.isDay()) return; }
        catch (e4) { return; }
        try {
            var pos = raw.blockPosition();
            if (!nativeLevel.canSeeSky(pos)) return;
            if (typeof nativeLevel.isRainingAt === "function" && nativeLevel.isRainingAt(pos)) return;
        } catch (e5) { return; }
        try {
            if (typeof raw.clearFire === "function") raw.clearFire();
            // Negative ticks restore the normal post-fire cooldown. This is more
            // reliable than zero for mobs whose own sunlight tick immediately
            // calls setSecondsOnFire again after clearFire().
            if (typeof raw.setRemainingFireTicks === "function") raw.setRemainingFireTicks(-20);
        } catch (e6) {}
    }

    // Born in Chaos runs the same sunlight procedure from baseTick() for these
    // three mobs and reignites them one tick after the normal 5-tick raid pass.
    // Give only those exact raid members a tiny per-tick cleanup. The guarded
    // helper still requires daytime + visible sky + no rain, so ordinary fire
    // attacks indoors or at night keep their normal behavior.
    var STRICT_DAYLIGHT_GUARD = {
        "born_in_chaos_v1:bonescaller": true,
        "born_in_chaos_v1:decrepit_skeleton": true,
        "born_in_chaos_v1:baby_skeleton": true
    };
    function raidUsesStrictDaylightGuard(def) {
        var rounds = (def && def.rounds) ? def.rounds : [];
        for (var ri = 0; ri < rounds.length; ri++) {
            var mobs = rounds[ri].mobs || [];
            for (var mi = 0; mi < mobs.length; mi++) {
                if (STRICT_DAYLIGHT_GUARD[String(mobs[mi].type)]) return true;
            }
        }
        return false;
    }
    function strictDaylightGuard(inst) {
        if (!inst._usesStrictDaylightGuard) return;
        eachMob(inst, function (mob) {
            var type = "";
            try { type = String(mob.type); } catch (e) {}
            if (!STRICT_DAYLIGHT_GUARD[type]) return;
            clearDaylightFire(inst.level, rawMobOf(mob));
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

    // Initial hard lock: raid mobs never inherit a nearby ambient target when
    // they spawn. The throttled aggro pass below continuously maintains it.
    function forceTarget(entity, player) {
        if (!player) return;
        try {
            var EAI = getEAI();
            var raw = EAI ? EAI.rawMob(entity) : entity;
            if (!raw || typeof raw.setTarget !== "function") return;
            var target = unwrapPlayer(player);
            if (!target || !isLiveEnt(target)) return;
            var cur = null;
            try { cur = (typeof raw.getTarget === "function") ? raw.getTarget() : null; } catch (eGt) {}
            if (!cur || !sameEnt(cur, target)) raw.setTarget(target);
        } catch (e) { /* mob may be dead/unloaded */ }
    }

    // ---------- Targeting engine (mod-agnostic) -----------------------------
    // Drives every raid mob's target each throttle tick so behavior is identical
    // for vanilla and modded mobs. The raid owner is an ABSOLUTE priority while
    // alive: retaliation, villagers, golems and other players cannot steal the
    // target. Only while the owner is dead/offline may mobs pick nearby fallback
    // victims; the next pass after respawn locks every mob back to the owner.

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
    // Dark Doppelganger's normal summon ritual calls setSummonerPlayer before
    // adding it to the level. Direct KubeJS spawning must mirror that ordering:
    // it binds the boss AI to the raid owner and lets the mod copy the owner's
    // usable armor/weapon and spell-power attributes.
    function preparePlayerBoundRaidMob(entity, type, player) {
        if (!entity || String(type) !== DARK_DOPPELGANGER_ID) return;
        try {
            var raw = rawMobOf(entity);
            var owner = unwrapPlayer(player);
            if (!raw || !owner || typeof raw.setSummonerPlayer !== "function") {
                warn("Dark Doppelganger could not bind to its raid player");
                return;
            }
            raw.setSummonerPlayer(owner);
        } catch (e) {
            warn("Dark Doppelganger player binding: " + e);
        }
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
    function mainPlayerEligible(t) {
        if (!isLiveEnt(t)) return false;
        try { if (typeof t.isSpectator === "function" && t.isSpectator()) return false; } catch (x) {}
        try { if (typeof t.isCreative === "function" && t.isCreative()) return false; } catch (y) {}
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
        if (mainRaw && mainPlayerEligible(mainRaw)) {
            // Prevent HurtByTargetGoal from stealing aggro between our 5-tick
            // passes. Main-player attacks may remain in memory; all others go.
            if (atk && !sameEnt(atk, mainRaw)) {
                try { raw.setLastHurtByMob(null); } catch (xM) {}
            }
            return mainRaw;
        }
        // Ally friendly-fire scrub: a raid mob accidentally hurt by another raid
        // mob must never retaliate — wipe the memory so vanilla HurtByTargetGoal
        // can't pick it up between our passes either.
        if (atk && isAlly(atk)) {
            try { raw.setLastHurtByMob(null); } catch (xC) {}
            atk = null;
        }
        if (validVictim(raw, atk)) return atk;

        var cur = null;
        try { cur = (typeof raw.getTarget === "function") ? raw.getTarget() : null; } catch (y) {}
        if (cur && validVictim(raw, cur)) return cur;

        var v = nearestFrom(raw, victims, radiusSqr);
        if (v) return v;
        return null;
    }

    // ---- Anti-stuck ---------------------------------------------------------
    // A mob that has a target but hasn't moved between aggro passes first gets a
    // navigation recompute; if it stays frozen ~8s without a useful approach it
    // teleports onto safe ground near the target. A close standstill is exempt
    // only with line of sight (legit melee crowd or ranged hold); a nearby mob
    // separated by a wall still counts as stuck.
    const STUCK_MOVE_SQ = 0.25; // blocks² moved per pass below this = "not moving"
    const STUCK_NEAR_SQ = 576;  // 24² blocks — inside this idling is allowed
    const STUCK_KICK    = 4;    // idle passes before a nav recompute (repeats every 4)
    const STUCK_TP      = 32;   // idle passes (~8s at 5-tick cadence) before hard teleport
    const STUCK_TP_R    = 12;   // teleport ring radius around the target
    const BOSS_BREACH_START = 2;       // first breach after ~0.5s stuck
    const BOSS_BREACH_RETRY = 4;       // retry every ~1s when no breakable wall was found
    const BOSS_BREACH_MAX_BLOCKS = 8;  // hard cap per attempt across every ray
    const BOSS_BREACH_MAX_HARDNESS = 10.0;
    const BOSS_BREACH_PROTECTED_IDS = {
        "minecraft:bedrock": true,
        "minecraft:barrier": true,
        "minecraft:end_portal": true,
        "minecraft:end_portal_frame": true,
        "minecraft:nether_portal": true,
        "minecraft:command_block": true,
        "minecraft:chain_command_block": true,
        "minecraft:repeating_command_block": true,
        "minecraft:structure_block": true,
        "minecraft:jigsaw": true,
        "minecraft:spawner": true,
        "minecraft:trial_spawner": true,
        "minecraft:vault": true,
        "minecraft:reinforced_deepslate": true,
        "minecraft:beacon": true,
        "minecraft:conduit": true,
        "minecraft:lodestone": true,
        "minecraft:respawn_anchor": true
    };

    function isRaidBreacher(raw) {
        try {
            var tags = raw.getTags();
            return !!(tags && tags.contains("raid_breacher"));
        } catch (e) { return false; }
    }
    var _bossBreachCls = null;
    function bossBreachClasses() {
        if (_bossBreachCls) return _bossBreachCls;
        _bossBreachCls = {
            BlockPos: RC("net.minecraft.core.BlockPos"),
            Registries: RC("net.minecraft.core.registries.BuiltInRegistries"),
            GameRules: RC("net.minecraft.world.level.GameRules"),
            EventHooks: RC("net.neoforged.neoforge.event.EventHooks")
        };
        return _bossBreachCls;
    }
    function bossBreachBlockId(state, C) {
        try { return String(C.Registries.BLOCK.getKey(state.getBlock())); }
        catch (e) { return ""; }
    }
    function canBossBreach(level, raw, pos, C) {
        var state = null;
        try { state = level.getBlockState(pos); } catch (e) { return false; }
        if (!state) return false;
        try { if (state.isAir()) return false; } catch (eAir) {}
        try {
            var fluid = state.getFluidState();
            if (fluid && !fluid.isEmpty()) return false;
        } catch (eFluid) {}
        try { if (level.getBlockEntity(pos) != null) return false; } catch (eBe) {}

        var id = bossBreachBlockId(state, C);
        if (BOSS_BREACH_PROTECTED_IDS[id]) return false;
        if (id.indexOf("portal") !== -1 || id.indexOf("command_block") !== -1 ||
            id.indexOf("structure_block") !== -1) return false;

        var hardness = -1;
        try { hardness = Number(state.getDestroySpeed(level, pos)); } catch (eHard) { return false; }
        if (!(hardness >= 0) || hardness > BOSS_BREACH_MAX_HARDNESS) return false;
        try {
            if (typeof state.canEntityDestroy === "function" && !state.canEntityDestroy(level, pos, raw)) return false;
        } catch (eCan) { return false; }
        try {
            if (C.EventHooks && !C.EventHooks.onEntityDestroyBlock(raw, pos, state)) return false;
        } catch (eEvent) { return false; }
        return true;
    }
    function destroyBossBreachBlock(level, raw, pos, C) {
        if (!canBossBreach(level, raw, pos, C)) return false;
        try { return !!level.destroyBlock(pos, false, raw); }
        catch (e3) {
            try { return !!level.destroyBlock(pos, false); }
            catch (e2) { return false; }
        }
    }
    // Open a short corridor through obstructions directly in front of the boss.
    // No downward rays, no drops and no continuous mining goal; one invocation
    // is hard-capped even when several rays hit a thick wall.
    function breachBossObstruction(raw, target) {
        if (!target) return 0; // caller already checked the cached breacher flag
        var C = bossBreachClasses();
        if (!C.BlockPos || !C.Registries) return 0;
        var level = null;
        try { level = (typeof raw.level === "function") ? raw.level() : raw.level; } catch (eLvl) {}
        if (!level) return 0;
        try {
            if (C.GameRules && !level.getGameRules().getBoolean(C.GameRules.RULE_MOBGRIEFING)) return 0;
        } catch (eRule) { return 0; }

        var rx, ry, rz, tx, tz;
        try {
            rx = Number(raw.getX()); rz = Number(raw.getZ());
            tx = Number(target.getX()); tz = Number(target.getZ());
            var box = raw.getBoundingBox();
            ry = Math.floor(Number(box.minY) + 0.1);
        } catch (ePos) { return 0; }
        var dx = tx - rx, dz = tz - rz;
        var len = Math.sqrt(dx * dx + dz * dz);
        if (!(len > 0.01)) return 0;
        dx /= len; dz /= len;
        var sideX = -dz, sideZ = dx;
        var width = 1.0, height = 2;
        try { width = Math.max(1.0, Number(raw.getBbWidth())); } catch (eW) {}
        try { height = Math.max(2, Math.min(3, Math.ceil(Number(raw.getBbHeight())))); } catch (eH) {}
        var front = width * 0.5 + 0.55;
        var sideSpread = Math.max(0.3, Math.min(1.1, width * 0.35));
        var sides = width >= 1.8 ? [-sideSpread, 0, sideSpread] : [-sideSpread, sideSpread];
        var broken = 0;

        for (var yOff = 0; yOff < height && broken < BOSS_BREACH_MAX_BLOCKS; yOff++) {
            for (var si = 0; si < sides.length && broken < BOSS_BREACH_MAX_BLOCKS; si++) {
                // Continue a short distance after a successful break so one
                // fast attempt can open a usable two-block-deep entrance.
                for (var depth = 0; depth < 3 && broken < BOSS_BREACH_MAX_BLOCKS; depth++) {
                    var reach = front + depth * 0.75;
                    var bx = Math.floor(rx + dx * reach + sideX * sides[si]);
                    var bz = Math.floor(rz + dz * reach + sideZ * sides[si]);
                    var pos = new C.BlockPos(bx, ry + yOff, bz);
                    var state = null;
                    try { state = level.getBlockState(pos); } catch (eState) { break; }
                    var air = false;
                    try { air = state.isAir(); } catch (eAir2) {}
                    if (air) continue;
                    if (destroyBossBreachBlock(level, raw, pos, C)) {
                        broken++;
                        continue;
                    }
                    break; // protected/unbreakable block stops this ray
                }
            }
        }
        return broken;
    }

    function unstick(inst, raw, target) {
        var key;
        try { key = String(raw.getStringUUID()); }
        catch (e) { try { key = String(raw.getUUID()); } catch (e2) { return; } }
        var x, y, z;
        try { x = raw.getX(); y = raw.getY(); z = raw.getZ(); } catch (e3) { return; }
        var st = inst._mobState[key];
        // Entity tags are read once per mob per wave. The hot anti-stuck path
        // then uses this cached boolean, so ordinary raid mobs never enter the
        // block-scanning code and stuck bosses do not repeatedly scan tags.
        if (!st) {
            inst._mobState[key] = {
                x: x, y: y, z: z, idle: 0, tp: 0,
                breacher: isRaidBreacher(raw)
            };
            return;
        }
        var dx = x - st.x, dy = y - st.y, dz = z - st.z;
        var movedSq = dx * dx + dy * dy + dz * dz;
        st.x = x; st.y = y; st.z = z;
        var distSq;
        try { distSq = raw.distanceToSqr(target); } catch (e4) { return; }
        var seesTarget = false;
        try { seesTarget = (typeof raw.hasLineOfSight === "function") && raw.hasLineOfSight(target); } catch (eLos) {}
        if (movedSq > STUCK_MOVE_SQ || (distSq < STUCK_NEAR_SQ && seesTarget)) { st.idle = 0; return; }
        st.idle++;
        var breachDue = (st.idle === BOSS_BREACH_START) ||
                        (st.idle > BOSS_BREACH_START && st.idle % BOSS_BREACH_RETRY === 0);
        if (st.breacher && breachDue) {
            var breached = breachBossObstruction(raw, target);
            if (breached > 0) {
                st.idle = 0;
                try {
                    var breachNav = (typeof raw.getNavigation === "function") ? raw.getNavigation() : null;
                    if (breachNav) breachNav.moveTo(target, 1.0);
                } catch (eBreachNav) {}
                return;
            }
        }
        if (st.idle >= STUCK_TP) {
            st.idle = 0; st.tp++;
            var ang = ((hashStr(key) % 360) * Math.PI / 180) + st.tp * GOLDEN_ANG;
            try {
                var lvl = (typeof raw.level === "function") ? raw.level() : raw.level;
                var tx = target.getX() + Math.cos(ang) * STUCK_TP_R;
                var tz = target.getZ() + Math.sin(ang) * STUCK_TP_R;
                var ty = groundY(lvl, tx, target.getY(), tz, inst.def.waterproof !== false);
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
            // Negative is Minecraft's hard no-drop sentinel. Unlike 0.0 it
            // cannot be raised by Looting, so raid-only gear never leaks.
            try { if (typeof raw.setDropChance === "function") raw.setDropChance(slot, -1.0); } catch (e3) {}
        }
        if (any) invokeNoArg(raw, "reassessWeaponGoal");   // no-op on mobs without it
    }
    function applyEntityNbt(entity, nbt) {
        if (!nbt) return;
        try { if (typeof entity.mergeNbt === "function") entity.mergeNbt(nbt); }
        catch (e) { warn("mergeNbt(entity): " + e); }
    }
    function forceAwakeRaidMob(entity, type) {
        var mode = FORCE_AWAKE_RAID_MOB_TYPES[String(type || "")];
        if (!mode) return;
        var raw = rawMobOf(entity);
        if (!raw) return;

        // Use only the public switch owned by each mod. This is deliberately
        // type-scoped: similarly named methods on unrelated mobs are untouched.
        if (mode === "cataclysm_sleep") {
            try {
                if (typeof raw.setAwaken === "function") raw.setAwaken(true);
            } catch (eAwake) {
                warn("setAwaken " + type + ": " + eAwake);
            }
            try {
                if (typeof raw.setSleep === "function") raw.setSleep(false);
                else if (typeof raw.setAttackState === "function") raw.setAttackState(0);
            } catch (eSleep) {
                warn("clear sleep state " + type + ": " + eSleep);
            }
        } else if (mode === "cataclysm_awaken") {
            try {
                if (typeof raw.setIsAwaken === "function") raw.setIsAwaken(true);
            } catch (eGolem) {
                warn("setIsAwaken " + type + ": " + eGolem);
            }
        } else if (mode === "active") {
            try {
                if (typeof raw.setActive === "function") raw.setActive(true);
            } catch (eActive) {
                warn("setActive " + type + ": " + eActive);
            }
        }
    }

    // Plan and spawn every mob in a round. Returns entity refs.
    function spawnRound(level, player, def, round, instanceId) {
        var EAI = getEAI();
        if (!EAI || !player) return null;
        var out = [];
        var pp = null;
        try { pp = player.position(); } catch (ePp) { warn(`spawnRound: player.position() failed: ${ePp}`); return null; }
        var server = null;
        try { server = player.server; } catch (eSv) {}
        // Total mob count drives horde spread or the ring squad count.
        var total = 0;
        for (var ti = 0; ti < round.mobs.length; ti++) total += round.mobs[ti].count;
        if (total < 1) total = 1;
        var roundIdx = def.rounds.indexOf(round);

        // Resolve shared horde anchor or multiple ring squad anchors once.
        var anchor = null;
        var ringAnchors = null;
        if (def.spawnPattern === "horde") {
            anchor = findHordeAnchor(level, pp, def, instanceId, roundIdx);
        } else {
            ringAnchors = findRingGroupAnchors(level, pp, def, total, instanceId, roundIdx);
        }

        // Plan every position before creating the first entity. This makes a
        // no-safe-ground result atomic: no partial wave is spawned, and the
        // caller can retry later without duplicates or cleanup drops.
        var positions = [];
        var emergencyAnchor = null;
        var emergencyTried = false;
        var emergencySeed = hashStr(String(instanceId) + "#" + roundIdx + "#emergency");
        if (def.spawnPattern === "horde" && !anchor) {
            emergencyTried = true;
            emergencyAnchor = findEmergencyAnchor(level, pp, def, emergencySeed);
            anchor = emergencyAnchor;
        }
        if (def.spawnPattern === "horde" && !anchor) {
            warn("spawnRound: no safe horde anchor; delaying wave " + (roundIdx + 1));
            return null;
        }
        // Difficult terrain may invalidate a sector. If fewer than two squads
        // survived normal planning, pay for one bounded rescue search so the
        // multi-direction attack is retained whenever any second safe area exists.
        if (def.spawnPattern === "ring" && (!ringAnchors || ringAnchors.length < 2)) {
            emergencyTried = true;
            emergencyAnchor = findEmergencyAnchor(level, pp, def, emergencySeed + 97);
            if (!ringAnchors) ringAnchors = [];
            if (emergencyAnchor) {
                var farEnough = true;
                for (var ai = 0; ai < ringAnchors.length; ai++) {
                    var dx = ringAnchors[ai].x - emergencyAnchor.x;
                    var dz = ringAnchors[ai].z - emergencyAnchor.z;
                    if (dx * dx + dz * dz < 64) { farEnough = false; break; }
                }
                if (farEnough || ringAnchors.length === 0) ringAnchors.push(emergencyAnchor);
            }
        }
        if (def.spawnPattern === "ring" && (!ringAnchors || ringAnchors.length === 0)) {
            warn("spawnRound: no safe ring group anchor; delaying wave " + (roundIdx + 1));
            return null;
        }
        if (ringAnchors) info("wave " + (roundIdx + 1) + " planned as " + ringAnchors.length + " assault groups");

        for (var pi = 0; pi < total; pi++) {
            var planned = anchor ? hordeMobPos(level, anchor, pi, total, def.waterproof !== false)
                                 : ringGroupMobPos(level, ringAnchors, pi, total, def.waterproof !== false);
            if (!planned) {
                if (!emergencyTried) {
                    emergencyTried = true;
                    emergencyAnchor = findEmergencyAnchor(level, pp, def, emergencySeed);
                }
                if (!emergencyAnchor) {
                    warn("spawnRound: no safe spawn ground; delaying wave " + (roundIdx + 1));
                    return null;
                }
                planned = anchor
                    ? hordeMobPos(level, emergencyAnchor, pi, total, def.waterproof !== false)
                    : ringGroupMobPos(level, [emergencyAnchor], pi, total, def.waterproof !== false);
            }
            positions.push(planned);
        }

        var idx = 0;

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
                var pos = positions[idx];
                idx++;

                var entity = EAI.fromPresets(level, mob.type, names, xtra);
                if (!entity) { err(`spawnRound: fromPresets returned null for ${mob.type}`); continue; }
                try { entity.setPos(Math.floor(pos.x) + 0.5, pos.y, Math.floor(pos.z) + 0.5); } catch (eP) { warn(`setPos: ${eP}`); }
                facePlayer(entity, pos, pp);
                try { entity.addTag("raid_mob"); } catch (e1) {}
                try { entity.addTag("raid_" + instanceId); } catch (e2) {}
                if (mob.breacher) { try { entity.addTag("raid_breacher"); } catch (eBreachTag) {} }
                try { entity.setPersistenceRequired(); } catch (e3) {}
                // Stable identity used by Xaero's custom RAID radar category.
                // The boss bar already carries the wave name, while keeping
                // this exact makes the client-side filter future-proof.
                try { entity.setCustomName(Text.of("[RAID]")); } catch (e4) {}
                applyEntityNbt(entity, mob.nbt);   // variants/skins/baby/mod data — pre-spawn
                preparePlayerBoundRaidMob(entity, mob.type, player);
                try { entity.spawn(); }
                catch (eSp) { err(`spawn failed ${mob.type}: ${eSp}`); continue; }
                forceAwakeRaidMob(entity, mob.type);
                try { EAI.applyDeferred(level, entity, EAI.resolveArgs(names, xtra)); }
                catch (eD) { warn(`applyDeferred: ${eD}`); }
                equipMob(entity, mob.equip);        // weapons/armor — post-spawn
                joinRaidTeam(server, entity);       // colored glow outline team
                forceTarget(entity, player);
                // Instant charge: start pathing toward the player on the spawn
                // tick so nobody stands around waiting for its first AI pass.
                try {
                    var rawNew = rawMobOf(entity);
                    var nav = (rawNew && typeof rawNew.getNavigation === "function") ? rawNew.getNavigation() : null;
                    if (nav) nav.moveTo(unwrapPlayer(player), 1.0);
                } catch (eNav) {}
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
        this.spawnRetryLeft = 0;       // backoff when terrain has no safe spawn plan
        this.breatherLeft = 0;
        this.roundTimeLeft = null;
        this.roundMobs = [];          // live mobs of the current round
        this.carryover = [];          // live survivors carried from timed-out rounds
        this.bar       = null;        // ServerBossEvent (or null if disabled/unavailable)
        this.barBase   = def.title || prettyId(def.id);
        this.roundTotalHealth = 1;    // sum of max-health for the current wave (bar denominator)
        this.roundTotalMobs = 0;      // actual current + carryover count displayed in the bar
        this.endLeft   = 0;           // ENDING-phase linger countdown (victory/defeat bar)
        this._mobState = {};          // uuid -> {x,y,z,idle,tp} anti-stuck tracking
        this._assistTick = 0;         // aggro pass counter (waterAssist throttling)
        this._usesStrictDaylightGuard = raidUsesStrictDaylightGuard(def);
        this._terminalNotified = false;// terminal lifecycle event fires exactly once
        this._deathCount = 0;         // shown by the HUD and persisted; never changes raid outcome
        this._diedDuringRaid = false; // compatibility flag used by flawless advancements
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
    // Straggler highlight: non-final waves keep their second-half reveal; the
    // final wave reveals ALL current + carryover mobs after exactly 3 minutes.
    // WIN_WAIT remains permanently revealed. Refreshed every ~1s using the
    // existing assist cadence, so this adds no new tick loop.
    RaidInstance.prototype.glowStragglers = function () {
        if ((this._assistTick & 3) !== 2) return;
        var glow = (this.phase === "WIN_WAIT");
        if (!glow && this.phase === "FIGHTING") {
            var round = this.def.rounds[this.roundIdx];
            var tl = round.timeLimit;
            var timed = (tl != null && this.roundTimeLeft != null);
            var finalRound = (this.roundIdx + 1 >= this.def.rounds.length);
            if (timed && finalRound) {
                glow = (tl - this.roundTimeLeft >= FINAL_GLOW_AFTER_TICKS);
            } else if (timed) {
                glow = (this.roundTimeLeft < tl / 2);
            }
        }
        if (!glow) return;
        eachMob(this, function (m) {
            try { m.potionEffects.add("minecraft:glowing", 120, 0, false, false); } catch (e) {}
        });
    };
    function applyDefeatPenalty(player) {
        if (!player) return;
        try { player.potionEffects.add("minecraft:slowness", DEFEAT_PENALTY_TICKS, DEFEAT_PENALTY_AMP, false, true); }
        catch (e1) { warn("defeat slowness: " + e1); }
        try { player.potionEffects.add("minecraft:weakness", DEFEAT_PENALTY_TICKS, DEFEAT_PENALTY_AMP, false, true); }
        catch (e2) { warn("defeat weakness: " + e2); }
    }
    function grantVictoryAdvancement(inst, player) {
        if (!inst || !player) return;
        var advancement = RAID_VICTORY_ADVANCEMENTS[inst.defId];
        if (!advancement) return;
        try {
            var server = player.server;
            if (!server || typeof server.runCommandSilent !== "function") return;
            // Minecraft usernames cannot contain whitespace, so the owner name
            // is safe as the single command target. "only" grants no parent or
            // unrelated raid advancement and is idempotent on repeat victories.
            server.runCommandSilent("advancement grant " + String(player.username) + " only " + advancement);
        } catch (e) {
            warn("victory advancement " + advancement + ": " + e);
        }
    }
    function grantFlawlessAdvancement(inst, player) {
        if (!inst || !player || inst._diedDuringRaid) return;
        var advancement = RAID_FLAWLESS_ADVANCEMENTS[inst.defId];
        if (!advancement) return;
        try {
            var server = player.server;
            if (!server || typeof server.runCommandSilent !== "function") return;
            server.runCommandSilent("advancement grant " + String(player.username) + " only " + advancement);
        } catch (e) {
            warn("flawless advancement " + advancement + ": " + e);
        }
    }
    RaidInstance.prototype.lose = function (player) {
        killMobs(this);
        applyDefeatPenalty(player);
        playSnd(player, this.def.sounds.lose);
        showTitle(player, "DEFEAT", this.barBase, "dark_red");
        fireCb(this.def, "onLose", [this.ctx(player)]);
        this.barEnd("§4§l✖ " + this.barBase + " - DEFEATED" + this.deathBarText(), "RED", 0.0);
        this.endLeft = this.def.barHold || DEFAULT_BAR_HOLD;
        this.phase = "ENDING";
        notifyTerminal(this, "lose");
    };
    // Set the bar name only when the rendered text actually changed — the live
    // FIGHTING text refreshes every throttle tick but the string only changes
    // ~once a second (timer tick / kill), so packet traffic stays minimal.
    RaidInstance.prototype.setBarName = function (txt) {
        if (!this.bar || txt === this._barText) return;
        this._barText = txt;
        try { this.bar.setName(Text.of(txt)); } catch (e) {}
    };
    RaidInstance.prototype.deathBarText = function () {
        return " §7• §c☠ §f" + Math.max(0, Number(this._deathCount) || 0);
    };
    // Live combat bar carries compact structured fields for both the vanilla
    // fallback and the custom HUD: title, wave number, mob count and timer.
    // The authored wave name is shown by the round-start title, not repeated here.
    RaidInstance.prototype.barFight = function (round) {
        var n = this.def.rounds.length;
        var alive = this.roundMobs.length + this.carryover.length;
        var totalMobs = Math.max(alive, this.roundTotalMobs);
        var txt = "§c" + this.barBase + " §8(" + (this.roundIdx + 1) + "/" + n + ")" +
                  " §7• §f⚔ " + alive + "/" + totalMobs;
        if (this.roundTimeLeft != null) {
            var col = (this.roundTimeLeft <= 1200) ? "§c" : "§e";
            txt += " §7• " + col + "⌛ " + fmtTicks(this.roundTimeLeft);
        }
        txt += this.deathBarText();
        this.setBarName(txt);
    };
    RaidInstance.prototype.updateBar = function (player) {
        if (!this.bar) return;
        if (player) { try { if (!this.bar.getPlayers().contains(player)) this.bar.addPlayer(player); } catch (e) {} }
        var alive = sumHealth(this.roundMobs) + sumHealth(this.carryover);
        var total = this.roundTotalHealth > 0 ? this.roundTotalHealth : 1;
        var aliveMobs = this.roundMobs.length + this.carryover.length;
        var p = alive / total;
        // A modded wrapper can briefly expose no readable health while the mob
        // is still alive. Use count progress instead of flashing an empty bar.
        if (aliveMobs > 0 && !(alive > 0)) {
            p = aliveMobs / Math.max(aliveMobs, this.roundTotalMobs, 1);
        }
        if (p < 0) p = 0; if (p > 1) p = 1;
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
        // While the owner is alive every raid mob is hard-locked to them, so an
        // entity scan cannot affect the result. Keep the shared fallback scan
        // only for the dead/offline interval; this is the common-path fast path.
        var victims = mainRaw ? [] : collectVictims(this, center, radius);
        var radiusSqr = radius * radius;
        var inst = this;
        eachMob(this, function (m) {
            var raw = rawMobOf(m);
            if (!raw) return;
            clearDaylightFire(inst.level, raw);
            if (typeof raw.setTarget !== "function") return;
            var t = decideTarget(raw, mainRaw, victims, radiusSqr);
            var cur = null;
            try { cur = (typeof raw.getTarget === "function") ? raw.getTarget() : null; } catch (eG) {}
            if (!t) {
                // No valid target this pass — if the mob is locked on a raid
                // ally (mod AI retaliation), break the lock instead of leaving it.
                if (cur && isAlly(cur)) { try { raw.setTarget(null); } catch (eN) {} }
                return;
            }
            // setTarget only on an actual change — re-setting the same target
            // every pass fires target-change events + goal re-evaluation on
            // every mob, and constantly restarts pathing (the "stuck" jitter).
            if (!cur || !sameEnt(cur, t)) {
                try { raw.setTarget(t); } catch (eS) {}
                // A target assignment alone does not wake every modded mob's
                // goal selector. Kick navigation once on acquisition/respawn;
                // the regular unstick pass takes over without restarting paths.
                try {
                    var navLock = (typeof raw.getNavigation === "function") ? raw.getNavigation() : null;
                    if (navLock) navLock.moveTo(t, 1.0);
                } catch (eNav) {}
            }
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
        var spawned = spawnRound(this.level, player, this.def, round, this.id);
        if (spawned == null) {
            this.spawnRetryLeft = SPAWN_RETRY_TICKS;
            this.setBarName("§e" + this.barBase + " §8(" + (this.roundIdx + 1) + "/" +
                            this.def.rounds.length + ") §7• waiting for safe spawn ground..." +
                            this.deathBarText());
            this.barColorSet("YELLOW");
            return false;
        }
        this.spawnRetryLeft = 0;
        this.roundMobs = spawned;
        this.roundTimeLeft = (round.timeLimit != null) ? round.timeLimit : null;
        this.roundTotalHealth = Math.max(1, sumMax(this.roundMobs) + sumMax(this.carryover));
        this.roundTotalMobs = this.roundMobs.length + this.carryover.length;
        this.barFight(round);
        this.barColorSet(this.def.barColor);   // back from BREATHER yellow
        this.updateBar(player);
        if (idx > 0) playSnd(player, this.def.sounds.roundStart);   // wave 1 covered by raidStart
        fireCb(this.def, "onRoundStart", [this.ctx(player), round, idx]);
        this.phase = "FIGHTING";
        return true;
    };
    RaidInstance.prototype.tick = function () {
        var player = resolvePlayer(this);   // live player wrapper, or null if offline
        var round  = this.def.rounds[this.roundIdx];

        // No player-death loss: if the main player dies the mobs switch to nearby
        // villagers/players (see aggro) and re-aggro the player on respawn. The
        // only loss is the final round's timer expiring (see FIGHTING below).
        // Logging out is different from dying: pause the whole combat state so
        // an offline player cannot lose (or accidentally win through unloaded
        // entity wrappers). On return, persistent mobs are rebound by UUID/tag.
        if (!player && this.phase !== "ENDING") return;
        if (this._restoring) {
            if (this._restoreDelay > 0) {
                this._restoreDelay -= TICK_THROTTLE;
                return;
            }
            if (!rebindRestoredMobs(this)) return;
            this._restoring = false;
            this._ctxPlayer = player;
            this.updateBar(player);
            persistActive(Manager._server);
            info("resumed raid " + this.id + " for " + player.username);
        }

        switch (this.phase) {

            case "ENDING":
                this.endLeft -= TICK_THROTTLE;
                if (this.endLeft <= 0) { this.closeBar(); this.phase = "DONE"; }
                break;
            case "SPAWNING":
                // Need a live player to ring-spawn around. Offline -> wait (raid
                // keeps running, just doesn't spawn the next round until they return).
                if (!player) return;
                if (this.spawnRetryLeft > 0) {
                    this.spawnRetryLeft -= TICK_THROTTLE;
                    return;
                }
                this.startRound(this.roundIdx, player);
                break;

            case "FIGHTING":
                this.roundMobs = pruneDead(this.roundMobs);
                this.carryover = pruneDead(this.carryover);
                this.aggro(player);
                this.barFight(round);
                this.updateBar(player);

                var finalRound = (this.roundIdx + 1 >= this.def.rounds.length);
                // Intermediate waves advance when THEIR mobs are gone; older
                // timed-out survivors remain in carryover and join later waves.
                // The final wave is different: victory requires every current
                // mob AND every carryover survivor to be dead before its timer.
                var roundCleared = (this.roundMobs.length === 0);
                var finalCleared = (roundCleared && this.carryover.length === 0);
                if (roundCleared && (!finalRound || finalCleared)) {
                    fireCb(this.def, "onRoundEnd", [this.ctx(player), round, this.roundIdx]);
                    if (!finalRound) {
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
                this.setBarName("§e" + this.barBase + " §8(" +
                                Math.min(this.roundIdx + 2, this.def.rounds.length) + "/" + this.def.rounds.length +
                                ") §7• §e⌛ §f" + Math.ceil(this.breatherLeft / 20) + "s" +
                                this.deathBarText());
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
                var stragglers = this.roundMobs.length + this.carryover.length;
                this.setBarName("§6" + this.barBase + " §8(" + this.def.rounds.length + "/" +
                                this.def.rounds.length + ") §7• §f⚔ " + stragglers + "/" +
                                Math.max(stragglers, this.roundTotalMobs) + " §7stragglers §e(glowing!)" +
                                this.deathBarText());
                this.updateBar(player);
                if (this.roundMobs.length === 0 && this.carryover.length === 0) {
                    fireCb(this.def, "onWin", [this.ctx(player)]);
                    grantVictoryAdvancement(this, player);
                    grantFlawlessAdvancement(this, player);
                    playSnd(player, this.def.sounds.win);
                    showTitle(player, "VICTORY", this.barBase, "green");
                    victoryBurst(player);
                    this.barEnd("§a§l✔ " + this.barBase + " - VICTORY" + this.deathBarText(), "GREEN", 1.0);
                    this.endLeft = this.def.barHold || DEFAULT_BAR_HOLD;
                    this.phase = "ENDING";
                    notifyTerminal(this, "win");
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
    const _terminalListeners = [];
    const _pendingLifestealerForms = [];
    var _idSeq    = 0;
    var _tickAccum = 0;
    var _persistAccum = 0;
    var _restoreAttempted = false;

    function newInstanceId(defId) {
        var id = null;
        do { _idSeq++; id = defId + "_" + _idSeq; } while (_active[id]);
        return id;
    }

    function mobUuid(entity) {
        try { if (entity && entity.uuid != null) return String(entity.uuid).toLowerCase(); } catch (e) {}
        try {
            var raw = rawMobOf(entity);
            if (raw && typeof raw.getUUID === "function") return String(raw.getUUID()).toLowerCase();
        } catch (e2) {}
        return null;
    }

    function mobUuidList(arr) {
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var id = mobUuid(arr[i]);
            if (id) out.push(id);
        }
        return out;
    }

    function levelId(level) {
        try {
            if (typeof level.dimension === "function") {
                var key = level.dimension();
                if (key && typeof key.location === "function") return String(key.location());
                return String(key);
            }
        } catch (e) {}
        try {
            var dim = level.dimension;
            if (dim && typeof dim.location === "function") return String(dim.location());
            return String(dim);
        } catch (e2) {}
        return "minecraft:overworld";
    }

    function findLevel(server, id) {
        if (!server || typeof server.getAllLevels !== "function") return null;
        var fallback = null;
        try {
            var it = server.getAllLevels().iterator();
            while (it.hasNext()) {
                var level = it.next();
                if (!fallback) fallback = level;
                if (levelId(level) === String(id)) return level;
            }
        } catch (e) {}
        // Scheduled raids currently run in the overworld. Only use the fallback
        // for that dimension; never silently move a restored manual raid between
        // dimensions, which could detach it from its persistent mobs.
        return String(id) === "minecraft:overworld" ? fallback : null;
    }

    function uuidSet(list) {
        var out = {};
        if (!list) return out;
        for (var i = 0; i < list.length; i++) out[String(list[i]).toLowerCase()] = true;
        return out;
    }

    function uuidKeys(set) {
        var out = [];
        if (!set) return out;
        for (var k in set) if (set[k]) out.push(k);
        return out;
    }

    function prepareForRebind(inst) {
        if (!inst || inst._restoring || inst.phase === "DONE" || inst.phase === "ENDING") return;
        inst._restoreRoundUuids = uuidSet(mobUuidList(inst.roundMobs));
        inst._restoreCarryUuids = uuidSet(mobUuidList(inst.carryover));
        inst._restoreExpected = uuidKeys(inst._restoreRoundUuids).length + uuidKeys(inst._restoreCarryUuids).length;
        inst._restoreWait = RESTORE_MOB_WAIT;
        inst._restoreDelay = RESTORE_LOGIN_DELAY;
        inst._restoreScanCooldown = 0;
        inst._restoring = true;
        // Do not retain stale Java entity wrappers across a chunk unload/login.
        inst.roundMobs = [];
        inst.carryover = [];
        inst._mobState = {};
    }

    function rebindRestoredMobs(inst) {
        if (inst._restoreScanCooldown > 0) {
            inst._restoreScanCooldown -= TICK_THROTTLE;
            if (inst._restoreScanCooldown > 0) return false;
        }
        var round = [], carry = [], matched = 0;
        try {
            var getter = inst.level.getEntities();
            if (getter && typeof getter.getAll === "function") {
                var it = getter.getAll().iterator();
                while (it.hasNext()) {
                    var entity = it.next();
                    var tags = null;
                    try { tags = entity.getTags(); } catch (eT) {}
                    if (!tags || !tags.contains("raid_" + inst.id)) continue;
                    var id = mobUuid(entity);
                    if (!id) continue;
                    if (inst._restoreCarryUuids[id]) { carry.push(entity); matched++; }
                    else if (inst._restoreRoundUuids[id]) { round.push(entity); matched++; }
                    else round.push(entity); // mod-created raid minion saved after the last snapshot
                }
            }
        } catch (e) { warn("restore mob scan " + inst.id + ": " + e); }

        if (matched < inst._restoreExpected && inst._restoreWait > 0) {
            // Retry only once per second. A resume is rare; throttling the
            // temporary entity scan keeps even crowded worlds inexpensive.
            inst._restoreScanCooldown = 20;
            inst._restoreWait -= 20;
            return false;
        }
        inst.roundMobs = round;
        inst.carryover = carry;
        inst._restoreRoundUuids = {};
        inst._restoreCarryUuids = {};
        inst._restoreExpected = 0;
        inst._restoreWait = 0;
        inst._restoreDelay = 0;
        inst._restoreScanCooldown = 0;
        inst._mobState = {};
        return true;
    }

    function snapshotInstance(inst) {
        var roundIds = inst._restoring ? uuidKeys(inst._restoreRoundUuids) : mobUuidList(inst.roundMobs);
        var carryIds = inst._restoring ? uuidKeys(inst._restoreCarryUuids) : mobUuidList(inst.carryover);
        return {
            id: inst.id,
            defId: inst.defId,
            playerUuid: inst.playerUuid,
            dimension: levelId(inst.level),
            roundIdx: inst.roundIdx,
            phase: inst.phase,
            spawnRetryLeft: inst.spawnRetryLeft,
            breatherLeft: inst.breatherLeft,
            roundTimeLeft: inst.roundTimeLeft,
            roundTotalHealth: inst.roundTotalHealth,
            roundTotalMobs: inst.roundTotalMobs,
            deathCount: Math.max(0, Number(inst._deathCount) || 0),
            diedDuringRaid: !!inst._diedDuringRaid,
            roundMobUuids: roundIds,
            carryoverUuids: carryIds
        };
    }

    function persistActive(server) {
        if (!server || !server.persistentData) return false;
        var snapshots = [];
        for (var k in _active) {
            var inst = _active[k];
            if (inst.phase !== "DONE" && inst.phase !== "ENDING") snapshots.push(snapshotInstance(inst));
        }
        try {
            if (snapshots.length > 0) server.persistentData.putString(ACTIVE_STATE_KEY, JSON.stringify(snapshots));
            else server.persistentData.remove(ACTIVE_STATE_KEY);
            return true;
        } catch (e) {
            warn("persist active raids: " + e);
            return false;
        }
    }

    function restoreActive(server) {
        if (_restoreAttempted) return 0;
        _restoreAttempted = true;
        var raw = "";
        try { raw = String(server.persistentData.getString(ACTIVE_STATE_KEY) || ""); }
        catch (e) { warn("read active raids: " + e); return 0; }
        if (!raw) return 0;

        var snapshots = null;
        try { snapshots = JSON.parse(raw); }
        catch (e2) {
            warn("invalid active raid snapshot discarded: " + e2);
            try { server.persistentData.remove(ACTIVE_STATE_KEY); } catch (eRm) {}
            return 0;
        }
        if (!snapshots || typeof snapshots.length !== "number") return 0;

        var restored = 0;
        for (var i = 0; i < snapshots.length; i++) {
            var s = snapshots[i];
            if (!s || !s.id || _active[String(s.id)]) continue;
            var def = Registry.get(String(s.defId));
            var level = findLevel(server, s.dimension);
            if (!def || !level || !def.rounds || def.rounds.length === 0) continue;

            var inst = Object.create(RaidInstance.prototype);
            inst.id = String(s.id);
            inst.defId = String(s.defId);
            inst.def = def;
            inst.level = level;
            inst.playerUuid = String(s.playerUuid);
            inst._ctxPlayer = null;
            inst.roundIdx = Math.max(0, Math.min(def.rounds.length - 1, Number(s.roundIdx) || 0));
            inst.phase = String(s.phase || "SPAWNING");
            if (inst.phase !== "SPAWNING" && inst.phase !== "FIGHTING" &&
                inst.phase !== "BREATHER" && inst.phase !== "WIN_WAIT") inst.phase = "SPAWNING";
            inst.spawnRetryLeft = Math.max(0, Number(s.spawnRetryLeft) || 0);
            inst.breatherLeft = Math.max(0, Number(s.breatherLeft) || 0);
            inst.roundTimeLeft = (s.roundTimeLeft == null) ? null : Math.max(0, Number(s.roundTimeLeft) || 0);
            inst.roundMobs = [];
            inst.carryover = [];
            inst.bar = (def.bossBar === false) ? null :
                makeBar(server, inst.id, def.title || prettyId(def.id), def.barColor, def.barOverlay);
            inst.barBase = def.title || prettyId(def.id);
            inst.roundTotalHealth = Math.max(1, Number(s.roundTotalHealth) || 1);
            inst.roundTotalMobs = Math.max(0, Number(s.roundTotalMobs) || 0);
            inst.endLeft = 0;
            inst._mobState = {};
            inst._assistTick = 0;
            inst._usesStrictDaylightGuard = raidUsesStrictDaylightGuard(def);
            inst._terminalNotified = false;
            // Old saves only contain the boolean, so treat it as one death.
            inst._deathCount = Math.max(0, Math.floor(
                Number(s.deathCount) || (s.diedDuringRaid ? 1 : 0)
            ));
            inst._diedDuringRaid = inst._deathCount > 0 || !!s.diedDuringRaid;
            inst._restoreRoundUuids = uuidSet(s.roundMobUuids || []);
            inst._restoreCarryUuids = uuidSet(s.carryoverUuids || []);
            inst._restoreExpected = uuidKeys(inst._restoreRoundUuids).length + uuidKeys(inst._restoreCarryUuids).length;
            inst._restoreWait = RESTORE_MOB_WAIT;
            inst._restoreDelay = RESTORE_LOGIN_DELAY;
            inst._restoreScanCooldown = 0;
            inst._restoring = true;
            _active[inst.id] = inst;

            var suffix = Number(inst.id.substring(inst.id.lastIndexOf("_") + 1));
            if (suffix > _idSeq) _idSeq = suffix;
            restored++;
        }
        if (restored > 0) info("restored " + restored + " active raid(s); waiting for owner login");
        return restored;
    }

    function entityTypeId(entity) {
        try { return String(entity.type); } catch (e) {}
        try {
            var raw = rawMobOf(entity);
            if (raw && typeof raw.getType === "function") return String(raw.getType());
        } catch (e2) {}
        return "";
    }

    function entityCoord(entity, property, getter) {
        try {
            var direct = entity[property];
            if (typeof direct === "function") direct = direct.call(entity);
            if (direct != null) return Number(direct);
        } catch (e) {}
        try {
            var raw = rawMobOf(entity);
            if (raw && typeof raw[getter] === "function") return Number(raw[getter]());
        } catch (e2) {}
        return NaN;
    }

    function entityLevelOf(entity) {
        try { return (typeof entity.level === "function") ? entity.level() : entity.level; } catch (e) {}
        try {
            var raw = rawMobOf(entity);
            return raw ? ((typeof raw.level === "function") ? raw.level() : raw.level) : null;
        } catch (e2) {}
        return null;
    }

    function sameEntityLevel(a, b) {
        var la = entityLevelOf(a), lb = entityLevelOf(b);
        if (!la || !lb) return false;
        if (la === lb) return true;
        try { return String(la.dimension()) === String(lb.dimension()); } catch (e) {}
        try { return String(la.dimension) === String(lb.dimension); } catch (e2) {}
        return false;
    }

    function distanceSqr(a, b) {
        var ax = entityCoord(a, "x", "getX"), ay = entityCoord(a, "y", "getY"), az = entityCoord(a, "z", "getZ");
        var bx = entityCoord(b, "x", "getX"), by = entityCoord(b, "y", "getY"), bz = entityCoord(b, "z", "getZ");
        if (isNaN(ax) || isNaN(ay) || isNaN(az) || isNaN(bx) || isNaN(by) || isNaN(bz)) return Infinity;
        var dx = ax - bx, dy = ay - by, dz = az - bz;
        return dx * dx + dy * dy + dz * dz;
    }

    function trackedByInstance(inst, entity) {
        var lists = [inst.roundMobs, inst.carryover];
        for (var li = 0; li < lists.length; li++) {
            for (var i = 0; i < lists[li].length; i++) {
                if (sameEnt(lists[li][i], entity)) return true;
            }
        }
        return false;
    }

    // Born in Chaos replaces a damaged Lifestealer with a separate true-form
    // entity. Move the new wrapper into the exact old raid slot so wave counts,
    // aggro, glow, cleanup and final victory all continue through phase two.
    // This runs only for that rare spawn event; ordinary raid ticks do no scan.
    function adoptLifestealerTrueForm(form) {
        if (!form || entityTypeId(form) !== LIFESTEALER_TRUE_FORM_ID) return false;

        var taggedOwner = null;
        try {
            var tags = form.getTags();
            if (tags) {
                for (var tk in _active) {
                    if (tags.contains("raid_" + _active[tk].id)) { taggedOwner = _active[tk]; break; }
                }
            }
        } catch (eT) {}

        // Chunk reloads can emit a spawned/join callback for an entity that is
        // already tracked. Treat that as success without touching health totals.
        if (taggedOwner && trackedByInstance(taggedOwner, form)) return true;

        var best = null, bestList = null, bestIndex = -1;
        var bestDist = LIFESTEALER_TRANSFORM_RADIUS_SQR + 1;
        for (var k in _active) {
            var inst = _active[k];
            if (inst.phase === "DONE" || inst.phase === "ENDING") continue;
            if (taggedOwner && inst !== taggedOwner) continue;
            var lists = [inst.roundMobs, inst.carryover];
            for (var li = 0; li < lists.length; li++) {
                var arr = lists[li];
                for (var i = 0; i < arr.length; i++) {
                    var old = arr[i];
                    if (!old || entityTypeId(old) !== LIFESTEALER_ID || !sameEntityLevel(old, form)) continue;
                    var d = distanceSqr(old, form);
                    if (d <= LIFESTEALER_TRANSFORM_RADIUS_SQR && d < bestDist) {
                        best = inst;
                        bestList = arr;
                        bestIndex = i;
                        bestDist = d;
                    }
                }
            }
        }

        // Some transformations preserve scoreboard tags even if the old wrapper
        // vanished before our handler. In that case the owner tag is authoritative.
        if (!best && taggedOwner && !trackedByInstance(taggedOwner, form)) {
            best = taggedOwner;
            bestList = (best.phase === "BREATHER" || best.phase === "SPAWNING")
                ? best.carryover : best.roundMobs;
        }
        if (!best || !bestList) return false;

        var replacedMaxHealth = 0;
        if (bestIndex >= 0) {
            replacedMaxHealth = Math.max(0, entMaxHealth(bestList[bestIndex]));
            bestList[bestIndex] = form;
        } else {
            bestList.push(form);
        }

        try { form.addTag("raid_mob"); } catch (e1) {}
        try { form.addTag("raid_" + best.id); } catch (e2) {}
        try { form.addTag("raid_breacher"); } catch (eBreach) {}
        try { form.setPersistenceRequired(); } catch (e3) {}
        try { form.setCustomName(Text.of("[RAID]")); } catch (e4) {}
        joinRaidTeam(Manager._server, form);
        forceTarget(form, resolvePlayer(best));

        // Swap the old form's max health for the new one in the fixed wave
        // denominator. The tag-only fallback has no old wrapper to measure, so
        // merely ensure the denominator covers all currently tracked health.
        var formMaxHealth = Math.max(0, entMaxHealth(form));
        if (bestIndex >= 0) {
            best.roundTotalHealth = Math.max(1, best.roundTotalHealth - replacedMaxHealth + formMaxHealth);
        } else {
            best.roundTotalHealth = Math.max(
                best.roundTotalHealth,
                sumMax(best.roundMobs) + sumMax(best.carryover),
                1
            );
        }
        info("raid " + best.id + ": adopted Lifestealer true form");
        return true;
    }

    function retryPendingLifestealerForms() {
        if (_pendingLifestealerForms.length === 0) return;
        var keep = [];
        for (var i = 0; i < _pendingLifestealerForms.length; i++) {
            var pending = _pendingLifestealerForms[i];
            if (!pending || !isLiveEnt(pending.entity)) continue;
            if (adoptLifestealerTrueForm(pending.entity)) continue;
            pending.ticks -= TICK_THROTTLE;
            if (pending.ticks > 0) keep.push(pending);
        }
        _pendingLifestealerForms.length = 0;
        for (var j = 0; j < keep.length; j++) _pendingLifestealerForms.push(keep[j]);
    }

    // The Dark Doppelganger creates 2-5 special boss minions at low health.
    // The mod deliberately stores no summoner UUID for these, so associate only
    // entities carrying its boss-minion flag with a tracked Doppelganger within
    // the mod's tiny summon radius. This event-only adoption keeps them in raid
    // aggro, cleanup and victory accounting without adding a tick/world scan.
    function adoptDarkDoppelgangerMinion(minion) {
        if (!minion || entityTypeId(minion) !== DARK_DOPPELGANGER_MINION_ID) return false;
        var rawMinion = rawMobOf(minion);
        try {
            if (!rawMinion || typeof rawMinion.isBossMinion !== "function" || !rawMinion.isBossMinion()) return false;
        } catch (eFlag) { return false; }

        var best = null, bestList = null;
        var bestDist = DARK_DOPPELGANGER_MINION_ADOPT_RADIUS_SQR + 1;
        for (var k in _active) {
            var inst = _active[k];
            if (inst.phase === "DONE" || inst.phase === "ENDING") continue;
            var lists = [inst.roundMobs, inst.carryover];
            for (var li = 0; li < lists.length; li++) {
                var arr = lists[li];
                for (var i = 0; i < arr.length; i++) {
                    var candidate = arr[i];
                    if (sameEnt(candidate, minion)) return true;
                    if (!candidate || entityTypeId(candidate) !== DARK_DOPPELGANGER_ID ||
                        !sameEntityLevel(candidate, minion)) continue;
                    var d = distanceSqr(candidate, minion);
                    if (d <= DARK_DOPPELGANGER_MINION_ADOPT_RADIUS_SQR && d < bestDist) {
                        best = inst;
                        bestList = arr;
                        bestDist = d;
                    }
                }
            }
        }
        if (!best || !bestList) return false;

        bestList.push(minion);
        try { minion.addTag("raid_mob"); } catch (e1) {}
        try { minion.addTag("raid_" + best.id); } catch (e2) {}
        try { minion.setPersistenceRequired(); } catch (e3) {}
        try { minion.setCustomName(Text.of("[RAID]")); } catch (e4) {}
        try { minion.setCustomNameVisible(false); } catch (e5) {}
        joinRaidTeam(Manager._server, minion);
        forceTarget(minion, resolvePlayer(best));

        best.roundTotalHealth = Math.max(1, best.roundTotalHealth + Math.max(0, entMaxHealth(minion)));
        best.roundTotalMobs++;
        info("raid " + best.id + ": adopted Dark Doppelganger boss minion");
        return true;
    }

    // Very small lifecycle hook used by the day scheduler. The scheduler owns
    // fired/in-progress flags while the core owns resumable active-state data.
    // Listeners still run only once at win/loss/stop.
    function notifyTerminal(inst, outcome) {
        if (!inst || inst._terminalNotified) return;
        inst._terminalNotified = true;
        var ev = {
            id: inst.id,
            defId: inst.defId,
            playerUuid: inst.playerUuid,
            outcome: String(outcome || "ended")
        };
        for (var i = 0; i < _terminalListeners.length; i++) {
            try { _terminalListeners[i](ev); }
            catch (e) { warn("terminal listener: " + e); }
        }
        // A terminal raid must disappear from the persisted active set
        // immediately, so a shutdown during the linger bar cannot resurrect it.
        persistActive(Manager._server);
    }

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

    // Spawned mobs are persistenceRequired + tagged. After restoring saved
    // instances, sweep loaded levels and discard only raid-tagged entities that
    // have no matching live/saved owner (for example, a corrupt old snapshot).
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
        _loadedSweepDone: false,

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
            persistActive(Manager._server);
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

        // Scheduler recovery uses this to reconnect its in-progress transaction
        // to instances restored by the core instead of re-firing the raid.
        activeIdsForDef: function (defId) {
            var out = [];
            for (var k in _active) {
                var inst = _active[k];
                if (inst.defId === String(defId) && inst.phase !== "DONE" && inst.phase !== "ENDING") out.push(inst.id);
            }
            return out;
        },

        saveActive: function () {
            return persistActive(Manager._server);
        },

        // Register a lightweight terminal listener. Used by raid_schedule.js to
        // commit its small fired/in-progress persistence transaction.
        onTerminal: function (listener) {
            if (typeof listener !== "function") return false;
            _terminalListeners.push(listener);
            return true;
        },

        stop: function (idOrPlayer) {
            var inst = null;
            if (typeof idOrPlayer === "string") inst = _active[idOrPlayer];
            else if (idOrPlayer && idOrPlayer.uuid) inst = playerInRaid(String(idOrPlayer.uuid));
            if (!inst) return false;
            cleanupMobs(inst);
            notifyTerminal(inst, "stopped");
            delete _active[inst.id];
            persistActive(Manager._server);
            info(`stopped raid ${inst.id}`);
            return true;
        },

        stopAll: function () {
            var n = 0;
            for (var k in _active) {
                cleanupMobs(_active[k]);
                notifyTerminal(_active[k], "stopped");
                delete _active[k];
                n++;
            }
            sweepBars(Manager._server);   // also clears bars orphaned by a prior reload/crash
            persistActive(Manager._server);
            return n;
        },

        sweepOrphans: function () {
            var m = sweepOrphans(Manager._server);
            sweepBars(Manager._server);
            Manager._loadedSweepDone = true;
            return m;
        },

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
            if (!_restoreAttempted) restoreActive(server);
            _persistAccum++;
            if (_persistAccum >= ACTIVE_SAVE_EVERY) {
                _persistAccum = 0;
                if (anyActive()) persistActive(server);
            }
            // These three Born in Chaos classes reignite themselves every entity
            // tick. This targeted pass is intentionally before the shared
            // throttle; all other raid systems retain their 5-tick cadence.
            for (var daylightKey in _active) strictDaylightGuard(_active[daylightKey]);
            _tickAccum++;
            if (_tickAccum < TICK_THROTTLE) return;
            _tickAccum = 0;
            retryPendingLifestealerForms();
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

    // Player death never ends a raid. Every death is counted for the HUD and
    // persisted, while the compatibility flag disqualifies the no-death reward.
    EntityEvents.death("minecraft:player", function (event) {
        try {
            var player = event.entity;
            var inst = playerInRaid(String(player.uuid));
            if (!inst) return;
            inst._deathCount = Math.max(0, Number(inst._deathCount) || 0) + 1;
            inst._diedDuringRaid = true;
            persistActive(player.server || Manager._server);
        } catch (e) { warn("record raid player death: " + e); }
    });

    // Capture UUIDs before logout invalidates Java entity wrappers. The actual
    // raid tick is paused while the owner is offline and resumes after rebinding.
    PlayerEvents.loggedOut(function (event) {
        try {
            var puid = String(event.player.uuid);
            for (var k in _active) {
                if (_active[k].playerUuid === puid) prepareForRebind(_active[k]);
            }
            persistActive(event.server || Manager._server);
        } catch (e) { warn("logout raid save: " + e); }
    });

    ServerEvents.unloaded(function (event) {
        try { persistActive(event.server || Manager._server); }
        catch (e) { warn("shutdown raid save: " + e); }
    });

    // Rare mod-created combat entities are adopted at their spawn event, so the
    // ordinary raid tick remains unchanged.
    EntityEvents.spawned(function (event) {
        var form = event.entity;
        if (!form || !anyActive()) return;
        var type = entityTypeId(form);
        if (type === DARK_DOPPELGANGER_MINION_ID) {
            adoptDarkDoppelgangerMinion(form);
            return;
        }
        // Lifestealer's second phase is a replacement entity. Retain a short
        // retry for the edge case where its old form is removed just after this
        // callback fires.
        if (type === LIFESTEALER_TRUE_FORM_ID && !adoptLifestealerTrueForm(form)) {
            _pendingLifestealerForms.push({
                entity: form,
                ticks: LIFESTEALER_TRANSFORM_RETRY_TICKS
            });
        }
    });

    // ---------- Friendly fire off -------------------------------------------
    // Raid mobs never damage each other: any hit where BOTH attacker (or the
    // projectile's owner) and victim carry the raid_mob tag is zeroed, and the
    // victim's retaliation memory is wiped on the spot (setLastHurtByMob runs
    // in LivingEntity.hurt BEFORE this Pre-damage event, so clearing here
    // sticks). Handler early-exits on the no-active-raid flag + victim tag, so
    // ambient combat costs two cheap checks.
    function anyActive() {
        for (var k in _active) { if (_active[k].phase !== "DONE") return true; }
        return false;
    }
    EntityEvents.beforeHurt(function (event) {
        try {
            if (!anyActive()) return;
            var victim = event.entity;
            if (!victim || !isAlly(victim)) return;
            var src = event.source;
            var attacker = null;
            try { attacker = (src && typeof src.getEntity === "function") ? src.getEntity() : null; } catch (eA) {}
            if (!attacker || !isAlly(attacker)) return;
            event.setNewDamage(0);
            try { victim.setLastHurtByMob(null); } catch (eC) {}
        } catch (e) { /* never break the damage pipeline */ }
    });

    // Clean up mobs + boss bars orphaned by a crash/restart/reload (bug #1).
    ServerEvents.loaded(function (event) {
        Manager._server = event.server;
        layoutRaidAdvancements(event.server);
        restoreActive(event.server);
        Manager.sweepOrphans();
    });

    // ---------- Export ------------------------------------------------------

    global.Raid         = function (id) { return new RaidBuilder(id); };
    global.RaidManager  = Manager;
    global.RaidRegistry = Registry;
    global.RAIDS        = RAIDS;

    console.info("[Raid] core loaded — Raid(), RaidManager, RAIDS ready");
})(this);
