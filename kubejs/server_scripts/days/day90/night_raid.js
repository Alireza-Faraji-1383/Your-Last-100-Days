// priority: 60
// kubejs/server_scripts/days/day90/night_raid.js
//
// NIGHT 90 — "The Gravemarch" (8 rounds, horde pattern)
// The penultimate night: everything the horde has, back to back. Elites are
// standard issue; three warbeasts walk in the final column.
//   1. Gravewake  — 18 movement zombies + 12 miners + 8 pearl zombies
//   2. Shieldwall — 16 shield zombies + 10 champions (60 HP) + 8 fishers
//   3. Deluge     — 18 crossbow skeletons + 8 trident drowned + 10 web spiders
//   4. Knightmarch— 10 fast diamond knights + 12 iron zombies + 10 miners (40 HP)
//   5. Hexcourt   — 3 arch-evokers + 3 evokers + 14 vindicators
//   6. Beastpack  — 3 warbeasts + 10 champions (60 HP) + 8 pearl zombies
//   7. Gravediggers — 16 miners (40 HP) + 10 iron blockers + 8 web spiders
//   8. Gravemarch — 3 warbeasts + 3 arch-evokers + 10 iron blockers + 12 miners (40 HP)
//
// Depends on globals: Raid + RaidManager (raid_core.js), RaidSchedule (raid_schedule.js),
// RaidMobs (raid_definitions.js).

(function () {
    "use strict";

    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day90] missing globals — night 90 raid not scheduled");
        return;
    }

    var M = RaidMobs;

    var CHAMPION_60 = { type: M.AXE_CHAMPION.type, presets: M.AXE_CHAMPION.presets,
                        equip: M.AXE_CHAMPION.equip,
                        extraArgs: ["attributes/max_health=60"] };
    var FAST_KNIGHT = { type: M.DIAMOND_KNIGHT.type, presets: M.DIAMOND_KNIGHT.presets,
                        equip: M.DIAMOND_KNIGHT.equip, nbt: M.DIAMOND_KNIGHT.nbt,
                        extraArgs: ["attributes/movement_speed=0.3"] };

    Raid("day90_gravemarch")
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(40)
        .followRange(300)
        .defaultPresets("farSight")
        .barColor("PURPLE")
        .barHold(200)
        .round("Gravewake")
            .breather(100)       // 5s — relentless
            .timeLimit(3600)
            .mob(M.MOVEMENT_ZOMBIE).count(18)
            .mob(M.MINER_ZOMBIE).count(12)
            .mob(M.PEARL_ZOMBIE).count(8)
        .round("Shieldwall")
            .breather(100)
            .timeLimit(3600)
            .mob(M.SHIELD_ZOMBIE).count(16)
            .mob(CHAMPION_60).count(10)
            .mob(M.FISHER_ZOMBIE).count(8)
        .round("Deluge")
            .breather(100)
            .timeLimit(3600)
            .mob(M.CROSSBOW_SKELETON).count(18)
            .mob(M.TRIDENT_DROWNED).count(8)
            .mob(M.WEB_SPIDER).count(10)
        .round("Knightmarch")
            .breather(100)
            .timeLimit(3600)
            .mob(FAST_KNIGHT).count(10)
            .mob(M.IRON_ZOMBIE).count(12)
            .mob(M.MINER_STRONG).count(10)
        .round("Hexcourt")
            .breather(100)
            .timeLimit(3600)
            .mob(M.ARCH_EVOKER).count(3)
            .mob(M.EVOKER).count(3)
            .mob(M.VINDICATOR).count(14)
        .round("Beastpack")
            .breather(100)
            .timeLimit(4800)
            .mob(M.WARBEAST_RAVAGER).count(3)
            .mob(CHAMPION_60).count(10)
            .mob(M.PEARL_ZOMBIE).count(8)
        .round("Gravediggers")
            .breather(100)
            .timeLimit(3600)
            .mob(M.MINER_STRONG).count(16)
            .mob(M.IRON_BLOCKER).count(10)
            .mob(M.WEB_SPIDER).count(8)
        .round("Gravemarch")
            .timeLimit(12000)    // 10 min final round
            .mob(M.WARBEAST_RAVAGER).count(3)
            .mob(M.ARCH_EVOKER).count(3)
            .mob(M.IRON_BLOCKER).count(10)
            .mob(M.MINER_STRONG).count(12)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:netherite_block 1");
                ctx.player.give("minecraft:totem_of_undying 2");
                ctx.player.give("minecraft:enchanted_golden_apple 5");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(90, "day90_gravemarch");
    console.info("[Day90] registered + scheduled 'day90_gravemarch' for night 90");
})();
