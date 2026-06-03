// priority: 50
// kubejs/server_scripts/quests/ftbquests_day_spine.js
//
// 100-day progression spine. Grants FTB Teams stages day_10 / day_25 / day_50 /
// day_100 to every team as the overworld day count crosses each milestone.
// Gated quest chapters carry a `gamestage` task on those stages (see chapters/).
//
// Stages are idempotent (addTeamStage no-ops if present), so we just re-assert
// every milestone <= current day on a throttled tick. Rhino: var-only.

(function () {
    "use strict";

    var FTBTeamsAPI      = Java.loadClass("dev.ftb.mods.ftbteams.api.FTBTeamsAPI");
    var TeamStagesHelper = Java.loadClass("dev.ftb.mods.ftbteams.api.TeamStagesHelper");

    var MILESTONES = [10, 25, 50, 100];
    var CHECK_EVERY = 100;   // server ticks between checks (~5s)
    var _accum = 0;

    function warn(m) { console.warn("[DaySpine] " + m); }

    function currentDay(server) {
        try {
            var ow = server.overworld();
            var t = (typeof ow.getDayTime === "function") ? ow.getDayTime() : ow.dayTime;
            return Math.floor(Number(t) / 24000);
        } catch (e) { return 0; }
    }

    function eachTeam(fn) {
        try {
            var mgr = FTBTeamsAPI.api().getManager();
            var teams = mgr.getTeams();
            var it = teams.iterator();
            while (it.hasNext()) fn(it.next());
        } catch (e) { warn("team iteration: " + e); }
    }

    ServerEvents.tick(function (event) {
        _accum++;
        if (_accum < CHECK_EVERY) return;
        _accum = 0;
        var server = event.server;
        var day = currentDay(server);
        if (day < MILESTONES[0]) return;
        eachTeam(function (team) {
            for (var i = 0; i < MILESTONES.length; i++) {
                if (day >= MILESTONES[i]) {
                    var stage = "day_" + MILESTONES[i];
                    try {
                        if (!TeamStagesHelper.hasTeamStage(team, stage))
                            TeamStagesHelper.addTeamStage(team, stage);
                    } catch (e) { warn("addTeamStage " + stage + ": " + e); }
                }
            }
        });
    });

    console.info("[DaySpine] ready — milestones " + MILESTONES.join(", "));
})();
