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
            callbacks: {}
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
    RaidBuilder.prototype.onStart      = function (fn) { this.def.callbacks.onStart = fn; return this; };
    RaidBuilder.prototype.onRoundStart = function (fn) { this.def.callbacks.onRoundStart = fn; return this; };
    RaidBuilder.prototype.onRoundEnd   = function (fn) { this.def.callbacks.onRoundEnd = fn; return this; };
    RaidBuilder.prototype.onWin        = function (fn) { this.def.callbacks.onWin = fn; return this; };
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

    function forceTarget(entity, player) {
        if (!player) return;
        try {
            var EAI = getEAI();
            var raw = EAI ? EAI.rawMob(entity) : entity;
            if (raw && typeof raw.setTarget === "function") raw.setTarget(player);
        } catch (e) { /* mob may be dead/unloaded */ }
    }

    // Spawn every mob of a round in a ring around the player. Returns entity refs.
    function spawnRound(level, player, def, round, instanceId) {
        var EAI = getEAI();
        if (!EAI || !player) return [];
        var out = [];
        var pp = player.position();
        var minR = def.spawn.minRadius, maxR = def.spawn.maxRadius;
        var span = Math.max(1, maxR - minR + 1);

        for (var gi = 0; gi < round.mobs.length; gi++) {
            var mob = round.mobs[gi];
            var names = mobPresetNames(def, mob);
            for (var c = 0; c < mob.count; c++) {
                var seq = gi * 31 + c;                       // deterministic spread, no Math.random
                var ang = (seq / Math.max(1, round.mobs.length * mob.count + 1)) * Math.PI * 2;
                var rad = minR + (seq * 13 % span);
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
    }
    RaidInstance.prototype.ctx = function (player) {
        return { player: player || resolvePlayer(this), level: this.level, raid: this.def, instance: this };
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
    RaidInstance.prototype.startRound = function (idx) {
        var round = this.def.rounds[idx];
        var player = resolvePlayer(this) || this._ctxPlayer;
        info(`raid ${this.id}: start round ${idx} "${round.name}"`);
        this.roundMobs = spawnRound(this.level, player, this.def, round, this.id);
        this.roundTimeLeft = (round.timeLimit != null) ? round.timeLimit : null;
        fireCb(this.def, "onRoundStart", [this.ctx(player), round, idx]);
        this.phase = "FIGHTING";
    };
    RaidInstance.prototype.tick = function () {
        var player = resolvePlayer(this) || this._ctxPlayer;
        var round  = this.def.rounds[this.roundIdx];

        switch (this.phase) {
            case "SPAWNING":
                this.startRound(this.roundIdx);
                break;

            case "FIGHTING":
                this.roundMobs = pruneDead(this.roundMobs);
                this.carryover = pruneDead(this.carryover);
                this.aggro(player);

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
                this.aggro(player);
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
                if (this.roundMobs.length === 0 && this.carryover.length === 0) {
                    fireCb(this.def, "onWin", [this.ctx(player)]);
                    this.phase = "DONE";
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
            if (!server || !server.players) return inst._ctxPlayer || null;
            var it = server.players.iterator();
            while (it.hasNext()) {
                var p = it.next();
                if (String(p.uuid) === inst.playerUuid) return p;
            }
        } catch (e) {}
        return null;
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

    function cleanupMobs(inst) {
        var lists = [inst.roundMobs, inst.carryover];
        for (var li = 0; li < lists.length; li++) {
            var arr = lists[li];
            for (var i = 0; i < arr.length; i++) {
                try { if (arr[i] && arr[i].isAlive && arr[i].isAlive()) arr[i].kill(); } catch (e) {}
            }
        }
        inst.roundMobs = []; inst.carryover = [];
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
