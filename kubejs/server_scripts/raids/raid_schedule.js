// priority: 85
// kubejs/server_scripts/raids/raid_schedule.js
//
// Day/night auto-trigger layer for raids. Declare night raids in day files, e.g.
// `kubejs/server_scripts/days/day20/night_raid.js`, after the raid is built:
//
//   Raid("pillager_siege")...build();
//   RaidSchedule.onDay(20, "pillager_siege")
//
// On the first nightfall on or after the overworld day count reaches `day`, the
// raid fires for every online player — each gets their own instance; players
// already in a raid are skipped (RaidManager.start self-guards). One-shot: each
// entry fires once per server run.
//
// Day counting matches ftbquests_day_spine.js: floor(overworld dayTime / 24000).
// Night = overworld time-of-day >= 13000 ticks (monster hours). The ">= day"
// (not "=== day") fire rule guarantees a missed/offline night still triggers on
// the next eligible night, rather than being skipped forever.
//
// Fired flags persist in server.persistentData ("raidsched_day<N>_<raidId>"). A
// second tiny "_in_progress" flag makes that write transactional: normal
// win/loss/stop clears in_progress and keeps fired; a reload/restart/crash leaves
// in_progress behind, so the next script load clears both flags and re-arms the
// interrupted raid. No raid/entity state is serialized and there are no per-tick
// writes. A night with nobody online (or everyone already raiding) stays armed.
//
// Depends on RaidManager (raid_core.js, priority 90 -> loads first). Rhino: var-only.

