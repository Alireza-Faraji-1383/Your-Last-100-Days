// priority: 80
// kubejs/server_scripts/raids/raid_player_commands.js
//
// Public, permission-level-0 commands:
//   /myday    - your own Minecraft-day counter and the next raid waiting for you
//   /myraids  - every scheduled raid with your own done/open state
//
// Deliberately NOT part of raid_commands.js: that whole /raid tree sits behind
// hasRaidAdminPermission (level 4) and mixing a public command into it risks a
// permission mistake.

(function () {
    "use strict";

    function playerDaysApi() {
        return (typeof PlayerDays !== "undefined") ? PlayerDays : null;
    }

    function scheduleApi() {
        return (typeof RaidSchedule !== "undefined") ? RaidSchedule : null;
    }

    function raidManager() {
        return (typeof RaidManager !== "undefined") ? RaidManager : null;
    }

    ServerEvents.commandRegistry(function (event) {
        var Commands = event.commands;

        function getPlayer(src) {
            try { return src.getPlayer(); }
            catch (e) {
                try { return src.getPlayerOrException(); }
                catch (e2) { return null; }
            }
        }

        function requirePlayer(src) {
            var player = getPlayer(src);
            if (!player) {
                try { src.sendFailure(Text.of("[Raid] this command must be run by a player.")); }
                catch (eMsg) {}
            }
            return player;
        }

        function safeRun(src, fn) {
            try { return fn(); }
            catch (e) {
                console.error("[Raid-my] " + e);
                try { src.sendFailure(Text.of("[Raid] " + e)); } catch (eS) {}
                return 0;
            }
        }

        // Online teammates only: same FTB owner key as this player.
        function onlineTeammates(player) {
            var out = [];
            var manager = raidManager();
            if (!manager || !manager.ownerKeyForPlayer) return out;
            var mine = "";
            try { mine = String(manager.ownerKeyForPlayer(player) || ""); }
            catch (eKey) { return out; }
            if (!mine) return out;
            try {
                var it = player.server.players.iterator();
                while (it.hasNext()) {
                    var other = it.next();
                    if (!other) continue;
                    if (String(other.username) === String(player.username)) continue;
                    var key = "";
                    try { key = String(manager.ownerKeyForPlayer(other) || ""); }
                    catch (eOther) { continue; }
                    if (key === mine) out.push(other);
                }
            } catch (eIter) {}
            return out;
        }

        var myDayNode = Commands.literal("myday")
            .executes(function (ctx) {
                return safeRun(ctx.source, function () {
                    var player = requirePlayer(ctx.source);
                    if (!player) return 0;
                    var api = playerDaysApi();
                    var sched = scheduleApi();
                    if (!api || !sched) {
                        ctx.source.sendFailure(Text.of("[Raid] raid schedule is not loaded."));
                        return 0;
                    }
                    var uuid = api.uuidOf(player);
                    var days = api.get(player.server, uuid);
                    player.tell(Text.of("§7Your day on this server: §e" + days));

                    var rows = sched.statusForUuid(uuid);
                    var next = null;
                    for (var i = 0; i < rows.length; i++) {
                        if (rows[i].fired) continue;
                        if (!next || rows[i].day < next.day) next = rows[i];
                    }
                    if (!next) {
                        player.tell(Text.of("§8No raids left - you have cleared them all."));
                        return 1;
                    }
                    var away = next.day - days;
                    var when = (away <= 0) ? "tonight" :
                               (away === 1 ? "in 1 day" : "in " + away + " days");
                    player.tell(Text.of(
                        "§7Next raid: §eday " + next.day + " §8• §f" +
                        next.title + " §8(" + when + ")"
                    ));
                    return 1;
                });
            });

        var myRaidsNode = Commands.literal("myraids")
            .executes(function (ctx) {
                return safeRun(ctx.source, function () {
                    var player = requirePlayer(ctx.source);
                    if (!player) return 0;
                    var api = playerDaysApi();
                    var sched = scheduleApi();
                    if (!api || !sched) {
                        ctx.source.sendFailure(Text.of("[Raid] raid schedule is not loaded."));
                        return 0;
                    }
                    var uuid = api.uuidOf(player);
                    var days = api.get(player.server, uuid);
                    var rows = sched.statusForUuid(uuid);

                    player.tell(Text.of("§6Your raids §8(day " + days + ")"));
                    for (var i = 0; i < rows.length; i++) {
                        var row = rows[i];
                        var line;
                        if (row.fired) {
                            line = "§a✔ day " + row.day + "  §f" + row.title + " §8cleared";
                        } else if (days >= row.day) {
                            line = "§e➤ day " + row.day + "  §f" + row.title + " §8tonight";
                        } else {
                            var awayDays = row.day - days;
                            line = "§8✖ day " + row.day + "  " + row.title +
                                   "  (in " + awayDays +
                                   (awayDays === 1 ? " day)" : " days)");
                        }
                        player.tell(Text.of(line));
                    }

                    var mates = onlineTeammates(player);
                    if (mates.length > 0) {
                        var parts = [];
                        for (var m = 0; m < mates.length; m++) {
                            parts.push(String(mates[m].username) + "(day " +
                                       api.get(player.server, api.uuidOf(mates[m])) + ")");
                        }
                        player.tell(Text.of("§7Team online: §f" + parts.join(", ")));
                    }
                    return 1;
                });
            });

        event.register(myDayNode);
        event.register(myRaidsNode);
    });

    console.info("[Raid-my] commands registered: /myday, /myraids");
})();
