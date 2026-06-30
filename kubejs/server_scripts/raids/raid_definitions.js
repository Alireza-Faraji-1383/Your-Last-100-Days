// priority: 70
// kubejs/server_scripts/raids/raid_definitions.js
//
// Reusable mob archetypes (exported as the RaidMobs global) + shared raid
// definitions. The user-facing library layer. Per-night triggers live in their
// own files under days/<dayN>/night_raid.js (priority 60), which reference these
// raids/archetypes. Depends on the Raid builder + RaidManager globals
// (raid_core.js, priority 90). Preset names come from EnhancedAI.presets.

(function (global) {
    "use strict";

    if (typeof Raid === "undefined") { console.error("[Raid-def] Raid builder missing — raid_core.js not loaded"); return; }

    // ---- Mob archetypes (exported as the global RaidMobs) -----------------
    // Reusable mob loadouts as plain objects matching the .mob() spec:
    //   { type, presets, extraArgs, equip, nbt, noDefaults }
    // Reference one with .mob(RaidMobs.X) and set the wave size with .count(n).
    // Each raid clones equip/nbt on use, so the same archetype is safe to reuse
    // across rounds/raids — chaining .equip()/.nbt() after .mob() won't leak back
    // into the shared object. defaultPresets() still merge in (unless noDefaults).
    // Day files under days/<dayN>/ read these via the RaidMobs global.
    //
    // EAI behavior presets used below (insane96 EnhancedAI):
    //   superMiner   — digs straight toward the player (needs gamerule mobGriefing true)
    //   fisherAggro  — casts a rod and reels the player in
    //   pearlThrower — throws ender pearls to teleport onto the player
    //   webShooter   — fires sticky/poison webs from range
    //   skirmisher   — ranged strafe + kite (skeletons/crossbows)
    var Mobs = {
        // --- Illagers ---
        PILLAGER:         { type: "minecraft:pillager",   presets: ["mobile"] },
        VINDICATOR:       { type: "minecraft:vindicator", presets: ["mobile"] },
        VINDICATOR_LEAD:  { type: "minecraft:vindicator", presets: ["sharpTargeting"] },
        EVOKER:           { type: "minecraft:evoker",     presets: ["sharpTargeting"] },
        // Axe-wielding heavy vindicator (netherite axe + iron armor).
        AXE_CHAMPION:     { type: "minecraft:vindicator", presets: ["mobile"],
                            equip: { mainhand: "minecraft:netherite_axe", head: "minecraft:iron_helmet", chest: "minecraft:iron_chestplate" } },

        // --- Ranged ---
        // Skeletons need a weapon to shoot — the bow re-enables the ranged goal.
        BOW_SKELETON:     { type: "minecraft:skeleton",   presets: ["mobile", "skirmisher"],
                            equip: { mainhand: "minecraft:bow", head: "minecraft:iron_helmet" },
                            nbt:   { Fire: -1 } },
        CROSSBOW_SKELETON:{ type: "minecraft:skeleton",   presets: ["mobile", "skirmisher"],
                            equip: { mainhand: "minecraft:crossbow", chest: "minecraft:chainmail_chestplate" } },
        TRIDENT_DROWNED:  { type: "minecraft:drowned",    presets: ["mobile", "skirmisher"],
                            equip: { mainhand: "minecraft:trident" } },

        // --- Zombies: weapons + armor ---
        // Full iron-armored, sworded zombie (variant via nbt).
        IRON_ZOMBIE:      { type: "minecraft:zombie",     presets: ["mobile"],
                            equip: { mainhand: "minecraft:iron_sword", head: "minecraft:iron_helmet", chest: "minecraft:iron_chestplate" },
                            nbt:   { IsBaby: false } },
        // Boss-grade zombie: diamond kit head-to-toe.
        DIAMOND_KNIGHT:   { type: "minecraft:zombie",     presets: ["mobile"],
                            equip: { mainhand: "minecraft:diamond_sword",
                                     head: "minecraft:diamond_helmet", chest: "minecraft:diamond_chestplate",
                                     legs: "minecraft:diamond_leggings", feet: "minecraft:diamond_boots" },
                            nbt:   { IsBaby: false } },
        // Sword + shield bruiser (offhand shield blocks frontal hits).
        SHIELD_ZOMBIE:    { type: "minecraft:zombie",     presets: ["mobile"],
                            equip: { mainhand: "minecraft:iron_sword", offhand: "minecraft:shield",
                                     head: "minecraft:iron_helmet", chest: "minecraft:iron_chestplate" },
                            nbt:   { IsBaby: false } },
        // Gold-armored husk shock trooper.
        GOLD_HUSK:        { type: "minecraft:husk",       presets: ["mobile"],
                            equip: { mainhand: "minecraft:golden_sword",
                                     head: "minecraft:golden_helmet", chest: "minecraft:golden_chestplate" } },

        // --- Zombies: EAI special behaviors (the requested trio + extras) ---
        // Miner: digs straight toward the player. tool_requirement=NONE so it
        // mines without the pickaxe; EAI wipes mob hands on a few post-spawn
        // ticks, so the pickaxe is best-effort cosmetic. Needs mobGriefing true.
        MINER_ZOMBIE:     { type: "minecraft:zombie",     presets: ["mobile", "superMiner"],
                            equip: { mainhand: "minecraft:iron_pickaxe", head: "minecraft:iron_helmet" },
                            nbt:   { Fire: -1 } },
        // Fisher: casts a rod and reels the player in. EAI auto-equips the rod;
        // we equip one too so it always has it.
        FISHER_ZOMBIE:    { type: "minecraft:zombie",     presets: ["mobile", "fisherAggro"],
                            equip: { mainhand: "minecraft:fishing_rod", head: "minecraft:leather_helmet" } },
        // Pearl: throws ender pearls to teleport onto the player. EAI handles
        // the throw; ender_pearl in hand makes that visible.
        PEARL_ZOMBIE:     { type: "minecraft:zombie",     presets: ["mobile", "pearlThrower"],
                            equip: { mainhand: "minecraft:ender_pearl" } },

        // --- Day 10 archetypes ---
        // Leather-helmet zombie → now iron helmet + fire immune (round 2).
        LEATHER_ZOMBIE:   { type: "minecraft:zombie",     presets: ["mobile"],
                            equip: { head: "minecraft:iron_helmet" },
                            nbt:   { IsBaby: false, Fire: -1 } },
        // Full movement zombie: climbing + sprint via entity tags, mobile preset.
        MOVEMENT_ZOMBIE:  { type: "minecraft:zombie",     presets: ["mobile"],
                            equip: { head: "minecraft:iron_helmet" },
                            nbt:   { IsBaby: false, Fire: -1 } },
        // Miner with double health (40 HP).
        MINER_STRONG:     { type: "minecraft:zombie",     presets: ["mobile", "superMiner"],
                            equip: { mainhand: "minecraft:iron_pickaxe", head: "minecraft:iron_helmet" },
                            nbt:   { Fire: -1 },
                            extraArgs: ["attributes/max_health=40"] },
        // Iron tank: full iron + sword + shield + blocking (shielding via entity tag).
        IRON_BLOCKER:     { type: "minecraft:zombie",     presets: ["mobile"],
                            equip: { mainhand: "minecraft:iron_sword", offhand: "minecraft:shield",
                                     head: "minecraft:iron_helmet", chest: "minecraft:iron_chestplate",
                                     legs: "minecraft:iron_leggings", feet: "minecraft:iron_boots" },
                            nbt:   { IsBaby: false, Fire: -1 } },

        // --- Spiders ---
        WEB_SPIDER:       { type: "minecraft:cave_spider", presets: ["mobile", "webShooter"],
                            equip: { head: "minecraft:iron_helmet" },
                            nbt:   { Fire: -1 } },

        // --- Bosses ---
        // Beefed-up boss ravager.
        WARBEAST_RAVAGER: { type: "minecraft:ravager",
                            extraArgs: ["attributes/max_health=150", "attributes/movement_speed=0.32"] },
        // Tankier evoker for harder nights.
        ARCH_EVOKER:      { type: "minecraft:evoker",     presets: ["sharpTargeting"],
                            extraArgs: ["attributes/max_health=80"] }
    };
    global.RaidMobs = Mobs;   // expose archetypes to day files (days/<dayN>/)

    // ---- Night triggers ---------------------------------------------------
    // Each scheduled night lives in its own file under days/<dayN>/night_raid.js
    // (priority 60), which defines the raid inline + calls RaidSchedule.onDay().
    // RaidMobs archetypes above are shared across all day files.

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

    console.info("[Raid-def] mob archetypes registered (" +
        Object.keys(Mobs).length + " types)");
})(this);
