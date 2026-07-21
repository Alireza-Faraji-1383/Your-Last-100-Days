// priority: 60
// kubejs/server_scripts/raids/day_010.js
//
// NIGHT 10 — "The Rotting Dawn" (chapter 1: the dead wake up)
// Intro raid: vanilla + Born in Chaos rabble. Teaches the two core threats —
// waves of rot at the walls, and miners digging underneath them.
// Depends on globals: Raid + RaidManager (raid_core.js), RaidSchedule
// (raid_schedule.js), RaidMobs (raid_mobs.js).

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day10] missing globals — night 10 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day10_rotting_dawn")
        .title("The Rotting Dawn")
        .spawn(60, 90)
        .aggroRadius(24)
        .defaultPresets("farSight")
        .barColor("GREEN")
        // --- Round 1: first shamblers, miners probing the walls ---
        .round("Shamblers")
            .breather(200)
            .timeLimit(6000)
            .mob({ type: "minecraft:zombie", presets: ["mobile"],
                   equip: { head: "minecraft:iron_helmet" }, nbt: { IsBaby: false, Fire: -1 } }).count(4)
            .mob(M.ROTTING_ZOMBIE).count(6)
            .mob(M.MINER_ZOMBIE).count(3)
        // --- Round 2: Born in Chaos rot joins in ---
        .round("Grave Rot")
            .breather(200)
            .timeLimit(6000)
            .mob(M.ROTTING_ZOMBIE).count(6)
            .mob(M.LUMBERJACK).count(3)
            .mob(M.SWARMER).count(4)
            .mob(M.MINER_ZOMBIE).count(3)
        // --- Round 3 (FINAL): bruisers + maggot swarm + arrows ---
        .round("The Bruisers")
            .timeLimit(12000)
            .mob(M.ZOMBIE_BRUISER).count(3)
            .mob(M.MAGGOT).count(6)
            .mob(M.BOW_SKELETON).count(4)
            .mob(M.MINER_STRONG).count(3)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:iron_ingot 12");
                ctx.player.give("minecraft:bread 16");
                ctx.player.give("minecraft:emerald 8");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(10, "day10_rotting_dawn");
    console.info("[Day10] registered + scheduled 'day10_rotting_dawn' for night 10");
})();
