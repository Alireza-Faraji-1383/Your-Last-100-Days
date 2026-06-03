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

    // ---------- Boss bar (vanilla ServerBossEvent) --------------------------

    var _barCls = null;
    function barClasses() {
        if (_barCls) return _barCls;
        try {
            _barCls = {
                SBE:     Java.loadClass("net.minecraft.server.level.ServerBossEvent"),
                Color:   Java.loadClass("net.minecraft.world.BossEvent$BossBarColor"),
                Overlay: Java.loadClass("net.minecraft.world.BossEvent$BossBarOverlay")
            };
        } catch (e) { err("boss bar classes unavailable: " + e); _barCls = { SBE: null }; }
        return _barCls;
    }
    function enumVal(cls, name, fallback) {
        try { return cls.valueOf(name); } catch (e) {}
        try { return cls.valueOf(fallback); } catch (e2) {}
        return null;
    }
    function makeBar(title, colorName, overlayName) {
        var C = barClasses();
        if (!C.SBE) return null;
        try {
            var bar = new C.SBE(Text.of(title || "Raid"),
                                enumVal(C.Color, colorName || "RED", "RED"),
                                enumVal(C.Overlay, overlayName || "NOTCHED_10", "PROGRESS"));
            bar.setProgress(1.0);
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
    function prettyId(id) {
        var parts = String(id).split("_"), out = [];
        for (var i = 0; i < parts.length; i++) { var w = parts[i]; if (w) out.push(w.charAt(0).toUpperCase() + w.slice(1)); }
        return out.join(" ");
    }
    function playSnd(player, s) {
        if (!player || !s || !s.id) return;
        try { player.playSound(s.id, (s.vol != null ? s.vol : 1.0), (s.pitch != null ? s.pitch : 1.0)); } catch (e) {}
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

    function RaidBuilder(id) {
        this.def = {
            id: id,
            spawn: { minRadius: DEFAULT_MIN_R, maxRadius: DEFAULT_MAX_R },
            defaultPresets: [],
            rounds: [],
            callbacks: {},
            title: null,            // boss bar label (null -> prettified id)
            bossBar: true,          // show a vanilla-style raid boss bar
            barColor: "RED",        // BossBarColor enum name
            barOverlay: "NOTCHED_10",// BossBarOverlay enum name
            barHold: DEFAULT_BAR_HOLD,// ticks victory/defeat bar lingers
            sounds: {                // played to the target player (id null/"" = silent)
                roundStart: { id: "minecraft:event.raid.horn",            vol: 1.0, pitch: 1.0 },
                win:        { id: "minecraft:ui.toast.challenge_complete", vol: 1.0, pitch: 1.0 },
                lose:       { id: "minecraft:entity.ravager.roar",        vol: 1.0, pitch: 0.8 }
            }
        };
        this._round = null;   // current round being configured
        this._mob   = null;   // current mob group being configured
    }
    RaidBuilder.prototype.spawn = function (minR, maxR) {
        this.def.spawn.minRadius = Number(minR);
        this.def.spawn.maxRadius = Number(maxR);
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
        if (this._round) this._round.breather = Number(ticks); else warn("breather() before round()");
        return this;
    };
    RaidBuilder.prototype.timeLimit = function (ticks) {
        if (this._round) this._round.timeLimit = Number(ticks); else warn("timeLimit() before round()");
        return this;
    };
    RaidBuilder.prototype.mob = function (type) {
        if (!this._round) { warn("mob() before round(); opening a default round"); this.round(null); }
        this._mob = { type: String(type), count: 1, presets: [], extraArgs: [], noDefaults: false };
        this._round.mobs.push(this._mob);
        return this;
    };
    RaidBuilder.prototype.count = function (n) {
        if (this._mob) this._mob.count = Math.max(1, parseInt(n, 10) || 1); else warn("count() before mob()");
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
    RaidBuilder.prototype.title      = function (s) { this.def.title = String(s); return this; };
    RaidBuilder.prototype.bossBar    = function (on) { this.def.bossBar = (on !== false); return this; };
    RaidBuilder.prototype.barColor   = function (c) { this.def.barColor = String(c); return this; };
    RaidBuilder.prototype.barOverlay = function (o) { this.def.barOverlay = String(o); return this; };
    RaidBuilder.prototype.barHold    = function (t) { this.def.barHold = Number(t); return this; };
    function _snd(id, vol, pitch) { return { id: (id == null ? "" : String(id)), vol: (vol == null ? 1.0 : Number(vol)), pitch: (pitch == null ? 1.0 : Number(pitch)) }; }
    RaidBuilder.prototype.roundStartSound = function (id, vol, pitch) { this.def.sounds.roundStart = _snd(id, vol, pitch); return this; };
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
        if (!d.rounds || d.rounds.length === 0) { err(`raid "${d.id}": no rounds`); return false; }
        var EAI = getEAI();
        var presetMap = (EAI && EAI.presets) ? EAI.presets : {};
        for (var i = 0; i < d.rounds.length; i++) {
            var r = d.rounds[i];
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

    // Ground Y: scan down from baseY+3 for a non-air block with 2 air above.
    // Best-effort; falls back to baseY.
    function groundY(level, x, baseY, z) {
        try {
            var bx = Math.floor(x), bz = Math.floor(z);
            var topY = Math.floor(baseY) + 3;
            for (var y = topY; y > topY - 14; y--) {
                var below = level.getBlock(bx, y - 1, bz);
                var at    = level.getBlock(bx, y, bz);
                var above = level.getBlock(bx, y + 1, bz);
                if (!isAirBlock(below) && isAirBlock(at) && isAirBlock(above)) return y;
            }
        } catch (e) { warn(`groundY: ${e}`); }
        return Math.floor(baseY);
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

    // Spawn every mob of a round in a ring around the player. Returns entity refs.
    function spawnRound(level, player, def, round, instanceId) {
        var EAI = getEAI();
        if (!EAI || !player) return [];
        var out = [];
        var pp = null;
        try { pp = player.position(); } catch (ePp) { warn(`spawnRound: player.position() failed: ${ePp}`); return []; }
        var minR = def.spawn.minRadius, maxR = def.spawn.maxRadius;
        var span = Math.max(1, maxR - minR + 1);

        // total mob count -> evenly spaced ring angle by global index (no Math.random).
        var total = 0;
        for (var ti = 0; ti < round.mobs.length; ti++) total += round.mobs[ti].count;
        if (total < 1) total = 1;
        var idx = 0;

        for (var gi = 0; gi < round.mobs.length; gi++) {
            var mob = round.mobs[gi];
            var names = mobPresetNames(def, mob);
            for (var c = 0; c < mob.count; c++) {
                var ang = (idx / total) * Math.PI * 2;
                var rad = minR + ((idx * 13) % span);
                idx++;
                var x = pp.x + Math.cos(ang) * rad;
                var z = pp.z + Math.sin(ang) * rad;
                var y = groundY(level, x, pp.y, z);

                var entity = EAI.fromPresets(level, mob.type, names, mob.extraArgs);
                if (!entity) { err(`spawnRound: fromPresets returned null for ${mob.type}`); continue; }
                try { entity.setPos(x + 0.5, y, z + 0.5); } catch (eP) { warn(`setPos: ${eP}`); }
                try { entity.addTag("raid_mob"); } catch (e1) {}
                try { entity.addTag("raid_" + instanceId); } catch (e2) {}
                try { entity.setPersistenceRequired(); } catch (e3) {}
                try { entity.setCustomName(Text.of("[" + round.name + "]")); } catch (e4) {}
                try { entity.spawn(); }
                catch (eSp) { err(`spawn failed ${mob.type}: ${eSp}`); continue; }
                try { EAI.applyDeferred(level, entity, EAI.resolveArgs(names, mob.extraArgs)); }
                catch (eD) { warn(`applyDeferred: ${eD}`); }
                forceTarget(entity, player);
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
    }
    // Freeze the bar on an end state (victory green / defeat red) before it closes.
    RaidInstance.prototype.barEnd = function (name, colorName, progress) {
        if (!this.bar) return;
        try { this.bar.setName(Text.of(name)); } catch (e) {}
        if (colorName) { var C = barClasses(); try { this.bar.setColor(enumVal(C.Color, colorName, "RED")); } catch (e2) {} }
        try { this.bar.setProgress(progress); } catch (e3) {}
    };
    RaidInstance.prototype.lose = function (player) {
        killMobs(this);
        playSnd(player, this.def.sounds.lose);
        fireCb(this.def, "onLose", [this.ctx(player)]);
        this.barEnd("§4§l✖ DEFEATED", "RED", 0.0);
        this.endLeft = this.def.barHold || DEFAULT_BAR_HOLD;
        this.phase = "ENDING";
    };
    RaidInstance.prototype.barRoundName = function (round, idx) {
        if (!this.bar) return;
        var n = this.def.rounds.length;
        try { this.bar.setName(Text.of("§c" + this.barBase + " §7— " + round.name + " (" + (idx + 1) + "/" + n + ")")); } catch (e) {}
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
        try { this.bar.removeAllPlayers(); } catch (e) {}
        this.bar = null;
    };
    RaidInstance.prototype.ctx = function (player) {
        return { player: player || resolvePlayer(this) || this._ctxPlayer, level: this.level, raid: this.def, instance: this };
    };
    RaidInstance.prototype.aggro = function (player) {
        if (!player) return;
        var lists = [this.roundMobs, this.carryover];
        for (var li = 0; li < lists.length; li++) {
            var arr = lists[li];
            for (var i = 0; i < arr.length; i++) forceTarget(arr[i], player);
        }
    };
    RaidInstance.prototype.aliveCount = function () {
        return pruneDead(this.roundMobs).length + pruneDead(this.carryover).length;
    };
    RaidInstance.prototype.startRound = function (idx, player) {
        var round = this.def.rounds[idx];
        info(`raid ${this.id}: start round ${idx} "${round.name}"`);
        this.roundMobs = spawnRound(this.level, player, this.def, round, this.id);
        this.roundTimeLeft = (round.timeLimit != null) ? round.timeLimit : null;
        this.roundTotalHealth = Math.max(1, sumMax(this.roundMobs) + sumMax(this.carryover));
        this.barRoundName(round, idx);
        this.updateBar(player);
        playSnd(player, this.def.sounds.roundStart);
        fireCb(this.def, "onRoundStart", [this.ctx(player), round, idx]);
        this.phase = "FIGHTING";
    };
    RaidInstance.prototype.tick = function () {
        var player = resolvePlayer(this);   // live player wrapper, or null if offline
        var round  = this.def.rounds[this.roundIdx];

        // Lose condition: the target player dies mid-raid (online but not alive).
        if (player && this.phase !== "ENDING" && this.phase !== "DONE") {
            var alive = true;
            try { alive = (typeof player.isAlive === "function") ? player.isAlive() : player.isAlive; } catch (eAlive) {}
            if (!alive) { this.lose(player); return; }
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
                this.startRound(this.roundIdx, player);
                break;

            case "FIGHTING":
                this.roundMobs = pruneDead(this.roundMobs);
                this.carryover = pruneDead(this.carryover);
                this.aggro(player);
                this.updateBar(player);

                if (this.roundMobs.length === 0) {
                    fireCb(this.def, "onRoundEnd", [this.ctx(player), round, this.roundIdx]);
                    if (this.roundIdx + 1 < this.def.rounds.length) {
                        this.breatherLeft = round.breather;
                        this.phase = "BREATHER";
                    } else {
                        this.phase = "WIN_WAIT";
                    }
                } else if (this.roundTimeLeft != null) {
                    this.roundTimeLeft -= TICK_THROTTLE;
                    if (this.roundTimeLeft <= 0) {
                        for (var i = 0; i < this.roundMobs.length; i++) this.carryover.push(this.roundMobs[i]);
                        this.roundMobs = [];
                        fireCb(this.def, "onRoundEnd", [this.ctx(player), round, this.roundIdx]);
                        if (this.roundIdx + 1 < this.def.rounds.length) {
                            this.roundIdx++;
                            this.phase = "SPAWNING";   // no breather on a timer force-advance
                        } else {
                            this.phase = "WIN_WAIT";
                        }
                    }
                }
                break;

            case "BREATHER":
                this.carryover = pruneDead(this.carryover);
                this.aggro(player);
                if (this.bar) { try { this.bar.setName(Text.of("§c" + this.barBase + " §7— next wave incoming…")); } catch (e) {} }
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
                this.updateBar(player);
                if (this.roundMobs.length === 0 && this.carryover.length === 0) {
                    fireCb(this.def, "onWin", [this.ctx(player)]);
                    playSnd(player, this.def.sounds.win);
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

    function fireCb(def, name, cbArgs) {
        var fn = def.callbacks[name];
        if (typeof fn !== "function") return;
        try { fn.apply(null, cbArgs); }
        catch (e) { err(`callback ${name} threw: ${e}`); }
    }

    // Live player by UUID from the current server player list; null if offline.
    function resolvePlayer(inst) {
        try {
            var server = Manager._server;
            if (!server || !server.players) return null;
            var it = server.players.iterator();
            while (it.hasNext()) {
                var p = it.next();
                if (String(p.uuid) === inst.playerUuid) return p;
            }
        } catch (e) {}
        return null;   // offline / not found — callers handle null (SPAWNING waits, aggro no-ops)
    }

    // ---------- Manager -----------------------------------------------------

    const _active = {};        // instanceId -> RaidInstance
    var _idSeq    = 0;
    var _tickAccum = 0;

    function newInstanceId(defId) { _idSeq++; return defId + "_" + _idSeq; }

    function playerInRaid(playerUuid) {
        for (var k in _active) {
            if (_active[k].playerUuid === playerUuid && _active[k].phase !== "DONE") return _active[k];
        }
        return null;
    }

    function killMobs(inst) {
        var lists = [inst.roundMobs, inst.carryover];
        for (var li = 0; li < lists.length; li++) {
            var arr = lists[li];
            for (var i = 0; i < arr.length; i++) {
                try { if (arr[i] && arr[i].isAlive && arr[i].isAlive()) arr[i].kill(); } catch (e) {}
            }
        }
        inst.roundMobs = []; inst.carryover = [];
    }

    function cleanupMobs(inst) {
        killMobs(inst);
        inst.closeBar();
    }

    const Manager = {
        _server: null,

        start: function (level, player, defId) {
            var def = Registry.get(defId);
            if (!def) { err(`start: unknown raid "${defId}"`); return null; }
            if (!player) { err("start: no player"); return null; }
            var puid = String(player.uuid);
            if (playerInRaid(puid)) { warn(`start: ${player.username} already in a raid`); return null; }
            var id = newInstanceId(defId);
            var inst = new RaidInstance(id, def, level || playerLevel(player), player);
            if (def.bossBar !== false) {
                inst.bar = makeBar(inst.barBase, def.barColor, def.barOverlay);
                if (inst.bar) { try { inst.bar.addPlayer(player); } catch (eB) {} }
            }
            _active[id] = inst;
            fireCb(def, "onStart", [inst.ctx(player)]);
            info(`started "${defId}" as ${id} for ${player.username}`);
            return id;
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
            return n;
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

    // ---------- Export ------------------------------------------------------

    global.Raid         = function (id) { return new RaidBuilder(id); };
    global.RaidManager  = Manager;
    global.RaidRegistry = Registry;
    global.RAIDS        = RAIDS;

    console.info("[Raid] core loaded — Raid(), RaidManager, RAIDS ready");
})(this);
