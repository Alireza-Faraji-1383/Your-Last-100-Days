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
//   - Skeleton AI cannot fire a crossbow (reassessWeaponGoal only wires the
//     bow goal) — every ranged skeleton gets a BOW. Crossbows only go to
//     pillagers, whose own AI handles them.
//   - Modded melee weapons only go to mobs with a mainhand melee attack.
//     Ranged mobs keep vanilla Bow/Crossbow/Trident because their AI checks
//     the concrete item type before it can shoot or throw.
//   - SUNSCREEN: every burnable undead (vanilla + modded zombie/skeleton
//     family) wears a helmet so dawn doesn't torch leftover raid mobs.
//   - Armor scales with the day arc: iron/chainmail early, Born in Chaos
//     dark_metal on mid/late elites, Advanced Netherite on champion tiers.
//   - Modded mobs otherwise bring their own AI + native weapons; the raid
//     engine's targeting loop drives them regardless.
//   - Infiltration layer: MINER_* dig to the player with tiered picks (needs
//     mobGriefing), PEARL_ZOMBIE teleports past walls, TNT_CREEPER + DEMOMAN
//     breach, DOOR_KNIGHT smashes doors, PHANTOM_CREEPER phases through
//     blocks, TOSSER hurls fellow raid mobs over the player's defenses.
//   - EAI fisher (rod hook) is intentionally NOT used anywhere.
//
// EAI presets referenced (see enhancedai_factory.js):
//   superMiner, pearlThrower, webShooter, skirmisher, mobile, tntCreeper,
//   thrower, antiCheese, sharpTargeting, farSight.

