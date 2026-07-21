// priority: 60
// kubejs/server_scripts/raids/day_080.js
//
// NIGHT 80 — "The Burning Siege" (chapter 8: the world starts to burn)
// Cataclysm ignited legion + kobold mercenaries + Born in Chaos fire
// spirits, one burning horde. Miniboss finale: MALEDICTUS (HP 200) with a
// wadjet sorcerer escort.

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day80] missing globals — night 80 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day80_burning_siege")
        .title("The Burning Siege")
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(40)
        .followRange(300)
        .defaultPresets("farSight", "antiCheese")
        .barColor("YELLOW")
        // --- Round 1: embers on the wind ---
        .round("Embers")
            .breather(200)
            .timeLimit(7200)
            .mob(M.SEARED_SPIRIT).count(5)
            .mob(M.INFERNAL_SPIRIT).count(4)
            .mob(M.BLAZE).count(4)
            .mob(M.KOBOLETON).count(4)
            .mob(M.MINER_ELITE).count(5)
        // --- Round 2: the ignited warband ---
        .round("Ignited Warband")
            .breather(200)
            .timeLimit(7200)
            .mob(M.IGNITED_BERSERKER).count(6)
            .mob(M.WITHER_SKELETON).count(5)
            .mob(M.DEMOMAN).count(4)
            .mob(M.KOBOLEDIATOR).count(2)
            .mob(M.MINER_ELITE).count(4)
        // --- Round 3: revenants breach the line ---
        .round("The Revenants")
            .breather(300)
            .timeLimit(8400)
            .mob(M.IGNITED_REVENANT).count(4)
            .mob(M.IGNITED_BERSERKER).count(4)
            .mob(M.PEARL_ZOMBIE).count(5)
            .mob(M.TNT_CREEPER).count(4)
            .mob(M.MINER_ELITE).count(5)
        // --- Round 4 (FINAL): MALEDICTUS ---
        .round("Maledictus")
            .timeLimit(16800)
            .mob(M.MALEDICTUS).count(1)
            .mob(M.WADJET).count(2)
            .mob(M.IGNITED_BERSERKER).count(3)
            .mob(M.SEARED_SPIRIT).count(4)
            .mob(M.MINER_ELITE).count(4)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:netherite_ingot 1");
                ctx.player.give("minecraft:netherite_scrap 4");
                ctx.player.give("minecraft:enchanted_golden_apple 1");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(80, "day80_burning_siege");
    console.info("[Day80] registered + scheduled 'day80_burning_siege' for night 80");
})();
