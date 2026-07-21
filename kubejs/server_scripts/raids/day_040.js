// priority: 60
// kubejs/server_scripts/raids/day_040.js
//
// NIGHT 40 — "Night of Spirits" (chapter 4: the veil tears)
// Born in Chaos horror night: spirits, hounds, phasing creepers. Walls stop
// mattering — phantom creepers slip through, fishers reel you off towers.

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day40] missing globals — night 40 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day40_night_of_spirits")
        .title("Night of Spirits")
        .spawn(30, 50)
        .aggroRadius(26)
        .defaultPresets("farSight")
        .barColor("PURPLE")
        // --- Round 1: the restless dead ---
        .round("Restless Dead")
            .breather(200)
            .timeLimit(4800)
            .mob(M.RESTLESS_SPIRIT).count(5)
            .mob(M.ROTTING_ZOMBIE).count(4)
            .mob(M.MINER_STRONG).count(2)
        // --- Round 2: wisps and embers ---
        .round("Grave Lights")
            .breather(200)
            .timeLimit(6000)
            .mob(M.FIRELIGHT).count(3)
            .mob(M.PUMPKIN_SPIRIT).count(3)
            .mob(M.SEARED_SPIRIT).count(2)
            .mob(M.FISHER_ZOMBIE).count(2)
        // --- Round 3: the hunt is loosed ---
        .round("The Hunt")
            .breather(200)
            .timeLimit(6000)
            .mob(M.DREAD_HOUND).count(4)
            .mob(M.HOUND_LEADER).count(1)
            .mob(M.PHANTOM_CREEPER).count(3)
        // --- Round 4 (FINAL): the nightmare itself ---
        .round("The Nightmare")
            .timeLimit(12000)
            .mob(M.NIGHTMARE_STALKER).count(1)
            .mob(M.LIFESTEALER).count(2)
            .mob(M.RESTLESS_SPIRIT).count(4)
            .mob(M.PEARL_ZOMBIE).count(3)
            .mob(M.MINER_STRONG).count(3)
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
