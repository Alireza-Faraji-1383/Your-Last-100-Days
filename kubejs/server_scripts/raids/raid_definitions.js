// priority: 70
// kubejs/server_scripts/raids/raid_definitions.js
//
// Sample raid definitions + a commented auto/event trigger. Edit freely — this
// is the user-facing layer. Depends on the Raid builder + RaidManager globals
// (raid_core.js, priority 90). Preset names come from EnhancedAI.presets.

(function () {
    "use strict";

    if (typeof Raid === "undefined") { console.error("[Raid-def] Raid builder missing — raid_core.js not loaded"); return; }

    // ---- Mob archetypes ---------------------------------------------------
    // Reusable mob loadouts as plain objects matching the .mob() spec:
    //   { type, presets, extraArgs, equip, nbt, noDefaults }
    // Reference one with .mob(Mobs.X) and set the wave size with .count(n).
    // Each raid clones equip/nbt on use, so the same archetype is safe to reuse
    // across rounds/raids — chaining .equip()/.nbt() after .mob() won't leak back
    // into the shared object. defaultPresets() still merge in (unless noDefaults).
    var Mobs = {
        PILLAGER:         { type: "minecraft:pillager",   presets: ["mobile"] },
        VINDICATOR:       { type: "minecraft:vindicator", presets: ["mobile"] },
        VINDICATOR_LEAD:  { type: "minecraft:vindicator", presets: ["sharpTargeting"] },
        EVOKER:           { type: "minecraft:evoker",     presets: ["sharpTargeting"] },
        // Skeletons need a weapon to shoot — the bow re-enables the ranged goal.
        BOW_SKELETON:     { type: "minecraft:skeleton",   presets: ["mobile", "skirmisher"],
                            equip: { mainhand: "minecraft:bow", head: "minecraft:leather_helmet" } },
        // Full iron-armored, sworded zombie (variant via nbt).
        IRON_ZOMBIE:      { type: "minecraft:zombie",     presets: ["mobile"],
                            equip: { mainhand: "minecraft:iron_sword", head: "minecraft:iron_helmet", chest: "minecraft:iron_chestplate" },
                            nbt:   { IsBaby: false } },
        // Beefed-up boss ravager.
        WARBEAST_RAVAGER: { type: "minecraft:ravager",
                            extraArgs: ["attributes/max_health=150", "attributes/movement_speed=0.32"] }
    };

    // ---- Sample: pillager siege, 3 sequential rounds ----------------------
    // Aggro: mobs march on the target player by default, but retaliate against
    // anyone who hits them and attack players/villagers/iron golems within
    // aggroRadius — then return to the player. Loss = the FINAL round's timer
    // running out (set a .timeLimit on the last round); no prize on loss.
    Raid("pillager_siege")
        .spawn(18, 36)                 // ring 18–36 blocks around the player
        .aggroRadius(20)               // proactively attack villagers/players/golems within 20 blocks
        .followRange(200)              // detect + chase the player from up to 200 blocks
        .defaultPresets("farSight")    // every mob sees + hunts the player far away
        .round("Scouts")
            .breather(80)              // 4s pause after this round is cleared
            .timeLimit(2400)           // non-final round: force-advance after 2 min; survivors carry over
            .mob(Mobs.PILLAGER).count(5)
            .mob(Mobs.VINDICATOR_LEAD).count(2)
            .mob(Mobs.BOW_SKELETON).count(3)
        .round("Assault")
            .breather(100)
            .mob(Mobs.VINDICATOR).count(6)
            .mob(Mobs.IRON_ZOMBIE).count(4)
        .round("Warbeast")
            .timeLimit(3600)           // FINAL round timer (3 min) -> loss + no prize if not cleared
            .mob(Mobs.WARBEAST_RAVAGER).count(1)
            .mob(Mobs.EVOKER).count(1)
        // onWin fires ONLY on victory — loss skips it, so no prize on a timeout.
        .onWin(function (ctx) {
            try { ctx.player.give("minecraft:emerald_block 3"); } catch (e) {}
        })
        .build();

    // ---- Night triggers ---------------------------------------------------
    // Fire a registered raid on the first nightfall on/after the overworld
    // reaches a day count. Each online player gets their own instance.
    if (typeof RaidSchedule !== "undefined") {
        RaidSchedule.onDay(20, "pillager_siege");   // pillager siege on night 20
    } else {
        console.warn("[Raid-def] RaidSchedule missing — raid_schedule.js not loaded; skipping night triggers");
    }

    // ---- Modded mobs: any "modid:mob" type works (e.g. a Mowzie's/Alex's mob).
    // Equipment + nbt + EAI presets all apply the same way. Uncomment + adapt.
    //
    // Raid("modded_siege")
    //     .aggroRadius(24)
    //     .defaultPresets("farSight", "mobile")
    //     .round("Wave 1")
    //         .timeLimit(3000)        // final + only round: loss if not cleared in time
    //         .mob({ type: "alexsmobs:bunf-... ", count: 3, presets: ["sharpTargeting"],
    //                equip: { mainhand: "minecraft:netherite_axe" },
    //                nbt: { /* mod-specific variant/skin keys */ } })
    //     .onWin(function (ctx) { try { ctx.player.give("minecraft:diamond 5"); } catch (e) {} })
    //     .build();

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
