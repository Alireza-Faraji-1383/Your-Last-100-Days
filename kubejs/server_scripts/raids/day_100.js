// priority: 60
// kubejs/server_scripts/raids/day_100.js
//
// NIGHT 100 — "The Last Dawn" (finale: everything comes at once)
// Six combined-arms rounds recapping every faction in the pack — wild hunt,
// bones, pirate breach, magic and elites — then IGNIS as the final boss.
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
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(40)
        .followRange(300)
        .defaultPresets("farSight", "antiCheese")
        .barColor("RED")
        // --- Round 1: the risen (chapter 1 echo) ---
        .round("The Risen")
            .breather(200)
            .timeLimit(6000)
            .mob(M.LIFESTEALER_BOSS).count(1)
            .mob(M.ZOMBIE_BRUISER).count(3)
            .mob(M.NAGA).count(3)
            .mob(M.UMVUTHANA).count(2)
            .mob(M.UMVUTHANA_RAPTOR).count(2)
            .mob(M.UMVUTHANA_CRANE).count(1)
            .mob(M.MINER_ELITE).count(9)
        // --- Round 2: the bones (chapter 2 echo) ---
        .round("The Bones")
            .breather(200)
            .timeLimit(6000)
            .mob(M.SIAMESE_SKELETON).count(2)
            .mob(M.BONESCALLER).count(3)
            .mob(M.SOUL_SKELETON).count(3)
            .mob(M.FROZEN_SKELETON).count(3)
            .mob(M.DEMOMAN).count(2)
            .mob(M.MINER_ELITE).count(8)
        // --- Round 3: the breach — everything that digs, blasts or phases ---
        .round("The Breach")
            .breather(300)
            .timeLimit(6000)
            .mob(M.PIRATE_CAPTAIN).count(1)
            .mob(M.CROSSBOW_PIRATE).count(4)
            .mob(M.PIRATE_ROOK).count(3)
            .mob(M.DOOR_KNIGHT).count(3)
            .mob(M.TNT_CREEPER).count(4)
            .mob(M.PHANTOM_CREEPER).count(2)
            .mob(M.MINER_ELITE).count(8)
        // --- Round 4: the covenant (chapter 5 echo) ---
        .round("The Covenant")
            .breather(300)
            .timeLimit(6000)
            .mob(M.MISSIONARY_BOSS).count(1)
            .mob(M.NECROMANCER).count(3)
            .mob(M.PYROMANCER).count(1)
            .mob(M.CRYOMANCER).count(1)
            .mob(M.ARCHEVOKER).count(2)
            .mob(M.PRIEST).count(1)
            .mob(M.APOTHECARIST).count(1)
            .mob(M.TOSSER).count(2)
            .mob(M.MINER_ELITE).count(9)
        // --- Round 5: the elite guard ---
        .round("The Elite Guard")
            .breather(400)
            .timeLimit(6000)
            .mob(M.FALLEN_KNIGHT).count(4)
            .mob(M.APTRGANGR).count(2)
            .mob(M.ROYAL_DRAUGR).count(2)
            .mob(M.IGNITED_REVENANT).count(2)
            .mob(M.ENDER_GOLEM).count(1)
            .mob(M.WATCHER).count(2)
            .mob(M.WITHER_KNIGHT).count(2)
            .mob(M.MINER_ELITE).count(8)
        // --- Round 6 (FINAL): IGNIS, the Last Flame ---
        .round("Ignis, the Last Flame")
            .timeLimit(20400)
            .mob(M.IGNIS).count(1)
            .mob(M.ASH_GUARD).count(3)
            .mob(M.FLAMING_SHOOTER).count(3)
            .mob(M.IGNITED_BERSERKER).count(3)
            .mob(M.SEARED_SPIRIT).count(2)
            .mob(M.PEARL_ZOMBIE).count(2)
            .mob(M.MINER_ELITE).count(7)
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
