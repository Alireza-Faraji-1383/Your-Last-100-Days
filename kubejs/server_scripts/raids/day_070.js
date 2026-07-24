// priority: 60
// kubejs/server_scripts/raids/day_070.js
//
// NIGHT 70 — "The Rotten Legion" (chapter 7: an army with a general)
// Born in Chaos elite army marching as one horde. Dedicated frontline,
// demolition and command waves culminate in Krampus and a wither guard.

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day70] missing globals — night 70 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day70_rotten_legion")
        .title("The Rotten Legion")
        .spawn(80, 100)
        .spawnPattern("horde")
        .aggroRadius(40)
        .followRange(300)
        .defaultPresets("farSight", "antiCheese")
        .barColor("RED")
        // --- Round 1: legion vanguard ---
        .round("Legion Vanguard")
            .breather(200)
            .timeLimit(6000)
            .mob(M.FALLEN_KNIGHT).count(5)
            .mob(M.ZOMBIE_BRUISER_CHAMPION).count(5)
            .mob(M.PUMPKINHEAD).count(3)
            .mob(M.SIAMESE_SKELETON).count(3)
            .mob(M.DREAD_HOUND).count(4)
            .mob(M.MINER_CHAMPION).count(8)
        // --- Round 2: siege breakers — the walls come down ---
        .round("Siege Breakers")
            .breather(200)
            .timeLimit(6000)
            .mob(M.DOOR_KNIGHT).count(5)
            .mob(M.TNT_CREEPER).count(6)
            .mob(M.DEMOMAN).count(2)
            .mob(M.TOSSER_CHAMPION).count(2)
            .mob(M.BARREL_ZOMBIE).count(4)
            .mob(M.MINER_CHAMPION).count(8)
        // --- Round 3: the general's hounds and henchmen ---
        .round("The Henchmen")
            .breather(300)
            .timeLimit(6000)
            .mob(M.WITCH).count(1)
            .mob(M.LIFESTEALER_BOSS).count(1)
            .mob(M.KRAMPUS_HENCHMAN).count(5)
            .mob(M.THRASHER).count(3)
            .mob(M.SCARLET_PERSECUTOR).count(2)
            .mob(M.DREAD_HOUND).count(3)
            .mob(M.ZOMBIE_CLOWN).count(2)
            .mob(M.MINER_CHAMPION).count(8)
        // --- Round 4 (FINAL): KRAMPUS ---
        .round("Krampus")
            .timeLimit(16800)
            .mob(M.KRAMPUS).count(1)
            .mob(M.KRAMPUS_HENCHMAN).count(4)
            .mob(M.FALLEN_KNIGHT).count(4)
            .mob(M.WITHER_KNIGHT).count(3)
            .mob(M.TOSSER_CHAMPION).count(2)
            .mob(M.MINER_CHAMPION).count(8)
        .onWin(function (ctx) {
            try {
      ctx.player.give("born_in_chaos_v1:dark_metal_ingot 8");
      ctx.player.give("born_in_chaos_v1:krampus_horn 1");
      ctx.player.give("born_in_chaos_v1:death_totem 1");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(70, "day70_rotten_legion");
    console.info("[Day70] registered + scheduled 'day70_rotten_legion' for night 70");
})();
