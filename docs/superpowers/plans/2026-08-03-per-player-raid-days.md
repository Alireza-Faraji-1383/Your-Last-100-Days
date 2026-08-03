# Per-Player Raid Days Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive every scheduled raid off the number of Minecraft days *that player* has been present on the server, instead of the world's day counter.

**Architecture:** A new `player_days.js` module owns a per-UUID "play day" counter stored in `server.persistentData`. `raid_schedule.js` swaps its per-FTB-Team `fired/pending` ledger for a per-player-UUID ledger and asks `PlayerDays` for eligibility instead of reading the world day. Raid *instances* stay exactly as they are (FTB Team + 500-block spatial grouping in `raid_core.js`); the only core change is that the terminal event now reports the participant roster so every player who finished the fight gets the scheduled raid ticked off.

**Tech Stack:** KubeJS (Rhino JS engine), NeoForge 1.21.1, Brigadier commands. No build step; scripts load from `kubejs/server_scripts/`.

## Global Constraints

- **Rhino quirk:** inside any function that can run more than once, use `var` + indexed `for` loops only. `const`/`let` inside `try {}` hoists to a function-scope `var` and throws `redeclaration of var X` on the 2nd call. Top-level (run-once) module constants may use `const`.
- **No test runner exists.** The automated gate per file is `node --check <file>` (syntax only — KubeJS globals such as `ServerEvents`, `Java`, `Text` are never executed by `--check`). Functional verification is in-game via commands (Task 6).
- **All player-facing strings are English**, matching the existing raid strings (`RAID TONIGHT`, `Prepare armor, food, healing and defenses.`).
- **No migration, no legacy compatibility.** The modpack is not published yet. Every player starts at play day 0 and every scheduled raid starts un-ticked. All `_team_states_v2` / v1 legacy code is deleted rather than migrated.
- **Storage lives in `server.persistentData`, never `player.persistentData`.** A raid can end while a participant is offline (see `PlayerEvents.loggedOut` in `raid_core.js` and `deliverPendingTeamWins`), and offline player NBT is not writable from KubeJS.
- **The world day is never a decision input.** It is read in exactly two places, both as mechanism: (1) detecting that the day rolled over so a play day can be counted, (2) `timeOfDay >= 13000` to know it is night.
- **Do not touch** `kubejs/server_scripts/quests/ftbquests_day_spine.js` (team quest stages stay on world day), `raid_blood_moon_guard.js`, or the `tools/y100d-raid-hud` mod.
- **Line numbers in this plan are indicative only.** `raid_core.js` is ~5.6k lines and is edited frequently; always locate the anchor text quoted in each step, not the line number.

---

## Behaviour Specification

The rules below were agreed with the modpack owner. Implement exactly these — no extra guards, no grace periods, no rate limits.

1. **Counting.** A player's `playDays` increments by 1 whenever they are online and the overworld day number differs from the last one counted for them. Comparison is `!==`, not `>`, so `/time set` moving the world backwards still burns a day rather than freezing the counter. Any fraction of a day counts as a full day.
2. **First sighting.** A player seen for the first time is set to `playDays = 1`.
3. **Offline freezes the counter.** A player with 8 days who is away for 10 world days and logs in once has 9 days, not 18.
4. **Eligibility.** The raid scheduled for day `N` fires for a player when `playDays >= N`. If `playDays === N`, wait for night (`timeOfDay >= 13000`). If `playDays > N` (they were offline that night), fire at the next 5-second check regardless of time of day — this is the existing catch-up behaviour and must be preserved.
5. **No chains are possible.** Reaching play day 20 requires 10 more online days, and the day-10 raid fires on the first of them. At most one overdue raid can ever exist. Do not add a per-day cap.
6. **Ledger is per player UUID**, not per team.
7. **Instances stay shared.** `RaidManager.start()` still builds the FTB Team + 500-block spatial group. Do not change grouping.
8. **Terminal ticks everybody.** When an instance ends (win **or** loss — matching current behaviour), every UUID on `inst.participantUuids` gets `fired = true` for that scheduled raid. A veteran who already cleared day 10 and helped a newer teammate keeps `fired = true` and receives the rewards again; that is intended.
9. **Worked example.** You are on play day 10, your friend is on play day 9, your raid fires, they join the shared instance, you win: both get day 10 ticked. The next night, no day-10 raid for your friend.
10. **Worked example.** Server is on world day 100. A new player joins; they fight the day-10 raid when the server reaches world day 109, assuming they were online continuously.
11. **Joining for five seconds once per Minecraft day still earns a day.** This is accepted: a continuously-online player earns days at the exact same rate (one per 20 real minutes), so it grants no speed advantage.

---

## File Structure

| File | priority | Responsibility |
|------|----------|----------------|
| `kubejs/server_scripts/raids/player_days.js` | 86 | **New.** Owns the `y100d_player_days` store and the `PlayerDays` global. Sole reader/writer of the play-day counter. |
| `kubejs/server_scripts/raids/raid_schedule.js` | 85 | **Rewritten.** Per-player `fired/pending` ledger, eligibility via `PlayerDays`, legacy code deleted. |
| `kubejs/server_scripts/raids/raid_core.js` | 90 | **3 small edits.** Expose `uuidOf`, add `participantUuids` to the terminal event, add `playerUuid` to `activeOwnerInstancesForDef`. |
| `kubejs/server_scripts/raids/raid_commands.js` | 80 | **Extended.** `/raid days` and `/raid done` admin branches. |
| `kubejs/server_scripts/raids/raid_player_commands.js` | 80 | **New.** `/myday` and `/myraids`, permission level 0. Kept out of `raid_commands.js` because the whole `/raid` tree sits behind `hasRaidAdminPermission` and mixing a public command into that file risks a permission mistake. |
| `docs/raid-reference.md` | — | Command table + play-day explanation. |

Load order matters: `raid_core.js` (90) → `player_days.js` (86) → `raid_schedule.js` (85) → command files (80).

---

## Task 1: `player_days.js` — the play-day counter

**Files:**
- Create: `kubejs/server_scripts/raids/player_days.js`

**Interfaces:**
- Consumes: nothing (this is the base layer).
- Produces: global `PlayerDays` with
  - `PlayerDays.uuidOf(player) -> string` (lowercase UUID, `""` on failure)
  - `PlayerDays.touch(server, player) -> number` — counts a day if the world day rolled over, returns the player's current play day
  - `PlayerDays.touchAll(server) -> number` — `touch` for every online player, returns how many counters advanced
  - `PlayerDays.get(server, uuid) -> number` — read-only, `0` for an unknown UUID
  - `PlayerDays.set(server, uuid, days) -> boolean` — admin override; also stamps the current world day so the next rollover counts normally
  - `PlayerDays.snapshot(server) -> object` — `{ "<uuid>": { d: <days>, w: <lastWorldDay> } }` copy for listings

- [ ] **Step 1: Create the file with full content**

Create `kubejs/server_scripts/raids/player_days.js`:

