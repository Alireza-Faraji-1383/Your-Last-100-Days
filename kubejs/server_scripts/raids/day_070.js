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
            .mob(M.FALLEN_KNIGHT).count(4)
            .mob(M.ZOMBIE_BRUISER).count(3)
            .mob(M.PUMPKINHEAD).count(2)
            .mob(M.SIAMESE_SKELETON).count(2)
            .mob(M.DREAD_HOUND).count(3)
            .mob(M.MINER_ELITE).count(7)
        // --- Round 2: siege breakers — the walls come down ---
        .round("Siege Breakers")
            .breather(200)
            .timeLimit(6000)
            .mob(M.DOOR_KNIGHT).count(4)
            .mob(M.TNT_CREEPER).count(5)
            .mob(M.DEMOMAN).count(2)
            .mob(M.TOSSER).count(2)
            .mob(M.BARREL_ZOMBIE).count(3)
            .mob(M.MINER_ELITE).count(7)
        // --- Round 3: the general's hounds and henchmen ---
        .round("The Henchmen")
            .breather(300)
            .timeLimit(6000)
            .mob(M.LIFESTEALER_BOSS).count(1)
            .mob(M.KRAMPUS_HENCHMAN).count(4)
            .mob(M.THRASHER).count(2)
            .mob(M.SCARLET_PERSECUTOR).count(2)
            .mob(M.DREAD_HOUND).count(3)
            .mob(M.ZOMBIE_CLOWN).count(2)
            .mob(M.MINER_ELITE).count(7)
        // --- Round 4 (FINAL): KRAMPUS ---
        .round("Krampus")
            .timeLimit(16800)
            .mob(M.KRAMPUS).count(1)
            .mob(M.KRAMPUS_HENCHMAN).count(4)
            .mob(M.FALLEN_KNIGHT).count(4)
            .mob(M.WITHER_KNIGHT).count(3)
            .mob(M.TOSSER).count(2)
            .mob(M.MINER_ELITE).count(7)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:netherite_scrap 4");
                ctx.player.give("minecraft:diamond_block 2");
                ctx.player.give("minecraft:enchanted_golden_apple 1");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(70, "day70_rotten_legion");
    console.info("[Day70] registered + scheduled 'day70_rotten_legion' for night 70");
})();
