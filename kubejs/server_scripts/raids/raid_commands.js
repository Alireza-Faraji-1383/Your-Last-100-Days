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
            .requires(function (src) { return src.hasPermission(2); })
            .then(startNode)
            .then(stopNode)
            .then(stopAllNode)
            .then(listNode)
            .then(statusNode);

        event.register(root);
    });

    console.info("[Raid-cmd] commands registered: /raid start|stop|stopall|list|status");
})();
