// priority: 60
// kubejs/server_scripts/days/day20/night_raid.js
//
// NIGHT 20 — "Pillager Siege"
// On the first nightfall on or after overworld day 20, every online player is
// besieged by the 3-round pillager_siege raid (Scouts -> Assault -> Warbeast),
// each in their own instance. The raid itself is registered in
// raids/raid_definitions.js; this file only schedules it.
//
// Depends on the RaidSchedule global (raids/raid_schedule.js, priority 85).

(function () {
    "use strict";

    if (typeof RaidSchedule === "undefined") {
        console.error("[Day20] RaidSchedule missing — raid_schedule.js not loaded; night 20 raid not scheduled");
        return;
    }

    RaidSchedule.onDay(20, "pillager_siege");
    console.info("[Day20] scheduled 'pillager_siege' for night 20");
})();
