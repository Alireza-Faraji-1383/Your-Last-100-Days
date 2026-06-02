// priority: 70
// kubejs/server_scripts/raids/raid_definitions.js
//
// Sample raid definitions + a commented auto/event trigger. Edit freely — this
// is the user-facing layer. Depends on the Raid builder + RaidManager globals
// (raid_core.js, priority 90). Preset names come from EnhancedAI.presets.

(function () {
    "use strict";

    if (typeof Raid === "undefined") { console.error("[Raid-def] Raid builder missing — raid_core.js not loaded"); return; }

    // ---- Sample: pillager siege, 3 sequential rounds ----------------------
    Raid("pillager_siege")
        .spawn(18, 36)                 // ring 18–36 blocks around the player
        .defaultPresets("farSight")    // every mob sees + hunts the player far away
        .round("Scouts")
            .breather(80)              // 4s pause after this round is cleared
            .timeLimit(2400)           // force-advance after 2 min; survivors carry over
            .mob("minecraft:pillager").count(5).presets("mobile")
            .mob("minecraft:vindicator").count(2).presets("sharpTargeting")
        .round("Assault")
            .breather(100)
            .mob("minecraft:vindicator").count(6).presets("mobile")
            .mob("minecraft:pillager").count(4)
        .round("Warbeast")
            .mob("minecraft:ravager").count(1).extraArgs("attributes/max_health=150", "attributes/movement_speed=0.32")
            .mob("minecraft:evoker").count(1).presets("sharpTargeting")
        .onStart(function (ctx) {
            try { ctx.player.tell(Text.of("§c⚔ The pillager siege begins!")); } catch (e) {}
        })
        .onRoundStart(function (ctx, round, idx) {
            try {
                ctx.player.tell(Text.of("§6Round " + (idx + 1) + ": " + round.name));
                ctx.player.playSound("minecraft:event.raid.horn", 1.0, 1.0);
            } catch (e) {}
        })
        .onWin(function (ctx) {
            try {
                ctx.player.tell(Text.of("§a✔ Siege repelled — you win!"));
                ctx.player.give("minecraft:emerald_block 3");
            } catch (e) {}
        })
        .build();

    // ---- Sample auto/event trigger (commented — enable + adapt) -----------
    // Fires once when a player walks into a region. A tag guard prevents
    // re-triggering. Uncomment to use.
    //
    // PlayerEvents.tick(function (event) {
    //     var player = event.player;
    //     if (!player || player.tags.contains("siege_done")) return;
    //     var p = player.position();
    //     if (p.x > 1000 && p.x < 1100 && p.z > 1000 && p.z < 1100) {
    //         player.addTag("siege_done");
    //         var lvl = (typeof player.level === "function") ? player.level() : player.level;
    //         RaidManager.start(lvl, player, "pillager_siege");
    //     }
    // });

    console.info("[Raid-def] sample raids registered: " +
        (typeof RAIDS !== "undefined" ? Object.keys(RAIDS).join(", ") : "?"));
})();
