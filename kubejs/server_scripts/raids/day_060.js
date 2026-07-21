// priority: 60
// kubejs/server_scripts/raids/day_060.js
//
// NIGHT 60 — "Rise of the Deep" (chapter 6: the sea marches inland)
// Cataclysm deepling invasion. Anglers drag the player off walls with the
// mod's own hook AI; finale is a coralssus trio with breach support.
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
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(40)
        .followRange(300)
        .defaultPresets("farSight", "antiCheese")
        .barColor("BLUE")
        // --- Round 1: tidal vanguard ---
        .round("Tidal Vanguard")
            .breather(200)
            .timeLimit(6000)
            .mob(M.DEEPLING).count(8)
            .mob(M.TRIDENT_DROWNED).count(4)
            .mob(M.MINER_STRONG).count(5)
        // --- Round 2: hooks from the dark ---
        .round("The Anglers")
            .breather(200)
            .timeLimit(7200)
            .mob(M.DEEPLING_ANGLER).count(4)
            .mob(M.DEEPLING).count(5)
            .mob(M.DEEPLING_BRUTE).count(3)
            .mob(M.MINER_ELITE).count(5)
        // --- Round 3: abyssal clergy ---
        .round("Abyssal Clergy")
            .breather(300)
            .timeLimit(8400)
            .mob(M.DEEPLING_PRIEST).count(3)
            .mob(M.DEEPLING_WARLOCK).count(3)
            .mob(M.DEEPLING_BRUTE).count(4)
            .mob(M.PEARL_ZOMBIE).count(4)
            .mob(M.MINER_ELITE).count(4)
        // --- Round 4 (FINAL): coral colossi ---
        .round("Coral Colossi")
            .timeLimit(14400)
            .mob(M.CORALSSUS).count(3)
            .mob(M.DEEPLING_BRUTE).count(4)
            .mob(M.DEEPLING_WARLOCK).count(3)
            .mob(M.TNT_CREEPER).count(4)
            .mob(M.MINER_ELITE).count(4)
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
