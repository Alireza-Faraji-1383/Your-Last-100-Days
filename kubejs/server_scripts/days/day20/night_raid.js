// priority: 60
// kubejs/server_scripts/days/day20/night_raid.js
//
// NIGHT 20 — "Broken Ground" (5 rounds, horde pattern)
// The dead now arrive as one mass from a single direction.
//   1. Vanguard   — 8 leather zombies + 4 miners
//   2. Trenchers  — 10 movement zombies + 6 miners
//   3. Anglers    — 8 gold husks + 4 fisher zombies + 4 bow skeletons
//   4. Blinkers   — 10 movement zombies + 5 pearl zombies + 4 miners (40 HP)
//   5. Wallbreak  — 5 iron blockers + 8 miners (40 HP) + 6 bow skeletons
//
// Depends on globals: Raid + RaidManager (raid_core.js), RaidSchedule (raid_schedule.js),
// RaidMobs (raid_definitions.js).

(function () {
    "use strict";

    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day20] missing globals — night 20 raid not scheduled");
        return;
    }

    var M = RaidMobs;

    Raid("day20_broken_ground")
        .spawn(80, 100)
        .spawnPattern("horde")   // one cluster, one direction per round
        .aggroRadius(25)
        .followRange(300)
        .defaultPresets("farSight")
        .barColor("GREEN")
        .barHold(200)
        .round("Vanguard")
            .breather(200)
            .timeLimit(4800)
            .mob(M.LEATHER_ZOMBIE).count(8)
            .mob(M.MINER_ZOMBIE).count(4)
        .round("Trenchers")
            .breather(200)
            .timeLimit(4800)
            .mob(M.MOVEMENT_ZOMBIE).count(10)
            .mob(M.MINER_ZOMBIE).count(6)
        .round("Anglers")
            .breather(200)
            .timeLimit(4800)
            .mob(M.GOLD_HUSK).count(8)
            .mob(M.FISHER_ZOMBIE).count(4)
            .mob(M.BOW_SKELETON).count(4)
        .round("Blinkers")
            .breather(200)
            .timeLimit(4800)
            .mob(M.MOVEMENT_ZOMBIE).count(10)
            .mob(M.PEARL_ZOMBIE).count(5)
            .mob(M.MINER_STRONG).count(4)
        .round("Wallbreak")
            .timeLimit(9600)     // final round
            .mob(M.IRON_BLOCKER).count(5)
            .mob(M.MINER_STRONG).count(8)
            .mob(M.BOW_SKELETON).count(6)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:diamond 5");
                ctx.player.give("minecraft:golden_apple 4");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(20, "day20_broken_ground");
    console.info("[Day20] registered + scheduled 'day20_broken_ground' for night 20");
})();
