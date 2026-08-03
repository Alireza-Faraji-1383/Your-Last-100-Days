// priority: 45
// Keeps Enhanced Celestials blood moons away from scheduled raid nights.
//
// Raids fire on each player's own Minecraft-day counter (player_days.js), not
// on the world day, so a scheduled raid has no fixed world day to protect.
// The guard instead projects every online player's next unfired raid onto the
// lunar calendar - a player n play days short of it reaches it in n more days
// of continuous presence - and protects that night plus the one before and
// after. A manual or delayed raid also protects every day it remains active
// and the following day.
(function () {
    "use strict";

    const CHECK_EVERY = 20; // one cheap API check per second; no entity/world scan
    const LAST_ACTIVE_DAY_KEY = "raid_blood_moon_guard_last_active_day";
    const BLOOD_MOON = "enhancedcelestials:blood_moon";
    const SUPER_BLOOD_MOON = "enhancedcelestials:super_blood_moon";

    var _ticks = 0;
    var _lastFullSweepDay = null;
    var _lastScheduleSignature = "";
    var _lastSeenActiveDay = null;
    var _ec = null;
    var _classLookupDone = false;

    function warn(message) {
        console.warn("[RaidBloodMoonGuard] " + message);
    }

    function enhancedCelestials() {
        if (_classLookupDone) return _ec;
        _classLookupDone = true;
        try {
            _ec = Java.loadClass("dev.corgitaco.enhancedcelestials.EnhancedCelestials");
        } catch (e) {
            warn("Enhanced Celestials API unavailable; guard disabled: " + e);
            _ec = null;
        }
        return _ec;
    }

    function overworld(server) {
        if (!server) return null;
        try {
            var direct = server.overworld();
            if (direct) return direct;
        } catch (e) {}
        try {
            var wrapped = server.getLevel("minecraft:overworld");
            if (!wrapped) return null;
            if (typeof wrapped.getLevel === "function") {
                var raw = wrapped.getLevel();
                if (raw) return raw;
            }
            if (wrapped.minecraftLevel) return wrapped.minecraftLevel;
            return wrapped;
        } catch (e2) {}
        return null;
    }

    function forecastData(server) {
        var api = enhancedCelestials();
        var level = overworld(server);
        if (!api || !level) return null;
        try {
            var optional = api.lunarForecastWorldData(level);
            if (optional && optional.isPresent()) return optional.get();
        } catch (e) {
            warn("could not read lunar forecast: " + e);
        }
        return null;
    }

    function playerDaysApi() {
        return (typeof PlayerDays !== "undefined") ? PlayerDays : null;
    }

    function raidScheduleApi() {
        return (typeof RaidSchedule !== "undefined") ? RaidSchedule : null;
    }

    function activeRaidExists() {
        try {
            if (typeof RaidManager === "undefined" ||
                !RaidManager || typeof RaidManager.getActive !== "function") return false;
            var active = RaidManager.getActive();
            for (var i = 0; i < active.length; i++) {
                var phase = String(active[i].phase || "");
                if (phase !== "DONE" && phase !== "ENDING") return true;
            }
        } catch (e) {}
        return false;
    }

    function rememberActiveRaidDay(server, currentDay) {
        if (!activeRaidExists()) return false;
        if (_lastSeenActiveDay === currentDay) return false;
        _lastSeenActiveDay = currentDay;
        try {
            server.persistentData.putLong(LAST_ACTIVE_DAY_KEY, currentDay);
        } catch (e) {
            warn("could not persist active raid day: " + e);
        }
        return true;
    }

    function lastActiveRaidDay(server) {
        try {
            if (server.persistentData.contains(LAST_ACTIVE_DAY_KEY))
                return Number(server.persistentData.getLong(LAST_ACTIVE_DAY_KEY));
        } catch (e) {}
        return null;
    }

    // currentDay is Enhanced Celestials' lunar day, the same space the forecast
    // entries' scheduledDay() live in, so the projection lands in that space too.
    function protectedDays(server, currentDay) {
        var days = {};
        var signatureParts = [];
        var api = playerDaysApi();
        var sched = raidScheduleApi();
        if (api && sched && typeof sched.statusForUuid === "function") {
            try {
                var it = server.players.iterator();
                while (it.hasNext()) {
                    var player = it.next();
                    if (!player) continue;
                    var uuid = String(api.uuidOf(player) || "");
                    if (!uuid) continue;
                    var playDays = Number(api.get(server, uuid) || 0);
                    var rows = sched.statusForUuid(uuid) || [];
                    var next = null;
                    for (var i = 0; i < rows.length; i++) {
                        if (rows[i].fired) continue;
                        if (!next || rows[i].day < next.day) next = rows[i];
                    }
                    if (!next) continue;
                    // Already eligible (they were offline that night) counts as
                    // zero days away, so tonight is protected.
                    var away = Math.floor(Number(next.day) - playDays);
                    if (!isFinite(away)) continue;
                    if (away < 0) away = 0;
                    var raidDay = currentDay + away;
                    days[raidDay - 1] = true;
                    days[raidDay] = true;
                    days[raidDay + 1] = true;
                    signatureParts.push(uuid + ":" + raidDay + ":" +
                                        String(next.raidId || ""));
                }
            } catch (e) { warn("player raid projection: " + e); }
        }
        // Player iteration order is not stable, and an unstable signature would
        // force a needless full forecast sweep every second.
        signatureParts.sort();

        // A manual raid has no knowable "day before". Its active day(s) and the
        // day after the last active day are still guaranteed blood-moon-free.
        var lastActive = lastActiveRaidDay(server);
        if (lastActive != null && isFinite(lastActive)) {
            days[lastActive] = true;
            days[lastActive + 1] = true;
            signatureParts.push("active:" + lastActive);
        }
        return { days: days, signature: signatureParts.join("|") };
    }

    function eventId(instance) {
        try {
            return String(instance.getLunarEventKey().location());
        } catch (e) {}
        return "";
    }

    function isBloodMoon(instance) {
        var id = eventId(instance);
        return id === BLOOD_MOON || id === SUPER_BLOOD_MOON;
    }

    function purgeBloodMoons(data, days, onlyDay) {
        var forecast = null;
        try { forecast = data.getForecast(); }
        catch (e) { warn("could not access forecast list: " + e); return 0; }
        if (!forecast) return 0;

        var removed = 0;
        // Remove backwards because Enhanced Celestials exposes index removal and
        // marks/syncs its tracked data from that method.
        for (var i = forecast.size() - 1; i >= 0; i--) {
            var instance = forecast.get(i);
            var day = Number(instance.scheduledDay());
            if (onlyDay != null && day !== onlyDay) continue;
            if (!days[day] || !isBloodMoon(instance)) continue;
            try {
                data.removeEventInForecast(i);
                removed++;
            } catch (e2) {
                warn("could not remove blood moon for day " + day + ": " + e2);
            }
        }
        return removed;
    }

    function guard(server) {
        var data = forecastData(server);
        if (!data) return;

        var currentDay;
        try { currentDay = Number(data.getCurrentDay()); }
        catch (e) { warn("could not read lunar day: " + e); return; }
        if (!isFinite(currentDay)) return;

        var activeDayChanged = rememberActiveRaidDay(server, currentDay);
        var protection = protectedDays(server, currentDay);
        var fullSweep = _lastFullSweepDay !== currentDay ||
                        _lastScheduleSignature !== protection.signature ||
                        activeDayChanged;
        var removed = 0;

        if (fullSweep) {
            removed = purgeBloodMoons(data, protection.days, null);
            _lastFullSweepDay = currentDay;
            _lastScheduleSignature = protection.signature;
        } else if (protection.days[currentDay]) {
            // Also defeats a blood moon forced by another command/mod after the
            // daily sweep, without rescanning the complete forecast every second.
            removed = purgeBloodMoons(data, protection.days, currentDay);
        }

        if (removed > 0)
            console.info("[RaidBloodMoonGuard] removed " + removed +
                         " blood-moon event(s); current day " + currentDay);
    }

    ServerEvents.loaded(function (event) {
        _ticks = 0;
        _lastFullSweepDay = null;
        _lastScheduleSignature = "";
        _lastSeenActiveDay = null;
        guard(event.server);
    });

    ServerEvents.tick(function (event) {
        _ticks++;
        if (_ticks < CHECK_EVERY) return;
        _ticks = 0;
        guard(event.server);
    });

    console.info("[RaidBloodMoonGuard] ready");
})();