```js
// priority: 86
// kubejs/server_scripts/raids/player_days.js
//
// Per-player Minecraft-day counter ("play days").
//
// The raid schedule is driven by how many Minecraft days a PLAYER has been
// present, not by the world's day count. A player who joins a world that is
// already on day 100 fights the day 10 raid once they personally have 10 days.
//
// Counting rule: while a player is online, whenever the overworld day number
// differs from the last one counted for them, add one day. Any fraction of a
// day counts as a whole day; being offline freezes the counter completely.
// The comparison is !== rather than > so that /time set moving the world
// backwards burns a day instead of freezing the counter forever.
//
// The store lives in server.persistentData, NOT player.persistentData: a raid
// can end while a participant is offline (raid_core.js PlayerEvents.loggedOut
// keeps nearby leavers on the roster and deliverPendingTeamWins pays them on
// their next login), and offline player NBT is not writable from KubeJS.
//
// Rhino quirk (same as raid_core.js): every function-internal declaration uses
// var + indexed for-loops.

(function (global) {
    "use strict";

    var STORE_KEY = "y100d_player_days";

    var _cache = null;    // { "<uuid>": { d: playDays, w: lastCountedWorldDay } }
    var _server = null;

    function warn(message) { console.warn("[PlayerDays] " + message); }

    function pickServer(server) {
        if (server) return server;
        return _server;
    }

    function worldDay(server) {
        try {
            var overworld = server.overworld();
            var time = (typeof overworld.getDayTime === "function")
                ? overworld.getDayTime() : overworld.dayTime;
            return Math.floor(Number(time) / 24000);
        } catch (e) { return 0; }
    }

    function normUuid(value) {
        return String(value == null ? "" : value).toLowerCase();
    }

    // KubeJS hands out either an enhanced ServerPlayer or a wrapper depending on
    // the call site, exactly like raid_core.js playerUuidOf.
    function uuidOf(player) {
        if (!player) return "";
        if (typeof player === "string") return normUuid(player);
        try { if (player.uuid != null) return normUuid(player.uuid); } catch (e) {}
        try {
            if (typeof player.getUUID === "function") return normUuid(player.getUUID());
        } catch (e2) {}
        return "";
    }

    function load(server) {
        if (_cache) return _cache;
        _cache = {};
        if (!server || !server.persistentData) return _cache;
        try {
            var raw = String(server.persistentData.getString(STORE_KEY) || "");
            if (!raw) return _cache;
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") return _cache;
            for (var key in parsed) {
                var entry = parsed[key];
                if (!entry || typeof entry !== "object") continue;
                _cache[normUuid(key)] = {
                    d: Math.max(0, Math.floor(Number(entry.d) || 0)),
                    w: Math.floor(Number(entry.w) || 0)
                };
            }
        } catch (e) {
            warn("read store: " + e);
            _cache = {};
        }
        return _cache;
    }

    function save(server) {
        if (!server || !server.persistentData) return false;
        try {
            server.persistentData.putString(STORE_KEY, JSON.stringify(load(server)));
            return true;
        } catch (e) {
            warn("write store: " + e);
            return false;
        }
    }

    function touch(server, player) {
        server = pickServer(server);
        if (!server) return 0;
        var uuid = uuidOf(player);
        if (!uuid) return 0;
        var store = load(server);
        var today = worldDay(server);
        var entry = store[uuid];
        if (!entry) {
            store[uuid] = { d: 1, w: today };
            save(server);
            console.info("[PlayerDays] first sighting of " + uuid + " -> day 1");
            return 1;
        }
        if (entry.w !== today) {
            entry.d = entry.d + 1;
            entry.w = today;
            save(server);
        }
        return entry.d;
    }

    function touchAll(server) {
        server = pickServer(server);
        if (!server) return 0;
        var advanced = 0;
        try {
            var it = server.players.iterator();
            while (it.hasNext()) {
                var player = it.next();
                if (!player) continue;
                var uuid = uuidOf(player);
                if (!uuid) continue;
                var store = load(server);
                var before = store[uuid] ? store[uuid].d : -1;
                if (touch(server, player) !== before) advanced++;
            }
        } catch (e) { warn("touchAll: " + e); }
        return advanced;
    }

    var PlayerDays = {
        uuidOf: uuidOf,

        touch: touch,

        touchAll: touchAll,

        get: function (server, uuid) {
            server = pickServer(server);
            if (!server) return 0;
            var key = uuidOf(uuid);
            if (!key) return 0;
            var entry = load(server)[key];
            return entry ? entry.d : 0;
        },

        set: function (server, uuid, days) {
            server = pickServer(server);
            if (!server) return false;
            var key = uuidOf(uuid);
            if (!key) return false;
            var value = Math.max(0, Math.floor(Number(days)));
            if (!(value >= 0)) return false;
            var store = load(server);
            store[key] = { d: value, w: worldDay(server) };
            return save(server);
        },

        snapshot: function (server) {
            server = pickServer(server);
            if (!server) return {};
            var store = load(server);
            var out = {};
            for (var key in store) out[key] = { d: store[key].d, w: store[key].w };
            return out;
        }
    };

    // Drop the cache on world load so a /reload or a different world cannot
    // serve stale counters; the next read re-parses server.persistentData.
    ServerEvents.loaded(function (event) {
        _server = event.server;
        _cache = null;
    });

    // Counting itself is driven by raid_schedule.js (one pass every 5 seconds).
    // Capturing the server here keeps PlayerDays usable from command handlers
    // that only have a CommandSourceStack.
    ServerEvents.tick(function (event) {
        _server = event.server;
    });

    global.PlayerDays = PlayerDays;
    console.info("[PlayerDays] ready - per-player Minecraft-day counter");
})(this);
```

- [ ] **Step 2: Syntax check**

Run: `node --check kubejs/server_scripts/raids/player_days.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add kubejs/server_scripts/raids/player_days.js
git commit -m "feat(raids): add per-player Minecraft-day counter"
```

---

## Task 2: `raid_core.js` — expose what the scheduler needs

Three surgical edits. Nothing else in this 5.6k-line file changes. **Find the anchor text; do not trust line numbers.**

**Files:**
- Modify: `kubejs/server_scripts/raids/raid_core.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RaidManager.uuidOf(player) -> string` — the same lowercase normalisation used for `participantUuids` keys
  - terminal event gains `participantUuids: string[]` — the roster at the moment the instance ended
  - `RaidManager.activeOwnerInstancesForDef(defId)` entries gain `playerUuid: string` — the UUID of the player the instance was started for

- [ ] **Step 1: Add `uuidOf` to the Manager API**

Find:

```js
        // Shared utilities reused by raid_commands.js (avoids duplicating them there).
        playerLevel: playerLevel,
        findOnlinePlayer: findOnlinePlayer,
```

Replace with:

```js
        // Shared utilities reused by raid_commands.js (avoids duplicating them there).
        playerLevel: playerLevel,
        findOnlinePlayer: findOnlinePlayer,

        // raid_schedule.js keys its per-player ledger with this exact
        // normalisation, so schedule keys and participantUuids keys always match.
        uuidOf: playerUuidOf,
```

- [ ] **Step 2: Add the participant roster to the terminal event**

Find:

```js
        var ev = {
            id: inst.id,
            defId: inst.defId,
            playerUuid: inst.playerUuid,
            ownerKey: raidOwnerKeyForInstance(inst),
            cohortId: String(inst.cohortId || inst.id),
            outcome: String(outcome || "ended")
        };
```

Replace with:

```js
        var ev = {
            id: inst.id,
            defId: inst.defId,
            playerUuid: inst.playerUuid,
            ownerKey: raidOwnerKeyForInstance(inst),
            cohortId: String(inst.cohortId || inst.id),
            outcome: String(outcome || "ended"),
            // Everyone still on the roster when the fight ended - i.e. exactly
            // the players who earn the rewards, including a nearby teammate who
            // logged out mid-fight and gets paid by deliverPendingTeamWins.
            // raid_schedule.js ticks the scheduled raid off for all of them.
            participantUuids: finishedParticipants
        };
```

