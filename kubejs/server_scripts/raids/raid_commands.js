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
        // NB: server.getPlayer(String) parses the arg as a UUID in KubeJS 2101
        // ("UUID string must be 32 or 36 characters long"), so match on username
        // over the live player list instead — same API resolvePlayer() uses.
        function findKjsPlayer(src, name) {
            if (typeof RaidManager === "undefined" || !RaidManager.findOnlinePlayer) return null;
            var self = getPlayer(src);
            var server = self ? self.server : null;
            var want = String(name).toLowerCase();
            return RaidManager.findOnlinePlayer(server, function (p) {
                return String(p.username).toLowerCase() === want;
            });
        }

        // Tab completion for <id>: every registered raid id, prefix-filtered.
        // Plain JS function auto-converts to the SuggestionProvider SAM in Rhino.
        function suggestRaidIds(ctx, builder) {
            var R = reg();
            var ids = R ? R.list() : [];
            var rem = "";
            try { rem = String(builder.getRemaining()).toLowerCase(); } catch (e) {}
            for (var i = 0; i < ids.length; i++) {
                var id = String(ids[i]);
                if (!rem || id.toLowerCase().indexOf(rem) === 0) builder.suggest(id);
            }
            return builder.buildFuture();
        }

        var startNode = Commands.literal("start")
            .then(Commands.argument("id", StringArg.word())
                .suggests(suggestRaidIds)
                .executes(function (ctx) { return safeExec(ctx.source, function () {
                    var M = mgr(); if (!M) return 0;
                    var player = getPlayer(ctx.source);
                    if (!player) { ctx.source.sendFailure(Text.of("must be run by/at a player")); return 0; }
                    var id = StringArg.getString(ctx, "id");
                    var iid = M.start(M.playerLevel(player), player, id);
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
                        var iid = M.start(M.playerLevel(target), target, id);
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
                ctx.source.sendSystemMessage(Text.of("[Raid] stopped " + n + " raid(s)."));
                return 1;
            }); });

        var listNode = Commands.literal("list")
            .executes(function (ctx) { return safeExec(ctx.source, function () {
                var R = reg();
                var ids = R ? R.list() : [];
                ctx.source.sendSystemMessage(Text.of("[Raid] registered (" + ids.length + "): " + (ids.join(", ") || "<none>")));
                return 1;
            }); });

        var statusNode = Commands.literal("status")
            .executes(function (ctx) { return safeExec(ctx.source, function () {
                var M = mgr(); if (!M) return 0;
                var act = M.getActive();
                if (act.length === 0) { ctx.source.sendSystemMessage(Text.of("[Raid] no active raids.")); return 1; }
                ctx.source.sendSystemMessage(Text.of("[Raid] active (" + act.length + "):"));
                for (var i = 0; i < act.length; i++) {
                    var a = act[i];
                    ctx.source.sendSystemMessage(Text.of("  " + a.id + " — round " + a.round + " — " + a.phase + " — alive " + a.alive));
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
