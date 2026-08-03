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
    const PENDING_TEAM_WINS_KEY = "raidfactory_pending_team_wins_v1";
    const WIN_REWARD_MARKER_PREFIX = "raidfactory_full_reward_claimed_v1_";
    const ACTIVE_SAVE_EVERY = 100;
    const TEAM_SYNC_EVERY = 20;       // refresh FTB roster/HUD once per second
    const TEAM_RAID_DISTANCE = 500;
    const TEAM_RAID_DISTANCE_SQ = TEAM_RAID_DISTANCE * TEAM_RAID_DISTANCE;
    const TEAM_RAID_ESCAPE_SECONDS = 10;
    const MAX_CONCURRENT_RAIDS = 5;    // global combat cap; additional raids wait in a persisted queue
    const RAID_QUEUE_CHECK_EVERY = 20; // one tiny queue pass per second while no terminal event fires
    const RAID_DRIVER_WATCHDOG_EVERY = 20; // one no-op readiness check per second while raids exist
    const QUEUED_RAID_GRACE_TICKS = 24000; // one full Minecraft day before a queued raid may activate
    const RESTORE_LOGIN_DELAY = 40; // let the returning player's chunks load first
    const RESTORE_MOB_WAIT = 200;   // first allow 10s of natural chunk loading
    const RESTORE_CHUNKS_PER_SCAN = 2; // bounded synchronous loads per second
    const RESTORE_CHUNK_RADIUS = 2; // covers fast movement since the last 5s crash snapshot
    const RESTORE_CHUNK_SETTLE = 40;// let persistent entities join after chunk requests
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
    // A tiny set of animation-driven bosses use their own direct MoveToTarget
    // goal rather than the raid's staged navigation. A larger search range is
    // safe for one boss and prevents its native goal from stalling at the
    // 80-100 block raid spawn perimeter.
    const NATIVE_LONG_PATH_RAID_MOB_RANGES = {
        "cataclysm:ignis": 128
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

    // ---------- FTB Teams bridge -------------------------------------------
    // Loaded lazily so the raid core still has a safe solo fallback if the API
    // is temporarily unavailable during script startup.
    var _ftbTeamsApiClass = null;
    var _javaUuidClass = null;
    var _ftbTeamsUnavailable = false;

    function normUuid(value) {
        return String(value == null ? "" : value).toLowerCase();
    }

    // KubeJS events and server player lists can expose either an enhanced
    // ServerPlayer or a wrapper depending on the call site. Keep identity
    // checks stable for both representations.
    function playerUuidOf(player) {
        if (!player) return "";
        try { if (player.uuid != null) return normUuid(player.uuid); } catch (e) {}
        try {
            if (typeof player.getUUID === "function") return normUuid(player.getUUID());
        } catch (e2) {}
        try {
            var raw = unwrapPlayer(player);
            if (raw && typeof raw.getUUID === "function") return normUuid(raw.getUUID());
        } catch (e3) {}
        return "";
    }

    function ftbTeamsManager() {
        if (_ftbTeamsUnavailable) return null;
        try {
            if (!_ftbTeamsApiClass)
                _ftbTeamsApiClass = Java.loadClass("dev.ftb.mods.ftbteams.api.FTBTeamsAPI");
            var api = _ftbTeamsApiClass.api();
            if (!api || (typeof api.isManagerLoaded === "function" && !api.isManagerLoaded())) return null;
            return api.getManager();
        } catch (e) {
            _ftbTeamsUnavailable = true;
            warn("FTB Teams API unavailable; using solo raid ownership: " + e);
            return null;
        }
    }

    function javaUuid(value) {
        try {
            if (!_javaUuidClass) _javaUuidClass = Java.loadClass("java.util.UUID");
            return _javaUuidClass.fromString(String(value));
        } catch (e) { return null; }
    }

    function optionalValue(optional) {
        try {
            if (optional && optional.isPresent()) return optional.get();
        } catch (e) {}
        return null;
    }

    function ftbTeamForPlayer(player) {
        var manager = ftbTeamsManager();
        if (!manager || !player) return null;
        var id = javaUuid(playerUuidOf(player));
        try {
            if (id) {
                var byId = optionalValue(manager.getTeamForPlayerID(id));
                if (byId) return byId;
            }
        } catch (eId) {}
        try { return optionalValue(manager.getTeamForPlayer(unwrapPlayer(player))); }
        catch (e) { return null; }
    }

    function ftbTeamById(teamId) {
        var manager = ftbTeamsManager();
        var id = javaUuid(teamId);
        if (!manager || !id) return null;
        try { return optionalValue(manager.getTeamByID(id)); }
        catch (e) { return null; }
    }

    function teamRoster(team, fallbackUuid) {
        var roster = {};
        if (team) {
            try {
                var it = team.getMembers().iterator();
                while (it.hasNext()) roster[normUuid(it.next())] = true;
            } catch (e) { warn("read FTB team roster: " + e); }
        }
        if (fallbackUuid) roster[normUuid(fallbackUuid)] = true;
        return roster;
    }

    function playerTeamIdentity(player) {
        var team = ftbTeamForPlayer(player);
        var puid = playerUuidOf(player);
        if (!team) return { teamId: null, members: teamRoster(null, puid) };
        var teamId = null;
        try { teamId = normUuid(team.getTeamId()); } catch (e) {
            try { teamId = normUuid(team.getId()); } catch (e2) {}
        }
        return { teamId: teamId || null, members: teamRoster(team, puid) };
    }

    // Stable scheduler ownership key. FTB Team UUIDs make one scheduled raid
    // shared by the whole team; solo players retain an independent UUID key.
    function raidOwnerKeyForPlayer(player) {
        var identity = playerTeamIdentity(player);
        if (identity.teamId) return "team:" + normUuid(identity.teamId);
        var playerId = playerUuidOf(player);
        return playerId ? "player:" + playerId : "";
    }

    function raidOwnerKeyForInstance(inst) {
        if (!inst) return "";
        if (inst.teamId) return "team:" + normUuid(inst.teamId);
        return inst.playerUuid ? "player:" + normUuid(inst.playerUuid) : "";
    }

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
    const PERSONAL_DEATH_BAR_MARKER = "[Y100D_PERSONAL_DEATHS]";
    const PERSONAL_DEATH_BAR_PATH = "/personal_";
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
            try { bar.setVisible(true); } catch (e4) {}
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
    function raidWorldTime(server) {
        try {
            var overworld = server && typeof server.overworld === "function"
                ? server.overworld() : null;
            if (overworld) {
                var time = (typeof overworld.getDayTime === "function")
                    ? overworld.getDayTime() : overworld.dayTime;
                var numeric = Number(time);
                if (isFinite(numeric)) return numeric;
            }
        } catch (e) {}
        // Test/API fallback only. Real servers always expose overworld dayTime.
        return Math.max(0, Number(_serverTickClock) || 0);
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
                if (playerUuidOf(p) === playerUuidOf(center)) return false;
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
            waterproof: true,        // traversal only: swim fast + never drown; every spawn is still dry-only
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
    // every mob of the raid. This never permits spawning in/on water.
    // .waterproof(false) restores vanilla water behavior after the dry spawn.
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

    // Every wave gets EnhancedAI breaching creepers. The first two waves form
    // the raid's opening demolition squads; later waves use a smaller escort.
    // High-tier raids (day 70+) gain one extra. Existing authored tntCreeper
    // groups count toward the minimum, so waves with 4-6 already are not doubled.
    function ensureEnhancedRaidCreepers(d) {
        if (!d || !d.rounds) return;
        var dayMatch = /^day(\d+)(?:_|$)/.exec(String(d.id || ""));
        var raidDay = dayMatch ? parseInt(dayMatch[1], 10) : 0;
        var tierBonus = raidDay >= 70 ? 1 : 0;
        for (var i = 0; i < d.rounds.length; i++) {
            var round = d.rounds[i];
            if (!round || !round.mobs) continue;
            var wanted = (i < 2 ? 3 : 2) + tierBonus;
            var existing = 0;
            var firstGroup = null;
            for (var j = 0; j < round.mobs.length; j++) {
                var mob = round.mobs[j];
                if (!mob || mob.type !== "minecraft:creeper" ||
                    !Array.isArray(mob.presets) || mob.presets.indexOf("tntCreeper") === -1) continue;
                existing += positiveIntOr(mob.count, 1);
                if (!firstGroup) firstGroup = mob;
            }
            if (existing >= wanted) continue;
            var missing = wanted - existing;
            if (firstGroup) {
                firstGroup.count += missing;
            } else {
                round.mobs.push(normalizeMobSpec({
                    type: "minecraft:creeper",
                    count: missing,
                    presets: ["mobile", "tntCreeper"]
                }));
            }
        }
    }

    RaidBuilder.prototype.build = function () {
        var d = this.def;
        ensureEnhancedRaidCreepers(d);
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
    const ENTITY_FIT_LOCAL_TRIES = 16;  // paid only when the authored point is too small
    const ENTITY_FIT_GLOBAL_TRIES = 24; // bounded second-stage search around the raid
    const ENTITY_FIT_MAX_WIDTH   = 12;  // reject pathological/display entity dimensions
    const ENTITY_FIT_MAX_HEIGHT  = 24;
    const ENTITY_SPAWN_GAP       = 0.2; // prevents planned bounding boxes overlapping
    const COLONY_BUILDING_CLEARANCE = 50; // horizontal blocks from actual structure bounds
    const COLONY_PLAYER_MIN_DISTANCE = 32;
    const COLONY_BORDER_BINARY_STEPS = 8; // fixed-cost refinement, independent of colony size
    const COLONY_BORDER_OUTSIDE_PADDING = 32;
    const COLONY_BORDER_FALLBACK_RADIUS = 256;
    const COLONY_BORDER_MAX_RADIUS = 2048;
    const COLONY_BORDER_EXPAND_STEPS = 4;
    const COLONY_BORDER_INNER_LIMIT = 32;
    const COLONY_BORDER_OFFSETS = [8, 0, -8, -16, -24, -32, 16, 32, 48, 64, 96, 128];

    // MineColonies is consulted only while planning a wave. There is no colony
    // work in the raid tick/aggro path.
    var _mineColoniesManager = null;
    var _mineColoniesTried = false;
    var _mineColoniesWarned = false;
    var _blockPosClass = null;
    var _chunkPosClass = null;

    function mineColoniesManager() {
        if (_mineColoniesTried) return _mineColoniesManager;
        _mineColoniesTried = true;
        try {
            var IColonyManager = Java.loadClass("com.minecolonies.api.colony.IColonyManager");
            _mineColoniesManager = IColonyManager.getInstance();
        } catch (e) {
            _mineColoniesManager = null;
            warn("MineColonies API unavailable; using normal raid spawning: " + e);
        }
        return _mineColoniesManager;
    }

    function blockPosAt(x, y, z) {
        try {
            if (!_blockPosClass) _blockPosClass = Java.loadClass("net.minecraft.core.BlockPos");
            return _blockPosClass.containing(Number(x), Number(y), Number(z));
        } catch (e) { return null; }
    }

    function posAxis(pos, axis) {
        if (!pos) return 0;
        var getter = axis === "x" ? "getX" : (axis === "y" ? "getY" : "getZ");
        try { return Number(pos[getter]()); } catch (e) {}
        try { return Number(pos[axis]); } catch (e2) {}
        return 0;
    }

    function addBuildingBounds(out, building) {
        if (!building) return;
        var buildingPos = null;
        try { buildingPos = building.getPosition(); } catch (eBuildingPos) {}
        try {
            var corners = building.getCorners();
            var a = corners ? corners.getA() : null;
            var b = corners ? corners.getB() : null;
            if (a && b) {
                var minX = Math.min(posAxis(a, "x"), posAxis(b, "x"));
                var maxX = Math.max(posAxis(a, "x"), posAxis(b, "x"));
                var minZ = Math.min(posAxis(a, "z"), posAxis(b, "z"));
                var maxZ = Math.max(posAxis(a, "z"), posAxis(b, "z"));
                var px = posAxis(buildingPos, "x"), pz = posAxis(buildingPos, "z");
                var pdx = px < minX ? minX - px : (px > maxX ? px - maxX : 0);
                var pdz = pz < minZ ? minZ - pz : (pz > maxZ ? pz - maxZ : 0);
                // Reject uninitialized/corrupt corner data rather than treating
                // world origin or a giant rectangle as a real structure.
                if (maxX - minX <= 256 && maxZ - minZ <= 256 &&
                    (!buildingPos || pdx * pdx + pdz * pdz <= 4096)) {
                    out.push({ minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ });
                    return;
                }
            }
        } catch (eCorners) {}
        // Unbuilt/new huts can temporarily lack schematic corners. Their hut
        // position still receives the full 50-block protection radius.
        try {
            var p = buildingPos || building.getPosition();
            var x = posAxis(p, "x"), z = posAxis(p, "z");
            out.push({ minX: x, maxX: x, minZ: z, maxZ: z });
        } catch (ePos) {}
    }

    function collectMineColoniesBuildings(colony) {
        var out = [];
        if (!colony) return out;
        try {
            // Only the player's own colony is relevant. The previous dimension-
            // wide scan visited every building of every colony for every wave.
            var buildings = colony.getServerBuildingManager().getBuildings().values();
            var bit = buildings.iterator();
            while (bit.hasNext()) addBuildingBounds(out, bit.next());
        } catch (e) {
            if (!_mineColoniesWarned) {
                _mineColoniesWarned = true;
                warn("player colony building bounds unavailable: " + e);
            }
        }
        return out;
    }

    // MineColonies' concrete server colony exposes its own claim map. Reading
    // those keys is proportional only to this colony's claimed chunks and gives
    // an exact finite search bound without scanning blocks or other colonies.
    function colonyClaimBounds(colony) {
        if (!colony || typeof colony.getClaimData !== "function") return null;
        try {
            if (!_chunkPosClass)
                _chunkPosClass = Java.loadClass("net.minecraft.world.level.ChunkPos");
            var claims = colony.getClaimData();
            if (!claims || claims.isEmpty()) return null;
            var it = claims.keySet().iterator();
            var minChunkX = Infinity, maxChunkX = -Infinity;
            var minChunkZ = Infinity, maxChunkZ = -Infinity;
            var claimedChunks = {};
            while (it.hasNext()) {
                var rawKey = it.next();
                var key = (rawKey && typeof rawKey.longValue === "function")
                    ? rawKey.longValue() : rawKey;
                var cx = Number(_chunkPosClass.getX(key));
                var cz = Number(_chunkPosClass.getZ(key));
                claimedChunks[cx + "," + cz] = true;
                if (cx < minChunkX) minChunkX = cx;
                if (cx > maxChunkX) maxChunkX = cx;
                if (cz < minChunkZ) minChunkZ = cz;
                if (cz > maxChunkZ) maxChunkZ = cz;
            }
            if (!isFinite(minChunkX) || !isFinite(minChunkZ)) return null;
            return {
                minX: minChunkX * 16,
                maxX: (maxChunkX + 1) * 16,
                minZ: minChunkZ * 16,
                maxZ: (maxChunkZ + 1) * 16,
                chunks: claimedChunks
            };
        } catch (e) {
            if (!_mineColoniesWarned) {
                _mineColoniesWarned = true;
                warn("player colony claim bounds unavailable; using bounded fallback: " + e);
            }
            return null;
        }
    }

    function colonySpawnContext(level, player) {
        var manager = mineColoniesManager();
        if (!manager || !level || !player) return null;
        try {
            var rawLevel = heightLevel(level) || level;
            var rawPlayer = unwrapPlayer(player);
            if (!rawPlayer) return null;
            var playerPos = (typeof rawPlayer.blockPosition === "function")
                ? rawPlayer.blockPosition()
                : blockPosAt(player.x, player.y, player.z);
            if (!playerPos) return null;

            var colony = manager.getColonyByPosFromWorld(rawLevel, playerPos);
            if (!colony || !colony.isCoordInColony(rawLevel, playerPos)) return null;
            var permissions = colony.getPermissions();
            if (!permissions || !permissions.isColonyMember(rawPlayer)) return null;

            var center = colony.getCenter();
            var buildings = collectMineColoniesBuildings(colony);
            return {
                colony: colony,
                rawLevel: rawLevel,
                centerX: posAxis(center, "x") + 0.5,
                centerY: posAxis(center, "y"),
                centerZ: posAxis(center, "z") + 0.5,
                buildings: buildings,
                claimBounds: colonyClaimBounds(colony),
                boundaryCache: {}
            };
        } catch (e) {
            if (!_mineColoniesWarned) {
                _mineColoniesWarned = true;
                warn("MineColonies spawn context failed; using normal raid spawning: " + e);
            }
            return null;
        }
    }

    function colonyContains(ctx, x, z) {
        if (!ctx) return false;
        // Fast path for the installed MineColonies server API: direct lookup in
        // this colony's claim keys avoids Level#getChunkAt and never loads a
        // distant chunk merely to test a possible raid border.
        if (ctx.claimBounds && ctx.claimBounds.chunks) {
            var cx = Math.floor(Number(x) / 16);
            var cz = Math.floor(Number(z) / 16);
            return !!ctx.claimBounds.chunks[cx + "," + cz];
        }
        try {
            var pos = blockPosAt(x, ctx.centerY, z);
            return !!(pos && ctx.colony.isCoordInColony(ctx.rawLevel, pos));
        } catch (e) { return false; }
    }

    // Horizontal Euclidean distance from a point to each building footprint.
    // A point inside a footprint has distance zero.
    function colonyPointClear(ctx, x, z, clearance) {
        if (!ctx) return true;
        var limit = Math.max(COLONY_BUILDING_CLEARANCE, Number(clearance) || 0);
        var limitSq = limit * limit;
        for (var i = 0; i < ctx.buildings.length; i++) {
            var b = ctx.buildings[i];
            var dx = x < b.minX ? b.minX - x : (x > b.maxX ? x - b.maxX : 0);
            var dz = z < b.minZ ? b.minZ - z : (z > b.maxZ ? z - b.maxZ : 0);
            if (dx * dx + dz * dz < limitSq) return false;
        }
        return true;
    }

    function colonyClaimExitRadius(ctx, angle) {
        var bounds = ctx ? ctx.claimBounds : null;
        if (!bounds) return null;
        var dx = Math.cos(angle), dz = Math.sin(angle);
        var tx = Infinity, tz = Infinity;
        if (dx > 0.000001) tx = (bounds.maxX - ctx.centerX) / dx;
        else if (dx < -0.000001) tx = (bounds.minX - ctx.centerX) / dx;
        if (dz > 0.000001) tz = (bounds.maxZ - ctx.centerZ) / dz;
        else if (dz < -0.000001) tz = (bounds.minZ - ctx.centerZ) / dz;
        var exit = Math.min(tx, tz);
        return isFinite(exit) && exit > 0 ? exit : null;
    }

    // Find the claimed border with a fixed number of O(1) membership checks.
    // Claim bounds supply an outside point immediately; the bounded expansion
    // exists only for API/version fallbacks where claim keys are unavailable.
    function colonyBoundaryRadius(ctx, angle) {
        if (!ctx) return null;
        var key = Math.round(((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) * 10000);
        if (ctx.boundaryCache[key] != null) return ctx.boundaryCache[key];

        var dx = Math.cos(angle), dz = Math.sin(angle);
        var claimExit = colonyClaimExitRadius(ctx, angle);
        var low = 0;
        var high = claimExit != null
            ? Math.min(COLONY_BORDER_MAX_RADIUS,
                       Math.max(16, claimExit + COLONY_BORDER_OUTSIDE_PADDING))
            : COLONY_BORDER_FALLBACK_RADIUS;

        var highInside = colonyContains(
            ctx, ctx.centerX + dx * high, ctx.centerZ + dz * high
        );
        for (var expand = 0;
             highInside && expand < COLONY_BORDER_EXPAND_STEPS && high < COLONY_BORDER_MAX_RADIUS;
             expand++) {
            low = high;
            high = Math.min(COLONY_BORDER_MAX_RADIUS, high * 2);
            highInside = colonyContains(
                ctx, ctx.centerX + dx * high, ctx.centerZ + dz * high
            );
        }
        if (highInside) return null;

        for (var i = 0; i < COLONY_BORDER_BINARY_STEPS; i++) {
            var mid = (low + high) / 2;
            if (colonyContains(ctx, ctx.centerX + dx * mid,
                                   ctx.centerZ + dz * mid)) low = mid;
            else high = mid;
        }
        ctx.boundaryCache[key] = high;
        return high;
    }

    function colonyCandidate(level, pp, def, ctx, angle, clearance, hordeZone, emergency) {
        var boundary = colonyBoundaryRadius(ctx, angle);
        if (boundary == null) return null;
        for (var i = 0; i < COLONY_BORDER_OFFSETS.length; i++) {
            var offset = COLONY_BORDER_OFFSETS[i];
            if (offset < -COLONY_BORDER_INNER_LIMIT) continue;
            var radius = Math.max(8, boundary + offset);
            var x = ctx.centerX + Math.cos(angle) * radius;
            var z = ctx.centerZ + Math.sin(angle) * radius;
            var pdx = x - pp.x, pdz = z - pp.z;
            if (pdx * pdx + pdz * pdz <
                COLONY_PLAYER_MIN_DISTANCE * COLONY_PLAYER_MIN_DISTANCE) continue;
            if (!colonyPointClear(ctx, x, z, clearance)) continue;
            var y = hordeZone
                ? hordeZoneY(level, pp, def, x, z)
                : (emergency
                    ? emergencyGroundY(level, x, pp.y, z)
                    : groundY(level, x, pp.y, z));
            if (y != null) return { x: x, y: y, z: z, colonyProtected: true };
        }
        return null;
    }

    // Hard cap on the follow_range actually applied to raid mobs. Vanilla path
    // search cost scales with follow_range (it bounds the A* search region per
    // repath), so followRange(300) made EVERY repath of EVERY mob scan a huge
    // region — the dominant lag with 40+ mobs. Detection/chase does NOT need it:
    // aggro() setTarget has no range limit and re-pulls mobs every 5 ticks, and
    // driveChaseNavigation() uses short staged waypoints that stay safely
    // inside this search budget, even when the player is much farther away.
    const FOLLOW_RANGE_CAP = 48;

    // Blocks a mob must not stand ON (instant damage / sink / suffocate-adjacent).
    var _dangerBelow = {
        "minecraft:lava": 1, "minecraft:water": 1, "minecraft:magma_block": 1,
        "minecraft:bubble_column": 1, "minecraft:lily_pad": 1, "minecraft:frogspawn": 1,
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

    // Spawn validation is deliberately dry-only. "waterproof" still controls
    // how raid mobs move and breathe after spawning, but can never make water a
    // valid feet/head/floor block during placement.
    function safeSpawnY(level, bx, y, bz) {
        var below = level.getBlock(bx, y - 1, bz);
        if (!isSafeFloor(below)) return null;
        var feet = level.getBlock(bx, y, bz);
        var head = level.getBlock(bx, y + 1, bz);
        return (isPassable(feet) && isPassable(head)) ? y : null;
    }
    function isDrySpawnPosition(level, pos) {
        if (!pos) return false;
        var bx = Math.floor(pos.x), by = Math.floor(pos.y), bz = Math.floor(pos.z);
        return safeSpawnY(level, bx, by, bz) != null;
    }

    function raidEntityDimensions(entity) {
        var raw = null;
        try { raw = rawMobOf(entity) || entity; } catch (eRaw) { raw = entity; }
        var width = NaN, height = NaN;
        // mergeNbt can change baby/variant/pose dimensions. Force the vanilla
        // cache to refresh before reading the standing bounding box.
        try {
            if (raw && typeof raw.refreshDimensions === "function") raw.refreshDimensions();
        } catch (eRefresh) {}
        try {
            if (raw && typeof raw.getBbWidth === "function")
                width = Number(raw.getBbWidth());
            if (raw && typeof raw.getBbHeight === "function")
                height = Number(raw.getBbHeight());
        } catch (e) {}
        if (!isFinite(width) || !isFinite(height)) {
            try {
                var dimensions = raw.getDimensions(raw.getPose());
                if (!isFinite(width))
                    width = Number(typeof dimensions.width === "function"
                        ? dimensions.width() : dimensions.width);
                if (!isFinite(height))
                    height = Number(typeof dimensions.height === "function"
                        ? dimensions.height() : dimensions.height);
            } catch (e2) {}
        }
        if (!isFinite(width) || width <= 0) width = 0.6;
        if (!isFinite(height) || height <= 0) height = 1.8;
        return { width: width, height: height };
    }

    function normalizedSpawnPosition(pos) {
        return {
            x: Math.floor(Number(pos.x)) + 0.5,
            y: Math.floor(Number(pos.y)),
            z: Math.floor(Number(pos.z)) + 0.5
        };
    }

    function entityBoundsAt(pos, dimensions) {
        var half = dimensions.width / 2;
        return {
            minX: pos.x - half,
            maxX: pos.x + half,
            minY: pos.y,
            maxY: pos.y + dimensions.height,
            minZ: pos.z - half,
            maxZ: pos.z + half
        };
    }

    function boundsOverlap(a, b, gap) {
        var g = Math.max(0, Number(gap) || 0);
        return a.minX < b.maxX + g && a.maxX > b.minX - g &&
               a.minY < b.maxY     && a.maxY > b.minY &&
               a.minZ < b.maxZ + g && a.maxZ > b.minZ - g;
    }

    function reservedSpawnClear(bounds, reserved) {
        for (var i = 0; i < reserved.length; i++) {
            if (boundsOverlap(bounds, reserved[i], ENTITY_SPAWN_GAP)) return false;
        }
        return true;
    }

    // Checks every block intersected by the entity's real standing bounding box
    // and every floor block under its footprint. This catches wide/tall bosses
    // inside trees, walls, overhangs and cliff edges while remaining a one-time
    // wave-planning cost.
    function entityFootprintClear(level, pos, dimensions, reserved) {
        if (!pos || !dimensions ||
            dimensions.width > ENTITY_FIT_MAX_WIDTH ||
            dimensions.height > ENTITY_FIT_MAX_HEIGHT) return false;
        var exact = normalizedSpawnPosition(pos);
        if (!isDrySpawnPosition(level, exact)) return false;
        var bounds = entityBoundsAt(exact, dimensions);
        if (!reservedSpawnClear(bounds, reserved)) return false;

        var epsilon = 0.0001;
        var minX = Math.floor(bounds.minX + epsilon);
        var maxX = Math.floor(bounds.maxX - epsilon);
        var minY = Math.floor(bounds.minY + epsilon);
        var maxY = Math.floor(bounds.maxY - epsilon);
        var minZ = Math.floor(bounds.minZ + epsilon);
        var maxZ = Math.floor(bounds.maxZ - epsilon);
        try {
            for (var x = minX; x <= maxX; x++) {
                for (var z = minZ; z <= maxZ; z++) {
                    if (!isSafeFloor(level.getBlock(x, minY - 1, z))) return false;
                    for (var y = minY; y <= maxY; y++) {
                        if (!isPassable(level.getBlock(x, y, z))) return false;
                    }
                }
            }
        } catch (e) {
            warn("entity footprint check: " + e);
            return false;
        }
        return true;
    }

    function sizedCandidate(level, x, baseY, z, dimensions, colonyCtx, reserved, emergency) {
        var clearance = COLONY_BUILDING_CLEARANCE + Math.ceil(dimensions.width / 2);
        if (!colonyPointClear(colonyCtx, x, z, clearance)) return null;
        var y = emergency
            ? emergencyGroundY(level, x, baseY, z)
            : groundY(level, x, baseY, z);
        if (y == null) return null;
        var pos = normalizedSpawnPosition({ x: x, y: y, z: z });
        if (!entityFootprintClear(level, pos, dimensions, reserved)) return null;
        return pos;
    }

    function findSizedSpawnPosition(level, base, entity, pp, def, colonyCtx, reserved, seed) {
        var dimensions = raidEntityDimensions(entity);
        if (dimensions.width > ENTITY_FIT_MAX_WIDTH ||
            dimensions.height > ENTITY_FIT_MAX_HEIGHT) {
            warn("spawnRound: rejected unsafe entity dimensions " +
                 dimensions.width.toFixed(2) + "x" + dimensions.height.toFixed(2));
            return null;
        }

        // The authored position already has a validated surface Y. Reuse it
        // directly in the common case instead of paying for another height scan.
        var direct = normalizedSpawnPosition(base);
        var directClearance = COLONY_BUILDING_CLEARANCE + Math.ceil(dimensions.width / 2);
        if (colonyPointClear(colonyCtx, direct.x, direct.z, directClearance) &&
            entityFootprintClear(level, direct, dimensions, reserved)) {
            return { pos: direct, bounds: entityBoundsAt(direct, dimensions) };
        }

        // First search close to the assigned squad position, preserving the
        // multi-direction formation whenever nearby terrain has enough room.
        var rotation = ((seed || 0) % 360) * Math.PI / 180;
        for (var i = 0; i < ENTITY_FIT_LOCAL_TRIES; i++) {
            var angle = rotation + i * GOLDEN_ANG;
            var radius = 2 + (i % 6) * 2;
            var local = sizedCandidate(
                level,
                base.x + Math.cos(angle) * radius,
                base.y,
                base.z + Math.sin(angle) * radius,
                dimensions, colonyCtx, reserved, false
            );
            if (local) return { pos: local, bounds: entityBoundsAt(local, dimensions) };
        }

        // A large boss may need a clearing outside its original squad. Search a
        // deterministic, bounded set around the raid perimeter; never fall back
        // to an unvalidated point.
        var minR = Math.max(6, def.spawn.minRadius);
        var maxR = Math.max(minR, def.spawn.maxRadius + 24);
        var span = Math.max(1, maxR - minR + 1);
        for (var j = 0; j < ENTITY_FIT_GLOBAL_TRIES; j++) {
            var globalAngle = rotation + (j + 3) * GOLDEN_ANG;
            var globalRadius = minR + ((j * 13 + (seed || 0)) % span);
            var globalPos = sizedCandidate(
                level,
                pp.x + Math.cos(globalAngle) * globalRadius,
                pp.y,
                pp.z + Math.sin(globalAngle) * globalRadius,
                dimensions, colonyCtx, reserved, true
            );
            if (globalPos)
                return { pos: globalPos, bounds: entityBoundsAt(globalPos, dimensions) };
        }
        return null;
    }

    var _heightTypes = null;
    var _heightTypesRetryAfter = 0;
    var _heightRuntimeRetryAfter = 0;
    function heightTypes() {
        if (_heightTypes) return _heightTypes;
        if (_serverTickClock < _heightTypesRetryAfter) return null;
        try { _heightTypes = Java.loadClass("net.minecraft.world.level.levelgen.Heightmap$Types"); }
        catch (e) {
            _heightTypes = null;
            _heightTypesRetryAfter = _serverTickClock + SPAWN_RETRY_TICKS;
        }
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
    // Ocean columns return null; the seabed is never used as a fallback.
    function surfaceGroundY(level, x, z) {
        if (_serverTickClock < _heightRuntimeRetryAfter)
            return { supported: false, y: null };
        var Types = heightTypes();
        var raw = heightLevel(level);
        if (!Types || !raw || levelHasCeiling(raw)) return { supported: false, y: null };
        var bx = Math.floor(x), bz = Math.floor(z);
        var offsets = [0, 1, -1, 2, -2];
        try {
            var top = Number(raw.getHeight(Types.MOTION_BLOCKING_NO_LEAVES, bx, bz));
            for (var i = 0; i < offsets.length; i++) {
                var sy = safeSpawnY(level, bx, top + offsets[i], bz);
                if (sy != null) return { supported: true, y: sy };
            }
            return { supported: true, y: null };
        } catch (e) {
            // A brand-new world can expose the level before its heightmap is
            // ready. Treat that as transient: use the bounded local fallback
            // for this attempt and retry the real surface API after 10 seconds.
            _heightRuntimeRetryAfter = _serverTickClock + SPAWN_RETRY_TICKS;
            warn("surfaceGroundY: " + e);
            return { supported: false, y: null };
        }
    }

    // Local Y fallback for ceiling dimensions (Nether-like) or an unavailable
    // heightmap API. Normal dimensions use surfaceGroundY and never choose a
    // cave merely because it is close to the player's current Y.
    function groundYRange(level, x, baseY, z, scan) {
        try {
            var bx = Math.floor(x), bz = Math.floor(z), py = Math.floor(baseY);
            for (var off = 0; off <= scan; off++) {
                for (var s = 0; s < (off === 0 ? 1 : 2); s++) {
                    var y = py + (s === 0 ? off : -off);
                    if (safeSpawnY(level, bx, y, bz) != null) return y;
                }
            }
        } catch (e) { warn(`groundY: ${e}`); }
        return null;
    }
    function groundY(level, x, baseY, z) {
        var surface = surfaceGroundY(level, x, z);
        if (surface.supported) return surface.y;
        return groundYRange(level, x, baseY, z, SPAWN_Y_SCAN);
    }
    function emergencyGroundY(level, x, baseY, z) {
        var surface = surfaceGroundY(level, x, z);
        if (surface.supported) return surface.y;
        return groundYRange(level, x, baseY, z, SPAWN_EMERGENCY_Y_SCAN);
    }

    // Rare rescue path shared by every failed position in a wave. It expands
    // horizontal candidates; only ceiling/API fallbacks pay the wider Y scan.
    // It runs at most once per plan and returns only fully validated positions.
    function findEmergencyAnchor(level, pp, def, seed, colonyCtx, spreadPadding, requireHordeZone) {
        if (colonyCtx) {
            var colonyBaseAng = ((seed || 0) % 360) * Math.PI / 180;
            for (var ct = 0; ct < SPAWN_EMERGENCY_TRIES; ct++) {
                var colonyAng = colonyBaseAng + ct * GOLDEN_ANG;
                var colonyAnchor = colonyCandidate(
                    level, pp, def, colonyCtx, colonyAng,
                    COLONY_BUILDING_CLEARANCE + Math.max(0, Number(spreadPadding) || 0),
                    !!requireHordeZone, true
                );
                if (colonyAnchor) return colonyAnchor;
            }
            return null;
        }
        var minR = Math.max(6, def.spawn.minRadius);
        var maxR = Math.max(minR, def.spawn.maxRadius + 16);
        var span = Math.max(1, maxR - minR + 1);
        var baseAng = ((seed || 0) % 360) * Math.PI / 180;
        for (var t = 0; t < SPAWN_EMERGENCY_TRIES; t++) {
            var ang = baseAng + t * GOLDEN_ANG;
            var rad = minR + ((t * 11 + (seed || 0)) % span);
            var x = pp.x + Math.cos(ang) * rad;
            var z = pp.z + Math.sin(ang) * rad;
            var y = emergencyGroundY(level, x, pp.y, z);
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
    function findRingGroupAnchors(level, pp, def, total, instanceId, roundIdx, colonyCtx) {
        var wanted = wantedRingGroups(total);
        var anchors = [];
        var minR = def.spawn.minRadius, maxR = def.spawn.maxRadius;
        var span = Math.max(1, maxR - minR + 1);
        var seed = hashStr(String(instanceId) + "#" + roundIdx + "#groups");
        var rotation = (seed % 360) * Math.PI / 180;

        for (var g = 0; g < wanted; g++) {
            var baseAng = rotation + (g / wanted) * Math.PI * 2;
            var found = null;
            for (var t = 0; t < RING_GROUP_ANCHOR_TRIES; t++) {
                var step = Math.ceil(t / 2) * RING_GROUP_ANGLE_STEP;
                var ang = baseAng + (t === 0 ? 0 : (t % 2 === 1 ? step : -step));
                if (colonyCtx) {
                    found = colonyCandidate(
                        level, pp, def, colonyCtx, ang,
                        COLONY_BUILDING_CLEARANCE + RING_GROUP_SPREAD_MAX,
                        false, false
                    );
                    if (found) break;
                    continue;
                }
                var rad = minR + ((seed + g * 17 + t * 11) % span);
                var x = pp.x + Math.cos(ang) * rad;
                var z = pp.z + Math.sin(ang) * rad;
                var y = groundY(level, x, pp.y, z);
                if (y != null) { found = { x: x, y: y, z: z }; break; }
            }
            if (found) anchors.push(found);
        }
        return anchors;
    }

    // Global mob indices are distributed round-robin, so each squad receives a
    // mixture of the wave's roles. Golden-angle offsets prevent collision piles.
    function ringGroupMobPos(level, anchors, idx, total, colonyCtx) {
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
        if (!colonyPointClear(colonyCtx, x, z, COLONY_BUILDING_CLEARANCE)) return anchor;
        var y = groundY(level, x, anchor.y, z);
        if (y != null) return { x: x, y: y, z: z };
        return anchor;
    }

    // Validate a whole landing zone, not just one column: anchor + 4 side samples
    // at HORDE_ZONE_R must all have safe floor (same rules as groundY) at a
    // similar elevation. Returns the anchor Y, or null if the zone is unusable.
    function hordeZoneY(level, pp, def, ax, az) {
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
    // through the other 7 directions. No unvalidated fallback is returned.
    function findHordeAnchor(level, pp, def, instanceId, roundIdx, colonyCtx, total) {
        var rad = (def.spawn.minRadius + def.spawn.maxRadius) / 2;
        var baseAng = hordeWaveBaseAngle(def, instanceId, roundIdx);
        var spread = Math.max(HORDE_SPREAD_MAX, Math.ceil(Math.sqrt(total || 1) * 1.5));
        for (var d = 0; d < 8; d++) {
            var ang = baseAng + d * (Math.PI / 4);
            if (colonyCtx) {
                var colonyAnchor = colonyCandidate(
                    level, pp, def, colonyCtx, ang,
                    COLONY_BUILDING_CLEARANCE + spread,
                    true, false
                );
                if (colonyAnchor) return colonyAnchor;
                continue;
            }
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
    function hordeMobPos(level, anchor, idx, total, colonyCtx) {
        var spread = Math.max(HORDE_SPREAD_MAX, Math.ceil(Math.sqrt(total || 1) * 1.5));
        var ang = idx * GOLDEN_ANG;
        var rad = 1 + ((idx * 5) % spread);
        var x = anchor.x + Math.cos(ang) * rad;
        var z = anchor.z + Math.sin(ang) * rad;
        if (!colonyPointClear(colonyCtx, x, z, COLONY_BUILDING_CLEARANCE))
            return { x: anchor.x, y: anchor.y, z: anchor.z };
        var y = groundY(level, x, anchor.y, z);
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
    function nearestFrom(raw, victims, radiusSqr, forcePlayerTarget) {
        var best = null, bestD = radiusSqr;
        for (var i = 0; i < victims.length; i++) {
            var e = victims[i];
            if (sameEnt(raw, e)) continue;
            var d;
            try { d = raw.distanceToSqr(e); } catch (x) { continue; }
            // Team players are authored raid targets. Some modded mobs return
            // false from canAttack while dormant or outside their native range;
            // that must not disable their raid aggro.
            if (d <= bestD && (forcePlayerTarget || canHit(raw, e))) {
                bestD = d;
                best = e;
            }
        }
        return best;
    }
    function entityInList(entity, list) {
        if (!entity || !list) return false;
        for (var i = 0; i < list.length; i++)
            if (sameEnt(entity, list[i])) return true;
        return false;
    }
    function decideTarget(raw, teamRaws, victims, radiusSqr) {
        var atk = null;
        try { atk = (typeof raw.getLastHurtByMob === "function") ? raw.getLastHurtByMob() : null; } catch (x) {}
        var teamTarget = nearestFrom(raw, teamRaws || [], Infinity, true);
        if (teamTarget && mainPlayerEligible(teamTarget)) {
            // Prevent HurtByTargetGoal from stealing aggro between our 5-tick
            // passes. Attacks from participating teammates may remain; all
            // unrelated retaliation memory is discarded.
            if (atk && !entityInList(atk, teamRaws)) {
                try { raw.setLastHurtByMob(null); } catch (xM) {}
            }
            return teamTarget;
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
    // short staged path; if it stays frozen ~5s without a useful approach it
    // teleports onto safe ground near the target. A close standstill is exempt
    // only with line of sight (legit melee crowd or ranged hold); a nearby mob
    // separated by a wall still counts as stuck.
    const STUCK_MOVE_SQ = 0.25; // blocks² moved per pass below this = "not moving"
    const STUCK_NEAR_SQ = 576;  // 24² blocks — inside this idling is allowed
    const STUCK_KICK    = 4;    // idle passes before a nav recompute (repeats every 4)
    const STUCK_TP      = 20;   // idle passes (~5s at 5-tick cadence) before hard teleport
    const STUCK_TP_R    = 10;   // teleport ring radius around the target
    const STUCK_TP_TRIES = 6;   // bounded dry-ground directions per hard recovery
    const CHASE_DIRECT_DISTANCE_SQ = 1600; // direct path only inside 40 blocks
    const CHASE_WAYPOINT_DISTANCE = 28;    // stays inside the 48-block path budget
    const CHASE_PATH_SPEED = 1.15;
    const CHASE_LATERAL_OFFSETS = [0, 7, -7, 13, -13];
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

    // follow_range stays capped for performance, so long-distance chasing is
    // split into cheap nearby paths. Only a new target or a genuinely idle mob
    // creates a path; moving mobs add no pathfinding work.
    function driveChaseNavigation(raw, target, nav, attempt) {
        if (!raw || !target || !nav) return false;
        var x, y, z, tx, ty, tz;
        try {
            x = Number(raw.getX()); y = Number(raw.getY()); z = Number(raw.getZ());
            tx = Number(target.getX()); ty = Number(target.getY()); tz = Number(target.getZ());
        } catch (e) { return false; }
        var dx = tx - x, dz = tz - z;
        var horizontalSq = dx * dx + dz * dz;
        try {
            if (horizontalSq <= CHASE_DIRECT_DISTANCE_SQ) {
                return !!nav.moveTo(target, CHASE_PATH_SPEED);
            }

            var horizontal = Math.sqrt(horizontalSq);
            var ux = dx / horizontal, uz = dz / horizontal;
            var lateral = CHASE_LATERAL_OFFSETS[
                Math.abs(Number(attempt) || 0) % CHASE_LATERAL_OFFSETS.length
            ];
            var wx = x + ux * CHASE_WAYPOINT_DISTANCE - uz * lateral;
            var wz = z + uz * CHASE_WAYPOINT_DISTANCE + ux * lateral;
            var ratio = CHASE_WAYPOINT_DISTANCE / horizontal;
            var wy = y + (ty - y) * Math.min(1, ratio);

            // Ground navigators get a real surface waypoint. Flying/water
            // navigators keep the interpolated Y and handle their own medium.
            var navName = "";
            try { navName = String(nav.getClass().getName()).toLowerCase(); } catch (eName) {}
            var needsGround = navName.indexOf("flying") === -1 &&
                              navName.indexOf("waterbound") === -1 &&
                              navName.indexOf("amphibious") === -1;
            if (needsGround) {
                var level = null;
                try { level = (typeof raw.level === "function") ? raw.level() : raw.level; } catch (eLevel) {}
                var ground = level ? groundY(level, wx, y, wz) : null;
                if (ground != null) wy = ground;
            }
            return !!nav.moveTo(wx, wy, wz, CHASE_PATH_SPEED);
        } catch (ePath) { return false; }
    }

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
                x: x, y: y, z: z, idle: 0, tp: 0, pathTry: 0,
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
        if (movedSq > STUCK_MOVE_SQ || (distSq < STUCK_NEAR_SQ && seesTarget)) {
            st.idle = 0;
            st.pathTry = 0;
            return;
        }
        st.idle++;
        var breachDue = (st.idle === BOSS_BREACH_START) ||
                        (st.idle > BOSS_BREACH_START && st.idle % BOSS_BREACH_RETRY === 0);
        if (st.breacher && breachDue) {
            var breached = breachBossObstruction(raw, target);
            if (breached > 0) {
                st.idle = 0;
                st.pathTry = 0;
                try {
                    var breachNav = (typeof raw.getNavigation === "function") ? raw.getNavigation() : null;
                    if (breachNav) driveChaseNavigation(raw, target, breachNav, 0);
                } catch (eBreachNav) {}
                return;
            }
        }
        if (st.idle >= STUCK_TP) {
            st.idle = 0;
            st.pathTry = 0;
            st.tp++;
            var baseAng = ((hashStr(key) % 360) * Math.PI / 180) + st.tp * GOLDEN_ANG;
            try {
                var lvl = (typeof raw.level === "function") ? raw.level() : raw.level;
                for (var tpTry = 0; tpTry < STUCK_TP_TRIES; tpTry++) {
                    var ang = baseAng + tpTry * GOLDEN_ANG;
                    var radius = STUCK_TP_R + (tpTry % 2) * 4;
                    var nearX = target.getX() + Math.cos(ang) * radius;
                    var nearZ = target.getZ() + Math.sin(ang) * radius;
                    var nearY = groundY(lvl, nearX, target.getY(), nearZ);
                    if (nearY != null) {
                        if (typeof raw.teleportTo === "function")
                            raw.teleportTo(Math.floor(nearX) + 0.5, nearY, Math.floor(nearZ) + 0.5);
                        else raw.setPos(Math.floor(nearX) + 0.5, nearY, Math.floor(nearZ) + 0.5);
                        break;
                    }
                }
            } catch (e5) {}
            return;
        }
        // Gentle kick: recompute only after verified lack of movement, so normal
        // paths and custom EAI goals (miner digging, fisher casting) keep control.
        if (st.idle % STUCK_KICK === 0) {
            try {
                var nav = (typeof raw.getNavigation === "function") ? raw.getNavigation() : null;
                if (nav) {
                    // A navigation may claim it is active while wedged against
                    // terrain. Stop that stale path before choosing the next
                    // short waypoint, with alternating sides around obstacles.
                    try { if (typeof nav.stop === "function") nav.stop(); } catch (eStop) {}
                    st.pathTry = Math.max(0, Number(st.pathTry) || 0) + 1;
                    driveChaseNavigation(raw, target, nav, st.pathTry);
                }
            } catch (e6) {}
        }
    }

    // ---------- Equipment / NBT --------------------------------------------

    var _slotMap = {
        mainhand: "MAINHAND", main: "MAINHAND", offhand: "OFFHAND", off: "OFFHAND",
        head: "HEAD", helmet: "HEAD", chest: "CHEST", chestplate: "CHEST",
        legs: "LEGS", leggings: "LEGS", feet: "FEET", boots: "FEET"
    };
    var _frostWalkerHolder = null;
    var _frostWalkerLookupFailed = false;
    function frostWalkerHolder(raw) {
        if (_frostWalkerHolder) return _frostWalkerHolder;
        if (_frostWalkerLookupFailed || !raw) return null;
        try {
            var Registries = Java.loadClass("net.minecraft.core.registries.Registries");
            var ResourceKey = Java.loadClass("net.minecraft.resources.ResourceKey");
            var ResourceLocation = Java.loadClass("net.minecraft.resources.ResourceLocation");
            var level = (typeof raw.level === "function") ? raw.level() : raw.level;
            var lookup = level.registryAccess().lookupOrThrow(Registries.ENCHANTMENT);
            var key = ResourceKey.create(
                Registries.ENCHANTMENT,
                ResourceLocation.parse("minecraft:frost_walker")
            );
            _frostWalkerHolder = lookup.getOrThrow(key);
            return _frostWalkerHolder;
        } catch (e) {
            _frostWalkerLookupFailed = true;
            warn("Frost Walker lookup failed; raid boots left unchanged: " + e);
            return null;
        }
    }
    function addRaidBootEnchant(raw, stack) {
        if (!raw || !stack) return;
        var holder = frostWalkerHolder(raw);
        if (!holder) return;
        try {
            // Level II is Frost Walker's vanilla maximum. ItemStack.enchant
            // writes the 1.21 enchantment data component directly and works for
            // both vanilla and modded boots.
            stack.enchant(holder, 2);
        } catch (e) { warn("enchant raid boots with Frost Walker II: " + e); }
    }
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
            if (slotName === "FEET") addRaidBootEnchant(raw, stack);
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

    // A failed spawn must never leave half a wave behind. Discarding is used
    // instead of kill(), so rollback cannot create loot or death side effects.
    function discardFailedSpawnAttempt(entities) {
        for (var i = 0; i < entities.length; i++) {
            var entity = entities[i];
            if (!entity) continue;
            try {
                var raw = rawMobOf(entity) || entity;
                if (raw && typeof raw.discard === "function") raw.discard();
                else if (typeof entity.discard === "function") entity.discard();
            } catch (e) {
                warn("spawn rollback discard: " + e);
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
        var colonyCtx = colonySpawnContext(level, player);
        var hordeSpread = Math.max(HORDE_SPREAD_MAX, Math.ceil(Math.sqrt(total) * 1.5));

        // Resolve shared horde anchor or multiple ring squad anchors once.
        var anchor = null;
        var ringAnchors = null;
        if (def.spawnPattern === "horde") {
            anchor = findHordeAnchor(level, pp, def, instanceId, roundIdx, colonyCtx, total);
        } else {
            ringAnchors = findRingGroupAnchors(level, pp, def, total, instanceId, roundIdx, colonyCtx);
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
            emergencyAnchor = findEmergencyAnchor(
                level, pp, def, emergencySeed, colonyCtx, hordeSpread, true
            );
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
            emergencyAnchor = findEmergencyAnchor(
                level, pp, def, emergencySeed + 97, colonyCtx, RING_GROUP_SPREAD_MAX, false
            );
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
            var planned = anchor
                ? hordeMobPos(level, anchor, pi, total, colonyCtx)
                : ringGroupMobPos(level, ringAnchors, pi, total, colonyCtx);
            if (planned && !isDrySpawnPosition(level, planned)) planned = null;
            if (!planned) {
                if (!emergencyTried) {
                    emergencyTried = true;
                    emergencyAnchor = findEmergencyAnchor(
                        level, pp, def, emergencySeed, colonyCtx,
                        anchor ? hordeSpread : RING_GROUP_SPREAD_MAX, !!anchor
                    );
                }
                if (!emergencyAnchor) {
                    warn("spawnRound: no safe spawn ground; delaying wave " + (roundIdx + 1));
                    return null;
                }
                planned = anchor
                    ? hordeMobPos(level, emergencyAnchor, pi, total, colonyCtx)
                    : ringGroupMobPos(level, [emergencyAnchor], pi, total, colonyCtx);
            }
            if (!isDrySpawnPosition(level, planned)) {
                warn("spawnRound: emergency position was not dry; delaying wave " + (roundIdx + 1));
                return null;
            }
            positions.push(planned);
        }

        // Real dimensions are available only after creating the unspawned
        // entity and applying its variant/baby NBT. Validate every member's
        // footprint before spawning the first one, keeping the wave atomic.
        var spawnPlan = [];
        var reservedBounds = [];
        var idx = 0;

        for (var gi = 0; gi < round.mobs.length; gi++) {
            var mob = round.mobs[gi];
            var names = mobPresetNames(def, mob);
            // Per-raid followRange overrides any preset follow_range (last write wins
            // in applyAttributes), clamped to FOLLOW_RANGE_CAP (see const above).
            var xtra = mob.extraArgs;
            var nativeLongRange = NATIVE_LONG_PATH_RAID_MOB_RANGES[mob.type];
            var fr = nativeLongRange != null ? nativeLongRange : def.followRange;
            if (fr == null) fr = FOLLOW_RANGE_CAP;            // also caps preset values (farSight=100)
            var frCap = nativeLongRange != null ? nativeLongRange : FOLLOW_RANGE_CAP;
            if (fr > frCap) fr = frCap;
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
                var basePos = positions[idx];
                idx++;

                var entity = EAI.fromPresets(level, mob.type, names, xtra);
                if (!entity) {
                    err(`spawnRound: fromPresets returned null for ${mob.type}; delaying complete wave`);
                    return null;
                }
                applyEntityNbt(entity, mob.nbt);
                preparePlayerBoundRaidMob(entity, mob.type, player);

                var fitted = findSizedSpawnPosition(
                    level, basePos, entity, pp, def, colonyCtx, reservedBounds,
                    emergencySeed + idx * 131 + gi * 17
                );
                if (!fitted) {
                    warn(`spawnRound: no full-size safe space for ${mob.type}; delaying complete wave ${roundIdx + 1}`);
                    return null;
                }
                try {
                    entity.setPos(fitted.pos.x, fitted.pos.y, fitted.pos.z);
                } catch (eP) {
                    warn(`setPos ${mob.type}: ${eP}; delaying complete wave`);
                    return null;
                }
                reservedBounds.push(fitted.bounds);
                spawnPlan.push({
                    entity: entity,
                    mob: mob,
                    names: names,
                    extraArgs: xtra,
                    pos: fitted.pos
                });
            }
        }

        for (var si = 0; si < spawnPlan.length; si++) {
                var plannedMob = spawnPlan[si];
                var entity = plannedMob.entity;
                var mob = plannedMob.mob;
                var names = plannedMob.names;
                var xtra = plannedMob.extraArgs;
                var pos = plannedMob.pos;

                facePlayer(entity, pos, pp);
                try { entity.addTag("raid_mob"); } catch (e1) {}
                try { entity.addTag("raid_" + instanceId); } catch (e2) {}
                if (mob.breacher) { try { entity.addTag("raid_breacher"); } catch (eBreachTag) {} }
                try { entity.setPersistenceRequired(); } catch (e3) {}
                // Stable identity used by Xaero's custom RAID radar category.
                // The boss bar already carries the wave name, while keeping
                // this exact makes the client-side filter future-proof.
                try { entity.setCustomName(Text.of("[RAID]")); } catch (e4) {}
                try {
                    var spawnResult = entity.spawn();
                    if (spawnResult === false) throw new Error("entity.spawn() returned false");
                } catch (eSp) {
                    err(`spawn failed ${mob.type}: ${eSp}; rolling back complete wave`);
                    discardFailedSpawnAttempt(out.concat([entity]));
                    return null;
                }
                // Track immediately so any later failure rolls this entity back.
                out.push(entity);
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
                    var rawTarget = unwrapPlayer(player);
                    if (nav && rawTarget) driveChaseNavigation(rawNew, rawTarget, nav, 0);
                } catch (eNav) {}
                spawnPoof(player, pos);
        }
        return out;
    }

    // ---------- Instance (state machine) ------------------------------------
    // Phases: QUEUED -> SPAWNING -> FIGHTING -> BREATHER -> ... -> WIN_WAIT -> DONE.

    function RaidInstance(id, def, level, player, options) {
        options = options || {};
        var identity = playerTeamIdentity(player);
        this.id        = id;
        this.defId     = def.id;
        this.def       = def;
        this.level     = level;
        this.playerUuid = playerUuidOf(player);
        this.teamId = options.teamId !== undefined ? options.teamId : identity.teamId;
        this.cohortId = String(options.cohortId || id);
        this.participantUuids = options.participantUuids || identity.members;
        this._lostParticipantUuids = options.lostParticipantUuids || {};
        this._spatialDepartureCountdowns = options.spatialDepartureCountdowns || {};
        this._spatialCountdownDirty = false;
        this._currentTeamRoster = null;
        this._cohortInitializing = !!options.cohortInitializing;
        this._onlineParticipants = [];
        this._teamSyncLeft = 0;
        this._offlinePrepared = false;
        this._ctxPlayer = player;     // fallback if live lookup fails
        this.roundIdx     = 0;
        this.phase        = "SPAWNING";
        this._queueOrder  = 0;
        this._queueReadyAt = 0;         // absolute overworld time; persisted across logout/restart
        this.spawnRetryLeft = 0;       // backoff when terrain has no safe spawn plan
        this.breatherLeft = 0;
        this.roundTimeLeft = null;
        this.roundMobs = [];          // live mobs of the current round
        this.carryover = [];          // live survivors carried from timed-out rounds
        this.bar       = null;        // ServerBossEvent (or null if disabled/unavailable)
        this._barParticipantKey = null;// sorted viewer UUIDs; avoids redundant team sync work
        this._barSyncWarned = false;  // log a conversion/API failure once, then self-retry
        this._personalDeathBars = {}; // one hidden, player-specific HUD data bar per online member
        this._personalDeathBarValues = {};
        this.barBase   = def.title || prettyId(def.id);
        this.roundTotalHealth = 1;    // sum of max-health for the current wave (bar denominator)
        this.roundTotalMobs = 0;      // actual current + carryover count displayed in the bar
        this.endLeft   = 0;           // ENDING-phase linger countdown (victory/defeat bar)
        this._mobState = {};          // uuid -> {x,y,z,idle,tp} anti-stuck tracking
        this._assistTick = 0;         // aggro pass counter (waterAssist throttling)
        this._usesStrictDaylightGuard = raidUsesStrictDaylightGuard(def);
        this._terminalNotified = false;// terminal lifecycle event fires exactly once
        this._deathCount = 0;         // shown by the HUD and persisted; never changes raid outcome
        this._diedDuringRaid = false; // legacy aggregate retained for old active snapshots
        this._playerDeathCounts = {}; // UUID -> personal deaths; flawless is evaluated per member
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

    function hasVictoryAdvancement(player, defId) {
        if (!player) return false;
        var advancement = RAID_VICTORY_ADVANCEMENTS[String(defId)];
        if (!advancement) return false;
        try {
            var rawPlayer = unwrapPlayer(player);
            var server = player.server;
            if (!server && rawPlayer && typeof rawPlayer.getServer === "function")
                server = rawPlayer.getServer();
            if (!rawPlayer || !server) return false;
            var ResourceLocation = Java.loadClass("net.minecraft.resources.ResourceLocation");
            var holder = server.getAdvancements().get(ResourceLocation.parse(advancement));
            if (!holder || typeof rawPlayer.getAdvancements !== "function") return false;
            return !!rawPlayer.getAdvancements().getOrStartProgress(holder).isDone();
        } catch (e) {
            return false;
        }
    }
    function personalDeathCount(inst, playerOrUuid) {
        if (!inst) return 0;
        var uuid = "";
        if (typeof playerOrUuid === "string") uuid = normUuid(playerOrUuid);
        else uuid = playerUuidOf(playerOrUuid);
        if (!uuid) return 0;
        var counts = inst._playerDeathCounts || {};
        return Math.max(0, Math.floor(Number(counts[uuid]) || 0));
    }
    function normalizedDeathCountMap(value) {
        var out = {};
        if (!value || typeof value !== "object") return out;
        for (var key in value) {
            var uuid = normUuid(key);
            var count = Math.max(0, Math.floor(Number(value[key]) || 0));
            if (uuid && count > 0) out[uuid] = count;
        }
        return out;
    }
    function deathCountMapSnapshot(inst) {
        return normalizedDeathCountMap(inst ? inst._playerDeathCounts : null);
    }
    function grantFlawlessAdvancement(inst, player) {
        // A teammate dying no longer disqualifies somebody who personally
        // survived the whole raid.
        if (!inst || !player || personalDeathCount(inst, player) > 0) return;
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

    function readPendingTeamWins(server) {
        if (!server || !server.persistentData) return [];
        try {
            var raw = String(server.persistentData.getString(PENDING_TEAM_WINS_KEY) || "");
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed.length === "number" ? parsed : [];
        } catch (e) {
            warn("read pending team wins: " + e);
            return [];
        }
    }

    function writePendingTeamWins(server, records) {
        if (!server || !server.persistentData) return;
        try {
            if (records && records.length > 0)
                server.persistentData.putString(PENDING_TEAM_WINS_KEY, JSON.stringify(records));
            else server.persistentData.remove(PENDING_TEAM_WINS_KEY);
        } catch (e) { warn("write pending team wins: " + e); }
    }

    function fullRewardMarkerKey(defId) {
        return WIN_REWARD_MARKER_PREFIX +
               String(defId || "unknown").toLowerCase().replace(/[^a-z0-9_]/g, "_");
    }

    // Returns true only once per player and raid. Existing victory advancements
    // seed the history, so worlds upgraded from an older script do not hand an
    // already-established winner another full first-clear package.
    function claimFullVictoryReward(player, defId) {
        if (!player) return false;
        var key = fullRewardMarkerKey(defId);
        var claimed = false;
        try { claimed = !!player.persistentData.getBoolean(key); }
        catch (eRead) {}
        if (!claimed) claimed = hasVictoryAdvancement(player, defId);

        // Consume the first-clear status before external reward callbacks run.
        // A disconnect or callback failure can therefore never replay the full
        // package on the next login.
        try { player.persistentData.putBoolean(key, true); }
        catch (eWrite) { warn("victory reward history " + defId + ": " + eWrite); }
        return !claimed;
    }

    function victoryRewardContext(inst, player) {
        var ctx = inst.ctx ? inst.ctx(player) :
            { player: player, level: playerLevel(player), raid: inst.def, instance: inst };
        var fullReward = claimFullVictoryReward(player, inst.defId);
        ctx.isFirstVictoryReward = fullReward;
        ctx.rewardDivisor = fullReward ? 1 : 2;
        ctx.giveRaidReward = function (itemId, fullCount) {
            var authoredCount = Math.max(0, Math.floor(Number(fullCount) || 0));
            var count = fullReward ? authoredCount : Math.floor(authoredCount / 2);
            if (count <= 0) return false;
            try {
                player.give(String(itemId) + " " + count);
                return true;
            } catch (eGive) {
                warn("victory reward " + itemId + " x" + count + ": " + eGive);
                return false;
            }
        };
        return ctx;
    }

    function deliverVictory(inst, player, delayed) {
        if (!inst || !player) return;
        fireCb(inst.def, "onWin", [victoryRewardContext(inst, player)]);
        grantVictoryAdvancement(inst, player);
        grantFlawlessAdvancement(inst, player);
        if (delayed) {
            try { player.tell(Text.of("§aYour team's saved raid victory rewards have been delivered.")); }
            catch (eTell) {}
            return;
        }
        playSnd(player, inst.def.sounds.win);
        showTitle(player, "VICTORY", inst.barBase, "green");
        victoryBurst(player);
    }

    function deliverVictoryToTeam(inst) {
        var server = Manager._server;
        var online = onlineParticipants(inst, true);
        var onlineById = {};
        for (var i = 0; i < online.length; i++) onlineById[playerUuidOf(online[i])] = online[i];

        var pending = readPendingTeamWins(server);
        var deliverNow = [];
        for (var uuid in inst.participantUuids) {
            if (!inst.participantUuids[uuid]) continue;
            var player = onlineById[normUuid(uuid)];
            if (player) deliverNow.push(player);
            else pending.push({
                uuid: normUuid(uuid),
                defId: inst.defId,
                flawless: personalDeathCount(inst, uuid) === 0
            });
        }
        // Persist offline entitlements before running item callbacks for online
        // members, so a callback failure can never erase somebody else's share.
        writePendingTeamWins(server, pending);
        for (var d = 0; d < deliverNow.length; d++)
            deliverVictory(inst, deliverNow[d], false);
    }

    function deliverPendingTeamWins(player) {
        if (!player) return 0;
        var server = player.server || Manager._server;
        var puid = playerUuidOf(player);
        var pending = readPendingTeamWins(server);
        if (pending.length === 0) return 0;

        var keep = [], toDeliver = [], delivered = 0;
        for (var i = 0; i < pending.length; i++) {
            var record = pending[i];
            if (!record || normUuid(record.uuid) !== puid) {
                keep.push(record);
                continue;
            }
            toDeliver.push(record);
        }
        // Consume this player's entitlements before external reward callbacks.
        // A broken mod item must never replay earlier rewards on every login.
        writePendingTeamWins(server, keep);
        for (var i = 0; i < toDeliver.length; i++) {
            var record = toDeliver[i];
            var def = Registry.get(String(record.defId));
            if (!def) {
                warn("pending team win references missing raid " + record.defId);
                continue;
            }
            var saved = {
                defId: String(record.defId),
                def: def,
                level: playerLevel(player),
                barBase: def.title || prettyId(def.id),
                _diedDuringRaid: !record.flawless,
                _playerDeathCounts: record.flawless ? {} : (function () {
                    var counts = {};
                    counts[playerUuidOf(player)] = 1;
                    return counts;
                })(),
                ctx: function (p) {
                    return { player: p, level: playerLevel(p), raid: def, instance: this };
                }
            };
            deliverVictory(saved, player, true);
            delivered++;
        }
        return delivered;
    }

    RaidInstance.prototype.lose = function (player) {
        removeMobsNoDrops(this);
        var inst = this;
        eachOnlineParticipant(this, function (member) {
            applyDefeatPenalty(member);
            playSnd(member, inst.def.sounds.lose);
            showTitle(member, "DEFEAT", inst.barBase, "dark_red");
            fireCb(inst.def, "onLose", [inst.ctx(member)]);
        }, true);
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
        return " §7• §a☠ §f" + Math.max(0, Number(this._deathCount) || 0);
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
        onlineParticipants(this, false);
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
        closePersonalDeathBars(this);
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
        // Every living teammate in the raid dimension is a hard-priority target.
        // This keeps the encounter shared instead of making every mob chase only
        // the player who originally started it.
        var mainRaw = null;
        if (player) {
            var pAlive = true;
            try { pAlive = (typeof player.isAlive === "function") ? player.isAlive() : player.isAlive; } catch (e) {}
            if (pAlive) mainRaw = unwrapPlayer(player);
        }
        var teamRaws = [];
        var teamPlayers = combatParticipants(this, false);
        for (var pi = 0; pi < teamPlayers.length; pi++) {
            var rawPlayer = unwrapPlayer(teamPlayers[pi]);
            if (rawPlayer && mainPlayerEligible(rawPlayer)) teamRaws.push(rawPlayer);
        }
        // Water upkeep every 4th pass (~1s): mergeNbt is a full entity NBT
        // save/load — too heavy per water mob at the 5-tick cadence. Drowned
        // conversion needs 600 in-water ticks, so a 20-tick reset is plenty.
        this._assistTick++;
        if ((this._assistTick & 3) === 0) waterAssist(this);
        this.glowStragglers();
        var radius = (this.def.aggroRadius != null) ? this.def.aggroRadius : 20;
        if (this.def.spawnPattern === "horde") radius += 8;   // cluster sits in one spot — widen detection
        var center = mainRaw || (teamRaws.length > 0 ? teamRaws[0] : firstRaw(this));
        // The shared team targets need no world scan. The existing one-query
        // fallback remains only for intervals where every teammate is dead.
        var victims = teamRaws.length > 0 ? [] : collectVictims(this, center, radius);
        var radiusSqr = radius * radius;
        var inst = this;
        eachMob(this, function (m) {
            var raw = rawMobOf(m);
            if (!raw) return;
            clearDaylightFire(inst.level, raw);
            if (typeof raw.setTarget !== "function") return;
            var t = decideTarget(raw, teamRaws, victims, radiusSqr);
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
                    if (navLock) driveChaseNavigation(raw, t, navLock, 0);
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
        if (idx > 0) {
            var inst = this;
            eachOnlineParticipant(this, function (member) {
                playSnd(member, inst.def.sounds.roundStart);
            }, false);
        }
        fireCb(this.def, "onRoundStart", [this.ctx(player), round, idx]);
        this.phase = "FIGHTING";
        return true;
    };
    RaidInstance.prototype.tick = function () {
        // A queued instance is only a small persisted reservation. It owns no
        // bar, mobs or combat tick until the global manager assigns a slot.
        if (this.phase === "QUEUED") return;
        this._teamSyncLeft = Math.max(0, (Number(this._teamSyncLeft) || 0) - TICK_THROTTLE);
        var player = resolvePlayer(this);   // live player wrapper, or null if offline
        var round  = this.def.rounds[this.roundIdx];

        // Every participant either left the FTB team or was disqualified by the
        // 500-block rule. Do not leave an ownerless raid paused forever.
        if (participantCount(this) === 0 && this.phase !== "ENDING") {
            this.lose(null);
            return;
        }

        // No player-death loss: if the main player dies the mobs switch to nearby
        // villagers/players (see aggro) and re-aggro the player on respawn. The
        // only loss is the final round's timer expiring (see FIGHTING below).
        // Logging out is different from dying: pause the whole combat state so
        // an offline player cannot lose (or accidentally win through unloaded
        // entity wrappers). On return, persistent mobs are rebound by UUID/tag.
        if (!player && this.phase !== "ENDING") {
            if (!this._restoring && !this._offlinePrepared) {
                prepareForRebind(this);
                this._offlinePrepared = true;
                persistActive(Manager._server);
            }
            return;
        }
        if (player) this._offlinePrepared = false;
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
                        var instRoundEnd = this;
                        eachOnlineParticipant(this, function (member) {
                            playSnd(member, instRoundEnd.def.sounds.roundEnd);
                        }, false);
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
                    // Commit + persist the terminal state before external reward
                    // callbacks, so one invalid mod item cannot replay rewards.
                    this.barEnd("§a§l✔ " + this.barBase + " - VICTORY" + this.deathBarText(), "GREEN", 1.0);
                    this.endLeft = this.def.barHold || DEFAULT_BAR_HOLD;
                    this.phase = "ENDING";
                    notifyTerminal(this, "win");
                    deliverVictoryToTeam(this);
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

    function onlinePlayerList(server) {
        if (!server) return null;
        try { if (server.players) return server.players; } catch (e) {}
        try {
            if (typeof server.getPlayerList === "function")
                return server.getPlayerList().getPlayers();
        } catch (e2) {}
        return null;
    }

    // Iterate the live server player list; return the first match for pred, or null.
    function findOnlinePlayer(server, pred) {
        var players = onlinePlayerList(server);
        if (!players) return null;
        try {
            var it = players.iterator();
            while (it.hasNext()) { var p = it.next(); if (p && pred(p)) return p; }
        } catch (e) {}
        return null;
    }

    function sameRaidLevel(inst, player) {
        if (!inst || !player) return false;
        try { return levelId(playerLevel(player)) === levelId(inst.level); }
        catch (e) { return false; }
    }

    function playerDistanceSqr(a, b) {
        if (!a || !b) return Infinity;
        try {
            if (levelId(playerLevel(a)) !== levelId(playerLevel(b))) return Infinity;
            var dx = Number(a.x) - Number(b.x);
            var dy = Number(a.y) - Number(b.y);
            var dz = Number(a.z) - Number(b.z);
            if (!isFinite(dx) || !isFinite(dy) || !isFinite(dz)) {
                var pa = a.position(), pb = b.position();
                dx = Number(pa.x) - Number(pb.x);
                dy = Number(pa.y) - Number(pb.y);
                dz = Number(pa.z) - Number(pb.z);
            }
            return dx * dx + dy * dy + dz * dz;
        } catch (e) { return Infinity; }
    }

    // Complete-link spatial groups: every pair inside one group is within the
    // 500-block limit. This avoids a 0/400/800 chain incorrectly treating the
    // first and last players as one raid merely because the middle player links
    // them. FTB teams are small and comparisons remain O(team²) once per second.
    function spatialPlayerGroups(players) {
        var ordered = players.slice();
        ordered.sort(function (a, b) {
            return playerUuidOf(a).localeCompare(playerUuidOf(b));
        });
        var groups = [];
        for (var i = 0; i < ordered.length; i++) {
            var player = ordered[i];
            if (!playerUuidOf(player)) continue;
            var placed = false;
            for (var g = 0; g < groups.length && !placed; g++) {
                var fits = true;
                for (var j = 0; j < groups[g].length; j++) {
                    if (playerDistanceSqr(player, groups[g][j]) > TEAM_RAID_DISTANCE_SQ) {
                        fits = false;
                        break;
                    }
                }
                if (fits) {
                    groups[g].push(player);
                    placed = true;
                }
            }
            if (!placed) groups.push([player]);
        }
        return groups;
    }

    function participantCount(inst) {
        var count = 0;
        if (!inst || !inst.participantUuids) return 0;
        for (var uuid in inst.participantUuids)
            if (inst.participantUuids[uuid]) count++;
        return count;
    }

    function canAcceptEarlyTeamMember(inst) {
        if (!inst || inst.phase === "DONE" || inst.phase === "ENDING") return false;
        return inst.roundIdx === 0 &&
               (inst.phase === "QUEUED" || inst.phase === "SPAWNING" ||
                inst.phase === "FIGHTING");
    }

    function cohortInstances(inst) {
        var out = [];
        if (!inst) return out;
        for (var key in _active) {
            var candidate = _active[key];
            if (!candidate || candidate.phase === "DONE" || candidate.phase === "ENDING") continue;
            if (candidate.defId === inst.defId &&
                candidate.teamId === inst.teamId &&
                String(candidate.cohortId || candidate.id) === String(inst.cohortId || inst.id))
                out.push(candidate);
        }
        return out;
    }

    function participantInstanceForCohort(inst, uuid) {
        var wanted = normUuid(uuid);
        var cohort = cohortInstances(inst);
        for (var i = 0; i < cohort.length; i++) {
            if (cohort[i].participantUuids && cohort[i].participantUuids[wanted])
                return cohort[i];
        }
        return null;
    }

    function onlinePlayersInRoster(roster) {
        var out = [];
        var livePlayers = onlinePlayerList(Manager._server);
        if (!roster || !livePlayers) return out;
        try {
            var it = livePlayers.iterator();
            while (it.hasNext()) {
                var player = it.next();
                if (player && roster[playerUuidOf(player)]) out.push(player);
            }
        } catch (e) {}
        return out;
    }

    function tellSpatialLoss(inst, player, reason) {
        if (!inst || !player) return;
        applyDefeatPenalty(player);
        playSnd(player, inst.def.sounds.lose);
        showTitle(player, "DEFEAT", reason || "Separated from the raid", "dark_red");
        try {
            player.tell(Text.of(
                "§cYou left your raid group by more than " +
                TEAM_RAID_DISTANCE + " blocks. This raid is lost for you."
            ));
        } catch (e) {}
        fireCb(inst.def, "onLose", [inst.ctx(player)]);
    }

    function showSpatialActionbar(player, message, color) {
        if (!player || !message) return;
        try {
            var server = player.server || Manager._server;
            if (!server || typeof server.runCommandSilent !== "function") return;
            server.runCommandSilent(
                "title " + String(player.username) + " actionbar " +
                JSON.stringify({
                    text: String(message),
                    color: String(color || "red"),
                    bold: true
                })
            );
        } catch (e) {}
    }

    function clearSpatialDepartureCountdown(inst, player, notifyReturn) {
        if (!inst || !player || !inst._spatialDepartureCountdowns) return false;
        var uuid = playerUuidOf(player);
        if (!uuid || !inst._spatialDepartureCountdowns[uuid]) return false;
        delete inst._spatialDepartureCountdowns[uuid];
        inst._spatialCountdownDirty = true;
        if (notifyReturn) {
            showSpatialActionbar(
                player,
                "You are back inside the raid area.",
                "green"
            );
        }
        return true;
    }

    function freezeOfflineDepartureCountdowns(inst, onlineParticipantUuids) {
        if (!inst || !inst._spatialDepartureCountdowns) return;
        for (var uuid in inst._spatialDepartureCountdowns) {
            if (onlineParticipantUuids && onlineParticipantUuids[uuid]) continue;
            var record = inst._spatialDepartureCountdowns[uuid];
            if (record) record.lastTick = _serverTickClock;
        }
    }

    function advanceSpatialDepartureCountdown(inst, player, reason) {
        if (!inst || !player) return false;
        if (!inst._spatialDepartureCountdowns) inst._spatialDepartureCountdowns = {};
        var uuid = playerUuidOf(player);
        if (!uuid) return false;

        var record = inst._spatialDepartureCountdowns[uuid];
        if (!record) {
            record = {
                remaining: TEAM_RAID_ESCAPE_SECONDS,
                lastTick: _serverTickClock,
                lastShown: -1
            };
            inst._spatialDepartureCountdowns[uuid] = record;
            inst._spatialCountdownDirty = true;
        } else {
            var elapsedTicks = Math.max(0, _serverTickClock - Number(record.lastTick || 0));
            var elapsedSeconds = Math.floor(elapsedTicks / 20);
            if (elapsedSeconds > 0) {
                record.remaining = Math.max(0, Number(record.remaining || 0) - elapsedSeconds);
                record.lastTick = Number(record.lastTick || 0) + elapsedSeconds * 20;
            }
        }

        var remaining = Math.max(0, Math.ceil(Number(record.remaining) || 0));
        if (remaining <= 0) {
            delete inst._spatialDepartureCountdowns[uuid];
            inst._spatialCountdownDirty = true;
            return removeParticipantAsLost(inst, player, reason);
        }
        if (record.lastShown !== remaining) {
            record.lastShown = remaining;
            showSpatialActionbar(
                player,
                "You are moving away from the raid area! Return within " +
                    remaining + (remaining === 1 ? " second." : " seconds."),
                remaining <= 3 ? "dark_red" : "red"
            );
        }
        return false;
    }

    function removeParticipantAsLost(inst, player, reason) {
        if (!inst || !player) return false;
        var uuid = playerUuidOf(player);
        if (!uuid || !inst.participantUuids || !inst.participantUuids[uuid]) return false;
        if (inst._spatialDepartureCountdowns)
            delete inst._spatialDepartureCountdowns[uuid];
        delete inst.participantUuids[uuid];
        if (!inst._lostParticipantUuids) inst._lostParticipantUuids = {};
        inst._lostParticipantUuids[uuid] = true;
        removePersonalDeathBar(inst, uuid);
        inst._barParticipantKey = null;
        inst._teamSyncLeft = 0;
        tellSpatialLoss(inst, player, reason);
        return true;
    }

    function groupContainsUuid(group, uuid) {
        var wanted = normUuid(uuid);
        for (var i = 0; i < group.length; i++)
            if (playerUuidOf(group[i]) === wanted) return true;
        return false;
    }

    // Keep the largest valid 500-block group. In an exact tie, the group containing
    // the original starter remains authoritative. This makes a travelling
    // majority safe while a lone player who runs 500+ blocks away loses only
    // their own participation.
    function enforceSpatialCohesion(inst, onlineMembers) {
        if (!inst) return 0;
        if (!onlineMembers || onlineMembers.length === 0) {
            freezeOfflineDepartureCountdowns(inst, {});
            return 0;
        }
        var participants = [];
        var outOfDimension = [];
        var onlineParticipantUuids = {};
        var onlineParticipantPlayers = {};
        for (var i = 0; i < onlineMembers.length; i++) {
            var player = onlineMembers[i];
            var onlineUuid = playerUuidOf(player);
            if (!inst.participantUuids[onlineUuid]) continue;
            onlineParticipantUuids[onlineUuid] = true;
            onlineParticipantPlayers[onlineUuid] = player;
            if (sameRaidLevel(inst, player)) participants.push(player);
            else outOfDimension.push(player);
        }

        freezeOfflineDepartureCountdowns(inst, onlineParticipantUuids);
        var violations = {};
        for (var od = 0; od < outOfDimension.length; od++) {
            violations[playerUuidOf(outOfDimension[od])] = {
                player: outOfDimension[od],
                reason: "Left the raid dimension"
            };
        }

        if (participants.length > 1) {
            var groups = spatialPlayerGroups(participants);
            if (groups.length > 1) {
                groups.sort(function (a, b) {
                    if (a.length !== b.length) return b.length - a.length;
                    var aOwner = groupContainsUuid(a, inst.playerUuid) ? 1 : 0;
                    var bOwner = groupContainsUuid(b, inst.playerUuid) ? 1 : 0;
                    return bOwner - aOwner;
                });
                for (var g = 1; g < groups.length; g++) {
                    for (var p = 0; p < groups[g].length; p++) {
                        var separated = groups[g][p];
                        violations[playerUuidOf(separated)] = {
                            player: separated,
                            reason: "Separated from the raid group"
                        };
                    }
                }
            }
        }

        var removed = 0;
        for (var uuid in onlineParticipantUuids) {
            var violation = violations[uuid];
            if (violation) {
                if (advanceSpatialDepartureCountdown(
                    inst, violation.player, violation.reason
                )) removed++;
                continue;
            }
            var safePlayer = onlineParticipantPlayers[uuid];
            if (safePlayer) clearSpatialDepartureCountdown(inst, safePlayer, true);
        }
        return removed;
    }

    function nearestEarlyInstance(inst, player) {
        var cohort = cohortInstances(inst);
        var best = null, bestDistance = Infinity;
        for (var i = 0; i < cohort.length; i++) {
            var candidate = cohort[i];
            if (!canAcceptEarlyTeamMember(candidate) || !sameRaidLevel(candidate, player)) continue;
            var current = onlinePlayersInRoster(candidate.participantUuids);
            if (current.length === 0) continue;
            var fitsWholeGroup = true;
            var nearestMemberDistance = Infinity;
            for (var j = 0; j < current.length; j++) {
                var distance = playerDistanceSqr(player, current[j]);
                if (distance > TEAM_RAID_DISTANCE_SQ) {
                    fitsWholeGroup = false;
                    break;
                }
                if (distance < nearestMemberDistance) nearestMemberDistance = distance;
            }
            if (fitsWholeGroup && nearestMemberDistance < bestDistance) {
                best = candidate;
                bestDistance = nearestMemberDistance;
            }
        }
        return best;
    }

    function addEarlyParticipant(inst, player) {
        if (!inst || !player || !canAcceptEarlyTeamMember(inst)) return false;
        var uuid = playerUuidOf(player);
        if (!uuid || (inst._lostParticipantUuids && inst._lostParticipantUuids[uuid])) return false;
        if (participantInstanceForCohort(inst, uuid)) return false;
        inst.participantUuids[uuid] = true;
        inst._barParticipantKey = null;
        inst._teamSyncLeft = 0;
        try {
            player.tell(Text.of("§aYou joined your team's raid before wave one ended."));
        } catch (e) {}
        return true;
    }

    function refreshTeamRoster(inst) {
        if (!inst) return;
        // Upgrade snapshots created by the older solo-owner format as soon as
        // their owner is online and FTB Teams can identify the current party.
        if (!inst.teamId) {
            var owner = findOnlinePlayer(Manager._server, function (p) {
                return playerUuidOf(p) === inst.playerUuid;
            });
            if (owner) {
                var identity = playerTeamIdentity(owner);
                if (identity.teamId) {
                    inst.teamId = identity.teamId;
                    inst._currentTeamRoster = identity.members;
                }
            }
        }
        var team = inst.teamId ? ftbTeamById(inst.teamId) : null;
        if (team) {
            inst._currentTeamRoster = teamRoster(team, null);
            return;
        }
        inst._currentTeamRoster = null;
        if (!inst.participantUuids) inst.participantUuids = {};
    }

    var _javaArrayListClass = null;
    function newJavaArrayList() {
        try {
            if (!_javaArrayListClass) _javaArrayListClass = Java.loadClass("java.util.ArrayList");
            return new _javaArrayListClass();
        } catch (e) { return null; }
    }

    // Resolve through PlayerList instead of passing a KubeJS wrapper to
    // CustomBossEvent.addPlayer(ServerPlayer). The wrapper mismatch used to be
    // swallowed and left both solo and FTB-team raids with zero HUD viewers.
    function rawOnlineServerPlayer(server, player) {
        var id = javaUuid(playerUuidOf(player));
        if (server && id) {
            try {
                if (typeof server.getPlayerList === "function") {
                    var authoritative = server.getPlayerList().getPlayer(id);
                    if (authoritative) return authoritative;
                }
            } catch (e) {}
        }
        return unwrapPlayer(player);
    }

    function personalDeathBarPath(inst, uuid) {
        return String(inst.id) + PERSONAL_DEATH_BAR_PATH +
               normUuid(uuid).replace(/[^a-z0-9]/g, "");
    }

    function removePersonalDeathBar(inst, uuid) {
        if (!inst || !inst._personalDeathBars) return;
        var bar = inst._personalDeathBars[uuid];
        if (!bar) return;
        try { bar.setVisible(false); } catch (eVisible) {}
        try { bar.removeAllPlayers(); } catch (ePlayers) {}
        try {
            var ce = customBars(Manager._server);
            if (ce) ce.remove(bar);
        } catch (eRemove) {}
        delete inst._personalDeathBars[uuid];
        if (inst._personalDeathBarValues) delete inst._personalDeathBarValues[uuid];
    }

    function closePersonalDeathBars(inst) {
        if (!inst || !inst._personalDeathBars) return;
        var ids = [];
        for (var uuid in inst._personalDeathBars) ids.push(uuid);
        for (var i = 0; i < ids.length; i++) removePersonalDeathBar(inst, ids[i]);
        inst._personalDeathBars = {};
        inst._personalDeathBarValues = {};
    }

    // These zero-progress bars are a tiny server-to-client data channel. The
    // client HUD consumes and cancels them before drawing, while the real shared
    // raid bar still carries health/progress only once for the whole team.
    function syncPersonalDeathBars(inst, players) {
        if (!inst || inst.def.bossBar === false) return;
        if (!inst._personalDeathBars) inst._personalDeathBars = {};
        if (!inst._personalDeathBarValues) inst._personalDeathBarValues = {};
        var live = {};
        // Send the size of this spatial raid cohort with the existing personal
        // death counter. The client uses it only to decide whether the aggregate
        // green skull is useful; no extra boss bar or packet stream is needed.
        var raidMemberCount = participantCount(inst);

        for (var i = 0; i < players.length; i++) {
            var player = players[i];
            var uuid = playerUuidOf(player);
            var raw = rawOnlineServerPlayer(Manager._server, player);
            if (!uuid || !raw) continue;
            live[uuid] = true;

            var count = personalDeathCount(inst, uuid);
            var dataValue = count + " " + raidMemberCount;
            var bar = inst._personalDeathBars[uuid];
            if (!bar) {
                bar = makeBar(
                    Manager._server,
                    personalDeathBarPath(inst, uuid),
                    PERSONAL_DEATH_BAR_MARKER + " " + dataValue,
                    "YELLOW",
                    "PROGRESS"
                );
                if (!bar) continue;
                inst._personalDeathBars[uuid] = bar;
                inst._personalDeathBarValues[uuid] = dataValue;
                try { bar.setProgress(0.0); } catch (eProgress) {}
            } else if (inst._personalDeathBarValues[uuid] !== dataValue) {
                try { bar.setName(Text.of(PERSONAL_DEATH_BAR_MARKER + " " + dataValue)); }
                catch (eName) {}
                inst._personalDeathBarValues[uuid] = dataValue;
            }

            // setPlayers performs a set diff internally, so unchanged viewers
            // do not receive add/remove packets during the one-second team sync.
            try {
                var onlyPlayer = newJavaArrayList();
                if (onlyPlayer && typeof bar.setPlayers === "function") {
                    onlyPlayer.add(raw);
                    bar.setPlayers(onlyPlayer);
                } else {
                    bar.removeAllPlayers();
                    bar.addPlayer(raw);
                }
                bar.setVisible(true);
            } catch (eSync) {
                warn("personal death HUD sync failed for " + uuid + ": " + eSync);
            }
        }

        var stale = [];
        for (var existing in inst._personalDeathBars) {
            if (!live[existing]) stale.push(existing);
        }
        for (var s = 0; s < stale.length; s++) removePersonalDeathBar(inst, stale[s]);
    }

    // Recreate a missing/externally removed custom bar on the next existing
    // one-second team sync. This is an O(1) registry lookup, not an entity scan.
    function ensureRaidBar(inst) {
        if (!inst || inst.def.bossBar === false ||
            inst.phase === "QUEUED" || inst.phase === "DONE") return null;
        var server = Manager._server;
        var ce = customBars(server);
        var rl = barRL(inst.id);
        var registered = null;
        try { if (ce && rl) registered = ce.get(rl); } catch (e) {}
        if (registered) {
            inst.bar = registered;
            return registered;
        }
        inst.bar = makeBar(server, inst.id, inst._barText || inst.barBase,
                           inst.def.barColor, inst.def.barOverlay);
        inst._barParticipantKey = null;
        return inst.bar;
    }

    function syncBarParticipants(inst, players) {
        if (!inst) return;
        var bar = ensureRaidBar(inst);
        if (!bar) return;
        syncPersonalDeathBars(inst, players);

        var rawPlayers = newJavaArrayList();
        if (!rawPlayers) return;
        var ids = [];
        for (var i = 0; i < players.length; i++) {
            var player = players[i];
            var playerId = playerUuidOf(player);
            var raw = rawOnlineServerPlayer(Manager._server, player);
            if (!playerId || !raw) continue;
            ids.push(playerId);
            try { rawPlayers.add(raw); }
            catch (eList) {
                if (!inst._barSyncWarned) {
                    inst._barSyncWarned = true;
                    warn("boss bar player conversion failed for " + inst.id + ": " + eList);
                }
            }
        }
        ids.sort();
        var participantKey = ids.join(",");
        if (participantKey === inst._barParticipantKey) {
            try { if (!bar.isVisible()) bar.setVisible(true); } catch (eVisibleCached) {}
            return;
        }

        try {
            // CustomBossEvent#setPlayers applies additions and removals
            // atomically and only sends packets for the actual differences.
            if (typeof bar.setPlayers === "function") {
                bar.setPlayers(rawPlayers);
            } else {
                bar.removeAllPlayers();
                var it = rawPlayers.iterator();
                while (it.hasNext()) bar.addPlayer(it.next());
            }
            bar.setVisible(true);
            inst._barParticipantKey = participantKey;
            inst._barSyncWarned = false;
        } catch (eSync) {
            inst._barParticipantKey = null;
            if (!inst._barSyncWarned) {
                inst._barSyncWarned = true;
                warn("boss bar participant sync failed for " + inst.id + ": " + eSync);
            }
        }
    }

    function lostInCohort(inst, uuid) {
        var wanted = normUuid(uuid);
        var cohort = cohortInstances(inst);
        for (var i = 0; i < cohort.length; i++) {
            if (cohort[i]._lostParticipantUuids &&
                cohort[i]._lostParticipantUuids[wanted]) return true;
        }
        return false;
    }

    function removeFormerTeamMembers(inst, roster) {
        if (!inst || !roster || !inst.participantUuids) return 0;
        var removed = 0, stale = [];
        for (var uuid in inst.participantUuids) {
            if (inst.participantUuids[uuid] && !roster[uuid]) stale.push(uuid);
        }
        for (var i = 0; i < stale.length; i++) {
            var player = findOnlinePlayer(Manager._server, function (candidate) {
                return playerUuidOf(candidate) === stale[i];
            });
            if (player) {
                if (removeParticipantAsLost(inst, player, "Left the FTB team")) removed++;
            } else {
                delete inst.participantUuids[stale[i]];
                if (inst._spatialDepartureCountdowns)
                    delete inst._spatialDepartureCountdowns[stale[i]];
                if (!inst._lostParticipantUuids) inst._lostParticipantUuids = {};
                inst._lostParticipantUuids[stale[i]] = true;
                removePersonalDeathBar(inst, stale[i]);
                inst._barParticipantKey = null;
                removed++;
            }
        }
        return removed;
    }

    // Reconcile one spatial raid cohort. Existing members are never replaced by
    // the live FTB roster: it is only a source for legitimate early joiners and
    // for detecting people who actually left the team.
    function syncSpatialCohort(inst) {
        if (!inst || inst._cohortInitializing || !inst.teamId) return false;
        var roster = inst._currentTeamRoster;
        if (!roster) return false; // temporary FTB API failure: preserve membership

        var changed = removeFormerTeamMembers(inst, roster) > 0;
        var onlineRoster = onlinePlayersInRoster(roster);
        // Queue time is not combat time: do not punish people for moving while
        // they wait. The normal 500-block countdown begins on activation.
        if (inst.phase !== "QUEUED" &&
            enforceSpatialCohesion(inst, onlineRoster) > 0) changed = true;
        if (inst._spatialCountdownDirty) {
            inst._spatialCountdownDirty = false;
            changed = true;
        }

        var cohort = cohortInstances(inst);
        var joinWindowOpen = false;
        for (var ci = 0; ci < cohort.length; ci++) {
            if (canAcceptEarlyTeamMember(cohort[ci])) {
                joinWindowOpen = true;
                break;
            }
        }
        if (!joinWindowOpen) {
            if (changed) persistActive(Manager._server);
            return changed;
        }

        for (var i = 0; i < onlineRoster.length; i++) {
            var player = onlineRoster[i];
            var uuid = playerUuidOf(player);
            if (!uuid || participantInstanceForCohort(inst, uuid) ||
                lostInCohort(inst, uuid)) continue;

            var nearest = nearestEarlyInstance(inst, player);
            if (nearest) {
                if (addEarlyParticipant(nearest, player)) changed = true;
                continue;
            }

            // The member joined/logged in during wave one but is over 500 blocks
            // from every existing group. Give them their own simultaneous copy
            // of this raid instead of attaching a remote HUD/reward entitlement.
            var participantSet = {};
            participantSet[uuid] = true;
            var queueSplit = runningRaidCount() >= MAX_CONCURRENT_RAIDS;
            var split = createRaidInstance(
                playerLevel(player), player, inst.def,
                String(inst.cohortId || inst.id), participantSet, inst.teamId,
                false, queueSplit
            );
            if (split) {
                if (queueSplit) notifyQueuedRaid(split);
                else activateRaidInstance(split, player);
                changed = true;
            }
        }
        if (changed) persistActive(Manager._server);
        return changed;
    }

    // Refresh FTB membership once per second: quick team changes propagate to
    // the shared HUD without doing team API work on every raid tick.
    function onlineParticipants(inst, force) {
        if (!inst) return [];
        inst._teamSyncLeft = Math.max(0, Number(inst._teamSyncLeft) || 0);
        if (!force && inst._teamSyncLeft > 0 && inst._onlineParticipants)
            return inst._onlineParticipants;

        refreshTeamRoster(inst);
        syncSpatialCohort(inst);
        var out = [];
        var livePlayers = onlinePlayerList(Manager._server);
        if (livePlayers) {
            try {
                var it = livePlayers.iterator();
                while (it.hasNext()) {
                    var p = it.next();
                    if (p && inst.participantUuids[playerUuidOf(p)]) out.push(p);
                }
            } catch (e) {}
        }
        inst._onlineParticipants = out;
        inst._teamSyncLeft = TEAM_SYNC_EVERY;
        syncBarParticipants(inst, out);
        return out;
    }

    function combatParticipants(inst, force) {
        var online = onlineParticipants(inst, force);
        var out = [];
        for (var i = 0; i < online.length; i++)
            if (sameRaidLevel(inst, online[i])) out.push(online[i]);
        return out;
    }

    function eachOnlineParticipant(inst, fn, force) {
        var players = onlineParticipants(inst, !!force);
        for (var i = 0; i < players.length; i++) {
            try { fn(players[i]); } catch (e) { warn("team participant action: " + e); }
        }
    }

    // Prefer the starter as the spawn anchor. If they disconnect, another
    // teammate in the raid dimension seamlessly keeps the same instance active.
    function resolvePlayer(inst) {
        var players = combatParticipants(inst, false);
        var fallback = null;
        for (var i = 0; i < players.length; i++) {
            if (!fallback) fallback = players[i];
            if (playerUuidOf(players[i]) === inst.playerUuid) return players[i];
        }
        return fallback;
    }

    function raidForPlayer(player) {
        if (!player) return null;
        // Membership is explicit per 500-block spatial subgroup. Merely sharing
        // an FTB Team must never attach a remote player to another group's HUD,
        // rewards or advancement eligibility.
        return playerInRaid(playerUuidOf(player));
    }

    // ---------- Manager -----------------------------------------------------

    const _active = {};        // instanceId -> RaidInstance
    const _terminalListeners = [];
    const _pendingLifestealerForms = [];
    var _idSeq    = 0;
    var _queueSeq = 0;
    var _serverTickClock = 0;
    var _tickAccum = 0;
    var _persistAccum = 0;
    var _queueCheckAccum = 0;
    var _queueDrainRequested = false;
    var _restoreAttempted = false;
    var _serverGeneration = 0;
    var _driverWatchdogServer = null;
    var _driverWatchdogScheduled = false;
    var _driverWatchdogClock = 0;
    var _driverWatchdogWarned = false;

    function hasManagedRaidInstances() {
        for (var key in _active) {
            if (_active[key] && _active[key].phase !== "DONE") return true;
        }
        return false;
    }

    function sameRaidServer(a, b) {
        if (!a || !b) return false;
        if (a === b) return true;
        try {
            if (typeof a.getPlayerList === "function" &&
                typeof b.getPlayerList === "function" &&
                a.getPlayerList() === b.getPlayerList()) return true;
        } catch (ePlayers) {}
        try {
            if (typeof a.getWorldData === "function" &&
                typeof b.getWorldData === "function" &&
                a.getWorldData() === b.getWorldData()) return true;
        } catch (eData) {}
        try {
            if (typeof a.overworld === "function" &&
                typeof b.overworld === "function" &&
                a.overworld() === b.overworld()) return true;
        } catch (eLevel) {}
        return false;
    }

    // Server-script globals can survive a singleplayer world transition on
    // some KubeJS/IntegratedServer startup paths. Never let the previous
    // world's restore flag, cached APIs or instance references poison a newly
    // created world.
    function bindRaidServer(server) {
        if (!server || sameRaidServer(Manager._server, server)) return false;

        for (var key in _active) delete _active[key];
        _pendingLifestealerForms.length = 0;
        _idSeq = 0;
        _queueSeq = 0;
        _serverTickClock = 0;
        _tickAccum = 0;
        _persistAccum = 0;
        _queueCheckAccum = 0;
        _queueDrainRequested = false;
        _restoreAttempted = false;

        // Retry APIs/classes that may have been queried while a brand-new
        // IntegratedServer was still bringing its managers and dimensions up.
        _ftbTeamsUnavailable = false;
        _mineColoniesManager = null;
        _mineColoniesTried = false;
        _mineColoniesWarned = false;
        _heightTypes = null;
        _heightTypesRetryAfter = 0;
        _heightRuntimeRetryAfter = 0;

        _serverGeneration++;
        _driverWatchdogServer = server;
        _driverWatchdogScheduled = false;
        _driverWatchdogClock = 0;
        _driverWatchdogWarned = false;
        Manager._server = server;
        Manager._loadedSweepDone = false;
        return true;
    }

    function releaseRaidServer(server) {
        if (server && Manager._server && !sameRaidServer(Manager._server, server)) return;
        for (var key in _active) delete _active[key];
        _pendingLifestealerForms.length = 0;
        _serverGeneration++;
        _driverWatchdogServer = null;
        _driverWatchdogScheduled = false;
        _restoreAttempted = false;
        Manager._server = null;
    }

    function scheduleRaidDriverWatchdog(server) {
        if (!server || !hasManagedRaidInstances()) return false;
        if (_driverWatchdogScheduled &&
            sameRaidServer(_driverWatchdogServer, server)) return true;
        if (typeof server.scheduleInTicks !== "function") {
            if (!_driverWatchdogWarned) {
                _driverWatchdogWarned = true;
                warn("raid driver watchdog unavailable; server scheduler missing");
            }
            return false;
        }

        _driverWatchdogServer = server;
        _driverWatchdogScheduled = true;
        _driverWatchdogClock = _serverTickClock;
        var generation = _serverGeneration;
        try {
            server.scheduleInTicks(RAID_DRIVER_WATCHDOG_EVERY, function () {
                // Ignore callbacks retained by an IntegratedServer that already
                // stopped; a new world's watchdog owns the current generation.
                if (generation !== _serverGeneration ||
                    !sameRaidServer(server, Manager._server)) return;

                _driverWatchdogScheduled = false;
                if (!hasManagedRaidInstances()) return;

                // Normal path: ServerEvents.tick advanced the clock, so this
                // callback performs no raid work. First-world fallback: if the
                // event registration was missed, advance exactly the ticks
                // represented by this watchdog interval.
                if (_serverTickClock === _driverWatchdogClock) {
                    for (var i = 0; i < RAID_DRIVER_WATCHDOG_EVERY; i++)
                        Manager._drive(server);
                }
                scheduleRaidDriverWatchdog(server);
            });
            return true;
        } catch (e) {
            _driverWatchdogScheduled = false;
            if (!_driverWatchdogWarned) {
                _driverWatchdogWarned = true;
                warn("raid driver watchdog schedule failed: " + e);
            }
            return false;
        }
    }

    function newInstanceId(defId) {
        var id = null;
        do { _idSeq++; id = defId + "_" + _idSeq; } while (_active[id]);
        return id;
    }

    function participantSetForPlayers(players) {
        var out = {};
        for (var i = 0; i < players.length; i++) {
            var uuid = playerUuidOf(players[i]);
            if (uuid) out[uuid] = true;
        }
        return out;
    }

    function onlineTeamPlayers(identity, starter) {
        var out = [];
        var seen = {};
        var roster = identity && identity.members ? identity.members : {};
        var live = onlinePlayerList(Manager._server || (starter ? starter.server : null));
        if (live) {
            try {
                var it = live.iterator();
                while (it.hasNext()) {
                    var player = it.next();
                    var uuid = playerUuidOf(player);
                    if (!uuid || !roster[uuid] || seen[uuid]) continue;
                    seen[uuid] = true;
                    out.push(player);
                }
            } catch (e) {}
        }
        var starterId = playerUuidOf(starter);
        if (starter && starterId && !seen[starterId]) out.push(starter);
        return out;
    }

    function ownerHasActiveInstance(identity, starterUuid) {
        var teamId = identity ? identity.teamId : null;
        var wantedPlayer = normUuid(starterUuid);
        for (var key in _active) {
            var inst = _active[key];
            if (!inst || inst.phase === "DONE" || inst.phase === "ENDING") continue;
            if (teamId) {
                if (inst.teamId === teamId) return true;
            } else if (!inst.teamId && inst.playerUuid === wantedPlayer) {
                return true;
            }
        }
        return false;
    }

    function runningRaidCount() {
        var count = 0;
        for (var key in _active) {
            var phase = _active[key] ? _active[key].phase : "DONE";
            if (phase !== "QUEUED" && phase !== "ENDING" && phase !== "DONE") count++;
        }
        return count;
    }

    function queuedRaidInstances() {
        var out = [];
        for (var key in _active) {
            var inst = _active[key];
            if (inst && inst.phase === "QUEUED") out.push(inst);
        }
        out.sort(function (a, b) {
            var byOrder = (Number(a._queueOrder) || 0) - (Number(b._queueOrder) || 0);
            return byOrder || String(a.id).localeCompare(String(b.id));
        });
        return out;
    }

    function queuePosition(inst) {
        var queued = queuedRaidInstances();
        for (var i = 0; i < queued.length; i++)
            if (queued[i].id === inst.id) return i + 1;
        return 0;
    }

    function explicitOnlineParticipants(inst) {
        return onlinePlayersInRoster(inst && inst.participantUuids);
    }

    function notifyQueuedRaid(inst) {
        if (!inst || inst.phase !== "QUEUED") return;
        var position = queuePosition(inst);
        var remaining = Math.max(
            0,
            Math.ceil(Number(inst._queueReadyAt || 0) - raidWorldTime(Manager._server))
        );
        var members = explicitOnlineParticipants(inst);
        for (var i = 0; i < members.length; i++) {
            try {
                members[i].tell(Text.of(
                    "[Raid] " + inst.barBase + " is queued" +
                    (position > 0 ? " (#" + position + ")" : "") +
                    (remaining > 0
                        ? ". You have one Minecraft day to prepare before it can start."
                        : ". Its preparation day is complete.") +
                    " It also waits for one of the " +
                    MAX_CONCURRENT_RAIDS + " raid slots to be free."
                ));
            } catch (e) {}
        }
        info(`queued "${inst.defId}" as ${inst.id} at position ${position}`);
    }

    function createRaidInstance(level, player, def, cohortId, participants, teamId,
                                initializing, queued, queueGraceServed) {
        if (!level || !player || !def) return null;
        var id = newInstanceId(def.id);
        var inst = new RaidInstance(id, def, level, player, {
            teamId: teamId || null,
            cohortId: cohortId || id,
            participantUuids: participants || participantSetForPlayers([player]),
            lostParticipantUuids: {},
            cohortInitializing: !!initializing
        });
        if (queued) {
            inst.phase = "QUEUED";
            inst._queueOrder = ++_queueSeq;
            inst._queueReadyAt = queueGraceServed
                ? raidWorldTime(Manager._server)
                : raidWorldTime(Manager._server) + QUEUED_RAID_GRACE_TICKS;
        } else if (def.bossBar !== false) {
            inst.bar = makeBar(Manager._server, inst.id, inst.barBase, def.barColor, def.barOverlay);
        }
        _active[id] = inst;
        return inst;
    }

    function activateRaidInstance(inst, representative) {
        if (!inst || !representative) return false;
        if (inst.phase === "QUEUED") {
            inst.phase = "SPAWNING";
            inst._queueOrder = 0;
            inst._queueReadyAt = 0;
            inst.level = playerLevel(representative) || inst.level;
            inst._ctxPlayer = representative;
            if (inst.def.bossBar !== false) {
                inst.bar = makeBar(
                    Manager._server, inst.id, inst.barBase,
                    inst.def.barColor, inst.def.barOverlay
                );
            }
        }
        inst._cohortInitializing = false;
        onlineParticipants(inst, true);
        eachOnlineParticipant(inst, function (member) {
            playSnd(member, inst.def.sounds.raidStart);
            showTitle(member, "RAID INCOMING", inst.barBase, "red");
            try { member.tell(Text.of("§c⚔ " + inst.barBase + " begins for your raid group...")); }
            catch (eTell) {}
        }, false);
        fireCb(inst.def, "onStart", [inst.ctx(representative)]);
        info(`started shared "${inst.defId}" as ${inst.id} for spatial group ${inst.cohortId}`);
        return true;
    }

    function startSpatialTeamRaid(level, player, def, options) {
        options = options || {};
        var identity = playerTeamIdentity(player);
        if (ownerHasActiveInstance(identity, playerUuidOf(player))) return [];

        var candidates = onlineTeamPlayers(identity, player);
        var groups = spatialPlayerGroups(candidates);
        if (groups.length === 0) groups = [[player]];

        // The command/banner/scheduler caller receives the starter's instance ID.
        // Other distant groups are real simultaneous instances in the same cohort.
        var starterId = playerUuidOf(player);
        groups.sort(function (a, b) {
            var aStarter = groupContainsUuid(a, starterId) ? 1 : 0;
            var bStarter = groupContainsUuid(b, starterId) ? 1 : 0;
            return bStarter - aStarter;
        });

        var created = [];
        var cohortId = "";
        for (var i = 0; i < groups.length; i++) {
            var representative = groups[i][0];
            if (groupContainsUuid(groups[i], starterId)) representative = player;
            var queueThis = runningRaidCount() >= MAX_CONCURRENT_RAIDS;
            var inst = createRaidInstance(
                playerLevel(representative) || level,
                representative,
                def,
                cohortId,
                participantSetForPlayers(groups[i]),
                identity.teamId,
                true,
                queueThis,
                !!options.queueGraceServed
            );
            if (!inst) continue;
            if (!cohortId) cohortId = inst.id;
            inst.cohortId = cohortId;
            created.push({ instance: inst, representative: representative });
        }

        for (var a = 0; a < created.length; a++) {
            created[a].instance._cohortInitializing = false;
            if (created[a].instance.phase === "QUEUED")
                notifyQueuedRaid(created[a].instance);
            else
                activateRaidInstance(created[a].instance, created[a].representative);
        }
        persistActive(Manager._server);
        return created;
    }

    function queuedRepresentative(inst) {
        if (!inst || inst.phase !== "QUEUED") return null;
        refreshTeamRoster(inst);
        if (inst._currentTeamRoster)
            removeFormerTeamMembers(inst, inst._currentTeamRoster);

        var members = explicitOnlineParticipants(inst);
        var fallback = null;
        for (var i = 0; i < members.length; i++) {
            if (!fallback) fallback = members[i];
            if (playerUuidOf(members[i]) === inst.playerUuid) return members[i];
        }
        return fallback;
    }

    // Fill eligible combat slots in FIFO order. An offline or still-preparing
    // entry is preserved but does not block later eligible online groups. This
    // runs only once per second or immediately after a terminal transition,
    // never once per mob/tick.
    function drainQueuedRaids(server) {
        if (!server) return 0;
        var free = Math.max(0, MAX_CONCURRENT_RAIDS - runningRaidCount());
        if (free <= 0) return 0;

        var queued = queuedRaidInstances();
        var now = raidWorldTime(server);
        var started = 0;
        var changed = false;
        for (var i = 0; i < queued.length && free > 0; i++) {
            var inst = queued[i];
            if (!inst || inst.phase !== "QUEUED") continue;
            if (now < Math.max(0, Number(inst._queueReadyAt) || 0)) continue;
            var representative = queuedRepresentative(inst);

            if (participantCount(inst) === 0) {
                inst.phase = "DONE";
                notifyTerminal(inst, "cancelled");
                delete _active[inst.id];
                changed = true;
                continue;
            }
            if (!representative) continue;

            if (activateRaidInstance(inst, representative)) {
                free--;
                started++;
                changed = true;
            }
        }
        if (changed) persistActive(server);
        return started;
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

    // Save the last known position with each UUID. On resume this lets the core
    // load only the few chunks that can actually contain a missing raid mob,
    // instead of treating every entity outside the player's loaded chunks as
    // dead after a fixed timeout.
    function mobRestoreRecords(arr) {
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var id = mobUuid(arr[i]);
            if (!id) continue;
            var record = { uuid: id };
            var x = entityCoord(arr[i], "x", "getX");
            var y = entityCoord(arr[i], "y", "getY");
            var z = entityCoord(arr[i], "z", "getZ");
            if (isFinite(x)) record.x = x;
            if (isFinite(y)) record.y = y;
            if (isFinite(z)) record.z = z;
            out.push(record);
        }
        return out;
    }

    function recordUuidSet(records, fallbackIds) {
        var out = {};
        if (records && typeof records.length === "number") {
            for (var i = 0; i < records.length; i++) {
                var id = records[i] && records[i].uuid;
                if (id) out[normUuid(id)] = true;
            }
        }
        if (fallbackIds && typeof fallbackIds.length === "number") {
            for (var j = 0; j < fallbackIds.length; j++) {
                if (fallbackIds[j]) out[normUuid(fallbackIds[j])] = true;
            }
        }
        return out;
    }

    function restoreLocationMap(roundRecords, carryRecords) {
        var out = {};
        var lists = [roundRecords || [], carryRecords || []];
        for (var li = 0; li < lists.length; li++) {
            for (var i = 0; i < lists[li].length; i++) {
                var r = lists[li][i];
                if (!r || !r.uuid || !isFinite(Number(r.x)) || !isFinite(Number(r.z))) continue;
                out[normUuid(r.uuid)] = {
                    x: Number(r.x),
                    y: isFinite(Number(r.y)) ? Number(r.y) : 0,
                    z: Number(r.z)
                };
            }
        }
        return out;
    }

    function recordsForRestoreSet(set, locations) {
        var out = [];
        for (var id in set) {
            if (!set[id]) continue;
            var loc = locations && locations[id];
            if (loc) out.push({ uuid: id, x: loc.x, y: loc.y, z: loc.z });
            else out.push({ uuid: id });
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
        var roundRecords = mobRestoreRecords(inst.roundMobs);
        var carryRecords = mobRestoreRecords(inst.carryover);
        inst._restoreRoundUuids = recordUuidSet(roundRecords, null);
        inst._restoreCarryUuids = recordUuidSet(carryRecords, null);
        inst._restoreMobLocations = restoreLocationMap(roundRecords, carryRecords);
        inst._restoreExpected = uuidKeys(inst._restoreRoundUuids).length + uuidKeys(inst._restoreCarryUuids).length;
        inst._restoreWait = RESTORE_MOB_WAIT;
        inst._restoreDelay = RESTORE_LOGIN_DELAY;
        inst._restoreScanCooldown = 0;
        inst._restoreChunkQueue = null;
        inst._restoreChunkIndex = 0;
        inst._restoreChunkSettle = 0;
        inst._restoreLegacyWarned = false;
        inst._restoring = true;
        // Do not retain stale Java entity wrappers across a chunk unload/login.
        inst.roundMobs = [];
        inst.carryover = [];
        inst._mobState = {};
    }

    function buildRestoreChunkQueue(inst, seen) {
        var queue = [];
        var added = {};
        var sets = [inst._restoreRoundUuids, inst._restoreCarryUuids];
        for (var si = 0; si < sets.length; si++) {
            var set = sets[si] || {};
            for (var id in set) {
                if (!set[id] || seen[id]) continue;
                var loc = inst._restoreMobLocations && inst._restoreMobLocations[id];
                if (!loc) continue;
                var centerX = Math.floor(Number(loc.x) / 16);
                var centerZ = Math.floor(Number(loc.z) / 16);
                for (var dx = -RESTORE_CHUNK_RADIUS; dx <= RESTORE_CHUNK_RADIUS; dx++) {
                    for (var dz = -RESTORE_CHUNK_RADIUS; dz <= RESTORE_CHUNK_RADIUS; dz++) {
                        var cx = centerX + dx, cz = centerZ + dz;
                        var key = cx + "," + cz;
                        if (added[key]) continue;
                        added[key] = true;
                        queue.push({ x: cx, z: cz });
                    }
                }
            }
        }
        inst._restoreChunkQueue = queue;
        inst._restoreChunkIndex = 0;
        inst._restoreChunkSettle = RESTORE_CHUNK_SETTLE;
    }

    function requestRestoreChunks(inst) {
        var queue = inst._restoreChunkQueue || [];
        var rawLevel = heightLevel(inst.level) || inst.level;
        var requested = 0;
        while (inst._restoreChunkIndex < queue.length && requested < RESTORE_CHUNKS_PER_SCAN) {
            var pos = queue[inst._restoreChunkIndex++];
            try { rawLevel.getChunk(pos.x, pos.z); }
            catch (e) { warn("restore chunk " + pos.x + "," + pos.z + " for " + inst.id + ": " + e); }
            requested++;
        }
        return requested;
    }

    function discardVerifiedMissing(set, seen, locations) {
        var removed = 0;
        for (var id in set) {
            if (!set[id] || seen[id] || !locations || !locations[id]) continue;
            delete set[id];
            delete locations[id];
            removed++;
        }
        return removed;
    }

    function rebindRestoredMobs(inst) {
        if (inst._restoreScanCooldown > 0) {
            inst._restoreScanCooldown -= TICK_THROTTLE;
            if (inst._restoreScanCooldown > 0) return false;
        }
        var round = [], carry = [], matched = 0, seen = {};
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
                    seen[id] = true;
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

        if (matched < inst._restoreExpected) {
            if (inst._restoreChunkQueue == null) buildRestoreChunkQueue(inst, seen);
            if (inst._restoreChunkIndex < inst._restoreChunkQueue.length) {
                requestRestoreChunks(inst);
                inst._restoreScanCooldown = 20;
                return false;
            }
            if (inst._restoreChunkSettle > 0) {
                inst._restoreChunkSettle -= 20;
                inst._restoreScanCooldown = 20;
                return false;
            }

            // Every missing UUID with a saved position has now had its old chunk
            // and all neighboring chunks loaded and rescanned. Only at this point
            // can it be considered genuinely absent. Legacy snapshots had UUIDs
            // only; those remain unresolved instead of creating a false victory.
            var confirmedGone =
                discardVerifiedMissing(inst._restoreRoundUuids, seen, inst._restoreMobLocations) +
                discardVerifiedMissing(inst._restoreCarryUuids, seen, inst._restoreMobLocations);
            if (confirmedGone > 0)
                info("restore " + inst.id + ": confirmed " + confirmedGone + " saved mob(s) absent after chunk verification");
            inst._restoreExpected =
                uuidKeys(inst._restoreRoundUuids).length + uuidKeys(inst._restoreCarryUuids).length;
            if (matched < inst._restoreExpected) {
                if (!inst._restoreLegacyWarned) {
                    inst._restoreLegacyWarned = true;
                    warn("restore " + inst.id + ": waiting for " +
                         (inst._restoreExpected - matched) +
                         " legacy UUID(s) without saved chunk positions");
                }
                inst._restoreScanCooldown = 20;
                return false;
            }
        }

        inst.roundMobs = round;
        inst.carryover = carry;
        inst._restoreRoundUuids = {};
        inst._restoreCarryUuids = {};
        inst._restoreMobLocations = {};
        inst._restoreExpected = 0;
        inst._restoreWait = 0;
        inst._restoreDelay = 0;
        inst._restoreScanCooldown = 0;
        inst._restoreChunkQueue = null;
        inst._restoreChunkIndex = 0;
        inst._restoreChunkSettle = 0;
        inst._restoreLegacyWarned = false;
        inst._mobState = {};
        return true;
    }

    function spatialDepartureCountdownSnapshot(inst) {
        var out = {};
        var records = inst && inst._spatialDepartureCountdowns;
        if (!records) return out;
        for (var uuid in records) {
            if (!inst.participantUuids || !inst.participantUuids[uuid]) continue;
            var remaining = Math.max(
                0,
                Math.min(
                    TEAM_RAID_ESCAPE_SECONDS,
                    Math.ceil(Number(records[uuid] && records[uuid].remaining) || 0)
                )
            );
            if (remaining > 0) out[uuid] = remaining;
        }
        return out;
    }

    function restoredSpatialDepartureCountdowns(saved) {
        var out = {};
        if (!saved || typeof saved !== "object") return out;
        for (var uuid in saved) {
            var remaining = Math.max(
                0,
                Math.min(
                    TEAM_RAID_ESCAPE_SECONDS,
                    Math.ceil(Number(saved[uuid]) || 0)
                )
            );
            if (remaining <= 0) continue;
            out[normUuid(uuid)] = {
                remaining: remaining,
                lastTick: _serverTickClock,
                lastShown: -1
            };
        }
        return out;
    }

    function snapshotInstance(inst) {
        var roundRecords = inst._restoring
            ? recordsForRestoreSet(inst._restoreRoundUuids, inst._restoreMobLocations)
            : mobRestoreRecords(inst.roundMobs);
        var carryRecords = inst._restoring
            ? recordsForRestoreSet(inst._restoreCarryUuids, inst._restoreMobLocations)
            : mobRestoreRecords(inst.carryover);
        var roundIds = [];
        var carryIds = [];
        for (var ri = 0; ri < roundRecords.length; ri++) roundIds.push(roundRecords[ri].uuid);
        for (var ci = 0; ci < carryRecords.length; ci++) carryIds.push(carryRecords[ci].uuid);
        return {
            id: inst.id,
            defId: inst.defId,
            playerUuid: inst.playerUuid,
            teamId: inst.teamId,
            cohortId: inst.cohortId,
            participantUuids: uuidKeys(inst.participantUuids),
            lostParticipantUuids: uuidKeys(inst._lostParticipantUuids),
            spatialDepartureCountdowns: spatialDepartureCountdownSnapshot(inst),
            dimension: levelId(inst.level),
            roundIdx: inst.roundIdx,
            phase: inst.phase,
            queueOrder: Math.max(0, Number(inst._queueOrder) || 0),
            queueReadyAt: inst.phase === "QUEUED"
                ? Math.max(0, Number(inst._queueReadyAt) || 0) : 0,
            spawnRetryLeft: inst.spawnRetryLeft,
            breatherLeft: inst.breatherLeft,
            roundTimeLeft: inst.roundTimeLeft,
            roundTotalHealth: inst.roundTotalHealth,
            roundTotalMobs: inst.roundTotalMobs,
            deathCount: Math.max(0, Number(inst._deathCount) || 0),
            diedDuringRaid: !!inst._diedDuringRaid,
            playerDeathCounts: deathCountMapSnapshot(inst),
            roundMobUuids: roundIds,
            carryoverUuids: carryIds,
            roundMobRecords: roundRecords,
            carryoverMobRecords: carryRecords
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
            inst.playerUuid = normUuid(s.playerUuid);
            inst.teamId = s.teamId ? normUuid(s.teamId) : null;
            inst.cohortId = String(s.cohortId || s.id);
            inst.participantUuids = uuidSet(s.participantUuids || [inst.playerUuid]);
            // Legacy snapshots had no explicit participant list. New snapshots
            // may intentionally exclude the original starter after spatial loss.
            if (!s.participantUuids) inst.participantUuids[inst.playerUuid] = true;
            inst._lostParticipantUuids = uuidSet(s.lostParticipantUuids || []);
            inst._spatialDepartureCountdowns =
                restoredSpatialDepartureCountdowns(s.spatialDepartureCountdowns);
            inst._spatialCountdownDirty = false;
            inst._currentTeamRoster = null;
            inst._cohortInitializing = false;
            inst._onlineParticipants = [];
            inst._teamSyncLeft = 0;
            inst._offlinePrepared = false;
            inst._ctxPlayer = null;
            inst.roundIdx = Math.max(0, Math.min(def.rounds.length - 1, Number(s.roundIdx) || 0));
            inst.phase = String(s.phase || "SPAWNING");
            if (inst.phase !== "QUEUED" && inst.phase !== "SPAWNING" && inst.phase !== "FIGHTING" &&
                inst.phase !== "BREATHER" && inst.phase !== "WIN_WAIT") inst.phase = "SPAWNING";
            inst._queueOrder = (inst.phase === "QUEUED")
                ? Math.max(1, Number(s.queueOrder) || (++_queueSeq))
                : 0;
            inst._queueReadyAt = (inst.phase === "QUEUED")
                ? (s.queueReadyAt != null
                    ? Math.max(0, Number(s.queueReadyAt) || 0)
                    : raidWorldTime(server) + QUEUED_RAID_GRACE_TICKS)
                : 0;
            if (inst._queueOrder > _queueSeq) _queueSeq = inst._queueOrder;
            inst.spawnRetryLeft = Math.max(0, Number(s.spawnRetryLeft) || 0);
            inst.breatherLeft = Math.max(0, Number(s.breatherLeft) || 0);
            inst.roundTimeLeft = (s.roundTimeLeft == null) ? null : Math.max(0, Number(s.roundTimeLeft) || 0);
            inst.roundMobs = [];
            inst.carryover = [];
            inst.bar = (def.bossBar === false || inst.phase === "QUEUED") ? null :
                makeBar(server, inst.id, def.title || prettyId(def.id), def.barColor, def.barOverlay);
            inst._barParticipantKey = null;
            inst._barSyncWarned = false;
            inst._personalDeathBars = {};
            inst._personalDeathBarValues = {};
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
            inst._playerDeathCounts = normalizedDeathCountMap(s.playerDeathCounts);
            // Legacy active snapshots did not record who died. Attribute their
            // aggregate to the original owner instead of unfairly disqualifying
            // every teammate from their personal flawless advancement.
            if (!s.playerDeathCounts && inst._deathCount > 0 && inst.playerUuid) {
                inst._playerDeathCounts[inst.playerUuid] = inst._deathCount;
            }
            inst._restoreRoundUuids = recordUuidSet(s.roundMobRecords, s.roundMobUuids || []);
            inst._restoreCarryUuids = recordUuidSet(s.carryoverMobRecords, s.carryoverUuids || []);
            inst._restoreMobLocations = restoreLocationMap(s.roundMobRecords, s.carryoverMobRecords);
            inst._restoreExpected = uuidKeys(inst._restoreRoundUuids).length + uuidKeys(inst._restoreCarryUuids).length;
            inst._restoreWait = RESTORE_MOB_WAIT;
            inst._restoreDelay = RESTORE_LOGIN_DELAY;
            inst._restoreScanCooldown = 0;
            inst._restoreChunkQueue = null;
            inst._restoreChunkIndex = 0;
            inst._restoreChunkSettle = 0;
            inst._restoreLegacyWarned = false;
            // Queued records never owned mobs, so they need neither chunk loads
            // nor the resume delay. Combat snapshots keep the existing rebind.
            inst._restoring = inst.phase !== "QUEUED";
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
        _queueDrainRequested = true;
        // A spatial subgroup that already finished/stopped must not be pulled
        // into another subgroup of the same cohort by the wave-one early-join
        // reconciler. Reuse the persisted cohort exclusion set; it is scoped to
        // this one cohort and does not affect a later scheduled raid.
        var finishedParticipants = uuidKeys(inst.participantUuids);
        var cohort = cohortInstances(inst);
        for (var ci = 0; ci < cohort.length; ci++) {
            var other = cohort[ci];
            if (!other || other.id === inst.id) continue;
            if (!other._lostParticipantUuids) other._lostParticipantUuids = {};
            for (var pi = 0; pi < finishedParticipants.length; pi++)
                other._lostParticipantUuids[finishedParticipants[pi]] = true;
        }
        var ev = {
            id: inst.id,
            defId: inst.defId,
            playerUuid: inst.playerUuid,
            ownerKey: raidOwnerKeyForInstance(inst),
            cohortId: String(inst.cohortId || inst.id),
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
        var wanted = normUuid(playerUuid);
        for (var k in _active) {
            var inst = _active[k];
            var ph = inst.phase;
            if (ph === "QUEUED" || ph === "DONE" || ph === "ENDING") continue;
            if (inst.participantUuids && inst.participantUuids[wanted]) return inst;
        }
        return null;
    }

    function playerRaidIncludingQueue(playerUuid) {
        var active = playerInRaid(playerUuid);
        if (active) return active;
        var wanted = normUuid(playerUuid);
        for (var k in _active) {
            var inst = _active[k];
            if (!inst || inst.phase !== "QUEUED") continue;
            if (inst.participantUuids && inst.participantUuids[wanted]) return inst;
        }
        return null;
    }

    function killMobs(inst) {
        var killed = 0;
        eachMob(inst, function (e) {
            try {
                if (e && e.isAlive && e.isAlive()) {
                    e.kill();
                    killed++;
                }
            } catch (x) {}
        });
        inst.roundMobs = []; inst.carryover = [];
        return killed;
    }

    // Loss/stop is administrative cleanup, not a combat kill. discard() avoids
    // vanilla loot, equipped-item drops, XP and modded on-death transformations.
    // The tag covers the rare modded entity wrapper that cannot be discarded and
    // has to fall back to kill(); the living-drops hook below then clears its loot.
    const NO_CLEANUP_DROPS_TAG = "raid_cleanup_no_drops";
    function removeMobsNoDrops(inst) {
        var removed = 0;
        eachMob(inst, function (e) {
            if (!e) return;
            var raw = rawMobOf(e) || e;
            var alive = true;
            try { alive = (typeof raw.isAlive === "function") ? raw.isAlive() : !!raw.isAlive; } catch (eAlive) {}
            if (!alive) return;
            try { raw.addTag(NO_CLEANUP_DROPS_TAG); } catch (eTag) {}
            try {
                if (typeof raw.discard === "function") {
                    raw.discard();
                    removed++;
                    return;
                }
            } catch (eDiscard) {}
            try {
                if (typeof e.discard === "function") {
                    e.discard();
                    removed++;
                    return;
                }
            } catch (eWrapperDiscard) {}
            try {
                // Compatibility fallback only; NO_CLEANUP_DROPS_TAG suppresses
                // the living drops generated by this forced death.
                if (typeof raw.kill === "function") raw.kill();
                else e.kill();
                removed++;
            } catch (eKill) {}
        });
        inst.roundMobs = []; inst.carryover = [];
        return removed;
    }

    function cleanupMobs(inst) {
        removeMobsNoDrops(inst);
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

    // A raidfactory bar is owned when it is either the shared raid bar or one
    // of that instance's hidden per-player death-data bars.
    function barOwnedByActive(rl) {
        try {
            var path = String(rl.getPath());
            for (var k in _active) {
                if (_active[k].phase === "DONE" || _active[k].phase === "QUEUED") continue;
                var id = String(_active[k].id);
                if (path === id || path.indexOf(id + PERSONAL_DEATH_BAR_PATH) === 0) return true;
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

        start: function (level, player, defId, options) {
            var def = Registry.get(defId);
            if (!def) { err(`start: unknown raid "${defId}"`); return null; }
            if (!player) { err("start: no player"); return null; }
            var startServer = null;
            try { startServer = player.server; } catch (eSv) {}
            if (startServer) {
                bindRaidServer(startServer);
                // Handles the rare first-world path where ServerEvents.loaded
                // was not delivered to this freshly registered script context.
                restoreActive(startServer);
            }
            // Respect existing FIFO reservations before admitting a brand-new
            // request into a free slot.
            drainQueuedRaids(Manager._server);
            var created = startSpatialTeamRaid(
                level || playerLevel(player), player, def, options || {}
            );
            if (created.length === 0) {
                warn(`start: ${player.username}'s team is already in a raid`);
                return null;
            }
            scheduleRaidDriverWatchdog(Manager._server);
            return created[0].instance.id;
        },

        // Queued reservations count here too, preventing commands/schedulers
        // from adding a duplicate raid while the team waits for a global slot.
        isInRaid: function (player) {
            try { return !!playerRaidIncludingQueue(playerUuidOf(player)); }
            catch (e) { return false; }
        },

        // Scheduler guard: one spatial subgroup finishing must not start the
        // team's next overdue raid while another 500-block subgroup is fighting.
        isOwnerInRaid: function (player) {
            try {
                var identity = playerTeamIdentity(player);
                return ownerHasActiveInstance(identity, playerUuidOf(player));
            } catch (e) { return false; }
        },

        // The day scheduler persists fired/pending state against this key. It is
        // intentionally public so scheduling never has to duplicate FTB API
        // reflection or accidentally treat teammates as separate raids.
        ownerKeyForPlayer: function (player) {
            try { return raidOwnerKeyForPlayer(player); } catch (e) { return ""; }
        },

        hasVictoryAdvancement: function (player, defId) {
            return hasVictoryAdvancement(player, defId);
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

        activeOwnerInstancesForDef: function (defId) {
            var out = [];
            for (var k in _active) {
                var inst = _active[k];
                if (inst.defId !== String(defId) ||
                    inst.phase === "DONE" || inst.phase === "ENDING") continue;
                out.push({ id: inst.id, ownerKey: raidOwnerKeyForInstance(inst) });
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
            else if (playerUuidOf(idOrPlayer))
                inst = playerRaidIncludingQueue(playerUuidOf(idOrPlayer));
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

        // Kill only the mobs owned by the executing player's shared team raid.
        // The instance stays active, so its normal tick advances the wave and
        // keeps rewards, HUD state and scheduling on the regular code path.
        killMobs: function (idOrPlayer) {
            var inst = null;
            if (typeof idOrPlayer === "string") inst = _active[idOrPlayer];
            else if (playerUuidOf(idOrPlayer)) inst = raidForPlayer(idOrPlayer);
            if (!inst || inst.phase === "QUEUED") return -1;
            var killed = killMobs(inst);
            persistActive(Manager._server);
            return killed;
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
                           phase: i.phase, alive: i.aliveCount(),
                           queuePosition: i.phase === "QUEUED" ? queuePosition(i) : 0 });
            }
            return out;
        },

        _drive: function (server) {
            bindRaidServer(server);
            _serverTickClock++;
            _queueCheckAccum++;
            if (!_restoreAttempted) restoreActive(server);
            _persistAccum++;
            if (_persistAccum >= ACTIVE_SAVE_EVERY) {
                _persistAccum = 0;
                if (anyActive()) persistActive(server);
            }
            // These three Born in Chaos classes reignite themselves every entity
            // tick. This targeted pass is intentionally before the shared
            // throttle; all other raid systems retain their 5-tick cadence.
            for (var daylightKey in _active) {
                if (_active[daylightKey].phase !== "QUEUED")
                    strictDaylightGuard(_active[daylightKey]);
            }
            _tickAccum++;
            if (_tickAccum < TICK_THROTTLE) return;
            _tickAccum = 0;
            retryPendingLifestealerForms();
            var done = [];
            for (var k in _active) {
                var inst = _active[k];
                if (inst.phase === "QUEUED") continue;
                try { inst.tick(); } catch (e) { err(`instance ${k} tick: ${e}`); }
                if (inst.phase === "DONE") done.push(k);
            }
            for (var d = 0; d < done.length; d++) delete _active[done[d]];
            if (_queueDrainRequested || _queueCheckAccum >= RAID_QUEUE_CHECK_EVERY) {
                _queueDrainRequested = false;
                _queueCheckAccum = 0;
                drainQueuedRaids(server);
            }
        }
    };

    // ---------- Tick driver -------------------------------------------------

    ServerEvents.tick(function (event) {
        Manager._drive(event.server);
    });

    // Player death never ends a raid. Every death updates both the team total
    // and that player's persisted personal count; flawless uses only the latter.
    EntityEvents.death("minecraft:player", function (event) {
        try {
            var player = event.entity;
            var inst = raidForPlayer(player);
            if (!inst) return;
            inst._deathCount = Math.max(0, Number(inst._deathCount) || 0) + 1;
            inst._diedDuringRaid = true;
            if (!inst._playerDeathCounts) inst._playerDeathCounts = {};
            var uuid = playerUuidOf(player);
            inst._playerDeathCounts[uuid] = personalDeathCount(inst, uuid) + 1;
            // Reuse the existing team/HUD sync; no new tick loop is introduced.
            inst._teamSyncLeft = 0;
            persistActive(player.server || Manager._server);
        } catch (e) { warn("record raid player death: " + e); }
    });

    PlayerEvents.loggedIn(function (event) {
        try {
            deliverPendingTeamWins(event.player);
            var inst = raidForPlayer(event.player);
            if (!inst) {
                var identity = playerTeamIdentity(event.player);
                if (identity.teamId) {
                    for (var key in _active) {
                        var candidate = _active[key];
                        if (!candidate || candidate.phase === "DONE" ||
                            candidate.phase === "ENDING" ||
                            candidate.teamId !== identity.teamId) continue;
                        candidate._teamSyncLeft = 0;
                        refreshTeamRoster(candidate);
                        syncSpatialCohort(candidate);
                        inst = raidForPlayer(event.player);
                        if (inst) break;
                    }
                }
            }
            if (inst) {
                inst._teamSyncLeft = 0;
                inst._barParticipantKey = null;
                onlineParticipants(inst, true);
            }
            // A queued raid whose participant just came online can use a free
            // slot on this pass once its persisted preparation day is complete.
            drainQueuedRaids(event.server || Manager._server);
        } catch (e) { warn("team raid login sync: " + e); }
    });

    // Rebind only when the last teammate in the raid dimension logs out. One
    // member leaving no longer pauses a battle that the rest of the team is
    // still actively fighting.
    PlayerEvents.loggedOut(function (event) {
        try {
            var leaving = playerUuidOf(event.player);
            var inst = raidForPlayer(event.player);
            if (inst) {
                // The logout callback can run after PlayerList already removed
                // this wrapper. Include it explicitly for one final distance
                // check so stepping outside 500 blocks and instantly quitting
                // cannot preserve reward/advancement eligibility.
                refreshTeamRoster(inst);
                var spatialPlayers = onlinePlayersInRoster(
                    inst._currentTeamRoster || inst.participantUuids
                );
                var leavingListed = false;
                for (var sp = 0; sp < spatialPlayers.length; sp++) {
                    if (playerUuidOf(spatialPlayers[sp]) === leaving) {
                        leavingListed = true;
                        break;
                    }
                }
                if (!leavingListed) spatialPlayers.push(event.player);
                enforceSpatialCohesion(inst, spatialPlayers);

                var players = combatParticipants(inst, true);
                var hasOther = false;
                for (var i = 0; i < players.length; i++) {
                    if (playerUuidOf(players[i]) !== leaving) { hasOther = true; break; }
                }
                if (!hasOther) {
                    prepareForRebind(inst);
                    inst._offlinePrepared = true;
                }
                inst._teamSyncLeft = 0;
            }
            persistActive(event.server || Manager._server);
        } catch (e) { warn("logout raid save: " + e); }
    });

    ServerEvents.unloaded(function (event) {
        var unloadingServer = event.server || Manager._server;
        try { persistActive(unloadingServer); }
        catch (e) { warn("shutdown raid save: " + e); }
        // Releasing the in-memory world binding must not depend on the save
        // succeeding; otherwise one failed shutdown write can poison the next
        // IntegratedServer session and recreate the first-world stall.
        try { releaseRaidServer(unloadingServer); }
        catch (eRelease) { warn("shutdown raid release: " + eRelease); }
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

    // Compatibility guard for removeMobsNoDrops(): normal cleanup uses discard()
    // and never reaches this event. If a modded entity only supports kill(), wipe
    // the complete living-drop list while leaving ordinary combat deaths intact.
    EntityEvents.drops(function (event) {
        try {
            var entity = event.entity;
            if (!entity) return;
            var tags = entity.getTags();
            if (!tags || !tags.contains(NO_CLEANUP_DROPS_TAG)) return;
            var drops = event.getDrops();
            try {
                drops.clear();
            } catch (eClear) {
                var it = drops.iterator();
                while (it.hasNext()) {
                    it.next();
                    it.remove();
                }
            }
        } catch (e) { /* cleanup drop protection must never break death handling */ }
    });

    // ---------- Friendly fire off -------------------------------------------
    // Raid mobs never damage each other: any hit where BOTH attacker (or the
    // projectile's owner) and victim carry the raid_mob tag is zeroed, and the
    // victim's retaliation memory is wiped on the spot (setLastHurtByMob runs
    // in LivingEntity.hurt BEFORE this Pre-damage event, so clearing here
    // sticks). Handler early-exits on the no-active-raid flag + victim tag, so
    // ambient combat costs two cheap checks.
    function anyActive() {
        for (var k in _active) {
            var phase = _active[k].phase;
            if (phase !== "QUEUED" && phase !== "ENDING" && phase !== "DONE")
                return true;
        }
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
        bindRaidServer(event.server);
        layoutRaidAdvancements(event.server);
        restoreActive(event.server);
        Manager.sweepOrphans();
        scheduleRaidDriverWatchdog(event.server);
    });

    // ---------- Export ------------------------------------------------------

    global.Raid         = function (id) { return new RaidBuilder(id); };
    global.RaidManager  = Manager;
    global.RaidRegistry = Registry;
    global.RAIDS        = RAIDS;

    console.info("[Raid] core loaded — Raid(), RaidManager, RAIDS ready");
})(this);