`finishedParticipants` is already computed a few lines above as `uuidKeys(inst.participantUuids)` — reuse it, do not recompute.

- [ ] **Step 3: Add `playerUuid` to the active-instance listing**

Find:

```js
                out.push({ id: inst.id, ownerKey: raidOwnerKeyForInstance(inst) });
```

Replace with:

```js
                out.push({
                    id: inst.id,
                    ownerKey: raidOwnerKeyForInstance(inst),
                    playerUuid: normUuid(inst.playerUuid)
                });
```

Scheduler recovery uses `playerUuid` to reconnect a restored instance to the per-player `pending` transaction that started it.

- [ ] **Step 4: Syntax check**

Run: `node --check kubejs/server_scripts/raids/raid_core.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add kubejs/server_scripts/raids/raid_core.js
git commit -m "feat(raids): expose participant roster and starter uuid to the scheduler"
```

---

## Task 3: `raid_schedule.js` — per-player ledger

This replaces the file wholesale. The old per-FTB-Team ledger (`_team_states_v2`), the v1 legacy keys (`legacyKey`, `legacyPendingKey`), and `migrateLegacyWinner` are all deleted — there is nothing to migrate.

**Files:**
- Rewrite: `kubejs/server_scripts/raids/raid_schedule.js`

**Interfaces:**
- Consumes: `PlayerDays` (Task 1); `RaidManager.uuidOf`, `.start`, `.playerLevel`, `.isOwnerInRaid`, `.onTerminal`, `.activeOwnerInstancesForDef` (Task 2).
- Produces: global `RaidSchedule` with
  - `RaidSchedule.onDay(day, raidId) -> boolean` (unchanged signature; `day_0N0.js` files already call it)
  - `RaidSchedule.list() -> [{ day, raidId, firedPlayers }]`
  - `RaidSchedule.entries() -> [{ day, raidId, title }]` sorted by day
  - `RaidSchedule.statusForUuid(uuid) -> [{ day, raidId, title, fired, pending }]` sorted by day
  - `RaidSchedule.setFired(uuid, raidId, value) -> boolean`
  - `RaidSchedule.reset(raidId) -> number`

- [ ] **Step 1: Confirm the callers this file must keep satisfying**

Run: `grep -rn "RaidSchedule\." kubejs/server_scripts/`
Expected: only `onDay(...)` calls from `kubejs/server_scripts/raids/day_0*.js` and `day_100.js`. If anything else appears, keep that method working too.

- [ ] **Step 2: Replace the whole file**

Overwrite `kubejs/server_scripts/raids/raid_schedule.js` with:

