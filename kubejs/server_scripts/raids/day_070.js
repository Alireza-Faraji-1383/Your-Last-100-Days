// priority: 60
// kubejs/server_scripts/raids/day_070.js
//
// NIGHT 70 — "The Rotten Legion" (chapter 7: an army with a general)
// Born in Chaos elite army marching as one horde. Heaviest breach wave so
// far (door knights + TNT creepers + elite miners + pearls), then KRAMPUS
// walks in with his henchmen as the miniboss finale.

(function () {
    "use strict";
    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day70] missing globals — night 70 raid not scheduled");
        return;
    }
    var M = RaidMobs;

    Raid("day70_rotten_legion")
        .title("The Rotten Legion")
        .spawn(36, 54)
        .spawnPattern("horde")
        .aggroRadius(28)
        .defaultPresets("farSight")
        .barColor("RED")
        // --- Round 1: legion vanguard ---
        .round("Legion Vanguard")
            .breather(200)
            .timeLimit(6000)
            .mob(M.ZOMBIE_BRUISER).count(4)
            .mob(M.FALLEN_KNIGHT).count(2)
            .mob(M.ROTTING_ZOMBIE).count(6)
            .mob(M.MINER_ELITE).count(3)
        // --- Round 2: siege breakers — the walls come down ---
        .round("Siege Breakers")
            .breather(200)
            .timeLimit(6000)
            .mob(M.DOOR_KNIGHT).count(3)
            .mob(M.TNT_CREEPER).count(4)
            .mob(M.MINER_ELITE).count(4)
            .mob(M.PEARL_ZOMBIE).count(3)
        // --- Round 3: the general's hounds and henchmen ---
        .round("The Henchmen")
            .breather(300)
            .timeLimit(7200)
            .mob(M.KRAMPUS_HENCHMAN).count(4)
            .mob(M.DREAD_HOUND).count(4)
            .mob(M.THRASHER).count(1)
            .mob(M.SCARLET_PERSECUTOR).count(2)
        // --- Round 4 (FINAL): KRAMPUS ---
        .round("Krampus")
            .timeLimit(14400)
            .mob(M.KRAMPUS).count(1)
            .mob(M.KRAMPUS_HENCHMAN).count(2)
            .mob(M.ZOMBIE_BRUISER).count(3)
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
