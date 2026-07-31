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
//   - Armor follows both power and story theme: leather/iron/diamond early,
//     then dedicated spirit, arcane, abyssal, rotten, burning and dark sets.
//     Day 100 deliberately changes armor with each callback wave.
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
    var CSS = "cataclysm_spellbooks:";
    var SW  = "spartan_weaponry_unofficial:";
    var MOW = "mowziesmobs:";
    var BFB = "block_factorys_bosses:";
    var DDG = "darkdoppelganger:";
    var ARMOR_LEATHER = {
        head: "minecraft:leather_helmet", chest: "minecraft:leather_chestplate",
        legs: "minecraft:leather_leggings", feet: "minecraft:leather_boots"
    };
    var ARMOR_IRON_CHAIN = {
        head: "minecraft:iron_helmet", chest: "minecraft:chainmail_chestplate",
        legs: "minecraft:chainmail_leggings", feet: "minecraft:iron_boots"
    };
    var ARMOR_IRON_DIAMOND = {
        head: "minecraft:diamond_helmet", chest: "minecraft:diamond_chestplate",
        legs: "minecraft:iron_leggings", feet: "minecraft:diamond_boots"
    };
    var ARMOR_SPIRIT = {
        head: ISS + "shadowwalker_helmet", chest: ISS + "shadowwalker_chestplate",
        legs: ISS + "shadowwalker_leggings", feet: ISS + "shadowwalker_boots"
    };
    var ARMOR_ARCANE = {
        head: ISS + "netherite_mage_helmet", chest: ISS + "netherite_mage_chestplate",
        legs: ISS + "netherite_mage_leggings", feet: ISS + "netherite_mage_boots"
    };
    var ARMOR_ABYSSAL = {
        head: CSS + "abyssal_warlock_helmet", chest: CSS + "abyssal_warlock_chestplate",
        legs: CSS + "abyssal_warlock_leggings", feet: CSS + "abyssal_warlock_boots"
    };
    var ARMOR_ROTTEN_LEGION = {
        head: BIC + "dark_metal_armor_helmet", chest: BIC + "dark_metal_armor_chestplate",
        legs: BIC + "dark_metal_armor_leggings", feet: BIC + "dark_metal_armor_boots"
    };
    var ARMOR_IGNIS = {
        head: CSS + "ignis_helmet", chest: CSS + "ignis_chestplate",
        legs: CSS + "ignis_leggings", feet: CSS + "ignis_boots"
    };
    var ARMOR_DARK_CONCORD = {
        head: CSS + "cursium_mage_circlet", chest: CSS + "cursium_mage_chestplate",
        legs: CSS + "cursium_mage_skirt", feet: CSS + "cursium_mage_boots"
    };
    var ARMOR_PLAGUED = {
        head: ISS + "plagued_helmet", chest: ISS + "plagued_chestplate",
        legs: ISS + "plagued_leggings", feet: ISS + "plagued_boots"
    };
    var ARMOR_BONE_GUARD = {
        head: CAT + "bone_reptile_helmet", chest: CAT + "bone_reptile_chestplate",
        legs: BIC + "dark_metal_armor_leggings", feet: BIC + "dark_metal_armor_boots"
    };

    function equipWith(mainhand, armor) {
        var out = {
            head: armor.head, chest: armor.chest, legs: armor.legs, feet: armor.feet
        };
        if (mainhand) out.mainhand = mainhand;
        return out;
    }

    function miner(mainhand, armor, maxHealth, speed) {
        var out = {
            type: "minecraft:zombie",
            presets: ["mobile", "superMiner"],
            equip: equipWith(mainhand, armor),
            nbt: { IsBaby: false, Fire: -1 }
        };
        var args = [];
        if (maxHealth) args.push("attributes/max_health=" + maxHealth);
        if (speed) args.push("attributes/movement_speed=" + speed);
        if (args.length) out.extraArgs = args;
        return out;
    }

    function bowSkeleton(armor, maxHealth) {
        var out = {
            type: "minecraft:skeleton",
            presets: ["mobile", "skirmisher"],
            equip: equipWith("minecraft:bow", armor),
            nbt: { Fire: -1 }
        };
        if (maxHealth) out.extraArgs = ["attributes/max_health=" + maxHealth];
        return out;
    }

    var Mobs = {
        // ================= Vanilla — infiltration layer =================
        WITCH:                { type: "minecraft:witch" },
        // Miner: digs straight toward the player. Visible pick is cosmetic
        // (tool_requirement=NONE). Helmet doubles as sunscreen.
        MINER_ZOMBIE:         miner("minecraft:iron_pickaxe", ARMOR_LEATHER, 0, 0),
        MINER_LEATHER_STRONG: miner("minecraft:diamond_pickaxe", ARMOR_LEATHER, 40, 0),
        MINER_IRON:           miner("minecraft:iron_pickaxe", ARMOR_IRON_CHAIN, 0, 0),
        MINER_STRONG:         miner("minecraft:diamond_pickaxe", ARMOR_IRON_CHAIN, 40, 0),
        MINER_DIAMOND:        miner("minecraft:diamond_pickaxe", ARMOR_IRON_DIAMOND, 0, 0),
        MINER_VETERAN:        miner("minecraft:diamond_pickaxe", ARMOR_IRON_DIAMOND, 40, 0),
        MINER_DARK:           miner("minecraft:netherite_pickaxe", ARMOR_SPIRIT, 40, 0),
        MINER_SPIRIT_ELITE:   miner("minecraft:netherite_pickaxe", ARMOR_SPIRIT, 80, 0.3),
        MINER_ARCANE:         miner("minecraft:netherite_pickaxe", ARMOR_ARCANE, 40, 0),
        MINER_ELITE:          miner("minecraft:netherite_pickaxe", ARMOR_ARCANE, 80, 0.3),
        MINER_ABYSSAL_SCOUT:  miner("minecraft:netherite_pickaxe", ARMOR_ABYSSAL, 40, 0),
        MINER_ABYSSAL:        miner("minecraft:netherite_pickaxe", ARMOR_ABYSSAL, 80, 0.3),
        MINER_CHAMPION:       miner("minecraft:netherite_pickaxe", ARMOR_ROTTEN_LEGION, 80, 0.3),
        MINER_IGNIS:          miner("minecraft:netherite_pickaxe", ARMOR_IGNIS, 80, 0.3),
        MINER_MYTHIC:         miner("minecraft:netherite_pickaxe", ARMOR_DARK_CONCORD, 80, 0.3),
        MINER_PLAGUED:        miner("minecraft:netherite_pickaxe", ARMOR_PLAGUED, 80, 0.3),
        MINER_BONE_GUARD:     miner("minecraft:netherite_pickaxe", ARMOR_BONE_GUARD, 80, 0.3),
        MINER_LAST_SHADOW:    miner("minecraft:netherite_pickaxe", ARMOR_SPIRIT, 80, 0.3),
        // Teleports onto the player with ender pearls — walls don't matter.
        PEARL_ZOMBIE:   { type: "minecraft:zombie", presets: ["mobile", "pearlThrower"],
                          equip: equipWith("minecraft:ender_pearl", ARMOR_IRON_CHAIN),
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=40"] },
        PEARL_ZOMBIE_VETERAN:{ type: "minecraft:zombie", presets: ["mobile", "pearlThrower"],
                          equip: equipWith("minecraft:ender_pearl", ARMOR_IRON_DIAMOND),
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=40"] },
        PEARL_ZOMBIE_ELITE:{ type: "minecraft:zombie", presets: ["mobile", "pearlThrower"],
                          equip: equipWith("minecraft:ender_pearl", ARMOR_SPIRIT),
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=40"] },
        PEARL_ZOMBIE_ARCANE:{ type: "minecraft:zombie", presets: ["mobile", "pearlThrower"],
                          equip: equipWith("minecraft:ender_pearl", ARMOR_ARCANE),
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=40"] },
        PEARL_ZOMBIE_ABYSSAL:{ type: "minecraft:zombie", presets: ["mobile", "pearlThrower"],
                          equip: equipWith("minecraft:ender_pearl", ARMOR_ABYSSAL),
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=40"] },
        PEARL_ZOMBIE_CHAMPION:{ type: "minecraft:zombie", presets: ["mobile", "pearlThrower"],
                          equip: equipWith("minecraft:ender_pearl", ARMOR_IGNIS),
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=40"] },
        PEARL_ZOMBIE_MYTHIC:{ type: "minecraft:zombie", presets: ["mobile", "pearlThrower"],
                          equip: equipWith("minecraft:ender_pearl", ARMOR_DARK_CONCORD),
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=40"] },
        PEARL_ZOMBIE_LAST:{ type: "minecraft:zombie", presets: ["mobile", "pearlThrower"],
                          equip: equipWith("minecraft:ender_pearl", ARMOR_SPIRIT),
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=40"] },
        // Picks up a fellow raid mob and hurls it at the player — delivers
        // melee over walls (EAI thrower; players themselves can't be grabbed).
        TOSSER:         { type: "minecraft:zombie", presets: ["mobile", "thrower"],
                          equip: equipWith(SW + "iron_battleaxe", ARMOR_IRON_DIAMOND),
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=50"] },
        TOSSER_ELITE:   { type: "minecraft:zombie", presets: ["mobile", "thrower"],
                          equip: equipWith(SW + "iron_battleaxe", ARMOR_ARCANE),
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=50"] },
        TOSSER_CHAMPION:{ type: "minecraft:zombie", presets: ["mobile", "thrower"],
                          equip: equipWith(SW + "iron_battleaxe", ARMOR_ROTTEN_LEGION),
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=50"] },
        TOSSER_MYTHIC:  { type: "minecraft:zombie", presets: ["mobile", "thrower"],
                          equip: equipWith(SW + "iron_battleaxe", ARMOR_DARK_CONCORD),
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=50"] },
        TOSSER_ARCANE:  { type: "minecraft:zombie", presets: ["mobile", "thrower"],
                          equip: equipWith(SW + "iron_battleaxe", ARMOR_ARCANE),
                          nbt: { IsBaby: false, Fire: -1 },
                          extraArgs: ["attributes/max_health=50"] },
        // Breaching creeper: launches at walls, TNT-like blast.
        TNT_CREEPER:    { type: "minecraft:creeper", presets: ["tntCreeper"] },
        // Poison-web artillery spider.
        WEB_SPIDER:     { type: "minecraft:cave_spider", presets: ["mobile", "webShooter"] },

        // ================= Vanilla — ranged / melee line ================
        BOW_SKELETON:      bowSkeleton(ARMOR_LEATHER, 0),
        IRON_SKELETON:     bowSkeleton(ARMOR_IRON_CHAIN, 0),
        // Heavier bow line (skeletons can't fire crossbows — bow + armor).
        ARMORED_SKELETON:  bowSkeleton(ARMOR_IRON_CHAIN, 40),
        DIAMOND_SKELETON:  bowSkeleton(ARMOR_IRON_DIAMOND, 40),
        DARK_SKELETON:     bowSkeleton(ARMOR_SPIRIT, 40),
        CHAMPION_SKELETON: bowSkeleton(ARMOR_IGNIS, 40),
        MYTHIC_SKELETON:   bowSkeleton(ARMOR_BONE_GUARD, 0),
        TRIDENT_DROWNED:   { type: "minecraft:drowned", presets: ["mobile", "skirmisher"],
                             equip: equipWith("minecraft:trident", ARMOR_ABYSSAL) },
        // Wither skeletons don't sunburn; dark-metal helm is pure menace.
        WITHER_SKELETON:   { type: "minecraft:wither_skeleton", presets: ["mobile"],
                             equip: equipWith(SW + "iron_greatsword", ARMOR_IGNIS) },

        // ================= Vanilla — illager warband ====================
        PILLAGER:        { type: "minecraft:pillager", presets: ["mobile"],
                           equip: { mainhand: "minecraft:crossbow", head: "minecraft:iron_helmet",
                                    feet: "minecraft:iron_boots" } },
        VINDICATOR:      { type: "minecraft:vindicator", presets: ["mobile"],
                           equip: { mainhand: SW + "iron_battleaxe",
                                    head: "minecraft:iron_helmet", chest: "minecraft:chainmail_chestplate",
                                    feet: "minecraft:iron_boots" } },
        VINDICATOR_ELITE:{ type: "minecraft:vindicator", presets: ["mobile", "sharpTargeting"],
                           equip: { mainhand: "minecraft:diamond_axe",
                                    head: "minecraft:diamond_helmet", chest: "minecraft:diamond_chestplate",
                                    feet: "minecraft:diamond_boots" },
                           extraArgs: ["attributes/max_health=50"] },
        EVOKER:          { type: "minecraft:evoker", presets: ["sharpTargeting"] },
        WARBEAST_RAVAGER:{ type: "minecraft:ravager",
                           extraArgs: ["attributes/max_health=150", "attributes/movement_speed=0.32"] },
        BLAZE:           { type: "minecraft:blaze" },

        // ================= Born in Chaos — undead rabble ================
        // Early undead wear leather; later variants are selected by day files.
        ROTTING_ZOMBIE:  { type: BIC + "decaying_zombie",
                           equip: equipWith(SW + "stone_spear", ARMOR_LEATHER) },
        ROTTING_ZOMBIE_DARK:{ type: BIC + "decaying_zombie",
                           equip: equipWith(SW + "stone_spear", ARMOR_SPIRIT) },
        ZOMBIE_BRUISER:  { type: BIC + "zombie_bruiser",
                           equip: equipWith(SW + "iron_warhammer", ARMOR_LEATHER) },
        ZOMBIE_BRUISER_CHAMPION:{ type: BIC + "zombie_bruiser",
                           equip: equipWith(SW + "iron_warhammer", ARMOR_ROTTEN_LEGION) },
        ZOMBIE_BRUISER_MYTHIC:{ type: BIC + "zombie_bruiser",
                           equip: equipWith(SW + "iron_warhammer", ARMOR_PLAGUED) },
        LUMBERJACK:      { type: BIC + "zombie_lumberjack",
                           equip: equipWith(BIC + "wood_splitter_axe", ARMOR_LEATHER) },
        BARREL_ZOMBIE:   { type: BIC + "barrel_zombie" },
        ZOMBIE_CLOWN:    { type: BIC + "zombie_clown" },
        MAGGOT:          { type: BIC + "maggot" },
        SWARMER:         { type: BIC + "swarmer" },
        PUMPKIN_BRUISER: { type: BIC + "pumpkin_bruiser" },
        PUMPKINHEAD:     { type: BIC + "pumpkinhead" },
        MISSIONARY:      { type: BIC + "missioner" },

        // ================= Born in Chaos — bones ========================
        DECREPIT_SKELETON:{ type: BIC + "decrepit_skeleton",
                             equip: equipWith(null, ARMOR_IRON_CHAIN), nbt: { Fire: -20 } },
        BABY_SKELETON:   { type: BIC + "baby_skeleton", nbt: { Fire: -20 } },
        BONE_IMP:        { type: BIC + "bone_imp" },
        BONESCALLER:     { type: BIC + "bonescaller", nbt: { Fire: -20 } }, // summons baby skeletons
        DARK_VORTEX:     { type: BIC + "dark_vortex" },        // mobile ranged bone support
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
        LIFESTEALER:     { type: BIC + "lifestealer", breacher: true },
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
        LIFESTEALER_BOSS:{ type: BIC + "lifestealer", miniboss: true, breacher: true,
                           extraArgs: ["attributes/max_health=150"] },
        MISSIONARY_BOSS: { type: BIC + "missioner", miniboss: true, breacher: true,
                           extraArgs: ["attributes/max_health=120"] },
        DOOR_KNIGHT:     { type: BIC + "door_knight" },        // smashes doors
        FALLEN_KNIGHT:   { type: BIC + "fallen_chaos_knight" },
        SCARLET_PERSECUTOR:{ type: BIC + "scarlet_persecutor" },
        KRAMPUS_HENCHMAN:{ type: BIC + "krampus_henchman" },
        KRAMPUS:         { type: BIC + "krampus", boss: true, breacher: true }, // day-70 final boss
        SUPREME_BONESCALLER:{ type: BIC + "supreme_bonescaller", miniboss: true, breacher: true },

        // ================= Cataclysm — the deep =========================
        // deepling_angler intentionally ABSENT — its fishing-rod hook AI is banned
        // from raids along with the EAI fisher preset.
        DEEPLING:        { type: CAT + "deepling" },
        DEEPLING_BRUTE:  { type: CAT + "deepling_brute" },
        DEEPLING_PRIEST: { type: CAT + "deepling_priest" },
        DEEPLING_WARLOCK:{ type: CAT + "deepling_warlock" },
        CORALSSUS:       { type: CAT + "coralssus", miniboss: true, breacher: true },
        CORAL_GOLEM:     { type: CAT + "coral_golem" },
        AMETHYST_CRAB:   { type: CAT + "amethyst_crab", miniboss: true, breacher: true },
        CLAWDIAN:        { type: CAT + "clawdian" },
        URCHINKIN:       { type: CAT + "urchinkin" },

        // ================= Cataclysm — fire, sand & draugr ==============
        IGNITED_BERSERKER:{ type: CAT + "ignited_berserker" },
        // Signature-loot miniboss (Burning Ashes outside raids).
        IGNITED_REVENANT:{ type: CAT + "ignited_revenant", miniboss: true, breacher: true },
        KOBOLETON:       { type: CAT + "koboleton" },          // kobold skirmisher
        KOBOLEDIATOR:    { type: CAT + "kobolediator",
                           nbt: { Awaken: true } },             // core also clears post-spawn Sleep
        WADJET:          { type: CAT + "wadjet",
                           nbt: { Awaken: true } },             // remains awake across saves
        WATCHER:         { type: CAT + "the_watcher" },        // Harbinger-factory construct
        PROWLER:         { type: CAT + "the_prowler", miniboss: true, breacher: true },
        ENDERMAPTERA:    { type: CAT + "endermaptera" },
        ENDER_GOLEM:     { type: CAT + "ender_golem", miniboss: true, breacher: true,
                           nbt: { is_Awaken: true } },
        DRAUGR:          { type: CAT + "draugr",
                           equip: equipWith(SW + "iron_battleaxe", ARMOR_DARK_CONCORD) },
        ELITE_DRAUGR:    { type: CAT + "elite_draugr",
                           equip: equipWith(BIC + "sharpened_dark_metal_sword", ARMOR_DARK_CONCORD) },
        ROYAL_DRAUGR:    { type: CAT + "royal_draugr",
                           equip: equipWith(SW + "diamond_halberd", ARMOR_DARK_CONCORD) },
        APTRGANGR:       { type: CAT + "aptrgangr", miniboss: true, breacher: true },
        // Burning Arena boss, HP-balanced for an open-field raid.
        MALEDICTUS:      { type: CAT + "maledictus", boss: true, breacher: true,
                           extraArgs: ["attributes/max_health=200"] },
        // Final boss of night 90, HP-balanced (vanilla 400 -> 250).
        IGNIS:           { type: CAT + "ignis", boss: true, breacher: true,
                           extraArgs: ["attributes/max_health=250"] },

        // Night 100 final boss. The core binds it to the raid player before
        // spawn so its native gear-copy, spells and phase logic initialize.
        DARK_DOPPELGANGER:{ type: DDG + "dark_doppelganger", boss: true, breacher: true },

        // ================= Iron's Spellbooks — the covenant =============
        // No standalone "summoner" mob exists in the mod — the NECROMANCER is
        // its skeleton-summoning wizard; raids lean on it as the summoner.
        CULTIST:         { type: ISS + "cultist" },
        CATACOMBS_ZOMBIE:{ type: ISS + "catacombs_zombie",
                           equip: equipWith(SW + "iron_longsword", ARMOR_ARCANE) },
        PYROMANCER:      { type: ISS + "pyromancer" },
        CRYOMANCER:      { type: ISS + "cryomancer" },
        NECROMANCER:     { type: ISS + "necromancer" },        // summons undead
        PRIEST:          { type: ISS + "priest" },             // enemy healer — kill first
        APOTHECARIST:    { type: ISS + "apothecarist" },
        ICE_SPIDER:      { type: ISS + "ice_spider" },
        ARCHEVOKER:      { type: ISS + "archevoker" },
        MAGEHUNTER:      { type: ISS + "magehunter_vindicator" },
        // "Ancient Knight" — heavy melee elite, day-50 miniboss.
        CITADEL_KEEPER:  { type: ISS + "citadel_keeper", miniboss: true, breacher: true,
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
        PIRATE_ROOK:     { type: BFB + "pirate_rook",
                           equip: { mainhand: "minecraft:iron_sword" } },
        CROSSBOW_PIRATE: { type: BFB + "crossbow_pirate" },
        PIRATE_CAPTAIN:  { type: BFB + "pirate_captain" }
    };

    global.RaidMobs = Mobs;
    console.info("[RaidMobs] " + Object.keys(Mobs).length + " archetypes registered");
})(this);
