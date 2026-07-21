// priority: 60
// kubejs/server_scripts/raids/day_060.js
//
// NIGHT 60 — "Rise of the Deep" (chapter 6: the sea marches inland)
// Cataclysm deepling invasion. Anglers + fishers drag the player off
// walls; the finale is a pair of coral colossi with breach support.
// Raids are waterproof by default — moats won't save anyone.

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day60] missing globals — night 60 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day60_rise_of_the_deep")
        .title("Rise of the Deep")
        .spawn(30, 50)
        .aggroRadius(26)
        .defaultPresets("farSight")
        .barColor("BLUE")
        // --- Round 1: tidal vanguard ---
        .round("Tidal Vanguard")
            .breather(200)
            .timeLimit(4800)
            .mob(M.DEEPLING).count(6)
            .mob(M.TRIDENT_DROWNED).count(3)
        // --- Round 2: hooks from the dark ---
        .round("The Anglers")
            .breather(200)
            .timeLimit(6000)
            .mob(M.DEEPLING_ANGLER).count(3)
            .mob(M.FISHER_ZOMBIE).count(3)
            .mob(M.DEEPLING).count(4)
            .mob(M.MINER_ELITE).count(3)
        // --- Round 3: abyssal clergy ---
        .round("Abyssal Clergy")
            .breather(200)
            .timeLimit(7200)
            .mob(M.DEEPLING_PRIEST).count(2)
            .mob(M.DEEPLING_WARLOCK).count(2)
            .mob(M.DEEPLING_BRUTE).count(3)
            .mob(M.PEARL_ZOMBIE).count(3)
        // --- Round 4 (FINAL): coral colossi ---
        .round("Coral Colossi")
            .timeLimit(12000)
            .mob(M.CORALSSUS).count(2)
            .mob(M.DEEPLING_BRUTE).count(3)
            .mob(M.DEEPLING_WARLOCK).count(2)
            .mob(M.TNT_CREEPER).count(3)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:trident 1");
                ctx.player.give("minecraft:diamond 10");
                ctx.player.give("minecraft:golden_apple 3");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(60, "day60_rise_of_the_deep");
    console.info("[Day60] registered + scheduled 'day60_rise_of_the_deep' for night 60");
})();
