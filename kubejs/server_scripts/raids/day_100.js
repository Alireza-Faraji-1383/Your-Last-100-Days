// priority: 60
// kubejs/server_scripts/raids/day_100.js
//
// NIGHT 100 — "The Last Dawn" (finale: everything comes at once)
// Six rounds recapping every chapter — rot, bones, breach, magic, elites —
// then IGNIS (Cataclysm, HP-balanced 400 -> 250) as the final boss.
// Survive this and the hundred days are over.

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day100] missing globals — night 100 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day100_last_dawn")
        .title("The Last Dawn")
        .spawn(68, 112)
        .aggroRadius(30)
        .defaultPresets("farSight", "antiCheese")
        .barColor("RED")
        // --- Round 1: the risen (chapter 1 echo) ---
        .round("The Risen")
            .breather(200)
            .timeLimit(7200)
            .mob(M.ZOMBIE_BRUISER).count(7)
            .mob(M.ROTTING_ZOMBIE).count(8)
            .mob(M.THRASHER).count(2)
            .mob(M.PUMPKIN_BRUISER).count(3)
            .mob(M.MINER_ELITE).count(5)
        // --- Round 2: the bones (chapter 2 echo) ---
        .round("The Bones")
            .breather(200)
            .timeLimit(7200)
            .mob(M.DECREPIT_SKELETON).count(7)
            .mob(M.BONESCALLER).count(3)
            .mob(M.DEMOMAN).count(4)
            .mob(M.ARMORED_SKELETON).count(5)
            .mob(M.MINER_ELITE).count(3)
        // --- Round 3: the breach — everything that digs, blasts or phases ---
        .round("The Breach")
            .breather(300)
            .timeLimit(8400)
            .mob(M.TNT_CREEPER).count(7)
            .mob(M.DOOR_KNIGHT).count(4)
            .mob(M.PEARL_ZOMBIE).count(6)
            .mob(M.PHANTOM_CREEPER).count(4)
            .mob(M.MINER_ELITE).count(6)
        // --- Round 4: the covenant (chapter 5 echo) ---
        .round("The Covenant")
            .breather(300)
            .timeLimit(8400)
            .mob(M.NECROMANCER).count(3)
            .mob(M.PYROMANCER).count(3)
            .mob(M.CRYOMANCER).count(3)
            .mob(M.ARCHEVOKER).count(3)
            .mob(M.PRIEST).count(2)
            .mob(M.TOSSER).count(3)
            .mob(M.MINER_ELITE).count(3)
        // --- Round 5: the elite guard ---
        .round("The Elite Guard")
            .breather(400)
            .timeLimit(10800)
            .mob(M.FALLEN_KNIGHT).count(4)
            .mob(M.APTRGANGR).count(2)
            .mob(M.ROYAL_DRAUGR).count(3)
            .mob(M.IGNITED_REVENANT).count(3)
            .mob(M.CITADEL_KEEPER).count(1)
            .mob(M.WATCHER).count(2)
            .mob(M.MINER_ELITE).count(4)
        // --- Round 6 (FINAL): IGNIS, the Last Flame ---
        .round("Ignis, the Last Flame")
            .timeLimit(20400)
            .mob(M.IGNIS).count(1)
            .mob(M.IGNITED_BERSERKER).count(4)
            .mob(M.SEARED_SPIRIT).count(4)
            .mob(M.PEARL_ZOMBIE).count(3)
            .mob(M.MINER_ELITE).count(3)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:netherite_ingot 4");
                ctx.player.give("minecraft:enchanted_golden_apple 3");
                ctx.player.give("irons_spellbooks:legendary_ink 1");
                ctx.player.give("minecraft:nether_star 1");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(100, "day100_last_dawn");
    console.info("[Day100] registered + scheduled 'day100_last_dawn' for night 100");
})();
