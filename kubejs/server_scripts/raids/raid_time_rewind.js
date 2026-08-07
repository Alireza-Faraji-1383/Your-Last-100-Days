// kubejs/server_scripts/raids/raid_time_rewind.js
//
// A personal raid-progression rewind.  It deliberately uses PlayerDays rather
// than world time, so no other player or server-wide schedule is affected.

(function () {
    "use strict";

    var ITEM_ID = "kubejs:raid_time_rewind";
    var REWIND_DAYS = 10;

    ServerEvents.recipes(function (event) {
        event.shaped(ITEM_ID, [
            "DDD",
            "DED",
            "DDD"
        ], {
            D: "minecraft:diamond",
            E: "minecraft:ender_pearl"
        });
    });

    ItemEvents.rightClicked(ITEM_ID, function (event) {
        var daysApi = (typeof PlayerDays !== "undefined") ? PlayerDays : null;
        var player = event.player;
        if (!daysApi || !player) {
            if (player) player.tell(Text.of("[Raid] personal raid progress is not ready."));
            return;
        }

        var server = event.server || player.server;
        var uuid = daysApi.uuidOf(player);
        var current = Number(daysApi.get(server, uuid) || 0);
        var next = Math.max(0, Math.floor(current) - REWIND_DAYS);

        if (!daysApi.set(server, uuid, next)) {
            player.tell(Text.of("[Raid] could not save your personal raid progress."));
            return;
        }

        event.item.shrink(1);
        player.tell(Text.of("[Raid] personal raid day rewound to " + next + "."));
    });

    console.info("[RaidTimeRewind] registered");
})();
