# Raid Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A modular raid system for the KubeJS 1.21.1 NeoForge modpack: ordered, non-overlapping rounds of EnhancedAI-driven mobs that ring-spawn around and aggro a target player, with a win-only outcome via callbacks.

**Architecture:** One engine file (`raid_core.js`) exposing `Raid` (fluent builder), `RaidManager`, and `RAIDS`, internally split into Registry / Builder / Spawner / Instance (state machine) / Manager (tick-driven). A commands file (`raid_commands.js`) and a user-editable definitions file (`raid_definitions.js`) consume those globals. Reuses the existing `EnhancedAI` factory verbatim for spawning + AI.

**Tech Stack:** KubeJS (Rhino JS engine), NeoForge 1.21.1, Brigadier commands. Depends on `kubejs/server_scripts/factories/enhancedai_factory.js`.

**Testing adaptation:** No external test runner — Rhino executes only in-game. Automated gate per file = `node --check <file>` (validates syntax only; KubeJS globals like `ServerEvents`/`Java`/`Text` are never executed by `--check`, so undefined-reference is not a concern). Functional verification = in-game `/raid` commands (Task 4).

**Rhino constraints (from `feedback_rhino_quirks`):** Inside any function that can run more than once, use `var` + indexed `for` loops only — `const`/`let` inside `try{}` hoists to a function-scope `var` and throws "redeclaration of var X" on the 2nd call. Top-level (run-once) module constants may use `const`. Template literals (backticks) are supported (the EAI factory uses them).

---

## File Structure

| File | priority | Responsibility |
|------|----------|----------------|
| `kubejs/server_scripts/raids/raid_core.js` | 90 | Engine: utils, Registry, Builder+validation, Spawner, Instance state machine, Manager + `ServerEvents.tick` driver. Exports `Raid`, `RaidManager`, `RaidRegistry`, `RAIDS`. |
| `kubejs/server_scripts/raids/raid_commands.js` | 80 | `/raid start\|stop\|stopall\|list\|status` Brigadier tree. |
| `kubejs/server_scripts/raids/raid_definitions.js` | 70 | Sample raid(s) via the builder + a commented auto/event trigger. User-editable. |

Priorities are all < 100 so they load after `enhancedai_factory.js` (priority 100) and the `EnhancedAI` global is ready.

---

## Task 1: Engine — `raid_core.js`

**Files:**
- Create: `kubejs/server_scripts/raids/raid_core.js`

This is one cohesive IIFE module; it is written as a single complete file because splitting an open IIFE across tasks would leave intermediate invalid syntax. Steps below build it section by section, then syntax-check and commit.

- [ ] **Step 1: Create the file with full content**

Create `kubejs/server_scripts/raids/raid_core.js`:

```js
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
```

- [ ] **Step 2: Syntax-check the file**

Run:
```bash
cd "C:/Users/Alireza/AppData/Roaming/PrismLauncher/instances/1.21.1/minecraft" && node --check kubejs/server_scripts/raids/raid_core.js && echo SYNTAX_OK
```
Expected: prints `SYNTAX_OK` with no parse errors.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Alireza/AppData/Roaming/PrismLauncher/instances/1.21.1/minecraft" && git add kubejs/server_scripts/raids/raid_core.js && git commit -m "feat(raid): add raid factory engine (builder, registry, spawner, instance, manager)"
```

---

## Task 2: Commands — `raid_commands.js`

**Files:**
- Create: `kubejs/server_scripts/raids/raid_commands.js`

Mirrors the Brigadier + `safeExec` patterns already proven in `factories/enhancedai_factory_test.js`.

- [ ] **Step 1: Create the file with full content**

Create `kubejs/server_scripts/raids/raid_commands.js`:

```js
// priority: 80
// kubejs/server_scripts/raids/raid_commands.js
//
// /raid command tree. Depends on RaidManager + RaidRegistry globals (raid_core.js).
//
//   /raid start <id>            start a raid at the executing player
//   /raid start <id> <player>   start a raid targeting a named player
//   /raid stop                  stop the executing player's raid + clean its mobs
//   /raid stopall               stop every active raid
//   /raid list                  list registered raid ids
//   /raid status                list active raids (round/phase/alive)

