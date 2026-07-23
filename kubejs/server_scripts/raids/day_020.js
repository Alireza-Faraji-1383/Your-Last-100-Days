// priority: 60
// kubejs/server_scripts/raids/day_020.js
//
// NIGHT 20 — "Night of Bones" (chapter 2: the graveyards empty out)
// Encirclement night: Born in Chaos bone mobs, Block Factory soul/frost
// skeletons and armed vanilla marksmen. Web artillery + first pearls.

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day20] missing globals — night 20 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day20_night_of_bones")
        .title("Night of Bones")
        .spawn(80, 100)
        .spawnPattern("ring")
        .aggroRadius(40)
        .followRange(300)
        .defaultPresets("farSight")
        .barColor("WHITE")
        // --- Round 1: brittle vanguard ---
        .round("Brittle Bones")
            .breather(200)
            .timeLimit(6000)
            .mob(M.DECREPIT_SKELETON).count(9)
            .mob(M.BONE_IMP).count(5)
            .mob(M.BABY_SKELETON).count(4)
            .mob(M.MINER_ZOMBIE).count(7)
        // --- Round 2: arrows from every direction ---
        .round("Marksmen")
            .breather(200)
            .timeLimit(6000)
            .mob(M.BOW_SKELETON).count(10)
            .mob(M.ARMORED_SKELETON).count(7)
            .mob(M.BABY_SKELETON).count(3)
            .mob(M.MINER_ZOMBIE).count(6)
        // --- Round 3: summoners + bomb throwers + webs ---
        .round("The Callers")
            .breather(200)
            .timeLimit(6000)
            .mob(M.BONESCALLER).count(4)
            .mob(M.SIAMESE_SKELETON).count(3)
            .mob(M.DEMOMAN).count(3)
            .mob(M.WEB_SPIDER).count(5)
            .mob(M.SOUL_SKELETON).count(2)
            .mob(M.MINER_STRONG).count(7)
        // --- Round 4 (FINAL): the Thrashers walk ---
        .round("The Thrashers")
            .timeLimit(14400)
            .mob(M.THRASHER).count(3)
            .mob(M.SIAMESE_SKELETON).count(2)
            .mob(M.SOUL_SKELETON).count(4)
            .mob(M.BOW_SKELETON).count(4)
            .mob(M.PEARL_ZOMBIE).count(2)
            .mob(M.MINER_STRONG).count(7)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:emerald 12");
                ctx.player.give("minecraft:experience_bottle 16");
                ctx.player.give("minecraft:lapis_lazuli 24");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(20, "day20_night_of_bones");
    console.info("[Day20] registered + scheduled 'day20_night_of_bones' for night 20");
})();
