// priority: 60
// kubejs/server_scripts/raids/day_030.js
//
// NIGHT 30 — "The Warband" (chapter 3: men are worse than monsters)
// Illagers, pirate mercenaries and spell-hunters march as one army. Real
// siege roles: crossfire, TNT creepers, door knights, throwers and miners.

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day30] missing globals — night 30 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day30_warband")
        .title("The Warband")
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(40)
        .followRange(300)
        .defaultPresets("farSight")
        .barColor("RED")
        // --- Round 1: raiding party ---
        .round("Raiding Party")
            .breather(200)
            .timeLimit(6000)
            .mob(M.PILLAGER).count(8)
            .mob(M.VINDICATOR).count(5)
            .mob(M.CROSSBOW_PIRATE).count(4)
            .mob(M.PIRATE_ROOK).count(2)
            .mob(M.MINER_DIAMOND).count(7)
        // --- Round 2: sappers hit the walls ---
        .round("Sappers")
            .breather(200)
            .timeLimit(6000)
            .mob(M.TNT_CREEPER).count(6)
            .mob(M.DOOR_KNIGHT).count(4)
            .mob(M.DEMOMAN).count(2)
            .mob(M.BARREL_ZOMBIE).count(4)
            .mob(M.TOSSER).count(2)
            .mob(M.MINER_VETERAN).count(7)
        // --- Round 3: the warlocks' escort ---
        .round("The Warlocks")
            .breather(200)
            .timeLimit(6000)
            .mob(M.WITCH).count(1)
            .mob(M.EVOKER).count(2)
            .mob(M.APOTHECARIST).count(1)
            .mob(M.MAGEHUNTER).count(3)
            .mob(M.VINDICATOR).count(5)
            .mob(M.PILLAGER).count(4)
            .mob(M.PEARL_ZOMBIE_VETERAN).count(2)
            .mob(M.MINER_VETERAN).count(7)
        // --- Round 4 (FINAL): Missionary + pirate captain + warbeasts ---
        .round("The Warbeasts")
            .timeLimit(14400)
            .mob(M.MISSIONARY_BOSS).count(1)
            .mob(M.PIRATE_CAPTAIN).count(1)
            .mob(M.WARBEAST_RAVAGER).count(3)
            .mob(M.VINDICATOR_ELITE).count(4)
            .mob(M.CROSSBOW_PIRATE).count(4)
            .mob(M.MINER_VETERAN).count(9)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:diamond 6");
                ctx.player.give("minecraft:emerald_block 2");
                ctx.player.give("minecraft:totem_of_undying 1");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(30, "day30_warband");
    console.info("[Day30] registered + scheduled 'day30_warband' for night 30");
})();