(function () {
    "use strict";

    function mgr() {
        if (typeof RaidManager === "undefined") { console.error("[Raid-cmd] RaidManager missing"); return null; }
        return RaidManager;
    }
    function reg() { return (typeof RaidRegistry !== "undefined") ? RaidRegistry : null; }
    function playerLevel(player) {
        return (typeof player.level === "function") ? player.level() : player.level;
    }

    ServerEvents.commandRegistry(function (event) {
        var Commands  = event.commands;
        var StringArg = Java.loadClass("com.mojang.brigadier.arguments.StringArgumentType");

        function getPlayer(src) {
            try { return src.getPlayer(); }
            catch (e) { try { return src.getPlayerOrException(); } catch (e2) { return null; } }
        }
        function safeExec(src, fn) {
            try { return fn(); }
            catch (e) {
                console.error("[Raid-cmd] " + e);
                try { src.sendFailure(Text.of("[Raid] " + e)); } catch (eS) {}
                return 0;
            }
        }
        // KubeJS player wrapper by name, via the executing player's server handle.
        function findKjsPlayer(src, name) {
            try {
                var self = getPlayer(src);
                var server = self ? self.server : null;
                if (server && typeof server.getPlayer === "function") return server.getPlayer(name);
            } catch (e) {}
            return null;
        }

        var startNode = Commands.literal("start")
            .then(Commands.argument("id", StringArg.word())
                .executes(function (ctx) { return safeExec(ctx.source, function () {
                    var M = mgr(); if (!M) return 0;
                    var player = getPlayer(ctx.source);
                    if (!player) { ctx.source.sendFailure(Text.of("must be run by/at a player")); return 0; }
                    var id = StringArg.getString(ctx, "id");
                    var iid = M.start(playerLevel(player), player, id);
                    if (iid) player.tell(Text.of("[Raid] started '" + id + "' (" + iid + ")"));
                    else ctx.source.sendFailure(Text.of("[Raid] cannot start '" + id + "' (unknown id, or player already in a raid)"));
                    return iid ? 1 : 0;
                }); })
                .then(Commands.argument("player", StringArg.word())
                    .executes(function (ctx) { return safeExec(ctx.source, function () {
                        var M = mgr(); if (!M) return 0;
                        var id = StringArg.getString(ctx, "id");
                        var pname = StringArg.getString(ctx, "player");
                        var target = findKjsPlayer(ctx.source, pname);
                        if (!target) { ctx.source.sendFailure(Text.of("[Raid] player not found: " + pname)); return 0; }
                        var iid = M.start(playerLevel(target), target, id);
                        if (iid) { try { target.tell(Text.of("[Raid] '" + id + "' started on you!")); } catch (e) {} }
                        else ctx.source.sendFailure(Text.of("[Raid] cannot start '" + id + "' (unknown id, or target already in a raid)"));
                        return iid ? 1 : 0;
                    }); })));

        var stopNode = Commands.literal("stop")
            .executes(function (ctx) { return safeExec(ctx.source, function () {
                var M = mgr(); if (!M) return 0;
                var player = getPlayer(ctx.source);
                if (!player) { ctx.source.sendFailure(Text.of("must be run by a player")); return 0; }
                var ok = M.stop(player);
                player.tell(Text.of(ok ? "[Raid] stopped your raid." : "[Raid] you have no active raid."));
                return ok ? 1 : 0;
            }); });

        var stopAllNode = Commands.literal("stopall")
            .executes(function (ctx) { return safeExec(ctx.source, function () {
                var M = mgr(); if (!M) return 0;
                var n = M.stopAll();
                ctx.source.sendSuccess(Text.of("[Raid] stopped " + n + " raid(s)."), false);
                return 1;
            }); });

        var listNode = Commands.literal("list")
            .executes(function (ctx) { return safeExec(ctx.source, function () {
                var R = reg();
                var ids = R ? R.list() : [];
                ctx.source.sendSuccess(Text.of("[Raid] registered (" + ids.length + "): " + (ids.join(", ") || "<none>")), false);
                return 1;
            }); });

        var statusNode = Commands.literal("status")
            .executes(function (ctx) { return safeExec(ctx.source, function () {
                var M = mgr(); if (!M) return 0;
                var act = M.getActive();
                if (act.length === 0) { ctx.source.sendSuccess(Text.of("[Raid] no active raids."), false); return 1; }
                ctx.source.sendSuccess(Text.of("[Raid] active (" + act.length + "):"), false);
                for (var i = 0; i < act.length; i++) {
                    var a = act[i];
                    ctx.source.sendSuccess(Text.of("  " + a.id + " — round " + a.round + " — " + a.phase + " — alive " + a.alive), false);
                }
                return 1;
            }); });

        var root = Commands.literal("raid")
            .requires(function (src) { return src.hasPermission(4); })
            .then(startNode)
            .then(stopNode)
            .then(stopAllNode)
            .then(listNode)
            .then(statusNode);

        event.register(root);
    });

    console.info("[Raid-cmd] commands registered: /raid start|stop|stopall|list|status");
})();
```

- [ ] **Step 2: Syntax-check the file**

Run:
```bash
cd "C:/Users/Alireza/AppData/Roaming/PrismLauncher/instances/1.21.1/minecraft" && node --check kubejs/server_scripts/raids/raid_commands.js && echo SYNTAX_OK
```
Expected: prints `SYNTAX_OK`.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Alireza/AppData/Roaming/PrismLauncher/instances/1.21.1/minecraft" && git add kubejs/server_scripts/raids/raid_commands.js && git commit -m "feat(raid): add /raid command tree"
```

