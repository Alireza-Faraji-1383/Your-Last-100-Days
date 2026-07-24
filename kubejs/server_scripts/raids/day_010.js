// priority: 60
// kubejs/server_scripts/raids/day_010.js
//
// NIGHT 10 — "The Rotting Dawn" (chapter 1: the dead wake up)
// Intro raid: vanilla + Born in Chaos rabble marching as one horde. Teaches
// the two core threats — waves of rot at the walls, miners digging under.
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
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(40)
        .followRange(300)
        .defaultPresets("farSight")
        .barColor("GREEN")
        // --- Round 1: first shamblers, miners probing the walls ---
        .round("Shamblers")
            .breather(200)
            .timeLimit(6000)
            .mob(M.ROTTING_ZOMBIE).count(7)
            .mob(M.BARREL_ZOMBIE).count(3)
            .mob(M.MAGGOT).count(5)
            .mob(M.SWARMER).count(3)
            .mob(M.MINER_ZOMBIE).count(6)
        // --- Round 2: Born in Chaos rot joins in ---
        .round("Grave Rot")
            .breather(200)
            .timeLimit(6000)
            .mob(M.WITCH).count(1)
            .mob(M.LUMBERJACK).count(5)
            .mob(M.ZOMBIE_CLOWN).count(4)
            .mob(M.DREAD_HOUND).count(6)
            .mob(M.CORPSE_FLY).count(3)
            .mob(M.MINER_ZOMBIE).count(7)
        // --- Round 3 (FINAL): bruisers + maggot swarm + arrows ---
        .round("The Bruisers")
            .timeLimit(12000)
            .mob(M.ZOMBIE_BRUISER).count(3)
            .mob(M.PUMPKIN_BRUISER).count(3)
            .mob(M.PUMPKINHEAD).count(2)
            .mob(M.BOW_SKELETON).count(5)
            .mob(M.MAGGOT).count(3)
            .mob(M.MINER_LEATHER_STRONG).count(7)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:iron_ingot 16");
                ctx.player.give("minecraft:golden_apple 2");
                ctx.player.give("born_in_chaos_v1:pieceofdarkmetal 4");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(10, "day10_rotting_dawn");
    console.info("[Day10] registered + scheduled 'day10_rotting_dawn' for night 10");
})();
