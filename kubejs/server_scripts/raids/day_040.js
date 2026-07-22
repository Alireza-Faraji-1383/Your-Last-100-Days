// priority: 60
// kubejs/server_scripts/raids/day_040.js
//
// NIGHT 40 — "Night of Spirits" (chapter 4: the veil tears)
// Born in Chaos horror night: spirits, hounds, spider broods, phasing
// creepers. Walls stop mattering — phantom creepers slip straight through.

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day40] missing globals — night 40 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day40_night_of_spirits")
        .title("Night of Spirits")
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(40)
        .followRange(300)
        .defaultPresets("farSight")
        .barColor("PURPLE")
        // --- Round 1: the restless dead ---
        .round("Restless Dead")
            .breather(200)
            .timeLimit(6000)
            .mob(M.RESTLESS_SPIRIT).count(7)
            .mob(M.ROTTING_ZOMBIE).count(7)
            .mob(M.MINER_STRONG).count(4)
        // --- Round 2: wisps, embers and bloodflies ---
        .round("Grave Lights")
            .breather(200)
            .timeLimit(6000)
            .mob(M.FIRELIGHT).count(5)
            .mob(M.PUMPKIN_SPIRIT).count(5)
            .mob(M.SEARED_SPIRIT).count(3)
            .mob(M.BLOODY_GADFLY).count(5)
            .mob(M.MINER_STRONG).count(4)
        // --- Round 3: the hunt is loosed ---
        .round("The Hunt")
            .breather(200)
            .timeLimit(6000)
            .mob(M.DREAD_HOUND).count(7)
            .mob(M.HOUND_LEADER).count(2)
            .mob(M.PHANTOM_CREEPER).count(5)
            .mob(M.MOTHER_SPIDER).count(2)
            .mob(M.MINER_STRONG).count(4)
        // --- Round 4 (FINAL): the Lifestealer miniboss leads the nightmares ---
        .round("The Nightmares")
            .timeLimit(14400)
            .mob(M.LIFESTEALER_BOSS).count(1)
            .mob(M.NIGHTMARE_STALKER).count(2)
            .mob(M.LIFESTEALER).count(2)
            .mob(M.RESTLESS_SPIRIT).count(6)
            .mob(M.PEARL_ZOMBIE).count(3)
            .mob(M.MINER_ELITE).count(5)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:golden_apple 4");
                ctx.player.give("minecraft:ender_pearl 8");
                ctx.player.give("minecraft:diamond 8");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(40, "day40_night_of_spirits");
    console.info("[Day40] registered + scheduled 'day40_night_of_spirits' for night 40");
})();
