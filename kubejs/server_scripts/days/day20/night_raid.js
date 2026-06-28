// priority: 60
// kubejs/server_scripts/days/day20/night_raid.js
//
// NIGHT 20 — "Pillager Siege"
// On the first nightfall on or after overworld day 20, every online player is
// besieged by the 3-round pillager_siege raid, each in their own instance:
//   1. Scouts   — pillagers, vindicator lead, bow skeletons
//   2. Assault   — vindicators, iron zombies
//   3. Warbeast (FINAL, 3-min timer) — warbeast ravager + evoker.
//      Not cleared in time -> defeat, no prize.
// Win drops emerald blocks.
//
// Depends on globals: Raid + RaidManager (raids/raid_core.js, prio 90),
// RaidSchedule (raids/raid_schedule.js, prio 85), RaidMobs (raids/raid_definitions.js,
// prio 70) — all load before this file (prio 60).

(function () {
    "use strict";

    if (typeof Raid === "undefined" || typeof RaidSchedule === "undefined" || typeof RaidMobs === "undefined") {
        console.error("[Day20] missing globals (Raid/RaidSchedule/RaidMobs) — night 20 raid not scheduled");
        return;
    }

    var M = RaidMobs;

    Raid("pillager_siege")
        .spawn(18, 36)
        .aggroRadius(20)
        .followRange(200)
        .defaultPresets("farSight")
        .barColor("RED")
        .round("Scouts")
            .breather(80)
            .timeLimit(2400)
            .mob(M.PILLAGER).count(5)
            .mob(M.VINDICATOR_LEAD).count(2)
            .mob(M.BOW_SKELETON).count(3)
        .round("Assault")
            .breather(100)
            .mob(M.VINDICATOR).count(6)
            .mob(M.IRON_ZOMBIE).count(4)
        .round("Warbeast")
            .timeLimit(3600)
            .mob(M.WARBEAST_RAVAGER).count(1)
            .mob(M.EVOKER).count(1)
        .onWin(function (ctx) {
            try { ctx.player.give("minecraft:emerald_block 3"); } catch (e) {}
        })
        .build();

    RaidSchedule.onDay(20, "pillager_siege");
    console.info("[Day20] registered + scheduled 'pillager_siege' for night 20");
})();
