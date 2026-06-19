// priority: 60
// kubejs/server_scripts/days/day30/night_raid.js
//
// NIGHT 30 — "Midnight Onslaught" (harder, custom — defined inline here)
// On the first nightfall on or after overworld day 30, every online player faces
// a 4-round escalating horde, each in their own instance:
//   1. Diggers   — miner/fisher/pearl zombies + shield bruisers (the EAI trick trio)
//   2. Volley    — crossbow skeletons, trident drowned, web-shooting cave spiders
//   3. Heavy      — diamond knights, netherite-axe champions, gold husks
//   4. Twin Beasts (FINAL, 4-min timer) — 2 warbeast ravagers + an arch evoker.
//      Not cleared in time -> defeat, no prize.
// Win drops netherite + diamond blocks.
//
// NOTE: the miner zombie digs toward players via EAI's superMiner preset, which
// needs `/gamerule mobGriefing true`. Without it the miner just walks.
//
// Depends on globals: Raid + RaidManager (raids/raid_core.js, prio 90),
// RaidSchedule (raids/raid_schedule.js, prio 85), RaidMobs (raids/raid_definitions.js,
// prio 70) — all load before this file (prio 60).

(function () {
    "use strict";

    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day30] missing globals (Raid/RaidSchedule/RaidMobs) — night 30 raid not scheduled");
        return;
    }

    var M = RaidMobs;

    Raid("day30_onslaught")
        .spawn(20, 44)                 // wider ring than the day-20 siege
        .aggroRadius(24)
        .followRange(200)
        .defaultPresets("farSight")
        .barColor("PURPLE")            // distinct boss bar for the harder night
        .round("Diggers")
            .breather(80)
            .timeLimit(2600)           // survivors carry into Volley if not cleared
            .mob(M.MINER_ZOMBIE).count(3)
            .mob(M.FISHER_ZOMBIE).count(2)
            .mob(M.PEARL_ZOMBIE).count(2)
            .mob(M.SHIELD_ZOMBIE).count(3)
        .round("Volley")
            .breather(90)
            .timeLimit(2600)
            .mob(M.CROSSBOW_SKELETON).count(5)
            .mob(M.TRIDENT_DROWNED).count(3)
            .mob(M.WEB_SPIDER).count(3)
        .round("Heavy")
            .breather(100)
            .mob(M.DIAMOND_KNIGHT).count(3)
            .mob(M.AXE_CHAMPION).count(3)
            .mob(M.GOLD_HUSK).count(4)
        .round("Twin Beasts")
            .timeLimit(4800)           // FINAL round timer (4 min) -> loss + no prize
            .mob(M.WARBEAST_RAVAGER).count(2)
            .mob(M.ARCH_EVOKER).count(1)
        .onWin(function (ctx) {
            try {
                ctx.player.give("minecraft:netherite_ingot 2");
                ctx.player.give("minecraft:diamond_block 3");
            } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(30, "day30_onslaught");
    console.info("[Day30] registered + scheduled 'day30_onslaught' for night 30");
})();