(function (global) {
    "use strict";

    var CHECK_EVERY = 200;     // server ticks between checks (~5s)
    var NIGHT_START = 13000;   // overworld time-of-day (ticks past dawn) when night raids may fire
    var _accum = 0;
    var _schedule = [];        // [{ day, raidId, fired, pending, pendingIds }]
    var _server = null;        // captured each tick — lets reset() reach persistentData
    var _recovered = false;    // interrupted transactions recovered once per script load

    function warn(m) { console.warn("[RaidSched] " + m); }

    function pdKey(s) { return "raidsched_day" + s.day + "_" + s.raidId; }
    function pendingKey(s) { return pdKey(s) + "_in_progress"; }
    function warningKey(s) { return "raidwarn_day" + s.day + "_" + s.raidId; }
    // fired = in-memory flag OR the persisted world flag (cached back in-memory).
    function pdFired(server, s) {
        if (s.fired) return true;
        try {
            if (server.persistentData.getBoolean(pdKey(s))) { s.fired = true; return true; }
        } catch (e) {}
        return false;
    }
    // Begin the tiny persistent transaction. Write in_progress FIRST: if a crash
    // lands between the two writes, recovery still re-arms instead of burning the
    // raid. The only persistent writes are here and in completePending().
    function beginPending(server, s, ids) {
        s.fired = true;
        s.pending = true;
        s.pendingIds = ids.slice();
        try {
            server.persistentData.putBoolean(pendingKey(s), true);
            server.persistentData.putBoolean(pdKey(s), true);
        } catch (e) { warn("persist start " + pdKey(s) + ": " + e); }
    }

    // Commit after every auto-launched instance reaches win/loss/stop. fired is
    // intentionally kept; only the recovery marker is removed.
    function completePending(server, s) {
        s.pending = false;
        s.pendingIds = [];
        try { server.persistentData.remove(pendingKey(s)); }
        catch (e) { warn("persist complete " + pendingKey(s) + ": " + e); }
    }

    // A leftover in_progress marker means the in-memory RaidInstance vanished
    // before a terminal event (shutdown, crash, /reload). Re-arm once. The
    // orphan sweep runs only in this exceptional path, never during normal ticks.
    function recoverInterrupted(server) {
        var recovered = 0;
        for (var i = 0; i < _schedule.length; i++) {
            var s = _schedule[i];
            var interrupted = false;
            try { interrupted = server.persistentData.getBoolean(pendingKey(s)); }
            catch (e) { warn("recover read " + pendingKey(s) + ": " + e); }
            if (!interrupted) continue;
            s.fired = false;
            s.pending = false;
            s.pendingIds = [];
            try {
                server.persistentData.remove(pdKey(s));
                server.persistentData.remove(pendingKey(s));
            } catch (e2) { warn("recover clear " + pdKey(s) + ": " + e2); }
            recovered++;
            console.info("[RaidSched] recovered interrupted '" + s.raidId + "' — re-armed for the next eligible night");
        }
        if (recovered > 0) {
            try {
                var M = (typeof RaidManager !== "undefined") ? RaidManager : null;
                // A full server start already swept in ServerEvents.loaded. A
                // mid-session /reload does not fire that event, so sweep only
                // when the new core has not done its load sweep yet.
                if (M && M.sweepOrphans && !M._loadedSweepDone) M.sweepOrphans();
            } catch (e3) { warn("recovery orphan sweep: " + e3); }
        }
        return recovered;
    }

    function overworldTime(server) {
        try {
            var ow = server.overworld();
            var t = (typeof ow.getDayTime === "function") ? ow.getDayTime() : ow.dayTime;
            return Number(t);
        } catch (e) { return 0; }
    }

    function raidExists(raidId) {
        try {
            return (typeof RaidRegistry !== "undefined" && RaidRegistry && RaidRegistry.has(String(raidId)));
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

    // One compact, persistent warning per player and scheduled raid. This uses
    // the scheduler's existing 5-second check, so it adds no tick/event loop.
    // Players who missed the previous day get a final daytime warning on raid
    // day; never show it at night immediately on top of the raid-start title.
    function showRaidWarning(server, player, s, tonight) {
        if (!server || !player) return false;
        var key = warningKey(s);
        try { if (player.persistentData.getBoolean(key)) return false; } catch (eRead) {}

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
                "\u00a76\u00a7l\u26a0 " + when + "\u00a7r\u00a77  Day " + s.day + " \u2022 \u00a7e" + raidName +
                "\u00a7r\u00a78  Prepare armor, food, healing and defenses."
            ));
        } catch (eTell) {}
        try { player.persistentData.putBoolean(key, true); }
        catch (eWrite) { warn("warning save " + s.raidId + ": " + eWrite); }
        return true;
    }

    function warnEligiblePlayers(server, day, timeOfDay) {
        var next = null;
        for (var i = 0; i < _schedule.length; i++) {
            var s = _schedule[i];
            if (day < s.day - 1 || pdFired(server, s)) continue;
            if (!next || s.day < next.day) next = s;
        }
        if (!next) return;
        var tonight = day >= next.day;
        if (tonight && timeOfDay >= NIGHT_START) return;
        try {
            var it = server.players.iterator();
            while (it.hasNext()) showRaidWarning(server, it.next(), next, tonight);
        } catch (e) { warn("warning player iteration: " + e); }
    }

    function findEntry(day, raidId) {
        var d = Math.floor(Number(day));
        var id = String(raidId);
        for (var i = 0; i < _schedule.length; i++) {
            if (_schedule[i].day === d && _schedule[i].raidId === id) return _schedule[i];
        }
        return null;
    }

    // Start raidId for every online player. Returns launched instance ids so the
    // persistent transaction can be committed exactly when that launch group ends.
    function fireForAll(server, raidId) {
        var M = (typeof RaidManager !== "undefined") ? RaidManager : null;
        var result = { count: 0, ids: [] };
        if (!M) { warn("RaidManager missing — cannot fire " + raidId); return result; }
        try {
            var it = server.players.iterator();
            while (it.hasNext()) {
                var p = it.next();
                if (!p) continue;
                // Quiet skip (no RaidManager warn spam) — an unfired entry retries
                // every check while a player is mid-raid.
                try { if (M.isInRaid && M.isInRaid(p)) continue; } catch (eIR) {}
                try {
                    var iid = M.start(M.playerLevel(p), p, raidId);
                    if (iid) { result.count++; result.ids.push(String(iid)); }
                }
                catch (e) { warn("start " + raidId + " for a player: " + e); }
            }
        } catch (e2) { warn("player iteration: " + e2); }
        return result;
    }

    // Core emits this once per win/loss/explicit stop. Manual raids are not in
    // pendingIds and are ignored. With multiple players the transaction commits
    // only after every instance launched by the same schedule entry has ended.
    function onRaidTerminal(ev) {
        if (!ev || !ev.id) return;
        var id = String(ev.id);
        for (var i = 0; i < _schedule.length; i++) {
            var s = _schedule[i];
            if (!s.pending || !s.pendingIds) continue;
            var next = [];
            var found = false;
            for (var j = 0; j < s.pendingIds.length; j++) {
                if (s.pendingIds[j] === id) found = true;
                else next.push(s.pendingIds[j]);
            }
            if (!found) continue;
            s.pendingIds = next;
            if (next.length === 0) completePending(_server, s);
            return;
        }
    }

    var Schedule = {
        // Fire raidId on the first nightfall on/after the overworld reaches `day`.
        onDay: function (day, raidId) {
            if (!(Number(day) >= 0) || !raidId) { warn("onDay: bad args (day, raidId)"); return false; }
            var d = Math.floor(Number(day));
            var id = String(raidId);
            if (findEntry(d, id)) { warn("onDay: duplicate schedule ignored for day " + d + " raid " + id); return false; }
            if (!raidExists(id)) warn("onDay: raid '" + id + "' is not registered yet");
            _schedule.push({ day: d, raidId: id, fired: false, pending: false, pendingIds: [] });
            return true;
        },
        list: function () {
            var out = [];
            for (var i = 0; i < _schedule.length; i++) {
                var s = _schedule[i];
                out.push({ day: s.day, raidId: s.raidId, fired: s.fired });
            }
            return out;
        },
        // Re-arm one-shot entries (testing). raidId omitted -> re-arm all. Returns
        // count. Also clears the persisted world flags.
        reset: function (raidId) {
            var n = 0;
            for (var i = 0; i < _schedule.length; i++) {
                var s = _schedule[i];
                if (!raidId || s.raidId === String(raidId)) {
                    s.fired = false; s.pending = false; s.pendingIds = []; n++;
                    try {
                        if (_server) {
                            _server.persistentData.remove(pdKey(s));
                            _server.persistentData.remove(pendingKey(s));
                        }
                    } catch (e) {}
                }
            }
            return n;
        }
    };

    ServerEvents.tick(function (event) {
        _accum++;
        if (_accum < CHECK_EVERY) return;
        _accum = 0;
        if (_schedule.length === 0) return;

        var server = event.server;
        _server = server;
        if (!_recovered) {
            _recovered = true;
            recoverInterrupted(server);
        }
        var t = overworldTime(server);
        var timeOfDay = t % 24000;
        var day = Math.floor(t / 24000);
        warnEligiblePlayers(server, day, timeOfDay);
        if (timeOfDay < NIGHT_START) return;          // daytime — wait for nightfall

        for (var i = 0; i < _schedule.length; i++) {
            var s = _schedule[i];
            if (day < s.day || pdFired(server, s)) continue;
            var launched = fireForAll(server, s.raidId);
            if (launched.count > 0) {
                beginPending(server, s, launched.ids);
                console.info("[RaidSched] day " + day + " night: fired '" + s.raidId + "' for " + launched.count + " player(s)");
            }
            // launched.count === 0 (empty server / everyone mid-raid): stay armed, retry
            // next check / next eligible night.
        }
    });

    try {
        var M = (typeof RaidManager !== "undefined") ? RaidManager : null;
        if (!M || !M.onTerminal || !M.onTerminal(onRaidTerminal))
            warn("RaidManager terminal hook unavailable — interrupted-raid transaction cannot commit");
    } catch (e) { warn("terminal hook registration: " + e); }

    global.RaidSchedule = Schedule;
    console.info("[RaidSched] ready — RaidSchedule.onDay(day, raidId)");
})(this);
