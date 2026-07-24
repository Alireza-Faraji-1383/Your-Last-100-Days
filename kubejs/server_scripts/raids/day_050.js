// priority: 60
// kubejs/server_scripts/raids/day_050.js
//
// NIGHT 50 — "The Arcane Covenant" (chapter 5: the mages pick a side)
// Iron's Spellbooks night. Necromancers are the covenant's skeleton-wizard
// summoners; the priest keeps everything alive — kill it first. Miniboss
// finale: the Ancient Knight (citadel keeper, 120 HP). antiCheese preset
// active from this night on: no pillar/boat cheese, mobs teleport to you.

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day50] missing globals — night 50 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day50_arcane_covenant")
        .title("The Arcane Covenant")
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(40)
        .followRange(300)
        .defaultPresets("farSight", "antiCheese")
        .barColor("BLUE")
        // --- Round 1: expendable faithful ---
        .round("The Faithful")
            .breather(200)
            .timeLimit(6000)
            .mob(M.CULTIST).count(8)
            .mob(M.CATACOMBS_ZOMBIE).count(6)
            .mob(M.APOTHECARIST).count(2)
            .mob(M.ICE_SPIDER).count(4)
            .mob(M.MINER_ARCANE).count(7)
        // --- Round 2: fire and ice ---
        .round("Battle Mages")
            .breather(200)
            .timeLimit(6000)
            .mob(M.PYROMANCER).count(3)
            .mob(M.CRYOMANCER).count(3)
            .mob(M.CULTIST).count(5)
            .mob(M.ARCHEVOKER).count(1)
            .mob(M.ICE_SPIDER).count(3)
            .mob(M.TOSSER_ELITE).count(2)
            .mob(M.MINER_ARCANE).count(8)
        // --- Round 3: the summoners + their healer ---
        .round("Death Coven")
            .breather(300)
            .timeLimit(6000)
            .mob(M.MISSIONARY_BOSS).count(1)
            .mob(M.NECROMANCER).count(4)
            .mob(M.PRIEST).count(3)
            .mob(M.APOTHECARIST).count(3)
            .mob(M.ARCHEVOKER).count(2)
            .mob(M.PEARL_ZOMBIE_ARCANE).count(2)
            .mob(M.MINER_ELITE).count(8)
        // --- Round 4 (FINAL): the Ancient Knight ---
        .round("The Ancient Knight")
            .timeLimit(14400)
            .mob(M.CITADEL_KEEPER).count(1)
            .mob(M.MAGEHUNTER).count(4)
            .mob(M.NECROMANCER).count(3)
            .mob(M.PYROMANCER).count(1)
            .mob(M.CRYOMANCER).count(1)
            .mob(M.APOTHECARIST).count(2)
            .mob(M.ICE_SPIDER).count(2)
            .mob(M.MINER_ELITE).count(8)
        .onWin(function (ctx) {
            try {
      ctx.player.give("irons_spellbooks:arcane_essence 16");
      ctx.player.give("irons_spellbooks:upgrade_orb 1");
      ctx.player.give("irons_spellbooks:mithril_ingot 4");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(50, "day50_arcane_covenant");
    console.info("[Day50] registered + scheduled 'day50_arcane_covenant' for night 50");
})();
