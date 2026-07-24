// priority: 60
// kubejs/server_scripts/raids/day_040.js
//
// NIGHT 40 — "Night of Spirits" (chapter 4: the veil tears)
// A surrounding horror hunt: Born in Chaos spirits/hounds meet Mowzie's
// aerial predators. Phantom creepers and pearls make walls unreliable.

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
        .spawnPattern("ring")
        .aggroRadius(40)
        .followRange(300)
        .defaultPresets("farSight")
        .barColor("PURPLE")
        // --- Round 1: the restless dead ---
        .round("Restless Dead")
            .breather(200)
            .timeLimit(6000)
            .mob(M.RESTLESS_SPIRIT).count(7)
            .mob(M.SPIRIT_GUIDE).count(4)
            .mob(M.CORPSE_FLY).count(5)
            .mob(M.ROTTING_ZOMBIE_DARK).count(3)
            .mob(M.MINER_DARK).count(7)
        // --- Round 2: wisps, embers and bloodflies ---
        .round("Grave Lights")
            .breather(200)
            .timeLimit(6000)
            .mob(M.WITCH).count(1)
            .mob(M.FIRELIGHT).count(7)
            .mob(M.PUMPKIN_SPIRIT).count(4)
            .mob(M.SEARED_SPIRIT).count(2)
            .mob(M.BLOODY_GADFLY).count(4)
            .mob(M.NAGA).count(2)
            .mob(M.MINER_DARK).count(7)
        // --- Round 3: the hunt is loosed ---
        .round("The Hunt")
            .breather(200)
            .timeLimit(6000)
            .mob(M.DREAD_HOUND).count(5)
            .mob(M.HOUND_LEADER).count(1)
            .mob(M.PHANTOM_CREEPER).count(4)
            .mob(M.MOTHER_SPIDER).count(2)
            .mob(M.UMVUTHANA_RAPTOR).count(4)
            .mob(M.MINER_DARK).count(8)
        // --- Round 4 (FINAL): the Lifestealer miniboss leads the nightmares ---
        .round("The Nightmares")
            .timeLimit(14400)
            .mob(M.LIFESTEALER_BOSS).count(1)
            .mob(M.NIGHTMARE_STALKER).count(3)
            .mob(M.LIFESTEALER).count(1)
            .mob(M.HOUND_LEADER).count(2)
            .mob(M.NAGA).count(3)
            .mob(M.PEARL_ZOMBIE_ELITE).count(3)
            .mob(M.MINER_SPIRIT_ELITE).count(9)
        .onWin(function (ctx) {
            try {
      ctx.player.give("born_in_chaos_v1:ethereal_spirit 4");
      ctx.player.give("born_in_chaos_v1:spiritual_dust 12");
      ctx.player.give("minecraft:echo_shard 2");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(40, "day40_night_of_spirits");
    console.info("[Day40] registered + scheduled 'day40_night_of_spirits' for night 40");
})();
