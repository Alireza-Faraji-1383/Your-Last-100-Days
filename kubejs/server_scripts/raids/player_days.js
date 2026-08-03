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
