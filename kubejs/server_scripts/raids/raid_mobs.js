// priority: 70
// kubejs/server_scripts/raids/raid_mobs.js
//
// Reusable mob archetypes (exported as the RaidMobs global) for the night
// raids under raids/day_*.js. Depends on the Raid builder (raid_core.js,
// priority 90) and EnhancedAI presets (enhancedai_factory.js, priority 100).
//
// Design rules:
//   - Vanilla humanoids spawn EMPTY-handed via the raid spawner (no
//     finalizeSpawn), so every skeleton/pillager/vindicator/drowned/wither
//     skeleton archetype carries an explicit mainhand weapon.
//   - Modded mobs (Born in Chaos / Cataclysm / Iron's Spellbooks) bring their
//     own AI + weapons; they get NO equip and no vanilla-AI presets. The raid
//     engine's targeting loop drives them regardless.
//   - Infiltration layer: MINER_* dig to the player (needs mobGriefing),
//     PEARL_ZOMBIE teleports past walls, TNT_CREEPER + DEMOMAN breach,
//     DOOR_KNIGHT smashes doors, PHANTOM_CREEPER phases through blocks.
//
// EAI presets referenced (see enhancedai_factory.js):
//   superMiner, pearlThrower, fisherAggro, webShooter, skirmisher, mobile,
//   tntCreeper, sharpTargeting, farSight.

