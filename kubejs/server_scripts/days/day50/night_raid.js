// priority: 60
// kubejs/server_scripts/days/day50/night_raid.js
//
// NIGHT 50 — "The Warbeast" (6 rounds, horde pattern) — halfway boss night.
// A ravager warbeast leads the column. First diamond knights.
//   1. Outriders  — 12 pillagers + 6 vindicators + 6 miners
//   2. Shock Wall — 10 vindicators + 4 axe champions + 6 pearl zombies
//   3. Rain       — 12 crossbow skeletons + 5 trident drowned + 8 web spiders
//   4. Knights    — 3 diamond knights + 10 iron zombies + 8 miners (40 HP)
//   5. Coven      — 2 evokers + 6 axe champions + 8 bow skeletons
//   6. Warbeast   — 1 warbeast ravager (150 HP) + 2 evokers + 6 iron blockers + 8 miners (40 HP)
//
// Depends on globals: Raid + RaidManager (raid_core.js), RaidSchedule (raid_schedule.js),
// RaidMobs (raid_definitions.js).

(function () {
    "use strict";

    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day50] missing globals — night 50 raid not scheduled");
        return;
    }

    var M = RaidMobs;

    Raid("day50_warbeast")
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(32)
        .followRange(300)
        .defaultPresets("farSight")
        .barColor("RED")
        .barHold(200)
        .round("Outriders")
            .breather(200)
            .timeLimit(4800)
            .mob(M.PILLAGER).count(12)
            .mob(M.VINDICATOR).count(6)
            .mob(M.MINER_ZOMBIE).count(6)
        .round("Shock Wall")
            .breather(200)
            .timeLimit(4800)
            .mob(M.VINDICATOR).count(10)
            .mob(M.AXE_CHAMPION).count(4)
            .mob(M.PEARL_ZOMBIE).count(6)
        .round("Rain")
            .breather(200)
            .timeLimit(4800)
            .mob(M.CROSSBOW_SKELETON).count(12)
            .mob(M.TRIDENT_DROWNED).count(5)
            .mob(M.WEB_SPIDER).count(8)
        .round("Knights")
            .breather(200)
            .timeLimit(4800)
            .mob(M.DIAMOND_KNIGHT).count(3)
            .mob(M.IRON_ZOMBIE).count(10)
            .mob(M.MINER_STRONG).count(8)
        .round("Coven")
            .breather(200)
            .timeLimit(4800)
            .mob(M.EVOKER).count(2)
            .mob(M.AXE_CHAMPION).count(6)
            .mob(M.BOW_SKELETON).count(8)
        .round("Warbeast")
            .timeLimit(12000)    // 10 min final boss round
            .mob(M.WARBEAST_RAVAGER).count(1)
            .mob(M.EVOKER).count(2)
            .mob(M.IRON_BLOCKER).count(6)
            .mob(M.MINER_STRONG).count(8)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:netherite_ingot 2");
                ctx.player.give("minecraft:totem_of_undying 1");
                ctx.player.give("minecraft:enchanted_golden_apple 2");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(50, "day50_warbeast");
    console.info("[Day50] registered + scheduled 'day50_warbeast' for night 50");
})();