---

## Task 3: Sample definitions + trigger — `raid_definitions.js`

**Files:**
- Create: `kubejs/server_scripts/raids/raid_definitions.js`

- [ ] **Step 1: Create the file with full content**

Create `kubejs/server_scripts/raids/raid_definitions.js`:

```js
// priority: 70
// kubejs/server_scripts/raids/raid_definitions.js
//
// Sample raid definitions + a commented auto/event trigger. Edit freely — this
// is the user-facing layer. Depends on the Raid builder + RaidManager globals
// (raid_core.js, priority 90). Preset names come from EnhancedAI.presets.

(function () {
    "use strict";

    if (typeof Raid === "undefined") { console.error("[Raid-def] Raid builder missing — raid_core.js not loaded"); return; }

    // ---- Sample: pillager siege, 3 sequential rounds ----------------------
    Raid("pillager_siege")
        .spawn(18, 36)                 // ring 18–36 blocks around the player
        .defaultPresets("farSight")    // every mob sees + hunts the player far away
        .round("Scouts")
            .breather(80)              // 4s pause after this round is cleared
            .timeLimit(2400)           // force-advance after 2 min; survivors carry over
            .mob("minecraft:pillager").count(5).presets("mobile")
            .mob("minecraft:vindicator").count(2).presets("sharpTargeting")
        .round("Assault")
            .breather(100)
            .mob("minecraft:vindicator").count(6).presets("mobile")
            .mob("minecraft:pillager").count(4)
        .round("Warbeast")
            .mob("minecraft:ravager").count(1).extraArgs("attributes/max_health=150", "attributes/movement_speed=0.32")
            .mob("minecraft:evoker").count(1).presets("sharpTargeting")
        .onStart(function (ctx) {
            try { ctx.player.tell(Text.of("§c⚔ The pillager siege begins!")); } catch (e) {}
        })
        .onRoundStart(function (ctx, round, idx) {
            try {
                ctx.player.tell(Text.of("§6Round " + (idx + 1) + ": " + round.name));
                ctx.player.playSound("minecraft:event.raid.horn", 1.0, 1.0);
            } catch (e) {}
        })
        .onWin(function (ctx) {
            try {
                ctx.player.tell(Text.of("§a✔ Siege repelled — you win!"));
                ctx.player.give("minecraft:emerald_block 3");
            } catch (e) {}
        })
        .build();

    // ---- Sample auto/event trigger (commented — enable + adapt) -----------
    // Fires once when a player walks into a region. A tag guard prevents
    // re-triggering. Uncomment to use.
    //
    // PlayerEvents.tick(function (event) {
    //     var player = event.player;
    //     if (!player || player.tags.contains("siege_done")) return;
    //     var p = player.position();
    //     if (p.x > 1000 && p.x < 1100 && p.z > 1000 && p.z < 1100) {
    //         player.addTag("siege_done");
    //         var lvl = (typeof player.level === "function") ? player.level() : player.level;
    //         RaidManager.start(lvl, player, "pillager_siege");
    //     }
    // });

    console.info("[Raid-def] sample raids registered: " +
        (typeof RAIDS !== "undefined" ? Object.keys(RAIDS).join(", ") : "?"));
})();
```

- [ ] **Step 2: Syntax-check the file**