(function (global) {
    "use strict";

    if (typeof Raid === "undefined") { console.error("[RaidMobs] Raid builder missing — raid_core.js not loaded"); return; }

    var BIC = "born_in_chaos_v1:";
    var CAT = "cataclysm:";
    var ISS = "irons_spellbooks:";

    var Mobs = {
        // ================= Vanilla — infiltration layer =================
        // Miner: digs straight toward the player. Pickaxe cosmetic
        // (tool_requirement=NONE). Fire:-1 so daylight leftovers don't burn.
        MINER_ZOMBIE:   { type: "minecraft:zombie", presets: ["mobile", "superMiner"],
                          equip: { mainhand: "minecraft:iron_pickaxe", head: "minecraft:iron_helmet" },
                          nbt: { IsBaby: false, Fire: -1 } },
        // Mid-game miner: double health.
        MINER_STRONG:   { type: "minecraft:zombie", presets: ["mobile", "superMiner"],
                          equip: { mainhand: "minecraft:iron_pickaxe", head: "minecraft:iron_helmet", chest: "minecraft:chainmail_chestplate" },
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=40"] },
        // Late-game miner: 60 HP, faster, iron-clad.
        MINER_ELITE:    { type: "minecraft:zombie", presets: ["mobile", "superMiner"],
                          equip: { mainhand: "minecraft:iron_pickaxe",
                                   head: "minecraft:iron_helmet", chest: "minecraft:iron_chestplate", legs: "minecraft:iron_leggings" },
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=60", "attributes/movement_speed=0.28"] },
        // Teleports onto the player with ender pearls — walls don't matter.
        PEARL_ZOMBIE:   { type: "minecraft:zombie", presets: ["mobile", "pearlThrower"],
                          equip: { mainhand: "minecraft:ender_pearl", head: "minecraft:chainmail_helmet" },
                          nbt: { IsBaby: false, Fire: -1 } },
        // Casts a rod and reels the player off walls/towers.
        FISHER_ZOMBIE:  { type: "minecraft:zombie", presets: ["mobile", "fisherAggro"],
                          equip: { mainhand: "minecraft:fishing_rod", head: "minecraft:leather_helmet" },
                          nbt: { IsBaby: false, Fire: -1 } },
        // Breaching creeper: launches at walls, TNT-like blast.
        TNT_CREEPER:    { type: "minecraft:creeper", presets: ["tntCreeper"] },
        // Poison-web artillery spider.
        WEB_SPIDER:     { type: "minecraft:cave_spider", presets: ["mobile", "webShooter"] },

        // ================= Vanilla — ranged / melee line ================
        BOW_SKELETON:      { type: "minecraft:skeleton", presets: ["mobile", "skirmisher"],
                             equip: { mainhand: "minecraft:bow", head: "minecraft:iron_helmet" },
                             nbt: { Fire: -1 } },
        CROSSBOW_SKELETON: { type: "minecraft:skeleton", presets: ["mobile", "skirmisher"],
                             equip: { mainhand: "minecraft:crossbow", chest: "minecraft:chainmail_chestplate" },
                             nbt: { Fire: -1 } },
        TRIDENT_DROWNED:   { type: "minecraft:drowned", presets: ["mobile", "skirmisher"],
                             equip: { mainhand: "minecraft:trident" } },
        WITHER_SKELETON:   { type: "minecraft:wither_skeleton", presets: ["mobile"],
                             equip: { mainhand: "minecraft:iron_sword" } },

        // ================= Vanilla — illager warband ====================
        PILLAGER:        { type: "minecraft:pillager", presets: ["mobile"],
                           equip: { mainhand: "minecraft:crossbow" } },
        VINDICATOR:      { type: "minecraft:vindicator", presets: ["mobile"],
                           equip: { mainhand: "minecraft:iron_axe" } },
        VINDICATOR_ELITE:{ type: "minecraft:vindicator", presets: ["mobile", "sharpTargeting"],
                           equip: { mainhand: "minecraft:diamond_axe", head: "minecraft:iron_helmet", chest: "minecraft:iron_chestplate" },
                           extraArgs: ["attributes/max_health=40"] },
        EVOKER:          { type: "minecraft:evoker", presets: ["sharpTargeting"] },
        WARBEAST_RAVAGER:{ type: "minecraft:ravager",
                           extraArgs: ["attributes/max_health=150", "attributes/movement_speed=0.32"] },
        BLAZE:           { type: "minecraft:blaze" },

        // ================= Born in Chaos — undead rabble ================
        ROTTING_ZOMBIE:  { type: BIC + "decaying_zombie" },
        ZOMBIE_BRUISER:  { type: BIC + "zombie_bruiser" },
        LUMBERJACK:      { type: BIC + "zombie_lumberjack" },
        MAGGOT:          { type: BIC + "maggot" },

        // ================= Born in Chaos — bones ========================
        DECREPIT_SKELETON:{ type: BIC + "decrepit_skeleton" },
        BABY_SKELETON:   { type: BIC + "baby_skeleton" },
        BONE_IMP:        { type: BIC + "bone_imp" },
        BONESCALLER:     { type: BIC + "bonescaller" },        // summons baby skeletons
        DEMOMAN:         { type: BIC + "skeleton_demoman" },   // lobs bombs — soft breach
        THRASHER:        { type: BIC + "skeleton_thrasher" },  // heavy bruiser

        // ================= Born in Chaos — spirits & terror =============
        RESTLESS_SPIRIT: { type: BIC + "restless_spirit" },
        PUMPKIN_SPIRIT:  { type: BIC + "pumpkin_spirit" },
        FIRELIGHT:       { type: BIC + "firelight" },
        SEARED_SPIRIT:   { type: BIC + "seared_spirit" },
        INFERNAL_SPIRIT: { type: BIC + "infernal_spirit" },
        DREAD_HOUND:     { type: BIC + "dread_hound" },
        HOUND_LEADER:    { type: BIC + "dire_hound_leader" },
        NIGHTMARE_STALKER:{ type: BIC + "nightmare_stalker" },
        LIFESTEALER:     { type: BIC + "lifestealer" },
        PHANTOM_CREEPER: { type: BIC + "phantom_creeper" },    // phases through walls, explodes

        // ================= Born in Chaos — elite & minibosses ===========
        DOOR_KNIGHT:     { type: BIC + "door_knight" },        // smashes doors
        FALLEN_KNIGHT:   { type: BIC + "fallen_chaos_knight" },
        SCARLET_PERSECUTOR:{ type: BIC + "scarlet_persecutor" },
        KRAMPUS_HENCHMAN:{ type: BIC + "krampus_henchman" },
        KRAMPUS:         { type: BIC + "krampus" },            // day-70 miniboss
        SUPREME_BONESCALLER:{ type: BIC + "supreme_bonescaller" }, // day-90 miniboss

        // ================= Cataclysm — the deep =========================
        DEEPLING:        { type: CAT + "deepling" },
        DEEPLING_BRUTE:  { type: CAT + "deepling_brute" },
        DEEPLING_ANGLER: { type: CAT + "deepling_angler" },    // built-in hook pull
        DEEPLING_PRIEST: { type: CAT + "deepling_priest" },
        DEEPLING_WARLOCK:{ type: CAT + "deepling_warlock" },
        CORALSSUS:       { type: CAT + "coralssus" },          // day-60 miniboss pair

        // ================= Cataclysm — fire & draugr ====================
        IGNITED_BERSERKER:{ type: CAT + "ignited_berserker" },
        IGNITED_REVENANT:{ type: CAT + "ignited_revenant" },
        DRAUGR:          { type: CAT + "draugr" },
        ELITE_DRAUGR:    { type: CAT + "elite_draugr" },
        ROYAL_DRAUGR:    { type: CAT + "royal_draugr" },
        APTRGANGR:       { type: CAT + "aptrgangr" },          // draugr giant — day-90/100 elite
        // Burning Arena boss, HP-balanced for an open-field raid.
        MALEDICTUS:      { type: CAT + "maledictus",
                           extraArgs: ["attributes/max_health=200"] },
        // Final boss of night 100, HP-balanced (vanilla 400 -> 250).
        IGNIS:           { type: CAT + "ignis",
                           extraArgs: ["attributes/max_health=250"] },

        // ================= Iron's Spellbooks — the covenant =============
        CULTIST:         { type: ISS + "cultist" },
        CATACOMBS_ZOMBIE:{ type: ISS + "catacombs_zombie" },
        PYROMANCER:      { type: ISS + "pyromancer" },
        CRYOMANCER:      { type: ISS + "cryomancer" },
        NECROMANCER:     { type: ISS + "necromancer" },        // summons undead
        PRIEST:          { type: ISS + "priest" },             // enemy healer — kill first
        ARCHEVOKER:      { type: ISS + "archevoker" },
        MAGEHUNTER:      { type: ISS + "magehunter_vindicator" },
        // "Ancient Knight" — heavy melee elite, day-50 miniboss.
        CITADEL_KEEPER:  { type: ISS + "citadel_keeper",
                           extraArgs: ["attributes/max_health=120"] }
    };

    global.RaidMobs = Mobs;
    console.info("[RaidMobs] " + Object.keys(Mobs).length + " archetypes registered");
})(this);
