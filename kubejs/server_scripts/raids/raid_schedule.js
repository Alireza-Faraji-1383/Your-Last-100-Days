// priority: 85
// Team-aware day/night scheduler for the custom raids.
//
// Each scheduled raid has independent fired/pending state for every FTB Team.
// An offline team therefore remains eligible and receives its own shared raid
// on the first eligible night after one of its members returns. Solo players use
// the same flow with their player UUID as the ownership key.
//
// State is a small JSON object per scheduled raid in server.persistentData.
// Starting a raid writes pending=true immediately; terminal events keep fired
// and clear pending. After a crash/restart, pending entries reconnect to the
// RaidInstance restored by raid_core.js or safely re-arm if no snapshot exists.
//
// Day counting matches ftbquests_day_spine.js: floor(overworld dayTime / 24000).
// Night begins at tick 13000. On-time raids still begin at night; a team that
// was offline on its scheduled day starts its overdue raid shortly after login,
// even in daytime, so logging in cannot permanently skip that team's raid.
//
// Depends on RaidManager (raid_core.js, priority 90 -> loads first).
(function (global) {
    "use strict";

    var CHECK_EVERY = 100;   // one small online-team pass every 5 seconds
    var NIGHT_START = 13000;
    var TEAM_STATE_SUFFIX = "_team_states_v2";
    var _accum = 0;
    var _schedule = [];
    var _server = null;
    var _recovered = false;

    function warn(message) { console.warn("[RaidSched] " + message); }

    // Old global keys are retained only for migration/reset compatibility. New
    // launch decisions never use them because they cannot represent each team.
    function legacyKey(s) { return "raidsched_day" + s.day + "_" + s.raidId; }
    function legacyPendingKey(s) { return legacyKey(s) + "_in_progress"; }
    function teamStateKey(s) { return legacyKey(s) + TEAM_STATE_SUFFIX; }
    function warningKey(s) { return "raidwarn_day" + s.day + "_" + s.raidId; }

    function emptyTeamStates() { return {}; }

    function loadTeamStates(server, s) {
        if (s.teamStatesLoaded) return s.teamStates;
        s.teamStatesLoaded = true;
        s.teamStates = emptyTeamStates();
        if (!server || !server.persistentData) return s.teamStates;
        try {
            var raw = String(server.persistentData.getString(teamStateKey(s)) || "");
            if (!raw) return s.teamStates;
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") return s.teamStates;
            for (var ownerKey in parsed) {
                var old = parsed[ownerKey];
                if (!old || typeof old !== "object") continue;
                var ids = [];
                if (old.instanceIds && typeof old.instanceIds.length === "number") {
                    for (var ii = 0; ii < old.instanceIds.length; ii++)
                        if (old.instanceIds[ii]) ids.push(String(old.instanceIds[ii]));
                } else if (old.instanceId) {
                    ids.push(String(old.instanceId));
                }
                s.teamStates[String(ownerKey)] = {
                    fired: !!old.fired,
                    pending: !!old.pending,
                    instanceId: ids.length > 0 ? ids[0] : "",
                    instanceIds: ids
                };
            }
        } catch (e) {
            warn("read team state for " + s.raidId + ": " + e);
            s.teamStates = emptyTeamStates();
        }
        return s.teamStates;
    }

    function saveTeamStates(server, s) {
        if (!server || !server.persistentData) return false;
        var states = loadTeamStates(server, s);
        try {
            var any = false;
            for (var key in states) {
                if (states[key] && (states[key].fired || states[key].pending)) {
                    any = true;
                    break;
                }
            }
            if (any) server.persistentData.putString(teamStateKey(s), JSON.stringify(states));
            else server.persistentData.remove(teamStateKey(s));
            return true;
        } catch (e) {
            warn("write team state for " + s.raidId + ": " + e);
            return false;
        }
    }

    function stateForOwner(server, s, ownerKey, create) {
        var states = loadTeamStates(server, s);
        var key = String(ownerKey || "");
        if (!key) return null;
        var state = states[key];
        if (!state && create) {
            state = { fired: false, pending: false, instanceId: "", instanceIds: [] };
            states[key] = state;
        }
        return state || null;
    }

    function ownerHasFired(server, s, ownerKey) {
        var state = stateForOwner(server, s, ownerKey, false);
        return !!(state && state.fired);
    }

    function raidManager() {
        return (typeof RaidManager !== "undefined") ? RaidManager : null;
    }

    function ownerKeyForPlayer(player) {
        var manager = raidManager();
        if (!manager || !manager.ownerKeyForPlayer) return "";
        try { return String(manager.ownerKeyForPlayer(player) || ""); }
        catch (e) { return ""; }
    }

    // A v1 world only remembers that "some team" fired the raid. Preserve the
    // known winning team without blocking offline teams: an owner is migrated as
    // completed only when its online member actually has that raid's victory
    // advancement. Other owners remain eligible.
    function migrateLegacyWinner(server, s, player, ownerKey) {
        if (stateForOwner(server, s, ownerKey, false)) return false;
        try {
            if (!server.persistentData.getBoolean(legacyKey(s))) return false;
            var manager = raidManager();
            if (!manager || !manager.hasVictoryAdvancement ||
                !manager.hasVictoryAdvancement(player, s.raidId)) return false;
            var state = stateForOwner(server, s, ownerKey, true);
            state.fired = true;
            state.pending = false;
            state.instanceId = "";
            state.instanceIds = [];
            saveTeamStates(server, s);
            console.info("[RaidSched] migrated completed v1 raid '" +
                         s.raidId + "' for " + ownerKey);
            return true;
        } catch (e) {
            warn("legacy winner migration for " + s.raidId + ": " + e);
            return false;
        }
    }

    function activeOwnerInstances(s) {
        var manager = raidManager();
        if (!manager || !manager.activeOwnerInstancesForDef) return [];
        try { return manager.activeOwnerInstancesForDef(s.raidId) || []; }
        catch (e) {
            warn("active owner lookup for " + s.raidId + ": " + e);
            return [];
        }
    }

    function activeByOwner(s) {
        var out = {};
        var active = activeOwnerInstances(s);
        for (var i = 0; i < active.length; i++) {
            var ownerKey = String(active[i].ownerKey || "");
            if (!ownerKey) continue;
            if (!out[ownerKey]) out[ownerKey] = [];
            out[ownerKey].push(String(active[i].id || ""));
        }
        return out;
    }

    // Reconcile transactions after raid_core has restored its active snapshots.
    // This also migrates an interrupted raid created by the old global scheduler:
    // the restored RaidInstance supplies the exact FTB owner key.
    function recoverTeamStates(server) {
        var rearmed = 0, reconnected = 0, migrated = 0;
        for (var i = 0; i < _schedule.length; i++) {
            var s = _schedule[i];
            var states = loadTeamStates(server, s);
            var active = activeByOwner(s);
            var changed = false;

            for (var ownerKey in active) {
                var activeIds = active[ownerKey];
                var activeId = activeIds.length > 0 ? activeIds[0] : "";
                var activeState = states[ownerKey];
                if (!activeState) {
                    states[ownerKey] = {
                        fired: true,
                        pending: true,
                        instanceId: activeId,
                        instanceIds: activeIds
                    };
                    migrated++;
                    changed = true;
                } else if (!activeState.fired || !activeState.pending ||
                           JSON.stringify(activeState.instanceIds || []) !== JSON.stringify(activeIds)) {
                    activeState.fired = true;
                    activeState.pending = true;
                    activeState.instanceId = activeId;
                    activeState.instanceIds = activeIds;
                    reconnected++;
                    changed = true;
                }
            }

            for (var key in states) {
                var state = states[key];
                if (!state || !state.pending) continue;
                if (active[key]) continue;
                // The scheduler said "started", but no resumable core snapshot
                // exists. Re-arm only this team; every other team's state stays.
                state.fired = false;
                state.pending = false;
                state.instanceId = "";
                state.instanceIds = [];
                rearmed++;
                changed = true;
            }

            // The v1 marker no longer owns recovery. Remove only its transaction
            // bit after active instances have been migrated; its fired bit is
            // harmless and kept so older backups remain intelligible.
            try {
                if (server.persistentData.getBoolean(legacyPendingKey(s))) {
                    server.persistentData.remove(legacyPendingKey(s));
                }
            } catch (eLegacy) {}

            if (changed) saveTeamStates(server, s);
        }
        if (reconnected || migrated)
            console.info("[RaidSched] restored " + (reconnected + migrated) +
                         " team raid transaction(s)");
        if (rearmed)
            console.info("[RaidSched] re-armed " + rearmed +
                         " team raid(s) whose active snapshot was missing");
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
                JSON.stringify({ text: "\u26a0 " + when, color: "gold", bold: true })
            );
            server.runCommandSilent(
                "title " + username + " subtitle " +
                JSON.stringify({ text: "Day " + s.day + " \u2022 " + raidName, color: "yellow" })
            );
            server.runCommandSilent(
                "playsound minecraft:block.bell.resonate master " + username + " ~ ~ ~ 0.8 0.85"
            );
        } catch (eTitle) { warn("warning display " + s.raidId + ": " + eTitle); }
        try {
            player.tell(Text.of(
                "\u00a76\u00a7l\u26a0 " + when +
                "\u00a7r\u00a77  Day " + s.day + " \u2022 \u00a7e" + raidName +
                "\u00a7r\u00a78  Prepare armor, food, healing and defenses."
            ));
        } catch (eTell) {}
        try { player.persistentData.putBoolean(key, true); }
        catch (eWrite) { warn("warning save " + s.raidId + ": " + eWrite); }
        return true;
    }

    // Warnings are evaluated per owner. A raid completed by Team A no longer
    // suppresses Team B's warning when one of B's members eventually logs in.
    function warnEligiblePlayers(server, day, timeOfDay) {
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
                var ownerKey = ownerKeyForPlayer(player);
                if (!ownerKey) continue;

                var next = null;
                for (var i = 0; i < _schedule.length; i++) {
                    var s = _schedule[i];
                    migrateLegacyWinner(server, s, player, ownerKey);
                    if (day < s.day - 1 || ownerHasFired(server, s, ownerKey)) continue;
                    if (!next || s.day < next.day) next = s;
                }
                if (!next) continue;
                var tonight = day >= next.day;
                if (tonight && timeOfDay >= NIGHT_START) continue;

                // Warning persistence is player-local, so every online teammate
                // receives it once even though the eventual raid is team-shared.
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

    function startForOnlineTeams(server, s) {
        var manager = raidManager();
        var launched = 0;
        var seenOwners = {};
        if (!manager) {
            warn("RaidManager missing; cannot fire " + s.raidId);
            return 0;
        }

        try {
            var it = server.players.iterator();
            while (it.hasNext()) {
                var player = it.next();
                if (!player) continue;
                var ownerKey = ownerKeyForPlayer(player);
                if (!ownerKey || seenOwners[ownerKey]) continue;
                seenOwners[ownerKey] = true;
                migrateLegacyWinner(server, s, player, ownerKey);
                if (ownerHasFired(server, s, ownerKey)) continue;

                // Busy teams remain queued and receive this raid after their
                // current shared raid ends.
                try {
                    if (manager.isOwnerInRaid && manager.isOwnerInRaid(player)) continue;
                    if (!manager.isOwnerInRaid && manager.isInRaid && manager.isInRaid(player)) continue;
                } catch (eInRaid) {}

                try {
                    var instanceId = manager.start(
                        manager.playerLevel(player), player, s.raidId
                    );
                    if (!instanceId) continue;
                    var state = stateForOwner(server, s, ownerKey, true);
                    state.fired = true;
                    state.pending = true;
                    state.instanceId = String(instanceId);
                    state.instanceIds = [];
                    var active = activeOwnerInstances(s);
                    for (var ai = 0; ai < active.length; ai++) {
                        if (String(active[ai].ownerKey || "") === ownerKey)
                            state.instanceIds.push(String(active[ai].id || ""));
                    }
                    if (state.instanceIds.length === 0)
                        state.instanceIds.push(String(instanceId));
                    // Persist after every successful team launch. If a crash lands
                    // just before this write, recovery reconstructs it from core.
                    saveTeamStates(server, s);
                    launched++;
                } catch (eStart) {
                    warn("start " + s.raidId + " for " + ownerKey + ": " + eStart);
                }
            }
        } catch (ePlayers) { warn("player iteration: " + ePlayers); }
        return launched;
    }

    function onRaidTerminal(event) {
        if (!event || !event.id || !_server) return;
        var instanceId = String(event.id);
        for (var i = 0; i < _schedule.length; i++) {
            var s = _schedule[i];
            if (event.defId && String(event.defId) !== String(s.raidId)) continue;
            var states = loadTeamStates(_server, s);
            for (var ownerKey in states) {
                var state = states[ownerKey];
                if (!state) continue;
                var ownerMatches = event.ownerKey &&
                    String(event.ownerKey) === String(ownerKey);
                var idMatches = state.instanceId === instanceId;
                var ids = state.instanceIds || [];
                for (var ii = 0; ii < ids.length && !idMatches; ii++)
                    if (String(ids[ii]) === instanceId) idMatches = true;
                // ownerKey is needed for an early-join spatial split whose ID was
                // created after the scheduler's initial transaction write. Never
                // let an unrelated manual raid reopen an already-closed schedule
                // entry merely because it belongs to the same FTB Team.
                if (!idMatches && !(ownerMatches && state.pending)) continue;

                var remaining = [];
                var active = activeOwnerInstances(s);
                for (var ai = 0; ai < active.length; ai++) {
                    if (String(active[ai].id || "") !== instanceId &&
                        String(active[ai].ownerKey || "") === String(ownerKey))
                        remaining.push(String(active[ai].id || ""));
                }
                state.fired = true;
                state.pending = remaining.length > 0;
                state.instanceId = remaining.length > 0 ? remaining[0] : "";
                state.instanceIds = remaining;
                saveTeamStates(_server, s);
                return;
            }
        }
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
                teamStates: emptyTeamStates(),
                teamStatesLoaded: false
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
                var firedTeams = 0;
                if (_server) {
                    var states = loadTeamStates(_server, s);
                    for (var key in states)
                        if (states[key] && states[key].fired) firedTeams++;
                }
                out.push({
                    day: s.day,
                    raidId: s.raidId,
                    fired: firedTeams > 0,
                    firedTeams: firedTeams
                });
            }
            return out;
        },

        // Testing/admin reset. Clears the complete per-team ledger for selected
        // entries and the old v1 flags. raidId omitted resets every schedule.
        reset: function (raidId) {
            var resetCount = 0;
            for (var i = 0; i < _schedule.length; i++) {
                var s = _schedule[i];
                if (raidId && s.raidId !== String(raidId)) continue;
                s.teamStates = emptyTeamStates();
                s.teamStatesLoaded = true;
                resetCount++;
                try {
                    if (_server) {
                        _server.persistentData.remove(teamStateKey(s));
                        _server.persistentData.remove(legacyKey(s));
                        _server.persistentData.remove(legacyPendingKey(s));
                    }
                } catch (e) {}
            }
            return resetCount;
        }
    };

    ServerEvents.loaded(function (event) {
        _server = event.server;
        _accum = 0;
        _recovered = false;
        for (var i = 0; i < _schedule.length; i++) {
            _schedule[i].teamStates = emptyTeamStates();
            _schedule[i].teamStatesLoaded = false;
        }
    });

    ServerEvents.tick(function (event) {
        // Capture immediately so a terminal event during the first five seconds
        // after a /reload can still commit its per-team transaction.
        _server = event.server;
        _accum++;
        if (_accum < CHECK_EVERY) return;
        _accum = 0;
        if (_schedule.length === 0) return;

        var server = event.server;
        if (!_recovered) {
            _recovered = true;
            recoverTeamStates(server);
        }

        var time = overworldTime(server);
        var timeOfDay = ((time % 24000) + 24000) % 24000;
        var day = Math.floor(time / 24000);
        // On the authored day, preserve the normal night start. Once that day
        // has passed, an offline team's catch-up starts within this 5-second
        // check window regardless of time-of-day.
        for (var i = 0; i < _schedule.length; i++) {
            var s = _schedule[i];
            if (day < s.day) continue;
            if (day === s.day && timeOfDay < NIGHT_START) continue;
            var launched = startForOnlineTeams(server, s);
            if (launched > 0)
                console.info("[RaidSched] day " + day + ": fired '" +
                             s.raidId + "' for " + launched + " new team(s)");
        }
        warnEligiblePlayers(server, day, timeOfDay);
    });

    try {
        var manager = raidManager();
        if (!manager || !manager.onTerminal || !manager.onTerminal(onRaidTerminal))
            warn("RaidManager terminal hook unavailable; team transactions cannot commit");
    } catch (e) { warn("terminal hook registration: " + e); }

    global.RaidSchedule = Schedule;
    console.info("[RaidSched] ready - per-team offline catch-up enabled");
})(this);
