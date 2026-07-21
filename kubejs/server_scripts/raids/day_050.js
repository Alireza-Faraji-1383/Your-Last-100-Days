// priority: 60
// kubejs/server_scripts/raids/day_050.js
//
// NIGHT 50 — "The Arcane Covenant" (chapter 5: the mages pick a side)
// Iron's Spellbooks night. Battle mages + a healer priest that must die
// first. Miniboss finale: the Ancient Knight (citadel keeper, 120 HP).

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day50] missing globals — night 50 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day50_arcane_covenant")
        .title("The Arcane Covenant")
        .spawn(34, 52)
        .aggroRadius(26)
        .defaultPresets("farSight")
        .barColor("BLUE")
        // --- Round 1: expendable faithful ---
        .round("The Faithful")
            .breather(200)
            .timeLimit(4800)
            .mob(M.CULTIST).count(6)
            .mob(M.CATACOMBS_ZOMBIE).count(4)
            .mob(M.MINER_STRONG).count(3)
        // --- Round 2: fire and ice ---
        .round("Battle Mages")
            .breather(200)
            .timeLimit(6000)
            .mob(M.PYROMANCER).count(2)
            .mob(M.CRYOMANCER).count(2)
            .mob(M.CULTIST).count(4)
            .mob(M.PEARL_ZOMBIE).count(2)
        // --- Round 3: death magic + a healer keeping it all alive ---
        .round("Death Coven")
            .breather(200)
            .timeLimit(7200)
            .mob(M.NECROMANCER).count(2)
            .mob(M.PRIEST).count(1)
            .mob(M.ARCHEVOKER).count(1)
            .mob(M.CULTIST).count(4)
            .mob(M.MINER_ELITE).count(3)
        // --- Round 4 (FINAL): the Ancient Knight ---
        .round("The Ancient Knight")
            .timeLimit(12000)
            .mob(M.CITADEL_KEEPER).count(1)
            .mob(M.MAGEHUNTER).count(2)
            .mob(M.NECROMANCER).count(1)
            .mob(M.PYROMANCER).count(1)
        .onWin(function (ctx) {
            try {
                ctx.player.give("irons_spellbooks:arcane_essence 8");
                ctx.player.give("irons_spellbooks:rare_ink 2");
                ctx.player.give("minecraft:diamond_block 1");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(50, "day50_arcane_covenant");
    console.info("[Day50] registered + scheduled 'day50_arcane_covenant' for night 50");
})();