```js
// priority: 85
// Per-player day/night scheduler for the custom raids.
//
// Every scheduled raid carries independent fired/pending state for every PLAYER
// UUID. Eligibility comes from that player's own Minecraft-day counter
// (player_days.js) - the world day is never a decision input. A player who
// joins a world already on day 100 therefore fights the day 10 raid once they
// personally have been present for 10 Minecraft days.
//
// Raid instances themselves stay team- and distance-shared (raid_core.js:
// FTB Team + 500-block spatial groups). When an instance ends - win or loss -
// every UUID still on its participant roster gets that scheduled raid ticked
// off. A veteran who already cleared the raid and only helped a newer teammate
// keeps fired = true and receives the rewards again; that is intended.
//
// State is a small JSON object per scheduled raid in server.persistentData:
//   raidsched_day<N>_<raidId>_player_states_v1
//     = { "<uuid>": { fired, pending, instanceIds } }
//
// Night begins at tick 13000. A raid whose day equals the player's current play
// day starts at night. A raid the player is already past (they were offline
// that night) starts at the next 5-second check, at any time of day, so logging
// out can never permanently skip it. At most one raid can ever be overdue:
// reaching play day 20 requires ten more online days, and the day 10 raid fires
// on the first of them.
//
// Depends on RaidManager (raid_core.js, priority 90) and PlayerDays
// (player_days.js, priority 86); both load first.
(function (global) {
    "use strict";

    var CHECK_EVERY = 100;   // one small online-player pass every 5 seconds
    var NIGHT_START = 13000;
    var STATE_SUFFIX = "_player_states_v1";
    var _accum = 0;
    var _schedule = [];
    var _server = null;
    var _recovered = false;

    function warn(message) { console.warn("[RaidSched] " + message); }

    function stateKey(s) {
        return "raidsched_day" + s.day + "_" + s.raidId + STATE_SUFFIX;
    }
    function warningKey(s) {
        return "raidwarn_day" + s.day + "_" + s.raidId;
    }

    function emptyStates() { return {}; }

    function loadStates(server, s) {
        if (s.statesLoaded) return s.states;
        s.statesLoaded = true;
        s.states = emptyStates();
        if (!server || !server.persistentData) return s.states;
        try {
            var raw = String(server.persistentData.getString(stateKey(s)) || "");
            if (!raw) return s.states;
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") return s.states;
            for (var uuid in parsed) {
                var old = parsed[uuid];
                if (!old || typeof old !== "object") continue;
                var ids = [];
                if (old.instanceIds && typeof old.instanceIds.length === "number") {
                    for (var ii = 0; ii < old.instanceIds.length; ii++)
                        if (old.instanceIds[ii]) ids.push(String(old.instanceIds[ii]));
                }
                s.states[String(uuid).toLowerCase()] = {
                    fired: !!old.fired,
                    pending: !!old.pending,
                    instanceIds: ids
                };
            }
        } catch (e) {
            warn("read player state for " + s.raidId + ": " + e);
            s.states = emptyStates();
        }
        return s.states;
    }

    function saveStates(server, s) {
        if (!server || !server.persistentData) return false;
        var states = loadStates(server, s);
        try {
            var any = false;
            for (var key in states) {
                if (states[key] && (states[key].fired || states[key].pending)) {
                    any = true;
                    break;
                }
            }
            if (any) server.persistentData.putString(stateKey(s), JSON.stringify(states));
            else server.persistentData.remove(stateKey(s));
            return true;
        } catch (e) {
            warn("write player state for " + s.raidId + ": " + e);
            return false;
        }
    }

    function stateForUuid(server, s, uuid, create) {
        var states = loadStates(server, s);
        var key = String(uuid || "").toLowerCase();
        if (!key) return null;
        var state = states[key];
        if (!state && create) {
            state = { fired: false, pending: false, instanceIds: [] };
            states[key] = state;
        }
        return state || null;
    }

    function hasFired(server, s, uuid) {
        var state = stateForUuid(server, s, uuid, false);
        return !!(state && state.fired);
    }

    function raidManager() {
        return (typeof RaidManager !== "undefined") ? RaidManager : null;
    }

    function playerDays() {
        return (typeof PlayerDays !== "undefined") ? PlayerDays : null;
    }

    function uuidOf(player) {
        var manager = raidManager();
        if (manager && manager.uuidOf) {
            try { return String(manager.uuidOf(player) || "").toLowerCase(); }
            catch (e) {}
        }
        var days = playerDays();
        if (days && days.uuidOf) {
            try { return String(days.uuidOf(player) || "").toLowerCase(); }
            catch (e2) {}
        }
        return "";
    }

    function daysForUuid(server, uuid) {
        var days = playerDays();
        if (!days) return 0;
        try { return Number(days.get(server, uuid) || 0); }
        catch (e) { return 0; }
    }

    function activeInstances(s) {
        var manager = raidManager();
        if (!manager || !manager.activeOwnerInstancesForDef) return [];
        try { return manager.activeOwnerInstancesForDef(s.raidId) || []; }
        catch (e) {
            warn("active instance lookup for " + s.raidId + ": " + e);
            return [];
        }
    }

    // instanceIds grouped by the UUID the instance was started for. Only the
    // starter carries the pending transaction; teammates pulled into the same
    // shared instance are ticked off at terminal time instead.
    function activeByStarter(s) {
        var out = {};
        var active = activeInstances(s);
        for (var i = 0; i < active.length; i++) {
            var starter = String(active[i].playerUuid || "").toLowerCase();
            if (!starter) continue;
            if (!out[starter]) out[starter] = [];
            out[starter].push(String(active[i].id || ""));
        }
        return out;
    }

    // Reconcile transactions after raid_core has restored its active snapshots.
    function recoverPlayerStates(server) {
        var rearmed = 0, reconnected = 0;
        for (var i = 0; i < _schedule.length; i++) {
            var s = _schedule[i];
            var states = loadStates(server, s);
            var active = activeByStarter(s);
            var changed = false;

            for (var starter in active) {
                var ids = active[starter];
                var state = stateForUuid(server, s, starter, true);
                if (!state.fired || !state.pending ||
                    JSON.stringify(state.instanceIds || []) !== JSON.stringify(ids)) {
                    state.fired = true;
                    state.pending = true;
                    state.instanceIds = ids;
                    reconnected++;
                    changed = true;
                }
            }

            for (var key in states) {
                var pendingState = states[key];
                if (!pendingState || !pendingState.pending) continue;
                if (active[key]) continue;
                // The scheduler said "started", but no resumable core snapshot
                // exists. Re-arm only this player; everyone else keeps their state.
                pendingState.fired = false;
                pendingState.pending = false;
                pendingState.instanceIds = [];
                rearmed++;
                changed = true;
            }

            if (changed) saveStates(server, s);
        }
        if (reconnected)
            console.info("[RaidSched] restored " + reconnected +
                         " player raid transaction(s)");
        if (rearmed)
            console.info("[RaidSched] re-armed " + rearmed +
                         " player raid(s) whose active snapshot was missing");
    }

    function overworldTime(server) {
        try {
            var overworld = server.overworld();
            var time = (typeof overworld.getDayTime === "function")
                ? overworld.getDayTime() : overworld.dayTime;
            return Number(time);
        } catch (e) { return 0; }
    }

    function raidExists(raidId) {
        try {
            return typeof RaidRegistry !== "undefined" &&
                   RaidRegistry && RaidRegistry.has(String(raidId));
        } catch (e) { return false; }
    }

    function raidDisplayName(s) {
        try {
            var def = (typeof RaidRegistry !== "undefined" && RaidRegistry)
                ? RaidRegistry.get(String(s.raidId)) : null;
            if (def && def.title) return String(def.title);
        } catch (e) {}
        return String(s.raidId).replace(/_/g, " ");
    }

    function showRaidWarning(server, player, s, tonight) {
        if (!server || !player) return false;
        var key = warningKey(s);
        try { if (player.persistentData.getBoolean(key)) return false; }
        catch (eRead) {}

        var when = tonight ? "RAID TONIGHT" : "RAID TOMORROW";
        var raidName = raidDisplayName(s);
        var username = String(player.username);
        try {
            server.runCommandSilent("title " + username + " times 10 70 20");
            server.runCommandSilent(
                "title " + username + " title " +
                JSON.stringify({ text: "⚠ " + when, color: "gold", bold: true })
            );
            server.runCommandSilent(
                "title " + username + " subtitle " +
                JSON.stringify({ text: "Day " + s.day + " • " + raidName, color: "yellow" })
            );
            server.runCommandSilent(
                "playsound minecraft:block.bell.resonate master " + username + " ~ ~ ~ 0.8 0.85"
            );
        } catch (eTitle) { warn("warning display " + s.raidId + ": " + eTitle); }
        try {
            player.tell(Text.of(
                "§6§l⚠ " + when +
                "§r§7  Day " + s.day + " • §e" + raidName +
                "§r§8  Prepare armor, food, healing and defenses."
            ));
        } catch (eTell) {}
        try { player.persistentData.putBoolean(key, true); }
        catch (eWrite) { warn("warning save " + s.raidId + ": " + eWrite); }
        return true;
    }

    // Warnings follow the player's own day counter, so two teammates on
    // different play days are warned on different nights.
    function warnEligiblePlayers(server, timeOfDay) {
        try {
            var it = server.players.iterator();
            while (it.hasNext()) {
                var player = it.next();
                if (!player) continue;
                try {
                    var manager = raidManager();
                    if (manager && manager.isOwnerInRaid && manager.isOwnerInRaid(player)) continue;
                    if (manager && !manager.isOwnerInRaid &&
                        manager.isInRaid && manager.isInRaid(player)) continue;
                } catch (eInRaid) {}
                var uuid = uuidOf(player);
                if (!uuid) continue;
                var days = daysForUuid(server, uuid);

                var next = null;
                for (var i = 0; i < _schedule.length; i++) {
                    var s = _schedule[i];
                    if (days < s.day - 1 || hasFired(server, s, uuid)) continue;
                    if (!next || s.day < next.day) next = s;
                }
                if (!next) continue;
                var tonight = days >= next.day;
                if (tonight && timeOfDay >= NIGHT_START) continue;

                showRaidWarning(server, player, next, tonight);
            }
        } catch (e) { warn("warning player iteration: " + e); }
    }

    function findEntry(day, raidId) {
        var targetDay = Math.floor(Number(day));
        var id = String(raidId);
        for (var i = 0; i < _schedule.length; i++) {
            if (_schedule[i].day === targetDay && _schedule[i].raidId === id)
                return _schedule[i];
        }
        return null;
    }

    function findEntryByRaidId(raidId) {
        var id = String(raidId);
        for (var i = 0; i < _schedule.length; i++)
            if (_schedule[i].raidId === id) return _schedule[i];
        return null;
    }

    function startForEligiblePlayers(server, s, timeOfDay) {
        var manager = raidManager();
        var launched = 0;
        if (!manager) {
            warn("RaidManager missing; cannot fire " + s.raidId);
            return 0;
        }

        try {
            var it = server.players.iterator();
            while (it.hasNext()) {
                var player = it.next();
                if (!player) continue;
                var uuid = uuidOf(player);
                if (!uuid || hasFired(server, s, uuid)) continue;

                var days = daysForUuid(server, uuid);
                if (days < s.day) continue;
                // On the player's own scheduled day, keep the normal night start.
                // Once that day has passed the catch-up fires within this
                // 5-second window regardless of time of day.
                if (days === s.day && timeOfDay < NIGHT_START) continue;

                // A player whose team is already fighting stays queued and gets
                // this raid after the current shared raid ends.
                try {
                    if (manager.isOwnerInRaid && manager.isOwnerInRaid(player)) continue;
                    if (!manager.isOwnerInRaid && manager.isInRaid && manager.isInRaid(player)) continue;
                } catch (eInRaid) {}

                try {
                    var instanceId = manager.start(
                        manager.playerLevel(player), player, s.raidId
                    );
                    if (!instanceId) continue;
                    var state = stateForUuid(server, s, uuid, true);
                    state.fired = true;
                    state.pending = true;
                    state.instanceIds = [];
                    var active = activeInstances(s);
                    for (var ai = 0; ai < active.length; ai++) {
                        if (String(active[ai].playerUuid || "").toLowerCase() === uuid)
                            state.instanceIds.push(String(active[ai].id || ""));
                    }
                    if (state.instanceIds.length === 0)
                        state.instanceIds.push(String(instanceId));
                    // Persist after every successful launch. If a crash lands
                    // just before this write, recovery rebuilds it from core.
                    saveStates(server, s);
                    launched++;
                } catch (eStart) {
                    warn("start " + s.raidId + " for " + uuid + ": " + eStart);
                }
            }
        } catch (ePlayers) { warn("player iteration: " + ePlayers); }
        return launched;
    }

    function onRaidTerminal(event) {
        if (!event || !event.id || !event.defId || !_server) return;
        var s = findEntryByRaidId(event.defId);
        if (!s) return;

        var instanceId = String(event.id);
        var states = loadStates(_server, s);
        var changed = false;

        // 1) Everyone who was still on the roster when the fight ended has now
        //    completed this scheduled raid - win or loss, exactly like the old
        //    per-team behaviour. This is what lets a veteran clear a raid for a
        //    newer teammate and what stops a helper repeating it tomorrow.
        var uuids = event.participantUuids || [];
        for (var u = 0; u < uuids.length; u++) {
            var key = String(uuids[u] || "").toLowerCase();
            if (!key) continue;
            var state = stateForUuid(_server, s, key, true);
            if (!state.fired) { state.fired = true; changed = true; }
            if (state.pending) { state.pending = false; changed = true; }
            if (state.instanceIds && state.instanceIds.length > 0) {
                state.instanceIds = [];
                changed = true;
            }
        }

        // 2) Close the transaction of whoever started this exact instance. A
        //    spatial split can leave that starter with a second live instance
        //    in the same cohort, so pending only clears once none remain.
        for (var owner in states) {
            var ownerState = states[owner];
            if (!ownerState || !ownerState.pending) continue;
            var remaining = [];
            var ids = ownerState.instanceIds || [];
            for (var ii = 0; ii < ids.length; ii++)
                if (String(ids[ii]) !== instanceId) remaining.push(String(ids[ii]));
            if (remaining.length === ids.length) continue;
            ownerState.fired = true;
            ownerState.instanceIds = remaining;
            ownerState.pending = remaining.length > 0;
            changed = true;
        }

        if (changed) saveStates(_server, s);
    }

    var Schedule = {
        onDay: function (day, raidId) {
            if (!(Number(day) >= 0) || !raidId) {
                warn("onDay: bad args (day, raidId)");
                return false;
            }
            var scheduledDay = Math.floor(Number(day));
            var id = String(raidId);
            if (findEntry(scheduledDay, id)) {
                warn("onDay: duplicate schedule ignored for day " +
                     scheduledDay + " raid " + id);
                return false;
            }
            if (!raidExists(id))
                warn("onDay: raid '" + id + "' is not registered yet");
            _schedule.push({
                day: scheduledDay,
                raidId: id,
                states: emptyStates(),
                statesLoaded: false
            });
            _schedule.sort(function (a, b) {
                if (a.day !== b.day) return a.day - b.day;
                return String(a.raidId).localeCompare(String(b.raidId));
            });
            return true;
        },

        list: function () {
            var out = [];
            for (var i = 0; i < _schedule.length; i++) {
                var s = _schedule[i];
                var firedPlayers = 0;
                if (_server) {
                    var states = loadStates(_server, s);
                    for (var key in states)
                        if (states[key] && states[key].fired) firedPlayers++;
                }
                out.push({ day: s.day, raidId: s.raidId, firedPlayers: firedPlayers });
            }
            return out;
        },

        entries: function () {
            var out = [];
            for (var i = 0; i < _schedule.length; i++) {
                out.push({
                    day: _schedule[i].day,
                    raidId: _schedule[i].raidId,
                    title: raidDisplayName(_schedule[i])
                });
            }
            return out;
        },

        statusForUuid: function (uuid) {
            var out = [];
            var key = String(uuid || "").toLowerCase();
            for (var i = 0; i < _schedule.length; i++) {
                var s = _schedule[i];
                var state = _server ? stateForUuid(_server, s, key, false) : null;
                out.push({
                    day: s.day,
                    raidId: s.raidId,
                    title: raidDisplayName(s),
                    fired: !!(state && state.fired),
                    pending: !!(state && state.pending)
                });
            }
            return out;
        },

        // Admin/testing override. Setting a raid back to false while the player
        // already has enough play days makes it fire at the next 5-second check.
        setFired: function (uuid, raidId, value) {
            if (!_server) return false;
            var s = findEntryByRaidId(raidId);
            var key = String(uuid || "").toLowerCase();
            if (!s || !key) return false;
            var state = stateForUuid(_server, s, key, true);
            state.fired = !!value;
            if (!value) {
                state.pending = false;
                state.instanceIds = [];
            }
            return saveStates(_server, s);
        },

        // Testing/admin reset. Clears the whole per-player ledger for selected
        // entries. raidId omitted resets every schedule entry.
        reset: function (raidId) {
            var resetCount = 0;
            for (var i = 0; i < _schedule.length; i++) {
                var s = _schedule[i];
                if (raidId && s.raidId !== String(raidId)) continue;
                s.states = emptyStates();
                s.statesLoaded = true;
                resetCount++;
                try { if (_server) _server.persistentData.remove(stateKey(s)); }
                catch (e) {}
            }
            return resetCount;
        }
    };

    ServerEvents.loaded(function (event) {
        _server = event.server;
        _accum = 0;
        _recovered = false;
        for (var i = 0; i < _schedule.length; i++) {
            _schedule[i].states = emptyStates();
            _schedule[i].statesLoaded = false;
        }
    });

    ServerEvents.tick(function (event) {
        // Capture immediately so a terminal event during the first five seconds
        // after a /reload can still commit its per-player transaction.
        _server = event.server;
        _accum++;
        if (_accum < CHECK_EVERY) return;
        _accum = 0;

        var server = event.server;
        // Counting runs even with an empty schedule so play days keep accruing.
        var days = playerDays();
        if (days) {
            try { days.touchAll(server); }
            catch (eDays) { warn("play-day pass: " + eDays); }
        } else {
            warn("PlayerDays missing; play days cannot advance");
        }
        if (_schedule.length === 0) return;

        if (!_recovered) {
            _recovered = true;
            recoverPlayerStates(server);
        }

        var time = overworldTime(server);
        var timeOfDay = ((time % 24000) + 24000) % 24000;
        for (var i = 0; i < _schedule.length; i++) {
            var s = _schedule[i];
            var launched = startForEligiblePlayers(server, s, timeOfDay);
            if (launched > 0)
                console.info("[RaidSched] fired '" + s.raidId + "' for " +
                             launched + " new player(s)");
        }
        warnEligiblePlayers(server, timeOfDay);
    });

    try {
        var manager = raidManager();
        if (!manager || !manager.onTerminal || !manager.onTerminal(onRaidTerminal))
            warn("RaidManager terminal hook unavailable; player transactions cannot commit");
    } catch (e) { warn("terminal hook registration: " + e); }

    global.RaidSchedule = Schedule;
    console.info("[RaidSched] ready - per-player day scheduling enabled");
})(this);
```

