// priority: 60
// kubejs/server_scripts/raids/day_030.js
//
// NIGHT 30 — "The Warband" (chapter 3: men are worse than monsters)
// Illager army marching from one direction (horde pattern) with a Born in
// Chaos missionary. Real siege: TNT creepers + door knights + miners.

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day30] missing globals — night 30 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day30_warband")
        .title("The Warband")
        .spawn(72, 104)
        .spawnPattern("horde")
        .aggroRadius(26)
        .defaultPresets("farSight")
        .barColor("RED")
        // --- Round 1: raiding party ---
        .round("Raiding Party")
            .breather(200)
            .timeLimit(6000)
            .mob(M.PILLAGER).count(7)
            .mob(M.VINDICATOR).count(5)
            .mob(M.MINER_ZOMBIE).count(3)
        // --- Round 2: sappers hit the walls ---
        .round("Sappers")
            .breather(200)
            .timeLimit(7200)
            .mob(M.TNT_CREEPER).count(5)
            .mob(M.DOOR_KNIGHT).count(3)
            .mob(M.DEMOMAN).count(3)
            .mob(M.MINER_STRONG).count(4)
        // --- Round 3: the warlocks' escort ---
        .round("The Warlocks")
            .breather(200)
            .timeLimit(7200)
            .mob(M.EVOKER).count(2)
            .mob(M.VINDICATOR).count(5)
            .mob(M.PILLAGER).count(5)
            .mob(M.PEARL_ZOMBIE).count(3)
            .mob(M.MINER_STRONG).count(3)
        // --- Round 4 (FINAL): the warbeasts ---
        .round("The Warbeasts")
            .timeLimit(14400)
            .mob(M.WARBEAST_RAVAGER).count(2)
            .mob(M.VINDICATOR_ELITE).count(3)
            .mob(M.MISSIONARY).count(2)
            .mob(M.PILLAGER).count(5)
            .mob(M.MINER_STRONG).count(3)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:diamond 6");
                ctx.player.give("minecraft:emerald_block 2");
                ctx.player.give("minecraft:golden_apple 2");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(30, "day30_warband");
    console.info("[Day30] registered + scheduled 'day30_warband' for night 30");
})();
