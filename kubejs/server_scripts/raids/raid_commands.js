// priority: 80
// kubejs/server_scripts/raids/raid_commands.js
//
// Admin command tree for the custom raid system:
//   /raid help
//   /raid start <id> [player]
//   /raid status
//   /raid killmobs
//   /raid stop
//   /raid list
//   /raid cleanup
//   /raid stopall
//   /raid days <player>
//   /raid done <player> [id] [true|false]

(function () {
    "use strict";

    // Minecraft's highest built-in operator level. Every route is protected
    // both in Brigadier and again at execution time so a failed /raid root
    // replacement/merge can never expose a custom command at vanilla level 2.
    const RAID_ADMIN_PERMISSION = 4;

    function hasRaidAdminPermission(src) {
        try { return !!(src && src.hasPermission(RAID_ADMIN_PERMISSION)); }
        catch (e) { return false; }
    }

    function mgr() {
        if (typeof RaidManager === "undefined") {
            console.error("[Raid-cmd] RaidManager missing");
            return null;
        }
        return RaidManager;
    }

    function reg() {
        return (typeof RaidRegistry !== "undefined") ? RaidRegistry : null;
    }

    ServerEvents.commandRegistry(function (event) {
        var Commands = event.commands;
        var StringArg = Java.loadClass("com.mojang.brigadier.arguments.StringArgumentType");
        var BoolArg = Java.loadClass("com.mojang.brigadier.arguments.BoolArgumentType");
        var IntArg = Java.loadClass("com.mojang.brigadier.arguments.IntegerArgumentType");

        function getPlayer(src) {
            try { return src.getPlayer(); }
            catch (e) {
                try { return src.getPlayerOrException(); }
                catch (e2) { return null; }
            }
        }

        function getServer(src) {
            try { if (src.server) return src.server; } catch (e) {}
            try { return src.getServer(); } catch (e2) { return null; }
        }

        function safeExec(src, fn) {
            if (!hasRaidAdminPermission(src)) {
                try {
                    src.sendFailure(Text.of(
                        "[Raid] permission level " + RAID_ADMIN_PERMISSION + " is required."
                    ));
                } catch (ePermission) {}
                return 0;
            }
            try { return fn(); }
            catch (e) {
                console.error("[Raid-cmd] " + e);
                try { src.sendFailure(Text.of("[Raid] " + e)); } catch (eS) {}
                return 0;
            }
        }

        // KubeJS 1.21 treats server.getPlayer(String) as a UUID lookup. Matching
        // the live wrapper list by username also keeps this compatible with the
        // team-aware RaidManager.
        function findKjsPlayer(src, name) {
            var M = mgr();
            if (!M || !M.findOnlinePlayer) return null;
            var self = getPlayer(src);
            var server = self ? self.server : getServer(src);
            var wanted = String(name).toLowerCase();
            return M.findOnlinePlayer(server, function (player) {
                return String(player.username).toLowerCase() === wanted;
            });
        }

        function raidDay(id) {
            var match = /^day(\d+)/i.exec(String(id));
            return match ? Number(match[1]) : 999999;
        }

        function startedInstanceMessage(M, instanceId, raidId) {
            var status = M && M.getActive ? M.getActive() : [];
            for (var i = 0; i < status.length; i++) {
                if (status[i].id !== instanceId) continue;
                if (status[i].phase === "QUEUED") {
                    // The core already sent the full queue/position notice to
                    // every participant; avoid a duplicate command reply.
                    return null;
                }
                break;
            }
            return "[Raid] started '" + raidId + "' (" + instanceId + ")";
        }

        // Keep raid ID suggestions stable and ordered from day 10 to day 100.
        function suggestRaidIds(ctx, builder) {
            var R = reg();
            var ids = R ? R.list() : [];
            ids.sort(function (a, b) {
                var byDay = raidDay(a) - raidDay(b);
                return byDay || String(a).localeCompare(String(b));
            });
            var remaining = "";
            try { remaining = String(builder.getRemaining()).toLowerCase(); } catch (e) {}
            for (var i = 0; i < ids.length; i++) {
                var id = String(ids[i]);
                if (!remaining || id.toLowerCase().indexOf(remaining) === 0) {
                    builder.suggest(id);
                }
            }
            return builder.buildFuture();
        }

        function suggestPlayers(ctx, builder) {
            var server = getServer(ctx.source);
            var remaining = "";
            try { remaining = String(builder.getRemaining()).toLowerCase(); } catch (e) {}
            try {
                var players = null;
                if (server && server.players) players = server.players;
                else if (server && server.getPlayerList) players = server.getPlayerList().getPlayers();
                if (players) {
                    var it = players.iterator();
                    while (it.hasNext()) {
                        var player = it.next();
                        var name = "";
                        try { name = String(player.username); } catch (eName) {}
                        if (!name || name === "undefined") {
                            try { name = String(player.getGameProfile().getName()); } catch (eProfile) {}
                        }
                        if (!name || name === "undefined") {
                            try { name = String(player.getScoreboardName()); } catch (eScore) {}
                        }
                        if (!remaining || name.toLowerCase().indexOf(remaining) === 0) {
                            builder.suggest(name);
                        }
                    }
                }
            } catch (e2) {}
            return builder.buildFuture();
        }

        // Minecraft registers its own debug /raid branch before KubeJS. Brigadier
        // merges equal root literals, which otherwise leaks vanilla subcommands
        // (check, sound, spawnleader, setomen...) into our autocomplete and also
        // creates ambiguous start/stop branches. Remove only that one root before
        // registering the custom tree; all unrelated commands stay untouched.
        function removeExistingRaidRoot(dispatcher) {
            try {
                if (!dispatcher || !dispatcher.getRoot) return false;
                var root = dispatcher.getRoot();
                if (!root || !root.getChild("raid")) return true;
                var commandNodeClass = root.getClass().getSuperclass();
                var fields = ["children", "literals", "arguments"];
                for (var i = 0; i < fields.length; i++) {
                    var field = commandNodeClass.getDeclaredField(fields[i]);
                    field.setAccessible(true);
                    field.get(root).remove("raid");
                }
                return !root.getChild("raid");
            } catch (e) {
                console.error("[Raid-cmd] could not replace vanilla /raid tree: " + e);
                return false;
            }
        }

        function showHelp(src) {
            src.sendSystemMessage(Text.of("[Raid] Commands:"));
            src.sendSystemMessage(Text.of("  /raid start <id> [player] - start a custom raid"));
            src.sendSystemMessage(Text.of("  /raid status - show active raids"));
            src.sendSystemMessage(Text.of("  /raid killmobs - kill your team's current raid mobs"));
            src.sendSystemMessage(Text.of("  /raid stop - stop your team's raid"));
            src.sendSystemMessage(Text.of("  /raid list - show registered raid ids"));
            src.sendSystemMessage(Text.of("  /raid cleanup - remove orphaned raid mobs and bars"));
            src.sendSystemMessage(Text.of("  /raid stopall - stop every active raid"));
            src.sendSystemMessage(Text.of("  /raid days <player> - show a player's play day"));
            src.sendSystemMessage(Text.of("  /raid days set <player> <n> - set a player's play day"));
            src.sendSystemMessage(Text.of("  /raid done <player> - list that player's scheduled raids"));
            src.sendSystemMessage(Text.of("  /raid done <player> <id> <true|false> - tick a raid off or back on"));
            return 1;
        }

        var helpNode = Commands.literal("help")
            .requires(hasRaidAdminPermission)
            .executes(function (ctx) {
                return safeExec(ctx.source, function () {
                    return showHelp(ctx.source);
                });
            });

        var startNode = Commands.literal("start")
            .requires(hasRaidAdminPermission)
            .then(Commands.argument("id", StringArg.word())
                .requires(hasRaidAdminPermission)
                .suggests(suggestRaidIds)
                .executes(function (ctx) {
                    return safeExec(ctx.source, function () {
                        var M = mgr();
                        if (!M) return 0;
                        var player = getPlayer(ctx.source);
                        if (!player) {
                            ctx.source.sendFailure(Text.of("[Raid] use /raid start <id> <player> from the console."));
                            return 0;
                        }
                        var id = StringArg.getString(ctx, "id");
                        var instanceId = M.start(M.playerLevel(player), player, id);
                        if (instanceId) {
                            var startMessage = startedInstanceMessage(M, instanceId, id);
                            if (startMessage) player.tell(Text.of(startMessage));
                        } else {
                            ctx.source.sendFailure(Text.of("[Raid] cannot start '" + id + "' (unknown id or team already in a raid)."));
                        }
                        return instanceId ? 1 : 0;
                    });
                })
                .then(Commands.argument("player", StringArg.word())
                    .requires(hasRaidAdminPermission)
                    .suggests(suggestPlayers)
                    .executes(function (ctx) {
                        return safeExec(ctx.source, function () {
                            var M = mgr();
                            if (!M) return 0;
                            var id = StringArg.getString(ctx, "id");
                            var playerName = StringArg.getString(ctx, "player");
                            var target = findKjsPlayer(ctx.source, playerName);
                            if (!target) {
                                ctx.source.sendFailure(Text.of("[Raid] player not found: " + playerName));
                                return 0;
                            }
                            var instanceId = M.start(M.playerLevel(target), target, id);
                            if (instanceId) {
                                var targetStartMessage = startedInstanceMessage(M, instanceId, id);
                                if (targetStartMessage) target.tell(Text.of(targetStartMessage));
                            } else {
                                ctx.source.sendFailure(Text.of("[Raid] cannot start '" + id + "' (unknown id or target team already in a raid)."));
                            }
                            return instanceId ? 1 : 0;
                        });
                    })));

        var statusNode = Commands.literal("status")
            .requires(hasRaidAdminPermission)
            .executes(function (ctx) {
                return safeExec(ctx.source, function () {
                    var M = mgr();
                    if (!M) return 0;
                    var active = M.getActive();
                    if (active.length === 0) {
                        ctx.source.sendSystemMessage(Text.of("[Raid] no active raids."));
                        return 1;
                    }
                    ctx.source.sendSystemMessage(Text.of("[Raid] running/queued (" + active.length + "):"));
                    for (var i = 0; i < active.length; i++) {
                        var raid = active[i];
                        ctx.source.sendSystemMessage(Text.of(
                            "  " + raid.id + " | wave " + raid.round +
                            " | " + raid.phase +
                            (raid.queuePosition > 0 ? " #" + raid.queuePosition : "") +
                            " | alive " + raid.alive
                        ));
                    }
                    return 1;
                });
            });

        var killMobsNode = Commands.literal("killmobs")
            .requires(hasRaidAdminPermission)
            .executes(function (ctx) {
                return safeExec(ctx.source, function () {
                    var M = mgr();
                    if (!M) return 0;
                    var player = getPlayer(ctx.source);
                    if (!player) {
                        ctx.source.sendFailure(Text.of("[Raid] this command must be run by a player."));
                        return 0;
                    }
                    var killed = M.killMobs(player);
                    if (killed < 0) {
                        ctx.source.sendFailure(Text.of("[Raid] your team has no active raid."));
                        return 0;
                    }
                    player.tell(Text.of("[Raid] killed " + killed + " mob(s) from your team's active raid."));
                    return 1;
                });
            });

        var stopNode = Commands.literal("stop")
            .requires(hasRaidAdminPermission)
            .executes(function (ctx) {
                return safeExec(ctx.source, function () {
                    var M = mgr();
                    if (!M) return 0;
                    var player = getPlayer(ctx.source);
                    if (!player) {
                        ctx.source.sendFailure(Text.of("[Raid] this command must be run by a player."));
                        return 0;
                    }
                    var stopped = M.stop(player);
                    player.tell(Text.of(stopped ? "[Raid] stopped your team's raid." : "[Raid] your team has no active raid."));
                    return stopped ? 1 : 0;
                });
            });

        var listNode = Commands.literal("list")
            .requires(hasRaidAdminPermission)
            .executes(function (ctx) {
                return safeExec(ctx.source, function () {
                    var R = reg();
                    var ids = R ? R.list() : [];
                    ids.sort(function (a, b) {
                        var byDay = raidDay(a) - raidDay(b);
                        return byDay || String(a).localeCompare(String(b));
                    });
                    ctx.source.sendSystemMessage(Text.of(
                        "[Raid] registered (" + ids.length + "): " + (ids.join(", ") || "<none>")
                    ));
                    return 1;
                });
            });

        var cleanupNode = Commands.literal("cleanup")
            .requires(hasRaidAdminPermission)
            .executes(function (ctx) {
                return safeExec(ctx.source, function () {
                    var M = mgr();
                    if (!M) return 0;
                    var removed = M.sweepOrphans();
                    ctx.source.sendSystemMessage(Text.of(
                        "[Raid] removed " + removed + " orphaned mob(s); stale bars were also checked."
                    ));
                    return 1;
                });
            });

        var stopAllNode = Commands.literal("stopall")
            .requires(hasRaidAdminPermission)
            .executes(function (ctx) {
                return safeExec(ctx.source, function () {
                    var M = mgr();
                    if (!M) return 0;
                    var count = M.stopAll();
                    ctx.source.sendSystemMessage(Text.of("[Raid] stopped " + count + " raid(s)."));
                    return 1;
                });
            });

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

        var root = Commands.literal("raid")
            .requires(hasRaidAdminPermission)
            .executes(function (ctx) {
                return safeExec(ctx.source, function () {
                    return showHelp(ctx.source);
                });
            })
            .then(helpNode)
            .then(startNode)
            .then(statusNode)
            .then(killMobsNode)
            .then(stopNode)
            .then(listNode)
            .then(cleanupNode)
            .then(stopAllNode)
            .then(daysNode)
            .then(doneNode);

        removeExistingRaidRoot(event.dispatcher);
        event.register(root);
    });

    console.info("[Raid-cmd] commands registered: /raid help|start|status|killmobs|stop|list|cleanup|stopall|days|done");
})();