- [ ] **Step 3: Syntax check**

Run: `node --check kubejs/server_scripts/raids/raid_schedule.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify no legacy references survive**

Run: `grep -n "team_states_v2\|migrateLegacyWinner\|legacyPendingKey\|ownerKeyForPlayer" kubejs/server_scripts/raids/raid_schedule.js`
Expected: no output. (`RaidManager.ownerKeyForPlayer` stays defined in `raid_core.js` — it is simply no longer used by the scheduler.)

- [ ] **Step 5: Commit**

```bash
git add kubejs/server_scripts/raids/raid_schedule.js
git commit -m "feat(raids): schedule raids by per-player days instead of world days"
```

---

## Task 4: Admin commands — `/raid days` and `/raid done`

**Files:**
- Modify: `kubejs/server_scripts/raids/raid_commands.js`

**Interfaces:**
- Consumes: `PlayerDays.get/set/uuidOf`, `RaidSchedule.statusForUuid/setFired/entries`, existing local helpers `safeExec`, `findKjsPlayer`, `suggestRaidIds`, `suggestPlayers`, `getServer`.
- Produces: nothing consumed by later tasks.

All four routes stay behind `hasRaidAdminPermission` (permission level 4), like the rest of the `/raid` tree. Targets are resolved from the **online** player list only — `suggestPlayers` already lists only online players, and the offline case is covered by the fact that `PlayerDays`/`RaidSchedule` state survives independently.

- [ ] **Step 1: Load the boolean and integer argument types**

Find:

```js
        var StringArg = Java.loadClass("com.mojang.brigadier.arguments.StringArgumentType");
