// priority: 60
// kubejs/server_scripts/days/day70/night_raid.js
//
// NIGHT 70 — "The Long Night" (7 rounds, horde pattern)
// Endurance night: seven waves, short breathers, mixed arms every round.
//   1. Dusk       — 14 movement zombies + 8 miners + 6 pearl zombies
//   2. Midnight   — 12 vindicators + 8 axe champions + 6 fisher zombies
//   3. Rain       — 14 crossbow skeletons + 8 web spiders + 6 trident drowned
//   4. Knightfall — 6 diamond knights + 12 shield zombies + 8 miners (40 HP)
//   5. Hexstorm   — 3 evokers + 1 arch-evoker + 10 vindicators
//   6. Beasts     — 2 warbeast ravagers + 8 axe champions + 8 pearl zombies
//   7. Daybreak   — 1 warbeast + 2 arch-evokers + 8 iron blockers + 12 miners (40 HP)
//
// Depends on globals: Raid + RaidManager (raid_core.js), RaidSchedule (raid_schedule.js),
// RaidMobs (raid_definitions.js).

(function () {
    "use strict";

    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day70] missing globals — night 70 raid not scheduled");
        return;
    }

    var M = RaidMobs;

    Raid("day70_long_night")
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(36)
        .followRange(300)
        .defaultPresets("farSight")
        .barColor("RED")
        .barHold(200)
        .round("Dusk")
            .breather(120)       // 6s — endurance pacing
            .timeLimit(4200)
            .mob(M.MOVEMENT_ZOMBIE).count(14)
            .mob(M.MINER_ZOMBIE).count(8)
            .mob(M.PEARL_ZOMBIE).count(6)
        .round("Midnight")
            .breather(120)
            .timeLimit(4200)
            .mob(M.VINDICATOR).count(12)
            .mob(M.AXE_CHAMPION).count(8)
            .mob(M.FISHER_ZOMBIE).count(6)
        .round("Rain")
            .breather(120)
            .timeLimit(4200)
            .mob(M.CROSSBOW_SKELETON).count(14)
            .mob(M.WEB_SPIDER).count(8)
            .mob(M.TRIDENT_DROWNED).count(6)
        .round("Knightfall")
            .breather(120)
            .timeLimit(4200)
            .mob(M.DIAMOND_KNIGHT).count(6)
            .mob(M.SHIELD_ZOMBIE).count(12)
            .mob(M.MINER_STRONG).count(8)
        .round("Hexstorm")
            .breather(120)
            .timeLimit(4200)
            .mob(M.EVOKER).count(3)
            .mob(M.ARCH_EVOKER).count(1)
            .mob(M.VINDICATOR).count(10)
        .round("Beasts")
            .breather(120)
            .timeLimit(4800)
            .mob(M.WARBEAST_RAVAGER).count(2)
            .mob(M.AXE_CHAMPION).count(8)
            .mob(M.PEARL_ZOMBIE).count(8)
        .round("Daybreak")
            .timeLimit(12000)    // 10 min final round
            .mob(M.WARBEAST_RAVAGER).count(1)
            .mob(M.ARCH_EVOKER).count(2)
            .mob(M.IRON_BLOCKER).count(8)
            .mob(M.MINER_STRONG).count(12)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:netherite_ingot 4");
                ctx.player.give("minecraft:totem_of_undying 2");
                ctx.player.give("minecraft:enchanted_golden_apple 3");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(70, "day70_long_night");
    console.info("[Day70] registered + scheduled 'day70_long_night' for night 70");
})();
