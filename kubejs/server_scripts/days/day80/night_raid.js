// priority: 60
// kubejs/server_scripts/days/day80/night_raid.js
//
// NIGHT 80 — "Twin Columns" (7 rounds, horde pattern)
// Two warbeasts per boss wave, buffed elite footmen (60 HP champions,
// hasted knights), tighter timers.
//   1. Forerunners — 16 movement zombies + 10 miners + 8 pearl zombies
//   2. Shieldline  — 14 shield zombies + 8 axe champions (60 HP) + 6 fishers
//   3. Deluge      — 16 crossbow skeletons + 8 trident drowned + 10 web spiders
//   4. Knightstorm — 8 diamond knights (fast) + 12 iron zombies + 10 miners (40 HP)
//   5. Hexlords    — 2 arch-evokers + 3 evokers + 12 vindicators
//   6. Twin Beasts — 2 warbeasts + 8 axe champions (60 HP) + 8 pearl zombies
//   7. The Columns — 2 warbeasts + 2 arch-evokers + 10 iron blockers + 12 miners (40 HP)
//
// Depends on globals: Raid + RaidManager (raid_core.js), RaidSchedule (raid_schedule.js),
// RaidMobs (raid_definitions.js).

(function () {
    "use strict";

    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day80] missing globals — night 80 raid not scheduled");
        return;
    }

    var M = RaidMobs;

    // Local elite variants: archetype + extraArgs (spread copies, shared objects untouched)
    var CHAMPION_60 = { type: M.AXE_CHAMPION.type, presets: M.AXE_CHAMPION.presets,
                        equip: M.AXE_CHAMPION.equip,
                        extraArgs: ["attributes/max_health=60"] };
    var FAST_KNIGHT = { type: M.DIAMOND_KNIGHT.type, presets: M.DIAMOND_KNIGHT.presets,
                        equip: M.DIAMOND_KNIGHT.equip, nbt: M.DIAMOND_KNIGHT.nbt,
                        extraArgs: ["attributes/movement_speed=0.3"] };

    Raid("day80_twin_columns")
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(36)
        .followRange(300)
        .defaultPresets("farSight")
        .barColor("PURPLE")
        .barHold(200)
        .round("Forerunners")
            .breather(120)
            .timeLimit(3600)     // 3 min
            .mob(M.MOVEMENT_ZOMBIE).count(16)
            .mob(M.MINER_ZOMBIE).count(10)
            .mob(M.PEARL_ZOMBIE).count(8)
        .round("Shieldline")
            .breather(120)
            .timeLimit(3600)
            .mob(M.SHIELD_ZOMBIE).count(14)
            .mob(CHAMPION_60).count(8)
            .mob(M.FISHER_ZOMBIE).count(6)
        .round("Deluge")
            .breather(120)
            .timeLimit(3600)
            .mob(M.CROSSBOW_SKELETON).count(16)
            .mob(M.TRIDENT_DROWNED).count(8)
            .mob(M.WEB_SPIDER).count(10)
        .round("Knightstorm")
            .breather(120)
            .timeLimit(3600)
            .mob(FAST_KNIGHT).count(8)
            .mob(M.IRON_ZOMBIE).count(12)
            .mob(M.MINER_STRONG).count(10)
        .round("Hexlords")
            .breather(120)
            .timeLimit(3600)
            .mob(M.ARCH_EVOKER).count(2)
            .mob(M.EVOKER).count(3)
            .mob(M.VINDICATOR).count(12)
        .round("Twin Beasts")
            .breather(120)
            .timeLimit(4800)
            .mob(M.WARBEAST_RAVAGER).count(2)
            .mob(CHAMPION_60).count(8)
            .mob(M.PEARL_ZOMBIE).count(8)
        .round("The Columns")
            .timeLimit(12000)    // 10 min final round
            .mob(M.WARBEAST_RAVAGER).count(2)
            .mob(M.ARCH_EVOKER).count(2)
            .mob(M.IRON_BLOCKER).count(10)
            .mob(M.MINER_STRONG).count(12)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:netherite_ingot 5");
                ctx.player.give("minecraft:totem_of_undying 2");
                ctx.player.give("minecraft:enchanted_golden_apple 4");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(80, "day80_twin_columns");
    console.info("[Day80] registered + scheduled 'day80_twin_columns' for night 80");
})();