```

Replace with:

```js
        var StringArg = Java.loadClass("com.mojang.brigadier.arguments.StringArgumentType");
        var BoolArg = Java.loadClass("com.mojang.brigadier.arguments.BoolArgumentType");
        var IntArg = Java.loadClass("com.mojang.brigadier.arguments.IntegerArgumentType");
```

- [ ] **Step 2: Add the two command nodes**

Find:

```js
        var root = Commands.literal("raid")
```

Insert immediately **above** it:

```js
        function playerDaysApi() {
            return (typeof PlayerDays !== "undefined") ? PlayerDays : null;
        }

        function scheduleApi() {
            return (typeof RaidSchedule !== "undefined") ? RaidSchedule : null;
        }

        // /raid days set <player> <n>   (literals bind before arguments, so the
        // "set" branch never gets swallowed by the <player> branch)
        var daysNode = Commands.literal("days")
            .requires(hasRaidAdminPermission)
            .then(Commands.literal("set")
                .requires(hasRaidAdminPermission)
                .then(Commands.argument("player", StringArg.word())
                    .requires(hasRaidAdminPermission)
                    .suggests(suggestPlayers)
                    .then(Commands.argument("n", IntArg.integer(0))
                        .requires(hasRaidAdminPermission)
                        .executes(function (ctx) {
                            return safeExec(ctx.source, function () {
                                var api = playerDaysApi();
                                if (!api) {
                                    ctx.source.sendFailure(Text.of("[Raid] PlayerDays is not loaded."));
                                    return 0;
                                }
                                var name = StringArg.getString(ctx, "player");
                                var target = findKjsPlayer(ctx.source, name);
                                if (!target) {
                                    ctx.source.sendFailure(Text.of("[Raid] player not found: " + name));
                                    return 0;
                                }
                                var server = getServer(ctx.source) || target.server;
                                var days = IntArg.getInteger(ctx, "n");
                                if (!api.set(server, api.uuidOf(target), days)) {
                                    ctx.source.sendFailure(Text.of("[Raid] could not write play days."));
                                    return 0;
                                }
                                ctx.source.sendSystemMessage(Text.of(
                                    "[Raid] " + target.username + " is now on play day " + days + "."
                                ));
                                return 1;
                            });
                        }))))
            .then(Commands.argument("player", StringArg.word())
                .requires(hasRaidAdminPermission)
                .suggests(suggestPlayers)
                .executes(function (ctx) {
                    return safeExec(ctx.source, function () {
                        var api = playerDaysApi();
                        if (!api) {
                            ctx.source.sendFailure(Text.of("[Raid] PlayerDays is not loaded."));
                            return 0;
                        }
                        var name = StringArg.getString(ctx, "player");
                        var target = findKjsPlayer(ctx.source, name);
                        if (!target) {
                            ctx.source.sendFailure(Text.of("[Raid] player not found: " + name));
                            return 0;
                        }
                        var server = getServer(ctx.source) || target.server;
                        ctx.source.sendSystemMessage(Text.of(
                            "[Raid] " + target.username + " play day: " +
                            api.get(server, api.uuidOf(target))
                        ));
                        return 1;
                    });
                }));

        // /raid done <player> [<raidId> <true|false>]
        var doneNode = Commands.literal("done")
            .requires(hasRaidAdminPermission)
            .then(Commands.argument("player", StringArg.word())
                .requires(hasRaidAdminPermission)
                .suggests(suggestPlayers)
                .executes(function (ctx) {
                    return safeExec(ctx.source, function () {
                        var api = playerDaysApi();
                        var sched = scheduleApi();
                        if (!api || !sched) {
                            ctx.source.sendFailure(Text.of("[Raid] raid schedule is not loaded."));
                            return 0;
                        }
                        var name = StringArg.getString(ctx, "player");
                        var target = findKjsPlayer(ctx.source, name);
                        if (!target) {
                            ctx.source.sendFailure(Text.of("[Raid] player not found: " + name));
                            return 0;
                        }
                        var server = getServer(ctx.source) || target.server;
                        var uuid = api.uuidOf(target);
                        var rows = sched.statusForUuid(uuid);
                        ctx.source.sendSystemMessage(Text.of(
                            "[Raid] " + target.username + " - play day " +
                            api.get(server, uuid) + ", " + rows.length + " scheduled raid(s):"
                        ));
                        for (var i = 0; i < rows.length; i++) {
                            var row = rows[i];
                            var mark = row.fired ? "§a[done]" : "§8[open]";
                            ctx.source.sendSystemMessage(Text.of(
                                "  " + mark + "§r day " + row.day + "  " +
                                row.raidId + (row.pending ? "  §e(running)" : "")
                            ));
                        }
                        return 1;
                    });
                })
                .then(Commands.argument("id", StringArg.word())
                    .requires(hasRaidAdminPermission)
                    .suggests(suggestRaidIds)
                    .then(Commands.argument("value", BoolArg.bool())
                        .requires(hasRaidAdminPermission)
                        .executes(function (ctx) {
                            return safeExec(ctx.source, function () {
                                var api = playerDaysApi();
                                var sched = scheduleApi();
                                if (!api || !sched) {
                                    ctx.source.sendFailure(Text.of("[Raid] raid schedule is not loaded."));
                                    return 0;
                                }
                                var name = StringArg.getString(ctx, "player");
                                var target = findKjsPlayer(ctx.source, name);
                                if (!target) {
                                    ctx.source.sendFailure(Text.of("[Raid] player not found: " + name));
                                    return 0;
                                }
                                var raidId = StringArg.getString(ctx, "id");
                                var value = BoolArg.getBool(ctx, "value");
                                if (!sched.setFired(api.uuidOf(target), raidId, value)) {
                                    ctx.source.sendFailure(Text.of(
                                        "[Raid] '" + raidId + "' is not a scheduled raid."
                                    ));
                                    return 0;
                                }
                                ctx.source.sendSystemMessage(Text.of(
                                    "[Raid] " + target.username + " '" + raidId + "' marked " +
                                    (value ? "done" : "open") +
                                    (value ? "." : " - it fires again once their play day is reached.")
                                ));
                                return 1;
                            });
                        }))));
