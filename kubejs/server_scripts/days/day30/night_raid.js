// priority: 60
// kubejs/server_scripts/days/day30/night_raid.js
//
// NIGHT 30 — "The Volley" (5 rounds, horde pattern)
// Ranged pressure joins the mass: skirmisher lines behind a melee screen.
//   1. Screen     — 10 iron zombies + 5 miners
//   2. Volley     — 8 crossbow skeletons + 3 trident drowned + 6 web spiders
//   3. Anglers    — 10 gold husks + 6 fisher zombies + 5 bow skeletons
//   4. Blink Line — 12 movement zombies + 6 pearl zombies + 6 miners (40 HP)
//   5. Pike Wall  — 6 iron blockers + 8 crossbow skeletons + 8 miners (40 HP)
//
// Depends on globals: Raid + RaidManager (raid_core.js), RaidSchedule (raid_schedule.js),
// RaidMobs (raid_definitions.js).

(function () {
    "use strict";

    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day30] missing globals — night 30 raid not scheduled");
        return;
    }

    var M = RaidMobs;

    Raid("day30_volley")
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(28)
        .followRange(300)
        .defaultPresets("farSight")
        .barColor("YELLOW")
        .barHold(200)
        .round("Screen")
            .breather(200)
            .timeLimit(4800)
            .mob(M.IRON_ZOMBIE).count(10)
            .mob(M.MINER_ZOMBIE).count(5)
        .round("Volley")
            .breather(200)
            .timeLimit(4800)
            .mob(M.CROSSBOW_SKELETON).count(8)
            .mob(M.TRIDENT_DROWNED).count(3)
            .mob(M.WEB_SPIDER).count(6)
        .round("Anglers")
            .breather(200)
            .timeLimit(4800)
            .mob(M.GOLD_HUSK).count(10)
            .mob(M.FISHER_ZOMBIE).count(6)
            .mob(M.BOW_SKELETON).count(5)
        .round("Blink Line")
            .breather(200)
            .timeLimit(4800)
            .mob(M.MOVEMENT_ZOMBIE).count(12)
            .mob(M.PEARL_ZOMBIE).count(6)
            .mob(M.MINER_STRONG).count(6)
        .round("Pike Wall")
            .timeLimit(9600)     // final round
            .mob(M.IRON_BLOCKER).count(6)
            .mob(M.CROSSBOW_SKELETON).count(8)
            .mob(M.MINER_STRONG).count(8)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:diamond_block 1");
                ctx.player.give("minecraft:golden_apple 5");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(30, "day30_volley");
    console.info("[Day30] registered + scheduled 'day30_volley' for night 30");
})();