(function (global) {
    "use strict";

    if (typeof Raid === "undefined") { console.error("[RaidMobs] Raid builder missing — raid_core.js not loaded"); return; }

    var BIC = "born_in_chaos_v1:";
    var CAT = "cataclysm:";
    var ISS = "irons_spellbooks:";
    var ADN = "advancednetherite:";
    var SW  = "spartan_weaponry_unofficial:";
    var MOW = "mowziesmobs:";
    var BFB = "block_factorys_bosses:";
    var DM_HELM  = BIC + "dark_metal_armor_helmet";
    var DM_CHEST = BIC + "dark_metal_armor_chestplate";
    var DM_LEGS  = BIC + "dark_metal_armor_leggings";
    var DM_BOOTS = BIC + "dark_metal_armor_boots";

    var Mobs = {
        // ================= Vanilla — infiltration layer =================
        // Miner: digs straight toward the player. Visible pick is cosmetic
        // (tool_requirement=NONE). Helmet doubles as sunscreen.
        MINER_ZOMBIE:   { type: "minecraft:zombie", presets: ["mobile", "superMiner"],
                          equip: { mainhand: "minecraft:iron_pickaxe",
                                   head: "minecraft:iron_helmet", chest: "minecraft:chainmail_chestplate" },
                          nbt: { IsBaby: false, Fire: -1 } },
        // Mid-game miner: double health, dark-metal plate.
        MINER_STRONG:   { type: "minecraft:zombie", presets: ["mobile", "superMiner"],
                          equip: { mainhand: "minecraft:diamond_pickaxe", head: DM_HELM, chest: DM_CHEST },
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=40"] },
        // Late-game miner: 80 HP, faster, full dark-metal.
        MINER_ELITE:    { type: "minecraft:zombie", presets: ["mobile", "superMiner"],
                          equip: { mainhand: ADN + "netherite_iron_pickaxe",
                                   head: DM_HELM, chest: DM_CHEST, legs: DM_LEGS, feet: DM_BOOTS },
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=80", "attributes/movement_speed=0.3"] },
        // Teleports onto the player with ender pearls — walls don't matter.
        PEARL_ZOMBIE:   { type: "minecraft:zombie", presets: ["mobile", "pearlThrower"],
                          equip: { mainhand: "minecraft:ender_pearl",
                                   head: "minecraft:iron_helmet", chest: "minecraft:chainmail_chestplate" },
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=40"] },
        // Picks up a fellow raid mob and hurls it at the player — delivers
        // melee over walls (EAI thrower; players themselves can't be grabbed).
        TOSSER:         { type: "minecraft:zombie", presets: ["mobile", "thrower"],
                          equip: { mainhand: SW + "iron_battleaxe", head: DM_HELM, chest: DM_CHEST },
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=50"] },
        // Breaching creeper: launches at walls, TNT-like blast.
        TNT_CREEPER:    { type: "minecraft:creeper", presets: ["tntCreeper"] },
        // Poison-web artillery spider.
        WEB_SPIDER:     { type: "minecraft:cave_spider", presets: ["mobile", "webShooter"] },

        // ================= Vanilla — ranged / melee line ================
        BOW_SKELETON:      { type: "minecraft:skeleton", presets: ["mobile", "skirmisher"],
                             equip: { mainhand: "minecraft:bow",
                                      head: "minecraft:iron_helmet", chest: "minecraft:chainmail_chestplate" },
                             nbt: { Fire: -1 } },
        // Heavier bow line (skeletons can't fire crossbows — bow + armor).
        ARMORED_SKELETON:  { type: "minecraft:skeleton", presets: ["mobile", "skirmisher"],
                             equip: { mainhand: "minecraft:bow",
                                      head: "minecraft:iron_helmet", chest: "minecraft:iron_chestplate", legs: "minecraft:iron_leggings" },
                             nbt: { Fire: -1 },
                             extraArgs: ["attributes/max_health=40"] },
        TRIDENT_DROWNED:   { type: "minecraft:drowned", presets: ["mobile", "skirmisher"],
                             equip: { mainhand: "minecraft:trident", head: "minecraft:iron_helmet" } },
        // Wither skeletons don't sunburn; dark-metal helm is pure menace.
        WITHER_SKELETON:   { type: "minecraft:wither_skeleton", presets: ["mobile"],
                             equip: { mainhand: SW + "iron_greatsword", head: DM_HELM } },

        // ================= Vanilla — illager warband ====================
        PILLAGER:        { type: "minecraft:pillager", presets: ["mobile"],
                           equip: { mainhand: "minecraft:crossbow", head: "minecraft:iron_helmet" } },
        VINDICATOR:      { type: "minecraft:vindicator", presets: ["mobile"],
                           equip: { mainhand: SW + "iron_battleaxe",
                                    head: "minecraft:iron_helmet", chest: "minecraft:chainmail_chestplate" } },
        VINDICATOR_ELITE:{ type: "minecraft:vindicator", presets: ["mobile", "sharpTargeting"],
                           equip: { mainhand: ADN + "netherite_iron_axe",
                                    head: ADN + "netherite_iron_helmet", chest: ADN + "netherite_iron_chestplate" },
                           extraArgs: ["attributes/max_health=50"] },
        EVOKER:          { type: "minecraft:evoker", presets: ["sharpTargeting"] },
        WARBEAST_RAVAGER:{ type: "minecraft:ravager",
                           extraArgs: ["attributes/max_health=150", "attributes/movement_speed=0.32"] },
        BLAZE:           { type: "minecraft:blaze" },

        // ================= Born in Chaos — undead rabble ================
        // Iron helmets = sunscreen for the burnable zombie/skeleton family.
        ROTTING_ZOMBIE:  { type: BIC + "decaying_zombie",
                           equip: { mainhand: SW + "stone_spear", head: "minecraft:iron_helmet" } },
        ZOMBIE_BRUISER:  { type: BIC + "zombie_bruiser",
                           equip: { mainhand: SW + "iron_warhammer", head: "minecraft:iron_helmet" } },
        LUMBERJACK:      { type: BIC + "zombie_lumberjack",
                           equip: { mainhand: BIC + "wood_splitter_axe", head: "minecraft:iron_helmet" } },
        BARREL_ZOMBIE:   { type: BIC + "barrel_zombie" },
        ZOMBIE_CLOWN:    { type: BIC + "zombie_clown" },
        MAGGOT:          { type: BIC + "maggot" },
        SWARMER:         { type: BIC + "swarmer" },
        PUMPKIN_BRUISER: { type: BIC + "pumpkin_bruiser" },
        PUMPKINHEAD:     { type: BIC + "pumpkinhead" },
        MISSIONARY:      { type: BIC + "missioner" },

        // ================= Born in Chaos — bones ========================
        DECREPIT_SKELETON:{ type: BIC + "decrepit_skeleton",
                            equip: { head: "minecraft:iron_helmet" } },
        BABY_SKELETON:   { type: BIC + "baby_skeleton" },
        BONE_IMP:        { type: BIC + "bone_imp" },
        BONESCALLER:     { type: BIC + "bonescaller" },        // summons baby skeletons
        DEMOMAN:         { type: BIC + "skeleton_demoman" },   // lobs bombs — soft breach
        THRASHER:        { type: BIC + "skeleton_thrasher" },  // heavy bruiser
        SIAMESE_SKELETON:{ type: BIC + "siamese_skeletons" },

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
        MOTHER_SPIDER:   { type: BIC + "mother_spider" },      // spawns baby spiders
        BLOODY_GADFLY:   { type: BIC + "bloody_gadfly" },      // flying harasser
        CORPSE_FLY:      { type: BIC + "corpse_fly" },
        SPIRIT_GUIDE:    { type: BIC + "spirit_guide" },
        FELSTEED:        { type: BIC + "felsteed" },
        THORNSHELL_CRAB: { type: BIC + "thornshell_crab" },

        // ================= Born in Chaos — elite & minibosses ===========
        // Miniboss cuts of the Lifestealer / Missionary — buffed HP, meant to
        // anchor a mid/late round with a small escort.
        LIFESTEALER_BOSS:{ type: BIC + "lifestealer",
                           extraArgs: ["attributes/max_health=150"] },
        MISSIONARY_BOSS: { type: BIC + "missioner",
                           extraArgs: ["attributes/max_health=120"] },
        DOOR_KNIGHT:     { type: BIC + "door_knight" },        // smashes doors
        FALLEN_KNIGHT:   { type: BIC + "fallen_chaos_knight" },
        SCARLET_PERSECUTOR:{ type: BIC + "scarlet_persecutor" },
        KRAMPUS_HENCHMAN:{ type: BIC + "krampus_henchman" },
        KRAMPUS:         { type: BIC + "krampus" },            // day-70 miniboss
        SUPREME_BONESCALLER:{ type: BIC + "supreme_bonescaller" }, // day-90 miniboss

        // ================= Cataclysm — the deep =========================
        // deepling_angler intentionally ABSENT — its fishing-rod hook AI is banned
        // from raids along with the EAI fisher preset.
        DEEPLING:        { type: CAT + "deepling" },
        DEEPLING_BRUTE:  { type: CAT + "deepling_brute" },
        DEEPLING_PRIEST: { type: CAT + "deepling_priest" },
        DEEPLING_WARLOCK:{ type: CAT + "deepling_warlock" },
        CORALSSUS:       { type: CAT + "coralssus" },          // day-60 miniboss trio
        CORAL_GOLEM:     { type: CAT + "coral_golem" },
        AMETHYST_CRAB:   { type: CAT + "amethyst_crab" },
        CLAWDIAN:        { type: CAT + "clawdian" },
        URCHINKIN:       { type: CAT + "urchinkin" },

        // ================= Cataclysm — fire, sand & draugr ==============
        IGNITED_BERSERKER:{ type: CAT + "ignited_berserker" },
        IGNITED_REVENANT:{ type: CAT + "ignited_revenant" },
        KOBOLETON:       { type: CAT + "koboleton" },          // kobold skirmisher
        KOBOLEDIATOR:    { type: CAT + "kobolediator" },       // kobold gladiator elite
        WADJET:          { type: CAT + "wadjet" },             // serpent sorcerer
        WATCHER:         { type: CAT + "the_watcher" },        // Harbinger-factory construct
        PROWLER:         { type: CAT + "the_prowler" },        // Harbinger-factory hunter
        ENDERMAPTERA:    { type: CAT + "endermaptera" },
        ENDER_GOLEM:     { type: CAT + "ender_golem" },
        NETHERITE_MINISTROSITY:{ type: CAT + "netherite_ministrosity" },
        DRAUGR:          { type: CAT + "draugr",
                           equip: { mainhand: SW + "iron_battleaxe", head: "minecraft:iron_helmet" } },
        ELITE_DRAUGR:    { type: CAT + "elite_draugr",
                           equip: { mainhand: BIC + "sharpened_dark_metal_sword", head: DM_HELM } },
        ROYAL_DRAUGR:    { type: CAT + "royal_draugr",
                           equip: { mainhand: SW + "diamond_halberd", head: DM_HELM } },
        APTRGANGR:       { type: CAT + "aptrgangr" },          // draugr giant — day-90/100 elite
        // Burning Arena boss, HP-balanced for an open-field raid.
        MALEDICTUS:      { type: CAT + "maledictus",
                           extraArgs: ["attributes/max_health=200"] },
        // Final boss of night 100, HP-balanced (vanilla 400 -> 250).
        IGNIS:           { type: CAT + "ignis",
                           extraArgs: ["attributes/max_health=250"] },

        // ================= Iron's Spellbooks — the covenant =============
        // No standalone "summoner" mob exists in the mod — the NECROMANCER is
        // its skeleton-summoning wizard; raids lean on it as the summoner.
        CULTIST:         { type: ISS + "cultist" },
        CATACOMBS_ZOMBIE:{ type: ISS + "catacombs_zombie",
                           equip: { mainhand: SW + "iron_longsword", head: "minecraft:iron_helmet" } },
        PYROMANCER:      { type: ISS + "pyromancer" },
        CRYOMANCER:      { type: ISS + "cryomancer" },
        NECROMANCER:     { type: ISS + "necromancer" },        // summons undead
        PRIEST:          { type: ISS + "priest" },             // enemy healer — kill first
        APOTHECARIST:    { type: ISS + "apothecarist" },
        ICE_SPIDER:      { type: ISS + "ice_spider" },
        ARCHEVOKER:      { type: ISS + "archevoker" },
        MAGEHUNTER:      { type: ISS + "magehunter_vindicator" },
        // "Ancient Knight" — heavy melee elite, day-50 miniboss.
        CITADEL_KEEPER:  { type: ISS + "citadel_keeper",
                           extraArgs: ["attributes/max_health=120"] },

        // ================= Mowzie's Mobs — mobile wild hunt =============
        // Stationary Foliaath and arena/puzzle bosses are deliberately
        // excluded: every archetype must travel from the spawn perimeter.
        NAGA:             { type: MOW + "naga" },
        UMVUTHANA:        { type: MOW + "umvuthana" },
        UMVUTHANA_RAPTOR: { type: MOW + "umvuthana_raptor" },
        UMVUTHANA_CRANE:  { type: MOW + "umvuthana_crane" },

        // ============== Block Factory Bosses — field troops ============
        // Only self-contained soldiers are used; arena-bound bosses stay out.
        SOUL_SKELETON:   { type: BFB + "soul_skeleton" },
        WITHER_KNIGHT:   { type: BFB + "soul_knight_wither_skeleton" },
        ASH_GUARD:       { type: BFB + "dragon_guard_sword" },
        FLAMING_GUARD:   { type: BFB + "flaming_skeleton_guard_sword" },
        FLAMING_SHOOTER: { type: BFB + "flaming_skeleton_guard_fireball" },
        PIRATE_ROOK:     { type: BFB + "pirate_rook" },
        CROSSBOW_PIRATE: { type: BFB + "crossbow_pirate" },
        PIRATE_CAPTAIN:  { type: BFB + "pirate_captain" }
    };

    global.RaidMobs = Mobs;
    console.info("[RaidMobs] " + Object.keys(Mobs).length + " archetypes registered");
})(this);
