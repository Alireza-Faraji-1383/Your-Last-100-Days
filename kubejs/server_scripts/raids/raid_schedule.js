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
// In-memory only: a /reload mid-night re-arms entries, so a raid can refire the
// same night. Guard with a world flag if that matters.
//
// Depends on RaidManager (raid_core.js, priority 90 -> loads first). Rhino: var-only.

(function (global) {
    "use strict";

    var CHECK_EVERY = 200;     // server ticks between checks (~5s)
    var NIGHT_START = 13000;   // overworld time-of-day (ticks past dawn) when night raids may fire
    var _accum = 0;
    var _schedule = [];        // [{ day, raidId, fired }]

    function warn(m) { console.warn("[RaidSched] " + m); }

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

    function findEntry(day, raidId) {
        var d = Math.floor(Number(day));
        var id = String(raidId);
        for (var i = 0; i < _schedule.length; i++) {
            if (_schedule[i].day === d && _schedule[i].raidId === id) return _schedule[i];
        }
        return null;
    }

    // Start raidId for every online player. Returns how many instances launched.
    function fireForAll(server, raidId) {
        var M = (typeof RaidManager !== "undefined") ? RaidManager : null;
        if (!M) { warn("RaidManager missing — cannot fire " + raidId); return 0; }
        var n = 0;
        try {
            var it = server.players.iterator();
            while (it.hasNext()) {
                var p = it.next();
                if (!p) continue;
                try { if (M.start(M.playerLevel(p), p, raidId)) n++; }
                catch (e) { warn("start " + raidId + " for a player: " + e); }
            }
        } catch (e2) { warn("player iteration: " + e2); }
        return n;
    }

    var Schedule = {
        // Fire raidId on the first nightfall on/after the overworld reaches `day`.
        onDay: function (day, raidId) {
            if (!(Number(day) >= 0) || !raidId) { warn("onDay: bad args (day, raidId)"); return false; }
            var d = Math.floor(Number(day));
            var id = String(raidId);
            if (findEntry(d, id)) { warn("onDay: duplicate schedule ignored for day " + d + " raid " + id); return false; }
            if (!raidExists(id)) warn("onDay: raid '" + id + "' is not registered yet");
            _schedule.push({ day: d, raidId: id, fired: false });
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
        // Re-arm one-shot entries (testing). raidId omitted -> re-arm all. Returns count.
        reset: function (raidId) {
            var n = 0;
            for (var i = 0; i < _schedule.length; i++) {
                if (!raidId || _schedule[i].raidId === String(raidId)) { _schedule[i].fired = false; n++; }
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
        var t = overworldTime(server);
        if ((t % 24000) < NIGHT_START) return;          // daytime — wait for nightfall
        var day = Math.floor(t / 24000);

        for (var i = 0; i < _schedule.length; i++) {
            var s = _schedule[i];
            if (s.fired || day < s.day) continue;
            var launched = fireForAll(server, s.raidId);
            s.fired = true;
            console.info("[RaidSched] day " + day + " night: fired '" + s.raidId + "' for " + launched + " player(s)");
        }
    });

    global.RaidSchedule = Schedule;
    console.info("[RaidSched] ready — RaidSchedule.onDay(day, raidId)");
})(this);
