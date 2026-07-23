// priority: 60
// kubejs/server_scripts/raids/day_090.js
//
// NIGHT 90 — "The Dark Concord" (chapter 9: every enemy signs one pact)
// Combined arms from every hostile faction: draugr, soul guards, mages,
// summoners, Ender constructs and aerial hunters across five role-led waves.

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day90] missing globals — night 90 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day90_dark_concord")
        .title("The Dark Concord")
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(40)
        .followRange(300)
        .defaultPresets("farSight", "antiCheese")
        .barColor("PURPLE")
        // --- Round 1: the draugr host ---
        .round("Draugr Host")
            .breather(200)
            .timeLimit(6000)
            .mob(M.DRAUGR).count(10)
            .mob(M.ELITE_DRAUGR).count(6)
            .mob(M.SOUL_SKELETON).count(4)
            .mob(M.MINER_ELITE).count(9)
        // --- Round 2: knights of chaos ---
        .round("Chaos Knights")
            .breather(200)
            .timeLimit(6000)
            .mob(M.FALLEN_KNIGHT).count(5)
            .mob(M.ROYAL_DRAUGR).count(2)
            .mob(M.DOOR_KNIGHT).count(4)
            .mob(M.WITHER_KNIGHT).count(2)
            .mob(M.TOSSER).count(2)
            .mob(M.ENDERMAPTERA).count(5)
            .mob(M.MINER_ELITE).count(8)
        // --- Round 3: the covenant reborn ---
        .round("Covenant Reborn")
            .breather(300)
            .timeLimit(6000)
            .mob(M.MISSIONARY_BOSS).count(1)
            .mob(M.NECROMANCER).count(4)
            .mob(M.ARCHEVOKER).count(4)
            .mob(M.CRYOMANCER).count(1)
            .mob(M.PRIEST).count(1)
            .mob(M.APOTHECARIST).count(3)
            .mob(M.PEARL_ZOMBIE).count(2)
            .mob(M.MINER_ELITE).count(9)
        // --- Round 4: the summoner (miniboss) ---
        .round("The Summoner")
            .breather(300)
            .timeLimit(6000)
            .mob(M.SUPREME_BONESCALLER).count(1)
            .mob(M.BONESCALLER).count(2)
            .mob(M.THRASHER).count(2)
            .mob(M.WATCHER).count(3)
            .mob(M.ENDERMAPTERA).count(4)
            .mob(M.TNT_CREEPER).count(3)
            .mob(M.MINER_ELITE).count(9)
        // --- Round 5 (FINAL): IGNIS with regular troops, no minibosses ---
        .round("Ignis, the Dark Flame")
            .timeLimit(16800)
            .mob(M.IGNIS).count(1)
            .mob(M.ROYAL_DRAUGR).count(2)
            .mob(M.FALLEN_KNIGHT).count(2)
            .mob(M.NIGHTMARE_STALKER).count(2)
            .mob(M.ELITE_DRAUGR).count(2)
            .mob(M.IGNITED_BERSERKER).count(2)
            .mob(M.NAGA).count(2)
            .mob(M.MINER_ELITE).count(9)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:netherite_ingot 2");
                ctx.player.give("minecraft:enchanted_golden_apple 2");
                ctx.player.give("irons_spellbooks:arcane_essence 12");
                ctx.player.give("irons_spellbooks:epic_ink 2");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(90, "day90_dark_concord");
    console.info("[Day90] registered + scheduled 'day90_dark_concord' for night 90");
})();