```

- [ ] **Step 3: Register the nodes and document them in `/raid help`**

Find:

```js
            .then(cleanupNode)
            .then(stopAllNode);
```

Replace with:

```js
            .then(cleanupNode)
            .then(stopAllNode)
            .then(daysNode)
            .then(doneNode);
```

Find:

```js
            src.sendSystemMessage(Text.of("  /raid stopall - stop every active raid"));
            return 1;
```

Replace with:

```js
            src.sendSystemMessage(Text.of("  /raid stopall - stop every active raid"));
            src.sendSystemMessage(Text.of("  /raid days <player> - show a player's play day"));
            src.sendSystemMessage(Text.of("  /raid days set <player> <n> - set a player's play day"));
            src.sendSystemMessage(Text.of("  /raid done <player> - list that player's scheduled raids"));
            src.sendSystemMessage(Text.of("  /raid done <player> <id> <true|false> - tick a raid off or back on"));
            return 1;
```

- [ ] **Step 4: Update the registration log line**

Find:

```js
    console.info("[Raid-cmd] commands registered: /raid help|start|status|killmobs|stop|list|cleanup|stopall");
```

Replace with:

```js
    console.info("[Raid-cmd] commands registered: /raid help|start|status|killmobs|stop|list|cleanup|stopall|days|done");
```

- [ ] **Step 5: Syntax check**

Run: `node --check kubejs/server_scripts/raids/raid_commands.js`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add kubejs/server_scripts/raids/raid_commands.js
git commit -m "feat(raids): add /raid days and /raid done admin commands"
```

---

## Task 5: Player commands — `/myday` and `/myraids`

**Files:**
- Create: `kubejs/server_scripts/raids/raid_player_commands.js`

**Interfaces:**
- Consumes: `PlayerDays.get/uuidOf`, `RaidSchedule.statusForUuid`, `RaidManager.ownerKeyForPlayer`.
- Produces: nothing.

Permission level 0 — every player may run these on themselves only. The teammate line lists **online** teammates only (same `RaidManager.ownerKeyForPlayer`), which avoids any offline-name lookup.

- [ ] **Step 1: Create the file with full content**

Create `kubejs/server_scripts/raids/raid_player_commands.js`:

```js
// priority: 80
// kubejs/server_scripts/raids/raid_player_commands.js
//
// Public, permission-level-0 commands:
//   /myday    - your own Minecraft-day counter and the next raid waiting for you
//   /myraids  - every scheduled raid with your own done/open state
//
// Deliberately NOT part of raid_commands.js: that whole /raid tree sits behind
// hasRaidAdminPermission (level 4) and mixing a public command into it risks a
// permission mistake.

(function () {
    "use strict";

    function playerDaysApi() {
        return (typeof PlayerDays !== "undefined") ? PlayerDays : null;
    }

    function scheduleApi() {
        return (typeof RaidSchedule !== "undefined") ? RaidSchedule : null;
    }

    function raidManager() {
        return (typeof RaidManager !== "undefined") ? RaidManager : null;
    }

    ServerEvents.commandRegistry(function (event) {
        var Commands = event.commands;

        function getPlayer(src) {
            try { return src.getPlayer(); }
            catch (e) {
                try { return src.getPlayerOrException(); }
                catch (e2) { return null; }
            }
        }

        function requirePlayer(src) {
            var player = getPlayer(src);
            if (!player) {
                try { src.sendFailure(Text.of("[Raid] this command must be run by a player.")); }
                catch (eMsg) {}
            }
            return player;
        }

        function safeRun(src, fn) {
            try { return fn(); }
            catch (e) {
                console.error("[Raid-my] " + e);
                try { src.sendFailure(Text.of("[Raid] " + e)); } catch (eS) {}
                return 0;
            }
        }

        // Online teammates only: same FTB owner key as this player.
        function onlineTeammates(player) {
            var out = [];
            var manager = raidManager();
            if (!manager || !manager.ownerKeyForPlayer) return out;
            var mine = "";
            try { mine = String(manager.ownerKeyForPlayer(player) || ""); }
            catch (eKey) { return out; }
            if (!mine) return out;
            try {
                var it = player.server.players.iterator();
                while (it.hasNext()) {
                    var other = it.next();
                    if (!other) continue;
                    if (String(other.username) === String(player.username)) continue;
                    var key = "";
                    try { key = String(manager.ownerKeyForPlayer(other) || ""); }
                    catch (eOther) { continue; }
                    if (key === mine) out.push(other);
                }
            } catch (eIter) {}
            return out;
        }

        var myDayNode = Commands.literal("myday")
            .executes(function (ctx) {
                return safeRun(ctx.source, function () {
                    var player = requirePlayer(ctx.source);
                    if (!player) return 0;
                    var api = playerDaysApi();
                    var sched = scheduleApi();
                    if (!api || !sched) {
                        ctx.source.sendFailure(Text.of("[Raid] raid schedule is not loaded."));
                        return 0;
                    }
                    var uuid = api.uuidOf(player);
                    var days = api.get(player.server, uuid);
                    player.tell(Text.of("§7Your day on this server: §e" + days));

                    var rows = sched.statusForUuid(uuid);
                    var next = null;
                    for (var i = 0; i < rows.length; i++) {
                        if (rows[i].fired) continue;
                        if (!next || rows[i].day < next.day) next = rows[i];
                    }
                    if (!next) {
                        player.tell(Text.of("§8No raids left - you have cleared them all."));
                        return 1;
                    }
                    var away = next.day - days;
                    var when = (away <= 0) ? "tonight" :
                               (away === 1 ? "in 1 day" : "in " + away + " days");
                    player.tell(Text.of(
                        "§7Next raid: §eday " + next.day + " §8• §f" +
                        next.title + " §8(" + when + ")"
                    ));
                    return 1;
                });
            });

        var myRaidsNode = Commands.literal("myraids")
            .executes(function (ctx) {
                return safeRun(ctx.source, function () {
                    var player = requirePlayer(ctx.source);
                    if (!player) return 0;
                    var api = playerDaysApi();
                    var sched = scheduleApi();
                    if (!api || !sched) {
                        ctx.source.sendFailure(Text.of("[Raid] raid schedule is not loaded."));
                        return 0;
                    }
                    var uuid = api.uuidOf(player);
                    var days = api.get(player.server, uuid);
                    var rows = sched.statusForUuid(uuid);

                    player.tell(Text.of("§6Your raids §8(day " + days + ")"));
                    for (var i = 0; i < rows.length; i++) {
                        var row = rows[i];
                        var line;
                        if (row.fired) {
                            line = "§a✔ day " + row.day + "  §f" + row.title + " §8cleared";
                        } else if (days >= row.day) {
                            line = "§e➤ day " + row.day + "  §f" + row.title + " §8tonight";
                        } else {
                            line = "§8✖ day " + row.day + "  " + row.title +
                                   "  (in " + (row.day - days) + " days)";
                        }
                        player.tell(Text.of(line));
                    }

                    var mates = onlineTeammates(player);
                    if (mates.length > 0) {
                        var parts = [];
                        for (var m = 0; m < mates.length; m++) {
                            parts.push(String(mates[m].username) + "(day " +
                                       api.get(player.server, api.uuidOf(mates[m])) + ")");
                        }
                        player.tell(Text.of("§7Team online: §f" + parts.join(", ")));
                    }
                    return 1;
                });
            });

        event.register(myDayNode);
        event.register(myRaidsNode);
    });

    console.info("[Raid-my] commands registered: /myday, /myraids");
})();
```

