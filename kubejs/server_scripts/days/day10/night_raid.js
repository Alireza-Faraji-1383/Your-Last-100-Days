// priority: 60
// kubejs/server_scripts/days/day10/night_raid.js
//
// NIGHT 10 — "The Awakening" (5 rounds, introductory raid)
// Every online player faces escalating waves of the undead:
//   1. Shamblers    — 6 basic zombies + 3 miner zombies
//   2. Horde        — 12 leather-helmet zombies + 3 miner zombies
//   3. Crawlers     — 10 climbing/sprinting zombies + 5 bow skeletons + 3 miners
//   4. Swarm        — 10 movement zombies + 5 bow skeletons + 5 miners (40 HP)
//   5. Vanguard     — 3 iron shield-blockers + 8 web cave spiders + 5 miners (40 HP)
//
// Depends on globals: Raid + RaidManager (raid_core.js), RaidSchedule (raid_schedule.js),
// RaidMobs (raid_definitions.js).

(function () {
    "use strict";

    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day10] missing globals — night 10 raid not scheduled");
        return;
    }

    var M = RaidMobs;

    Raid("day10_awakening")
        .spawn(80, 100)         // ring 150–250 blocks around the player
        .aggroRadius(25)         // proactively attack villagers/players/golems within 25 blocks
        .followRange(300)        // detect + chase the player from up to 300 blocks
        .defaultPresets("farSight")
        .barColor("GREEN")
        .barHold(200)
        // --- Round 1: Shamblers ---
        .round("Shamblers")
            .breather(200)       // 10s pause
            .timeLimit(4800)     // 4 min
            // 6 basic zombies with iron helmet + fire immune
            .mob({ type: "minecraft:zombie", presets: ["mobile"], equip: { head: "minecraft:iron_helmet" }, nbt: { IsBaby: false, Fire: -1 } }).count(6)
            .mob(M.MINER_ZOMBIE).count(3)
        // --- Round 2: Horde ---
        .round("Horde")
            .breather(200)
            .timeLimit(4800)
            .mob(M.LEATHER_ZOMBIE).count(12)
            .mob(M.MINER_ZOMBIE).count(3)
        // --- Round 3: Crawlers ---
        .round("Crawlers")
            .breather(200)
            .timeLimit(4800)
            .mob(M.MOVEMENT_ZOMBIE).count(10)
            .mob(M.BOW_SKELETON).count(5)
            .mob(M.MINER_ZOMBIE).count(3)
        // --- Round 4: Swarm ---
        .round("Swarm")
            .breather(200)
            .timeLimit(4800)
            .mob(M.MOVEMENT_ZOMBIE).count(10)
            .mob(M.BOW_SKELETON).count(5)
            .mob(M.MINER_STRONG).count(5)
        // --- Round 5: Vanguard (FINAL) ---
        .round("Vanguard")
            .timeLimit(9600)     // 8 min final round
            .mob(M.IRON_BLOCKER).count(3)
            .mob(M.WEB_SPIDER).count(8)
            .mob(M.MINER_STRONG).count(5)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:emerald_block 2");
                ctx.player.give("minecraft:golden_apple 3");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(10, "day10_awakening");
    console.info("[Day10] registered + scheduled 'day10_awakening' for night 10");
})();
