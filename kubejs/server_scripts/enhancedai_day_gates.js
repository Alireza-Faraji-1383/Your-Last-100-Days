// priority: 99
// Progression gates for Enhanced AI. These affect only mobs that join after
// the threshold; existing mobs keep the behavior they spawned with.
(function () {
    "use strict";

    var TARGETING_CLASS = "insane96mcp.enhancedai.module.mobs.targeting.Targeting";
    var LEADERS_CLASS = "insane96mcp.enhancedai.module.mobs.Leaders";
    var XRAY_START_DAY = 19;   // after day 18
    var LEADERS_START_DAY = 26; // after day 25
    var LEADER_CHANCE = 0.03;  // the pack's original value
    var lastDay = -1;

    function worldDay(server) {
        try {
            var overworld = server.overworld();
            var time = (typeof overworld.getDayTime === "function")
                ? overworld.getDayTime() : overworld.dayTime;
            return Math.floor(Number(time) / 24000);
        } catch (e) {
            return 0;
        }
    }

    // 0% through day 18; then +10% every ten days, capped at the pack's
    // original 50% chance: days 19/29/39/49/59+ = 10/20/30/40/50%.
    function xrayChanceForDay(day) {
        if (day < XRAY_START_DAY) return 0.0;
        return Math.min(0.5, 0.1 * (1 + Math.floor((day - XRAY_START_DAY) / 10)));
    }

    function applyGates(server) {
        var day = worldDay(server);
        if (day === lastDay) return;

        try {
            var Targeting = Java.loadClass(TARGETING_CLASS);
            var Leaders = Java.loadClass(LEADERS_CLASS);
            var Double = Java.loadClass("java.lang.Double");

            var xrayChance = xrayChanceForDay(day);
            Targeting.xrayRangeOverrideChance = Double.valueOf(xrayChance);
            Leaders.leaderChance = Double.valueOf(day >= LEADERS_START_DAY ? LEADER_CHANCE : 0.0);
            lastDay = day;
            console.info("[EnhancedAI] day " + day + ": x-ray=" +
                xrayChance + ", leaders=" +
                (day >= LEADERS_START_DAY ? LEADER_CHANCE : 0));
        } catch (e) {
            console.error("[EnhancedAI] progression gates failed: " + e);
        }
    }

    ServerEvents.loaded(function (event) {
        applyGates(event.server);
    });

    ServerEvents.tick(function (event) {
        applyGates(event.server);
    });
})();
