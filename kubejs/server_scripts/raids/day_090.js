// priority: 60
// kubejs/server_scripts/raids/day_090.js
//
// NIGHT 90 — "The Dark Concord" (chapter 9: every enemy signs one pact)
// Combined arms: Cataclysm draugr host, Born in Chaos knights, Iron's
// Spellbooks covenant — five rounds, two minibosses (Supreme Bonescaller,
// then a Aptrgangr pair finale).

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day90] missing globals — night 90 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day90_dark_concord")
        .title("The Dark Concord")
        .spawn(32, 52)
        .aggroRadius(28)
        .defaultPresets("farSight")
        .barColor("PURPLE")
        // --- Round 1: the draugr host ---
        .round("Draugr Host")
            .breather(200)
            .timeLimit(6000)
            .mob(M.DRAUGR).count(6)
            .mob(M.ELITE_DRAUGR).count(3)
            .mob(M.MINER_ELITE).count(4)
        // --- Round 2: knights of chaos ---
        .round("Chaos Knights")
            .breather(200)
            .timeLimit(6000)
            .mob(M.FALLEN_KNIGHT).count(4)
            .mob(M.ROYAL_DRAUGR).count(2)
            .mob(M.DOOR_KNIGHT).count(3)
        // --- Round 3: the covenant reborn ---
        .round("Covenant Reborn")
            .breather(300)
            .timeLimit(7200)
            .mob(M.NECROMANCER).count(2)
            .mob(M.ARCHEVOKER).count(2)
            .mob(M.CRYOMANCER).count(2)
            .mob(M.PRIEST).count(1)
            .mob(M.PEARL_ZOMBIE).count(4)
        // --- Round 4: the summoner (miniboss) ---
        .round("The Summoner")
            .breather(300)
            .timeLimit(9600)
            .mob(M.SUPREME_BONESCALLER).count(1)
            .mob(M.BONESCALLER).count(2)
            .mob(M.THRASHER).count(2)
            .mob(M.TNT_CREEPER).count(4)
        // --- Round 5 (FINAL): the risen giants ---
        .round("The Risen Giants")
            .timeLimit(14400)
            .mob(M.APTRGANGR).count(2)
            .mob(M.NIGHTMARE_STALKER).count(1)
            .mob(M.ELITE_DRAUGR).count(4)
            .mob(M.MINER_ELITE).count(4)
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
