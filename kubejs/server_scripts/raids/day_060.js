// priority: 60
// kubejs/server_scripts/raids/day_060.js
//
// NIGHT 60 — "The Court of the Deep" (chapter 6: the sea marches inland)
// Cataclysm deepling invasion reinforced by reef beasts and armored crabs;
// finale is a coralssus pair with a mixed breach escort.
// No anglers — fishing-hook mobs are banned from raids.
// Raids are waterproof by default — moats won't save anyone.

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day60] missing globals — night 60 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day60_rise_of_the_deep")
        .title("The Court of the Deep")
        .spawn(80, 100)
        .spawnPattern("ring")
        .aggroRadius(40)
        .followRange(300)
        .defaultPresets("farSight", "antiCheese")
        .barColor("BLUE")
        // --- Round 1: tidal vanguard ---
        .round("Tidal Vanguard")
            .breather(200)
            .timeLimit(6000)
            .mob(M.DEEPLING).count(8)
            .mob(M.TRIDENT_DROWNED).count(5)
            .mob(M.THORNSHELL_CRAB).count(3)
            .mob(M.URCHINKIN).count(4)
            .mob(M.MINER_ABYSSAL_SCOUT).count(7)
        // --- Round 2: the tide presses in ---
        .round("The Undertow")
            .breather(200)
            .timeLimit(6000)
            .mob(M.DEEPLING).count(5)
            .mob(M.DEEPLING_BRUTE).count(4)
            .mob(M.CLAWDIAN).count(5)
            .mob(M.CORAL_GOLEM).count(2)
            .mob(M.TRIDENT_DROWNED).count(2)
            .mob(M.MINER_ABYSSAL).count(7)
        // --- Round 3: abyssal clergy ---
        .round("Abyssal Clergy")
            .breather(300)
            .timeLimit(6000)
            .mob(M.DEEPLING_PRIEST).count(3)
            .mob(M.DEEPLING_WARLOCK).count(3)
            .mob(M.AMETHYST_CRAB).count(2)
            .mob(M.CLAWDIAN).count(4)
            .mob(M.DEEPLING_BRUTE).count(2)
            .mob(M.PEARL_ZOMBIE_ABYSSAL).count(2)
            .mob(M.MINER_ABYSSAL).count(8)
        // --- Round 4 (FINAL): coral colossi + reef guard ---
        .round("Coral Colossi")
            .timeLimit(14400)
            .mob(M.CORALSSUS).count(2)
            .mob(M.CORAL_GOLEM).count(3)
            .mob(M.CLAWDIAN).count(3)
            .mob(M.DEEPLING_WARLOCK).count(2)
            .mob(M.TNT_CREEPER).count(2)
            .mob(M.THORNSHELL_CRAB).count(2)
            .mob(M.MINER_ABYSSAL).count(8)
        .onWin(function (ctx) {
            try {
      ctx.player.give("minecraft:heart_of_the_sea 1");
      ctx.player.give("minecraft:trident 1");
      ctx.player.give("cataclysm:crystallized_coral_fragments 8");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(60, "day60_rise_of_the_deep");
    console.info("[Day60] registered + scheduled 'day60_rise_of_the_deep' for night 60");
})();
