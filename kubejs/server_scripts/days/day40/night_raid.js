// priority: 60
// kubejs/server_scripts/days/day40/night_raid.js
//
// NIGHT 40 — "Illager Muster" (6 rounds, horde pattern)
// The illagers take the field: pillager lines, vindicator shock troops,
// and the first evoker.
//   1. Scouts     — 10 pillagers + 6 miners
//   2. Shock      — 8 vindicators + 6 movement zombies + 4 pearl zombies
//   3. Volley     — 10 crossbow skeletons + 4 trident drowned + 6 web spiders
//   4. Champions  — 4 axe champions + 8 iron zombies + 6 miners (40 HP)
//   5. Hexer      — 1 evoker + 8 vindicators + 6 bow skeletons
//   6. The Muster — 2 evokers + 4 axe champions + 6 iron blockers + 8 miners (40 HP)
//
// Depends on globals: Raid + RaidManager (raid_core.js), RaidSchedule (raid_schedule.js),
// RaidMobs (raid_definitions.js).

(function () {
    "use strict";

    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day40] missing globals — night 40 raid not scheduled");
        return;
    }

    var M = RaidMobs;

    Raid("day40_illager_muster")
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(28)
        .followRange(300)
        .defaultPresets("farSight")
        .barColor("YELLOW")
        .barHold(200)
        .round("Scouts")
            .breather(200)
            .timeLimit(4800)
            .mob(M.PILLAGER).count(10)
            .mob(M.MINER_ZOMBIE).count(6)
        .round("Shock")
            .breather(200)
            .timeLimit(4800)
            .mob(M.VINDICATOR).count(8)
            .mob(M.MOVEMENT_ZOMBIE).count(6)
            .mob(M.PEARL_ZOMBIE).count(4)
        .round("Volley")
            .breather(200)
            .timeLimit(4800)
            .mob(M.CROSSBOW_SKELETON).count(10)
            .mob(M.TRIDENT_DROWNED).count(4)
            .mob(M.WEB_SPIDER).count(6)
        .round("Champions")
            .breather(200)
            .timeLimit(4800)
            .mob(M.AXE_CHAMPION).count(4)
            .mob(M.IRON_ZOMBIE).count(8)
            .mob(M.MINER_STRONG).count(6)
        .round("Hexer")
            .breather(200)
            .timeLimit(4800)
            .mob(M.EVOKER).count(1)
            .mob(M.VINDICATOR).count(8)
            .mob(M.BOW_SKELETON).count(6)
        .round("The Muster")
            .timeLimit(9600)     // final round
            .mob(M.EVOKER).count(2)
            .mob(M.AXE_CHAMPION).count(4)
            .mob(M.IRON_BLOCKER).count(6)
            .mob(M.MINER_STRONG).count(8)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:diamond_block 2");
                ctx.player.give("minecraft:totem_of_undying 1");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(40, "day40_illager_muster");
    console.info("[Day40] registered + scheduled 'day40_illager_muster' for night 40");
})();
