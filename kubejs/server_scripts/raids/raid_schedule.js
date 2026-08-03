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
    // Keyed by variant: a player warned "TOMORROW" on their day N-1 must still
    // get the "TONIGHT" warning on their day N.
    function warningKey(s, tonight) {
        return "raidwarn_day" + s.day + "_" + s.raidId + (tonight ? "_t" : "_m");
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

    // Every online player who has personally reached this raid's scheduled day.
    // raid_core.js uses it to skip spawning a separate instance for a distant
    // 500-block cluster that contains nobody the raid is due for; a teammate
    // standing next to the starter still joins the shared fight.
    function eligibleUuidsForDay(server, s) {
        var out = {};
        try {
            var it = server.players.iterator();
            while (it.hasNext()) {
                var player = it.next();
                if (!player) continue;
                var uuid = uuidOf(player);
                if (!uuid) continue;
                if (daysForUuid(server, uuid) >= s.day) out[uuid] = true;
            }
        } catch (e) { warn("eligible set for " + s.raidId + ": " + e); }
        return out;
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
        var key = warningKey(s, tonight);
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
                        manager.playerLevel(player), player, s.raidId,
                        { eligibleUuids: eligibleUuidsForDay(server, s) }
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
        // raid_core.js also reports "stopped" (/raid stop, /raid stopall) and
        // "cancelled" (a queued raid whose participants all went offline). The
        // fight never resolved in either case, so it must not consume the
        // scheduled raid - the behaviour spec ticks a raid off on win or loss.
        var outcome = String(event.outcome || "");
        var resolved = (outcome === "win" || outcome === "lose");

        // 1) Everyone who was still on the roster when the fight ended has now
        //    completed this scheduled raid - win or loss, exactly like the old
        //    per-team behaviour. This is what lets a veteran clear a raid for a
        //    newer teammate and what stops a helper repeating it tomorrow.
        var uuids = resolved ? (event.participantUuids || []) : [];
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
            // An unresolved raid re-arms the starter instead of consuming their
            // scheduled raid; it fires again at the next 5-second check.
            ownerState.fired = resolved;
            ownerState.instanceIds = remaining;
            ownerState.pending = resolved && remaining.length > 0;
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
            try { recoverPlayerStates(server); }
            catch (eRecover) { warn("recovery: " + eRecover); }
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