Run:
```bash
cd "C:/Users/Alireza/AppData/Roaming/PrismLauncher/instances/1.21.1/minecraft" && node --check kubejs/server_scripts/raids/raid_definitions.js && echo SYNTAX_OK
```
Expected: prints `SYNTAX_OK`.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Alireza/AppData/Roaming/PrismLauncher/instances/1.21.1/minecraft" && git add kubejs/server_scripts/raids/raid_definitions.js && git commit -m "feat(raid): add sample pillager_siege raid + event trigger template"
```

---

## Task 4: In-game functional verification

**Files:** none (runtime verification inside Minecraft).

No external runner can execute Rhino — this task is the functional gate. Run it in the live instance.

- [ ] **Step 1: Reload scripts**

In-game chat as an operator: `/reload` (or restart the instance). Check the server log / KubeJS console for:
- `[Raid] core loaded — Raid(), RaidManager, RAIDS ready`
- `[Raid-cmd] commands registered: ...`
- `[Raid-def] sample raids registered: pillager_siege`
- No `[Raid]`/Rhino errors (especially no "redeclaration of var").

Expected: all three load lines present, no errors.

- [ ] **Step 2: Registry + validation**

Run: `/raid list`
Expected: `[Raid] registered (1): pillager_siege`.

- [ ] **Step 3: Start a raid + round 1 spawns and aggros**

Run: `/raid start pillager_siege`
Expected: chat shows siege-begin + "Round 1: Scouts", raid horn plays; ~7 mobs (5 pillagers + 2 vindicators) spawn in a ring 18–36 blocks away and path toward you even from across open ground.

- [ ] **Step 4: Status reflects state**

Run: `/raid status`
Expected: one active raid, `round 1/3`, phase `FIGHTING`, `alive` ≈ 7.

- [ ] **Step 5: Sequential rounds (never overlap)**

Kill all round-1 mobs. Wait the breather (~4s).
Expected: only after the last round-1 mob dies does "Round 2: Assault" announce and round-2 mobs spawn. Round 2 never spawns while round-1 mobs are alive. Repeat to confirm round 3 ("Warbeast": 1 ravager + 1 evoker) spawns after round 2 is cleared.

- [ ] **Step 6: Timer carryover (optional but recommended)**

Start a fresh raid. On round 1 (`timeLimit` 2400 = 2 min), do NOT kill everything. After 2 min, confirm round 2 spawns while round-1 survivors are still alive (carryover), and the raid still requires those survivors dead before winning.

- [ ] **Step 7: Win callback**

Clear all rounds (kill every raid mob including carryover).
Expected: "§a✔ Siege repelled — you win!" once, you receive 3 emerald blocks, and `/raid status` shows no active raids.

- [ ] **Step 8: Stop + cleanup**

Start a raid, then run `/raid stop`.
Expected: "stopped your raid", all `raid_<id>`-tagged mobs are removed, `/raid status` shows none. Test `/raid stopall` with a raid active too.

- [ ] **Step 9: Record results**

If any step fails, debug with the systematic-debugging skill before declaring complete. If all pass, note completion.

---

## Self-Review (completed by author)

- **Spec coverage:** triggers (commands ✔ Task 2; event template ✔ Task 3) · fluent builder ✔ Task 1 · sequential rounds + breather + timer carryover ✔ Instance state machine Task 1 / verified Task 4 steps 5–6 · ring-spawn around player ✔ `spawnRound`/`groundY` · single target player ✔ `playerInRaid`/`resolvePlayer` · far-aggro ✔ `farSight` default preset + per-tick `forceTarget` · win callback + lifecycle hooks ✔ `fireCb` + builder `on*` · keep-running on death/disconnect ✔ `resolvePlayer` returns live player or fallback, raid never auto-ends · win-only (no lose) ✔ no lose path exists · EAI reuse ✔ `fromPresets`/`resolveArgs`/`applyDeferred`/`rawMob`.
- **Placeholder scan:** none — every file is given in full.
- **Type/name consistency:** `roundMobs`/`carryover`/`roundTimeLeft`/`breatherLeft`/`phase` used consistently across Instance + Manager; `mobPresetNames`, `pruneDead`, `fireCb`, `resolvePlayer`, `forceTarget`, `spawnRound`, `groundY`, `isAirBlock` each defined once and called with matching signatures; Manager methods `start`/`stop`/`stopAll`/`getActive`/`_drive` match command-file call sites; `Raid`/`RaidManager`/`RaidRegistry`/`RAIDS` exports match consumers.
- **Rhino safety:** all function-internal declarations use `var` + indexed loops; only top-level run-once constants use `const`.
