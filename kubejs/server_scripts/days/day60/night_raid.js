// priority: 60
// kubejs/server_scripts/days/day60/night_raid.js
//
// NIGHT 60 — "Siegeworks" (6 rounds, horde pattern)
// Heavy siege column: miner strength doubles, diamond knights become regulars,
// shorter clear timers start applying pressure.
//   1. Sappers    — 12 miners + 8 movement zombies + 6 pearl zombies
//   2. Escort     — 12 vindicators + 6 axe champions + 6 fisher zombies
//   3. Barrage    — 14 crossbow skeletons + 6 trident drowned + 8 web spiders
//   4. Knightline — 5 diamond knights + 10 shield zombies + 8 miners (40 HP)
//   5. Coven      — 3 evokers + 8 axe champions + 8 bow skeletons
//   6. Siegeworks — 1 warbeast + 1 arch-evoker + 8 iron blockers + 10 miners (40 HP)
//
// Depends on globals: Raid + RaidManager (raid_core.js), RaidSchedule (raid_schedule.js),
// RaidMobs (raid_definitions.js).

(function () {
    "use strict";

    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day60] missing globals — night 60 raid not scheduled");
        return;
    }

    var M = RaidMobs;

    Raid("day60_siegeworks")
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(32)
        .followRange(300)
        .defaultPresets("farSight")
        .barColor("RED")
        .barHold(200)
        .round("Sappers")
            .breather(150)
            .timeLimit(4200)     // 3.5 min — pressure starts
            .mob(M.MINER_ZOMBIE).count(12)
            .mob(M.MOVEMENT_ZOMBIE).count(8)
            .mob(M.PEARL_ZOMBIE).count(6)
        .round("Escort")
            .breather(150)
            .timeLimit(4200)
            .mob(M.VINDICATOR).count(12)
            .mob(M.AXE_CHAMPION).count(6)
            .mob(M.FISHER_ZOMBIE).count(6)
        .round("Barrage")
            .breather(150)
            .timeLimit(4200)
            .mob(M.CROSSBOW_SKELETON).count(14)
            .mob(M.TRIDENT_DROWNED).count(6)
            .mob(M.WEB_SPIDER).count(8)
        .round("Knightline")
            .breather(150)
            .timeLimit(4200)
            .mob(M.DIAMOND_KNIGHT).count(5)
            .mob(M.SHIELD_ZOMBIE).count(10)
            .mob(M.MINER_STRONG).count(8)
        .round("Coven")
            .breather(150)
            .timeLimit(4200)
            .mob(M.EVOKER).count(3)
            .mob(M.AXE_CHAMPION).count(8)
            .mob(M.BOW_SKELETON).count(8)
        .round("Siegeworks")
            .timeLimit(12000)    // 10 min final round
            .mob(M.WARBEAST_RAVAGER).count(1)
            .mob(M.ARCH_EVOKER).count(1)
            .mob(M.IRON_BLOCKER).count(8)
            .mob(M.MINER_STRONG).count(10)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:netherite_ingot 3");
                ctx.player.give("minecraft:totem_of_undying 1");
                ctx.player.give("minecraft:enchanted_golden_apple 2");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(60, "day60_siegeworks");
    console.info("[Day60] registered + scheduled 'day60_siegeworks' for night 60");
})();
