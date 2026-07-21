// priority: 60
// kubejs/server_scripts/raids/day_020.js
//
// NIGHT 20 — "Night of Bones" (chapter 2: the graveyards empty out)
// Skeleton night: Born in Chaos bone mobs + armed vanilla marksmen (bows
// only — skeleton AI can't fire crossbows). Web spiders + first pearls.

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
        .spawnPattern("horde")
        .aggroRadius(40)
        .followRange(300)
        .defaultPresets("farSight")
        .barColor("WHITE")
        // --- Round 1: brittle vanguard ---
        .round("Brittle Bones")
            .breather(200)
            .timeLimit(6000)
            .mob(M.DECREPIT_SKELETON).count(10)
            .mob(M.BONE_IMP).count(4)
            .mob(M.MINER_ZOMBIE).count(4)
        // --- Round 2: arrows from every direction ---
        .round("Marksmen")
            .breather(200)
            .timeLimit(6000)
            .mob(M.BOW_SKELETON).count(7)
            .mob(M.ARMORED_SKELETON).count(5)
            .mob(M.BABY_SKELETON).count(8)
            .mob(M.MINER_ZOMBIE).count(4)
        // --- Round 3: summoners + bomb throwers + webs ---
        .round("The Callers")
            .breather(200)
            .timeLimit(7200)
            .mob(M.BONESCALLER).count(3)
            .mob(M.BONE_IMP).count(6)
            .mob(M.DEMOMAN).count(4)
            .mob(M.WEB_SPIDER).count(5)
            .mob(M.MINER_STRONG).count(4)
        // --- Round 4 (FINAL): the Thrashers walk ---
        .round("The Thrashers")
            .timeLimit(14400)
            .mob(M.THRASHER).count(2)
            .mob(M.DECREPIT_SKELETON).count(7)
            .mob(M.BOW_SKELETON).count(6)
            .mob(M.PEARL_ZOMBIE).count(4)
            .mob(M.MINER_STRONG).count(4)
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
