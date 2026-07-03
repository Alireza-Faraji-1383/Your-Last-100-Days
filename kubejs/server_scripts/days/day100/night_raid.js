// priority: 60
// kubejs/server_scripts/days/day100/night_raid.js
//
// NIGHT 100 — "The Last Stand" (9 rounds, horde pattern) — FINALE.
// Everything at once, ending with the Dread Ravager (300 HP boss) and its
// full court. Survive this and the hundred days are won.
//   1. Omens      — 20 movement zombies + 12 miners + 10 pearl zombies
//   2. Shieldhost — 18 shield zombies + 12 champions (60 HP) + 8 fishers
//   3. Blacksky   — 20 crossbow skeletons + 10 trident drowned + 12 web spiders
//   4. Knighthost — 12 fast diamond knights + 14 iron zombies + 10 miners (40 HP)
//   5. Hexthrone  — 4 arch-evokers + 4 evokers + 16 vindicators
//   6. Beasttide  — 3 warbeasts + 12 champions (60 HP) + 10 pearl zombies
//   7. Undermine  — 20 miners (40 HP) + 12 iron blockers + 10 web spiders
//   8. Kingsguard — 2 warbeasts + 2 arch-evokers + 12 fast knights + 10 blockers
//   9. Last Stand — DREAD RAVAGER (300 HP) + 2 warbeasts + 3 arch-evokers
//                   + 12 iron blockers + 14 miners (40 HP)
//
// Depends on globals: Raid + RaidManager (raid_core.js), RaidSchedule (raid_schedule.js),
// RaidMobs (raid_definitions.js).

(function () {
    "use strict";

    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day100] missing globals — night 100 raid not scheduled");
        return;
    }

    var M = RaidMobs;

    var CHAMPION_60 = { type: M.AXE_CHAMPION.type, presets: M.AXE_CHAMPION.presets,
                        equip: M.AXE_CHAMPION.equip,
                        extraArgs: ["attributes/max_health=60"] };
    var FAST_KNIGHT = { type: M.DIAMOND_KNIGHT.type, presets: M.DIAMOND_KNIGHT.presets,
                        equip: M.DIAMOND_KNIGHT.equip, nbt: M.DIAMOND_KNIGHT.nbt,
                        extraArgs: ["attributes/movement_speed=0.3"] };
    // Finale boss: triple-health armored ravager.
    var DREAD_RAVAGER = { type: "minecraft:ravager",
                          extraArgs: ["attributes/max_health=300",
                                      "attributes/movement_speed=0.34",
                                      "attributes/attack_damage=18",
                                      "attributes/armor=10"] };

    Raid("day100_last_stand")
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(40)
        .followRange(300)
        .defaultPresets("farSight")
        .barColor("PURPLE")
        .barOverlay("NOTCHED_20")
        .barHold(400)            // let the victory bar linger on the finale
        .round("Omens")
            .breather(100)
            .timeLimit(3600)
            .mob(M.MOVEMENT_ZOMBIE).count(20)
            .mob(M.MINER_ZOMBIE).count(12)
            .mob(M.PEARL_ZOMBIE).count(10)
        .round("Shieldhost")
            .breather(100)
            .timeLimit(3600)
            .mob(M.SHIELD_ZOMBIE).count(18)
            .mob(CHAMPION_60).count(12)
            .mob(M.FISHER_ZOMBIE).count(8)
        .round("Blacksky")
            .breather(100)
            .timeLimit(3600)
            .mob(M.CROSSBOW_SKELETON).count(20)
            .mob(M.TRIDENT_DROWNED).count(10)
            .mob(M.WEB_SPIDER).count(12)
        .round("Knighthost")
            .breather(100)
            .timeLimit(3600)
            .mob(FAST_KNIGHT).count(12)
            .mob(M.IRON_ZOMBIE).count(14)
            .mob(M.MINER_STRONG).count(10)
        .round("Hexthrone")
            .breather(100)
            .timeLimit(3600)
            .mob(M.ARCH_EVOKER).count(4)
            .mob(M.EVOKER).count(4)
            .mob(M.VINDICATOR).count(16)
        .round("Beasttide")
            .breather(100)
            .timeLimit(4800)
            .mob(M.WARBEAST_RAVAGER).count(3)
            .mob(CHAMPION_60).count(12)
            .mob(M.PEARL_ZOMBIE).count(10)
        .round("Undermine")
            .breather(100)
            .timeLimit(3600)
            .mob(M.MINER_STRONG).count(20)
            .mob(M.IRON_BLOCKER).count(12)
            .mob(M.WEB_SPIDER).count(10)
        .round("Kingsguard")
            .breather(200)       // one breath before the end
            .timeLimit(4800)
            .mob(M.WARBEAST_RAVAGER).count(2)
            .mob(M.ARCH_EVOKER).count(2)
            .mob(FAST_KNIGHT).count(12)
            .mob(M.IRON_BLOCKER).count(10)
        .round("Last Stand")
            .timeLimit(14400)    // 12 min final boss round
            .mob(DREAD_RAVAGER).count(1)
            .mob(M.WARBEAST_RAVAGER).count(2)
            .mob(M.ARCH_EVOKER).count(3)
            .mob(M.IRON_BLOCKER).count(12)
            .mob(M.MINER_STRONG).count(14)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:netherite_block 2");
                ctx.player.give("minecraft:totem_of_undying 3");
                ctx.player.give("minecraft:enchanted_golden_apple 8");
                ctx.player.give("minecraft:nether_star 1");
                ctx.player.tell(Text.of("§6§lYou survived the hundred days."));
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(100, "day100_last_stand");
    console.info("[Day100] registered + scheduled 'day100_last_stand' for night 100");
})();
