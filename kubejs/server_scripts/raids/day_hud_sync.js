// priority: 84
// kubejs/server_scripts/raids/day_hud_sync.js
//
// Permanent per-player day HUD data channel.
//
// The client mod y100d_raid_hud renders the player's personal play day at the
// top-center of the screen at all times.  This script supplies that number
// through a hidden CustomBossEvent per online player, exactly like the
// personal-death channel in raid_core.js:
//
//   name = "[Y100D_PERSONAL_DAY] <day>"
//   progress = 0,  viewed by exactly one player
//
// The client consumes and cancels the bar before vanilla can draw it, then
// draws its own overlay via RenderGuiEvent.Post.  Using a CustomBossEvent
// avoids custom packets and survives /reload, dimension changes and respawns.
//
// Depends on PlayerDays (player_days.js, priority 86) - so priority 84 loads after it.
// Rhino: var + indexed for-loops only.

(function (global) {
    "use strict";

    var MARKER = "[Y100D_PERSONAL_DAY]";
    var DAY_NS = "y100d_raid_hud";
    var DAY_PATH_PREFIX = "day_";
    var SYNC_EVERY = 20; // ticks ~1s, keeps the HUD responsive after day rolls

    var _server = null;
    var _tickAccum = 0;
    var _dayBars = {};   // normUuid -> CustomBossEvent
    var _dayValues = {}; // normUuid -> string payload

    var _barCls = null;

    function barClasses() {
        if (_barCls) return _barCls;
        try {
            _barCls = {
                Color: Java.loadClass("net.minecraft.world.BossEvent$BossBarColor"),
                Overlay: Java.loadClass("net.minecraft.world.BossEvent$BossBarOverlay"),
                RL: Java.loadClass("net.minecraft.resources.ResourceLocation")
            };
        } catch (e) {
            _barCls = {};
        }
        return _barCls;
    }

    function barRL(path) {
        var C = barClasses();
        if (!C.RL) return null;
        var p = String(path).toLowerCase().replace(/[^a-z0-9._\-\/]/g, "_");
        try { return C.RL.fromNamespaceAndPath(DAY_NS, p); }
        catch (e) { try { return C.RL.tryParse(DAY_NS + ":" + p); } catch (e2) { return null; } }
    }

    function customBars(server) {
        if (!server || typeof server.getCustomBossEvents !== "function") return null;
        try { return server.getCustomBossEvents(); } catch (e) { return null; }
    }

    function enumVal(cls, name, fallback) {
        try { return cls.valueOf(name); } catch (e) {}
        try { return cls.valueOf(fallback); } catch (e2) {}
        return null;
    }

    function makeDayBar(server, path, title) {
        var C = barClasses();
        var ce = customBars(server);
        if (!ce) return null;
        var rl = barRL(path);
        if (!rl) return null;
        try {
            var existing = ce.get(rl);
            if (existing) { try { existing.removeAllPlayers(); ce.remove(existing); } catch (eR) {} }
            var bar = ce.create(rl, Text.of(title || MARKER + " 0"));
            try { bar.setColor(enumVal(C.Color, "YELLOW", "YELLOW")); } catch (e1) {}
            try { if (typeof bar.setOverlay === "function") bar.setOverlay(enumVal(C.Overlay, "PROGRESS", "PROGRESS")); } catch (e2) {}
            try { bar.setProgress(0.0); } catch (e3) {}
            try { bar.setVisible(true); } catch (e4) {}
            return bar;
        } catch (e) {
            console.warn("[DayHUD] makeBar failed: " + e);
            return null;
        }
    }

    function normUuid(value) {
        return String(value == null ? "" : value).toLowerCase();
    }

    function playerUuidOf(player) {
        if (!player) return "";
        try { if (player.uuid != null) return normUuid(player.uuid); } catch (e) {}
        try { if (typeof player.getUUID === "function") return normUuid(player.getUUID()); } catch (e2) {}
        return "";
    }

    var _javaArrayListClass = null;
    function newJavaArrayList() {
        try {
            if (!_javaArrayListClass) _javaArrayListClass = Java.loadClass("java.util.ArrayList");
            return new _javaArrayListClass();
        } catch (e) { return null; }
    }

    var _javaUuidClass = null;
    function javaUuid(value) {
        try {
            if (!_javaUuidClass) _javaUuidClass = Java.loadClass("java.util.UUID");
            return _javaUuidClass.fromString(String(value));
        } catch (e) { return null; }
    }

    function unwrapPlayer(player) {
        try { if (player && player.getClass) { /* KubeJS wrapper has original via getEntity or direct */ } } catch (e) {}
        // KubeJS player wrapper stores raw ServerPlayer at .entity or via getEntity()
        try { if (player && typeof player.getEntity === "function") return player.getEntity(); } catch (e1) {}
        try { if (player && player.entity) return player.entity; } catch (e2) {}
        return player;
    }

    function rawOnlineServerPlayer(server, player) {
        var id = javaUuid(playerUuidOf(player));
        if (server && id) {
            try {
                if (typeof server.getPlayerList === "function") {
                    var authoritative = server.getPlayerList().getPlayer(id);
                    if (authoritative) return authoritative;
                }
            } catch (e) {}
        }
        return unwrapPlayer(player);
    }

    function dayBarPath(uuid) {
        return DAY_PATH_PREFIX + normUuid(uuid).replace(/[^a-z0-9]/g, "");
    }

    function playerDaysApi() {
        return (typeof PlayerDays !== "undefined") ? PlayerDays : null;
    }

    function dayForPlayer(server, player) {
        var api = playerDaysApi();
        if (!api) return 0;
        try { return Math.max(0, Math.floor(Number(api.get(server, api.uuidOf(player)) || 0))); }
        catch (e) { return 0; }
    }

    function syncAll() {
        if (!_server) return;
        var api = playerDaysApi();
        if (!api) return;
        var live = {};
        try {
            var it = _server.players.iterator();
            while (it.hasNext()) {
                var player = it.next();
                if (!player) continue;
                var uuid = playerUuidOf(player);
                if (!uuid) continue;
                live[uuid] = true;
                var day = dayForPlayer(_server, player);
                var payload = String(day);
                var bar = _dayBars[uuid];
                var expectedTitle = MARKER + " " + payload;

                if (!bar) {
                    bar = makeDayBar(_server, dayBarPath(uuid), expectedTitle);
                    if (!bar) continue;
                    _dayBars[uuid] = bar;
                    _dayValues[uuid] = payload;
                } else if (_dayValues[uuid] !== payload) {
                    try { bar.setName(Text.of(expectedTitle)); } catch (eName) {}
                    _dayValues[uuid] = payload;
                }

                var raw = rawOnlineServerPlayer(_server, player);
                if (!raw) continue;
                try {
                    var only = newJavaArrayList();
                    if (only && typeof bar.setPlayers === "function") {
                        only.add(raw);
                        bar.setPlayers(only);
                    } else {
                        bar.removeAllPlayers();
                        bar.addPlayer(raw);
                    }
                    bar.setVisible(true);
                    // keep progress 0 so vanilla never flashes before client cancels
                    try { bar.setProgress(0.0); } catch (eP) {}
                } catch (eSync) {
                    console.warn("[DayHUD] sync failed for " + uuid + ": " + eSync);
                }
            }
        } catch (eIter) {
            console.warn("[DayHUD] player iteration: " + eIter);
        }

        // Remove bars for players who logged out
        var stale = [];
        for (var uuid2 in _dayBars) {
            if (!live[uuid2]) stale.push(uuid2);
        }
        for (var s = 0; s < stale.length; s++) {
            var su = stale[s];
            var b = _dayBars[su];
            if (b) {
                try { b.setVisible(false); } catch (eV) {}
                try { b.removeAllPlayers(); } catch (eR) {}
                try {
                    var ce = customBars(_server);
                    if (ce) ce.remove(b);
                } catch (eRm) {}
            }
            delete _dayBars[su];
            delete _dayValues[su];
        }
    }

    function sweepDayBars(server) {
        var ce = customBars(server);
        if (!ce || typeof ce.getEvents !== "function") return 0;
        var removed = 0;
        try {
            var toRemove = [];
            var it = ce.getEvents().iterator();
            while (it.hasNext()) {
                var ev = it.next();
                var rl = null;
                try { rl = ev.getTextId(); } catch (eId) { continue; }
                if (!rl) continue;
                if (String(rl.getNamespace()) !== DAY_NS) continue;
                var path = String(rl.getPath());
                if (path.indexOf(DAY_PATH_PREFIX) !== 0) continue;
                // Keep only if we still track it as live
                var keep = false;
                for (var k in _dayBars) {
                    if (path === dayBarPath(k)) { keep = true; break; }
                }
                if (!keep) toRemove.push(ev);
            }
            for (var i = 0; i < toRemove.length; i++) {
                try { toRemove[i].removeAllPlayers(); ce.remove(toRemove[i]); removed++; } catch (eRm2) {}
            }
        } catch (e) {
            console.warn("[DayHUD] sweep: " + e);
        }
        return removed;
    }

    ServerEvents.loaded(function (event) {
        _server = event.server;
        _tickAccum = 0;
        // Rebuild live set on world load (survives /reload with new server instance)
        _dayBars = {};
        _dayValues = {};
        sweepDayBars(_server);
        syncAll();
        console.info("[DayHUD] ready - per-player day HUD channel active");
    });

    ServerEvents.tick(function (event) {
        _server = event.server;
        _tickAccum++;
        if (_tickAccum < SYNC_EVERY) return;
        _tickAccum = 0;
        syncAll();
    });

    // Instant sync on join so HUD appears immediately instead of waiting ~1s.
    try {
        PlayerEvents.loggedIn(function (event) {
            try { _server = event.server; } catch (eS) {}
            _tickAccum = SYNC_EVERY;
            // run next tick immediately
        });
    } catch (eIn) {}

    // Clean up on logout to avoid ghost bars until next tick
    try {
        PlayerEvents.loggedOut(function (event) {
            // Next syncAll will cull stale bars
        });
    } catch (eOut) {}

    console.info("[DayHUD] script loaded");
})(this);
