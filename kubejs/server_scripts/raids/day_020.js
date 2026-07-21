// priority: 60
// kubejs/server_scripts/raids/day_020.js
//
// NIGHT 20 — "Night of Bones" (chapter 2: the graveyards empty out)
// Skeleton night: Born in Chaos bone mobs + armed vanilla marksmen. First
// taste of pearl infiltrators; bonescallers punish ignoring the backline.

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day20] missing globals — night 20 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day20_night_of_bones")
        .title("Night of Bones")
        .spawn(32, 48)
        .aggroRadius(24)
        .defaultPresets("farSight")
        .barColor("WHITE")
        // --- Round 1: brittle vanguard ---
        .round("Brittle Bones")
            .breather(200)
            .timeLimit(4800)
            .mob(M.DECREPIT_SKELETON).count(6)
            .mob(M.MINER_ZOMBIE).count(3)
        // --- Round 2: arrows from every direction ---
        .round("Marksmen")
            .breather(200)
            .timeLimit(4800)
            .mob(M.BOW_SKELETON).count(5)
            .mob(M.CROSSBOW_SKELETON).count(3)
            .mob(M.BABY_SKELETON).count(4)
        // --- Round 3: summoners + bomb throwers ---
        .round("The Callers")
            .breather(200)
            .timeLimit(6000)
            .mob(M.BONESCALLER).count(2)
            .mob(M.BONE_IMP).count(4)
            .mob(M.DEMOMAN).count(2)
            .mob(M.MINER_STRONG).count(3)
        // --- Round 4 (FINAL): the Thrasher walks ---
        .round("The Thrasher")
            .timeLimit(12000)
            .mob(M.THRASHER).count(1)
            .mob(M.DECREPIT_SKELETON).count(4)
            .mob(M.BOW_SKELETON).count(4)
            .mob(M.PEARL_ZOMBIE).count(2)
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