- [ ] **Step 2: Syntax check**

Run: `node --check kubejs/server_scripts/raids/raid_player_commands.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add kubejs/server_scripts/raids/raid_player_commands.js
git commit -m "feat(raids): add /myday and /myraids player commands"
```

---

## Task 6: In-game verification and documentation

**Files:**
- Modify: `docs/raid-reference.md`

There is no automated harness for Rhino. Run every check below on a real world before calling this done, and paste the actual output into the final report — do not claim a check passed without its output.

- [ ] **Step 1: Boot check**

Start the world (or run `/reload` on a running one). Read `logs/latest.log`.

Expected — all four lines present, no `[RaidSched]` or `[PlayerDays]` warnings:
```
[PlayerDays] ready - per-player Minecraft-day counter
[RaidSched] ready - per-player day scheduling enabled
[Raid-cmd] commands registered: /raid help|start|status|killmobs|stop|list|cleanup|stopall|days|done
[Raid-my] commands registered: /myday, /myraids
```

- [ ] **Step 2: The counter counts**

Run `/myday`, note the number, then `/time add 24000`, wait ~5 seconds, run `/myday` again.
Expected: the day increased by exactly 1.

Run `/time add 24000` twice within the same 5-second window and check again.
Expected: it increased by 1 for that window, not 2 — one tick per pass is correct because only the *current* world day is compared.

- [ ] **Step 3: World day is not an input**

Run `/raid days set <you> 0`, then `/time set 0` and `/time set 13000` (night).
Expected: no raid starts. `/myday` shows `day 0` and the next raid `in 10 days`.

- [ ] **Step 4: Eligibility fires at night, not at dawn**

Run `/raid days set <you> 10`, then `/time set 1000` (day). Wait 10 seconds.
Expected: no raid. `/myraids` shows `➤ day 10 ... tonight`.

Run `/time set 13000`. Wait 5 seconds.
Expected: the day-10 raid starts. `/raid status` lists one running instance.

- [ ] **Step 5: Catch-up fires in daylight**

Run `/raid stopall`, `/raid done <you> day10_awakening false`, `/raid days set <you> 11`, `/time set 1000`.
Expected: within ~5 seconds the day-10 raid starts even though it is daytime.

- [ ] **Step 6: The whole party gets ticked off (needs a second account or a friend)**

Put both players on the same FTB Team, within 500 blocks. Set player A to play day 10 and player B to play day 9 (`/raid days set`). Clear both with `/raid done <name> day10_awakening false`. Let the raid fire for A and win it together.

Expected:
- `/raid done A` shows `[done] day 10`
- `/raid done B` shows `[done] day 10` as well
- Both received the day-10 rewards

- [ ] **Step 7: Skipping ahead keeps earlier raids queued**

With B still on play day 9 and `day10` now marked done, run `/raid done B day30_onslaught true` (simulating that B helped the team beat the day-30 raid).
Expected: `/myraids` as B shows day 30 cleared, day 20 still open and scheduled for B's play day 20.

- [ ] **Step 8: Crash recovery**

Start a raid, then kill the server process (do not `/stop` cleanly). Restart.
Expected: the log shows either `restored N player raid transaction(s)` or `re-armed N player raid(s) whose active snapshot was missing`, and `/raid status` matches — either the raid is running again or it is armed to fire again.

- [ ] **Step 9: Permission check**

As a non-op player, run `/raid days <name>`.
Expected: `[Raid] permission level 4 is required.`
Then run `/myday` and `/myraids` as the same non-op player.
Expected: both work.

- [ ] **Step 10: Update `docs/raid-reference.md`**

Replace the `## دستورات` section at the end of the file with:

```markdown
## دستورات

### ادمین (permission level 4)
```
/raid start <id>          — شروع رید روی خودت
/raid start <id> <player> — شروع رید روی بازیکن دیگه
/raid stop                — متوقف کردن ریدت
/raid stopall             — متوقف کردن همه ریدها
/raid list                — لیست ریدهای ثبت شده
/raid status              — وضعیت ریدهای فعال
/raid days <player>       — روز شخصی بازیکن
/raid days set <player> <n>            — تنظیم روز شخصی
/raid done <player>                    — لیست ریدهای اون بازیکن + وضعیت
/raid done <player> <id> <true|false>  — تیک زدن / برداشتن یک رید
```
تمام شاخه‌های `/raid` فقط با بالاترین سطح دسترسی Minecraft، یعنی permission level 4، قابل استفاده‌اند.

### بازیکن (بدون نیاز به دسترسی)
```
/myday     — روز شخصی تو + رید بعدی
/myraids   — لیست همه ریدها با وضعیت خودت + روز هم‌تیمی‌های آنلاین
```

## زمان‌بندی رید بر اساس روز شخصی

رید‌ها بر اساس **روزهای حضور خود بازیکن** شلیک می‌شوند، نه روز دنیا.

- هر بار که بازیکن آنلاین است و روز ماینکرفت عوض می‌شود، یک روز به شمارنده‌اش اضافه می‌شود. هر بخشی از روز، یک روز کامل حساب می‌شود.
- آفلاین بودن شمارنده را کاملاً فریز می‌کند. ۸ روز بازی، ۱۰ روز غیبت، یک بار ورود → ۹ روز.
- رید روز N وقتی می‌آید که روز شخصی بازیکن به N برسد؛ اگر دقیقاً N باشد منتظر شب می‌ماند، اگر از N گذشته باشد (آن شب آنلاین نبوده) بلافاصله می‌آید.
- سرور روز ۱۰۰ باشد و بازیکن تازه بیاید: رید روز ۱۰ او وقتی می‌آید که سرور به روز ۱۱۰ برسد (اگر پیوسته آنلاین بوده باشد).
- وقتی یک رید تمام می‌شود (برد یا باخت)، برای **همه‌ی اعضای حاضر در آن رید** تیک می‌خورد. کهنه‌کاری که فقط کمک کرده، جایزه را دوباره می‌گیرد.
```

- [ ] **Step 11: Commit**

```bash
git add docs/raid-reference.md
git commit -m "docs(raids): document per-player raid days and the new commands"
```

---

## Notes for the implementer

- **Do not add** a login grace period, a per-day raid cap, or a minimum-online-time threshold before a day counts. All three were considered and explicitly rejected by the modpack owner.
- **Do not change** `RaidManager.start`, the FTB Team grouping, or the 500-block spatial cohort logic. Losing a raid must keep marking it done, exactly as it does today.
- `RaidManager.ownerKeyForPlayer` stays in `raid_core.js` (`/myraids` uses it to find online teammates); only the scheduler stops using it.
- If `PlayerDays` is missing at runtime, the scheduler logs `PlayerDays missing; play days cannot advance` and fires nothing. That is the intended fail-safe — no raid is better than every raid at once.
