// priority: 100
// kubejs/server_scripts/factories/enhancedai_factory.js
//
// EnhancedAI v4.1.0.0 (Insane96) data-key factory for KubeJS 1.21.1 NeoForge.
//
// Storage model: InsaneLib.ModNBTData reads from entity.getPersistentData()
// which IS the NeoForgeData compound. Data key `enhancedai:miner_mobs/miner`
// resolves to NBT path NeoForgeData.enhancedai.miner_mobs.miner.
//
// Goal-attach flow:
//   1. Pre-spawn: write nested NBT (NeoForgeData.enhancedai.<feature>.<key>).
//   2. Mod's EntityJoinLevelEvent calls EAIData.applyIfAbsent → no-op
//      because value already present → onChange listener (which adds the
//      MineTowardsTargetGoal etc.) NEVER fires.
//   3. Fix: post-spawn shotgun — call EAIData.<FIELD>.apply(rawMob, value)
//      (writes + fires onChange) + inject goal directly + repeat 4x.
//
// Miner gotchas (MineTowardsTargetGoal.canUse bytecode):
//   - mobGriefing gamerule must be TRUE
//   - tool_requirement=ANY_TOOL needs DiggerItem offhand; use NONE to skip
//   - max_target_distance=0 means UNLIMITED
//   - Mob must be stuck ~60 ticks with target aggroed
//
// Vanilla attributes: keys under feature "attributes" (e.g.
// "attributes/follow_range=100") are NOT EnhancedAI NBT — they set
// LivingEntity base attribute values via Attributes.<NAME>. follow_range is
// the real "see player from N blocks" radius (targeting/alert_range only
// alerts nearby allies). See applyAttributes + farSight preset.
//
// Rhino quirk: const/let inside try{} hoists to function-scope var on Rhino,
// causing "redeclaration of var X" on 2nd invocation. All function-internal
// declarations use `var` + indexed for-loops. Top-level module constants OK.

(function (global) {
    "use strict";

    const NS    = "enhancedai";
    const DEBUG = false;

    function warn(m) { console.warn(`[EnhancedAI] ${m}`); }
    function err(m)  { console.error(`[EnhancedAI] ${m}`); }
    function info(m) { if (DEBUG) console.info(`[EnhancedAI] ${m}`); }

    // ---------- Java class cache --------------------------------------------

    const _classCache = {};
    function J(fqn) {
        if (_classCache[fqn] !== undefined) return _classCache[fqn];
        try { _classCache[fqn] = Java.loadClass(fqn); }
        catch (e) { _classCache[fqn] = null; }
        return _classCache[fqn];
    }

    // ---------- Type guards --------------------------------------------------

    function isLevel(o) {
        return o !== null && typeof o === "object" &&
               typeof o.createEntity === "function";
    }
    function isEntity(o) {
        if (o === null || typeof o !== "object") return false;
        return typeof o.setPos === "function" ||
               typeof o.getPersistentData === "function" ||
               o.persistentData !== undefined;
    }
    function isEntityTypeId(s) {
        return typeof s === "string" && s.length > 0 && s.indexOf(":") !== -1;
    }

    // ---------- Value parsing ------------------------------------------------

    function coerce(raw) {
        if (typeof raw !== "string") return raw;   // already a primitive/array
        if (raw === "true")  return true;
        if (raw === "false") return false;
        if (raw.startsWith("[") && raw.endsWith("]")) {
            var inner = raw.substring(1, raw.length - 1).trim();
            if (inner.length === 0) return [];
            return inner.split(",").map(function (x) { return coerce(x.trim()); });
        }
        if ((raw.startsWith("\"") && raw.endsWith("\"")) ||
            (raw.startsWith("'")  && raw.endsWith("'"))) {
            return raw.substring(1, raw.length - 1);
        }
        if (/^-?\d+$/.test(raw))      return parseInt(raw, 10);
        if (/^-?\d*\.\d+$/.test(raw)) return parseFloat(raw);
        return raw;
    }

    // Strip "enhancedai:" prefix only if ":" appears before "/" — otherwise
    // ":" is part of a value (e.g. minecraft:overworld).
    function parseString(s) {
        var colon = s.indexOf(":");
        var slashFirst = s.indexOf("/");
        var body = (colon !== -1 && colon < slashFirst) ? s.substring(colon + 1) : s;
        var eq = body.indexOf("=");
        if (eq === -1) return null;
        var path = body.substring(0, eq).trim();
        var raw  = body.substring(eq + 1).trim();
        var slash = path.indexOf("/");
        if (slash === -1) return null;
        return {
            feature: path.substring(0, slash),
            subkey:  path.substring(slash + 1),
            value:   coerce(raw)
        };
    }

    function normalize(item) {
        if (item == null) return null;
        if (typeof item === "string") {
            var p = parseString(item);
            return p ? [p] : null;
        }
        if (Array.isArray(item)) {
            if (item.length === 3 && typeof item[0] === "string" && typeof item[1] === "string") {
                return [{ feature: item[0], subkey: item[1], value: coerce(item[2]) }];
            }
            return null;
        }
        if (typeof item === "object") {
            if (item.feature && item.values && typeof item.values === "object") {
                var out = [];
                for (var k in item.values) {
                    out.push({ feature: item.feature, subkey: k, value: coerce(item.values[k]) });
                }
                return out;
            }
            if (item.feature && item.subkey !== undefined) {
                return [{ feature: item.feature, subkey: item.subkey, value: coerce(item.value) }];
            }
        }
        return null;
    }

    // ---------- NBT build / apply -------------------------------------------

    function buildNbt(args) {
        var inner = {};
        var root  = { NeoForgeData: {} };
        root.NeoForgeData[NS] = inner;
        var entries = [];

        if (!Array.isArray(args)) return { root: root, count: 0, entries: entries };

        for (var i = 0; i < args.length; i++) {
            var list = normalize(args[i]);
            if (!list) { warn(`bad arg @${i}: ${JSON.stringify(args[i])}`); continue; }
            for (var j = 0; j < list.length; j++) {
                var e = list[j];
                // "attributes/*" are vanilla LivingEntity attributes, not
                // EnhancedAI NBT keys — applied directly, kept out of NBT.
                if (e.feature !== "attributes") {
                    if (!inner[e.feature]) inner[e.feature] = {};
                    inner[e.feature][e.subkey] = e.value;
                }
                entries.push(e);
            }
        }
        return { root: root, count: entries.length, entries: entries };
    }

    function applyNbt(entity, root) {
        if (typeof entity.mergeNbt !== "function") { err("no mergeNbt on entity"); return false; }
        try { entity.mergeNbt(root); return true; }
        catch (e) { warn(`mergeNbt failed: ${e}`); return false; }
    }

    // ---------- Mob unwrap / server -----------------------------------------

    function rawMob(entity) {
        if (!entity) return null;
        var candidates = [entity, entity.minecraftEntity, entity.entity,
                          entity.unwrap && entity.unwrap()];
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            if (!c) continue;
            try {
                if (typeof c.getGoalSelector === "function" || c.goalSelector !== undefined) return c;
            } catch (e) { /* keep going */ }
        }
        return entity;
    }

    function getServer(target) {
        if (!target) return null;
        try {
            if (typeof target.getServer === "function") return target.getServer();
            if (target.server) return target.server;
            if (target.level) {
                var l = (typeof target.level === "function") ? target.level() : target.level;
                if (l && typeof l.getServer === "function") return l.getServer();
                if (l && l.server) return l.server;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    // ---------- mobGriefing gate --------------------------------------------
    // MineTowardsTargetGoal.canUse() short-circuits on !mobGriefing.

    function checkMobGriefing(level) {
        try {
            var lvl = (level && typeof level.getLevel === "function") ? level.getLevel() : level;
            if (!lvl) return null;
            var rules = (typeof lvl.getGameRules === "function") ? lvl.getGameRules() : lvl.gameRules;
            if (!rules) return null;
            var GameRules = J("net.minecraft.world.level.GameRules");
            if (!GameRules) return null;
            var on = rules.getBoolean(GameRules.RULE_MOBGRIEFING);
            if (!on) warn("mobGriefing=false → miner goal canUse() returns false. /gamerule mobGriefing true");
            return on;
        } catch (e) { return null; }
    }

    // ---------- Direct miner apply ------------------------------------------
    // For miner_mobs entries, call MinerMobs.<FIELD>.apply(rawMob, boxedValue)
    // — writes NBT + fires onChange (attaches goal). Boxing required: Rhino
    // can't auto-box JS → java.lang.Object for EAIData.apply(Mob, T).

    function entriesEnableMiner(entries) {
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e.feature === "miner_mobs" && e.subkey === "miner" &&
                (e.value === true || e.value === "true" || e.value === 1)) return true;
        }
        return false;
    }

    // ---------- Vanilla attribute apply -------------------------------------
    // "attributes/<name>=<number>" sets LivingEntity base attribute value.
    // <name> maps to Attributes.<NAME.toUpperCase()> Holder. e.g.
    //   attributes/follow_range=100   -> see player from 100 blocks
    //   attributes/movement_speed=0.35
    //   attributes/max_health=40
    // Reapplied in deferred because zombie finalizeSpawn re-rolls follow_range
    // and movement_speed modifiers on top of the base.

    function applyAttributes(entity, entries) {
        var attrEntries = [];
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].feature === "attributes") attrEntries.push(entries[i]);
        }
        if (attrEntries.length === 0) return 0;

        var Attributes = J("net.minecraft.world.entity.ai.attributes.Attributes");
        if (!Attributes) { err("applyAttributes: Attributes class not loaded"); return 0; }
        var raw = rawMob(entity);
        if (!raw || typeof raw.getAttribute !== "function") {
            err("applyAttributes: no getAttribute on mob"); return 0;
        }

        var written = 0;
        for (var k = 0; k < attrEntries.length; k++) {
            var en = attrEntries[k];
            var fieldName = String(en.subkey).toUpperCase();
            var holder = null;
            try { holder = Attributes[fieldName]; } catch (eF) { holder = null; }
            if (!holder) { err(`unknown attribute "${en.subkey}"`); continue; }
            var inst = null;
            try { inst = raw.getAttribute(holder); }
            catch (eG) { warn(`getAttribute ${en.subkey}: ${eG}`); continue; }
            if (!inst) { warn(`mob lacks attribute ${en.subkey}`); continue; }
            var val = parseFloat(en.value);
            if (isNaN(val)) { err(`attribute ${en.subkey} not a number: ${en.value}`); continue; }
            try {
                inst.setBaseValue(val);
                written++;
                info(`attribute ${en.subkey}=${val}`);
                if (fieldName === "MAX_HEALTH" && typeof raw.setHealth === "function") {
                    try { raw.setHealth(val); } catch (eH) { /* ignore */ }
                }
            } catch (eS) { err(`setBaseValue ${en.subkey}: ${eS}`); }
        }
        return written;
    }

    function directApplyMiner(entity, entries) {
        var minerEntries = [];
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].feature === "miner_mobs") minerEntries.push(entries[i]);
        }
        if (minerEntries.length === 0) return 0;

        var MinerMobs = J("insane96mcp.enhancedai.module.mobs.miner.MinerMobs");
        if (!MinerMobs) { err("directApplyMiner: MinerMobs class not loaded"); return 0; }
        var ToolReq    = J("insane96mcp.enhancedai.module.mobs.miner.MinerMobs$ToolRequirement");
        var JBoolean   = J("java.lang.Boolean");
        var JInteger   = J("java.lang.Integer");
        var JDouble    = J("java.lang.Double");
        var JArrayList = J("java.util.ArrayList");

        var raw = rawMob(entity);
        if (!raw) { err("directApplyMiner: no rawMob"); return 0; }

        var written = 0;
        for (var k = 0; k < minerEntries.length; k++) {
            var en = minerEntries[k];
            var field = null;
            var jval = null;
            switch (en.subkey) {
                case "miner":
                    field = MinerMobs.MINER;
                    jval = JBoolean.valueOf(en.value === true || en.value === "true" || en.value === 1);
                    break;
                case "tool_requirement":
                    field = MinerMobs.TOOL_REQUIREMENT;
                    if (!ToolReq) break;
                    try { jval = ToolReq.valueOf(String(en.value)); }
                    catch (eEnum) { err(`bad ToolRequirement "${en.value}"`); continue; }
                    break;
                case "max_y":
                    field = MinerMobs.MAX_Y;
                    jval = JInteger.valueOf(parseInt(en.value, 10));
                    break;
                case "max_target_distance":
                    field = MinerMobs.MAX_TARGET_DISTANCE;
                    jval = JInteger.valueOf(parseInt(en.value, 10));
                    break;
                case "time_to_break_multiplier":
                    field = MinerMobs.TIME_TO_BREAK_MULTIPLIER;
                    jval = JDouble.valueOf(parseFloat(en.value));
                    break;
                case "dimension_whitelist":
                    field = MinerMobs.DIMENSION_WHITELIST;
                    if (!Array.isArray(en.value)) {
                        err(`dimension_whitelist not array: ${en.value}`); continue;
                    }
                    var jList = new JArrayList();
                    for (var di = 0; di < en.value.length; di++) jList.add(String(en.value[di]));
                    jval = jList;
                    break;
                default: continue;
            }
            if (!field || jval == null) continue;
            try {
                field.apply(raw, jval);
                written++;
                info(`directApply ${en.subkey}=${en.value}`);
            } catch (eApp) { err(`directApply ${en.subkey}: ${eApp}`); }
        }
        return written;
    }

    // ---------- Hand & goal mgmt --------------------------------------------
    // Wipe both hands — EAI fisher/pearler/shielding randomly equip rod/pearl/
    // shield which shifts goal priority away from MineTowardsTargetGoal.

    function clearHands(entity) {
        try {
            var raw = rawMob(entity);
            if (!raw || typeof raw.setItemSlot !== "function") return;
            var EquipmentSlot = J("net.minecraft.world.entity.EquipmentSlot");
            var ItemStack = J("net.minecraft.world.item.ItemStack");
            if (!EquipmentSlot || !ItemStack) return;
            raw.setItemSlot(EquipmentSlot.MAINHAND, ItemStack.EMPTY);
            raw.setItemSlot(EquipmentSlot.OFFHAND, ItemStack.EMPTY);
            if (typeof raw.setDropChance === "function") {
                raw.setDropChance(EquipmentSlot.MAINHAND, 0.0);
                raw.setDropChance(EquipmentSlot.OFFHAND, 0.0);
            }
        } catch (e) { warn(`clearHands: ${e}`); }
    }

    const STRIP_GOALS = [
        "insane96mcp.enhancedai.module.mobs.pearler.PearlUseGoal",
        "insane96mcp.enhancedai.module.mobs.fisher.FishingTargetGoal"
    ];
    function stripDistractionGoals(entity) {
        try {
            var raw = rawMob(entity);
            if (!raw || !raw.goalSelector) return;
            var GoalHelper = J("insane96mcp.enhancedai.utils.GoalHelper");
            if (!GoalHelper || typeof GoalHelper.removeGoal !== "function") return;
            for (var i = 0; i < STRIP_GOALS.length; i++) {
                var cls = J(STRIP_GOALS[i]);
                if (!cls) continue;
                try { GoalHelper.removeGoal(raw.goalSelector, cls); } catch (eRm) { /* ignore */ }
            }
        } catch (e) { warn(`stripDistractionGoals: ${e}`); }
    }

    // tool_requirement=ANY_TOOL needs DiggerItem offhand; auto-equip only
    // runs for mod's own minerChance roll — pre-setting MINER bypasses that.
    function equipPickaxeIfNeeded(entity, entries) {
        var needs = false;
        var toolReq = null;
        for (var i = 0; i < entries.length; i++) {
            var en = entries[i];
            if (en.feature !== "miner_mobs") continue;
            if (en.subkey === "miner" && en.value === true) needs = true;
            if (en.subkey === "tool_requirement") toolReq = String(en.value);
        }
        if (!needs || toolReq === "NONE") return;

        try {
            var raw = rawMob(entity);
            if (!raw || typeof raw.getOffhandItem !== "function") return;
            var off = raw.getOffhandItem();
            if (off && typeof off.isEmpty === "function" && !off.isEmpty()) return;
            var ItemStack = J("net.minecraft.world.item.ItemStack");
            var Items = J("net.minecraft.world.item.Items");
            var EquipmentSlot = J("net.minecraft.world.entity.EquipmentSlot");
            if (!ItemStack || !Items || !EquipmentSlot) return;
            raw.setItemSlot(EquipmentSlot.OFFHAND, new ItemStack(Items.STONE_PICKAXE));
            if (typeof raw.setDropChance === "function") {
                raw.setDropChance(EquipmentSlot.OFFHAND, -1.0);
            }
        } catch (e) { warn(`equipPickaxe: ${e}`); }
    }

    // Direct goal injection — bypass EAIData entirely. Last-resort defense
    // against changed() listener path failing.
    function injectMinerGoal(entity, priority) {
        try {
            var raw = rawMob(entity);
            if (!raw || !raw.goalSelector) return false;
            var GoalClass = J("insane96mcp.enhancedai.module.mobs.miner.MineTowardsTargetGoal");
            if (!GoalClass) { err("injectMinerGoal: class missing"); return false; }
            var GoalHelper = J("insane96mcp.enhancedai.utils.GoalHelper");
            if (GoalHelper && typeof GoalHelper.removeGoal === "function") {
                try { GoalHelper.removeGoal(raw.goalSelector, GoalClass); } catch (e1) { /* ignore */ }
            }
            raw.goalSelector.addGoal((typeof priority === "number") ? priority : 1, new GoalClass(raw));
            return true;
        } catch (e) { err(`injectMinerGoal: ${e}`); return false; }
    }

    // ---------- Listener firing ---------------------------------------------
    // changed(mob) reads current NBT via the data key and fires onChange —
    // attaches MineTowardsTargetGoal etc.

    const LISTENER_REFS = {
        "miner_mobs": {
            cls: "insane96mcp.enhancedai.module.mobs.miner.MinerMobs",
            fields: ["MINER", "TOOL_REQUIREMENT", "MAX_Y", "MAX_TARGET_DISTANCE",
                     "TIME_TO_BREAK_MULTIPLIER", "DIMENSION_WHITELIST"]
        }
    };

    function fireFeatureListener(entity, featureName) {
        var ref = LISTENER_REFS[featureName];
        if (!ref) return false;
        var raw = rawMob(entity);
        if (!raw) return false;
        var cls = J(ref.cls);
        if (!cls) { err(`class not loaded: ${ref.cls}`); return false; }
        var any = false;
        for (var i = 0; i < ref.fields.length; i++) {
            var fieldName = ref.fields[i];
            var data = null;
            try { data = cls[fieldName]; }
            catch (eF) { err(`field ${ref.cls}.${fieldName}: ${eF}`); continue; }
            if (!data || typeof data.changed !== "function") continue;
            try { data.changed(raw); any = true; }
            catch (eC) { err(`changed ${featureName}/${fieldName}: ${eC}`); }
        }
        return any;
    }

    function fireListeners(entity, args) {
        if (!isEntity(entity) || !Array.isArray(args)) return;
        var seen = {};
        for (var i = 0; i < args.length; i++) {
            var list = normalize(args[i]);
            if (!list) continue;
            for (var j = 0; j < list.length; j++) {
                var feat = list[j].feature;
                if (seen[feat]) continue;
                seen[feat] = true;
                fireFeatureListener(entity, feat);
            }
        }
    }

    // ---------- Public API ---------------------------------------------------

    function create(level, entityType, args) {
        if (!isLevel(level)) { err("create: invalid level"); return null; }
        if (!isEntityTypeId(entityType)) { err(`create: bad type "${entityType}"`); return null; }

        var entity;
        try { entity = level.createEntity(entityType); }
        catch (e) { err(`createEntity threw: ${e}`); return null; }
        if (!entity) { err(`createEntity null: ${entityType}`); return null; }

        var built = buildNbt(args || []);
        if (built.count > 0) {
            applyNbt(entity, built.root);
            directApplyMiner(entity, built.entries);
            applyAttributes(entity, built.entries);
        }
        checkMobGriefing(level);
        return entity;
    }

    function apply(entity, args) {
        if (!isEntity(entity)) { err("apply: invalid entity"); return null; }
        var built = buildNbt(args || []);
        if (built.count > 0) {
            applyNbt(entity, built.root);
            directApplyMiner(entity, built.entries);
            applyAttributes(entity, built.entries);
        }
        return entity;
    }

    // Reapply at multiple tick offsets — counters mod re-init on
    // EntityJoinLevelEvent and ensures AI goal actually attaches.
    function applyDeferred(level, entity, args, ticks) {
        var server = getServer(level) || getServer(entity);
        if (!server || typeof server.scheduleInTicks !== "function") {
            warn("applyDeferred: no scheduler"); return;
        }
        var built = buildNbt(args || []);
        if (built.count === 0) return;

        var wantMiner = entriesEnableMiner(built.entries);
        var offsets = Array.isArray(ticks) ? ticks : [1, 5, 20, 60];

        for (var oi = 0; oi < offsets.length; oi++) {
            var t = offsets[oi];
            try {
                server.scheduleInTicks(t, (function (tick) {
                    return function () {
                        try {
                            if (!entity || (entity.isAlive && !entity.isAlive())) return;
                            applyNbt(entity, built.root);
                            if (wantMiner) {
                                clearHands(entity);
                                directApplyMiner(entity, built.entries);
                                stripDistractionGoals(entity);
                            }
                            equipPickaxeIfNeeded(entity, built.entries);
                            applyAttributes(entity, built.entries);
                            fireListeners(entity, args);
                            if (wantMiner) injectMinerGoal(entity, 1);
                        } catch (eD) { warn(`deferred t=${tick}: ${eD}`); }
                    };
                })(t));
            } catch (eS) { warn(`scheduleInTicks(${t}): ${eS}`); }
        }
    }

    function dumpGoals(entity) {
        try {
            var raw = rawMob(entity);
            var sel = raw && raw.goalSelector;
            if (!sel) { warn("no goalSelector"); return; }
            var goals = (typeof sel.getAvailableGoals === "function")
                ? sel.getAvailableGoals() : sel.availableGoals;
            if (!goals) { warn("no availableGoals"); return; }
            var names = [];
            var iter = goals.iterator();
            while (iter.hasNext()) {
                var wrap = iter.next();
                var g;
                try { g = (typeof wrap.getGoal === "function") ? wrap.getGoal() : wrap.goal; }
                catch (e1) { g = wrap; }
                try { names.push(g.getClass().getName()); } catch (e2) { names.push(String(g)); }
            }
            console.info(`[EnhancedAI] goals on ${raw.type}: ${names.join(", ")}`);
        } catch (e) { err(`dumpGoals: ${e}`); }
    }

    function enhancedAiFactory(a, b, c) {
        if (isLevel(a) && isEntityTypeId(b)) return create(a, b, c);
        if (isEntity(a) && (b === undefined || Array.isArray(b))) return apply(a, b);
        err("ambiguous call");
        return null;
    }

    // ---------- Presets ------------------------------------------------------
    // Miner notes:
    //   - tool_requirement=NONE skips offhand check
    //   - max_target_distance=0 means unlimited
    //   - max_y=320 matches mod default

    const PRESETS = {
        superMiner: [
            "miner_mobs/miner=true",
            "miner_mobs/tool_requirement=NONE",
            "miner_mobs/max_y=320",
            "miner_mobs/max_target_distance=0",
            "miner_mobs/time_to_break_multiplier=1.0",
            "miner_mobs/dimension_whitelist=[minecraft:overworld,minecraft:the_nether,minecraft:the_end]",
            "parkour/can_parkour=true",
            "sprint/can_sprint=true",
            "climbing/can_climb_ladders=true"
        ],

        pearlThrower: ["pearler_mobs/inaccuracy=8"],

        fisherAggro: [
            "fisher_mobs/hook_hands_chance=0.7",
            "fisher_mobs/reel_in_ticks=15",
            "fisher_mobs/cooldown=80",
            "fisher_mobs/fish_range=18.0",
            "fisher_mobs/attack_range=3.0"
        ],

        webShooter: [
            "web_thrower/web_thrower=true",
            "web_thrower/poisonous_web=true",
            "web_thrower/place_web_on_block_hit=true",
            "web_thrower/place_web_on_entity_hit=true",
            "web_thrower/damage=2.0",
            "web_thrower/cooldown=100",
            "web_thrower/distance_min=4.0",
            "web_thrower/distance_max=16.0"
        ],

        antiCheese: [
            "anti-cheese/prevent_riding=true",
            "anti-cheese/break_vehicle=true",
            "teleport_anti-cheese/use_teleport_anti_cheese=true",
            "avoid_explosions/can_run_from_explosions=true",
            "avoid_explosions/can_run_from_tnt=true"
        ],

        thrower: [
            "pick_up_and_throw/can_pick_up=#minecraft:players",
            "pick_up_and_throw/min_distance_to_pick_up=2",
            "pick_up_and_throw/max_distance_to_throw=12",
            "pick_up_and_throw/speed_modifier_to_pick_up=1.2",
            "pick_up_and_throw/cooldown=200"
        ],

        sharpTargeting: [
            "targeting/target_chance=1",
            "targeting/unseen_forget_ticks=600",
            "targeting/alert_range=24",
            "targeting/hurt_by_prefer_players=true",
            "targeting/hurt_by_prevent_infighting=true"
        ],

        mobile: [
            "climbing/can_climb_ladders=true",
            "climbing/can_climb_walls=true",
            "parkour/can_parkour=true",
            "sprint/can_sprint=true",
            "open_doors/can_open_doors=true",
            "jump/can_jump=true"
        ],

        tntCreeper: [
            "creeper_launch/launch=true",
            "tnt_like_creepers/tnt_like=true",
            "disable_falling_swelling/disable_falling_swelling=true"
        ],

        skirmisher: [
            "skeleton_shoot/shooting_range=24.0",
            "skeleton_shoot/strafe=true",
            "skeleton_flee_target/avoid_target=true",
            "skeleton_flee_target/attack_when_avoiding=true",
            "flee_target/avoid_target=true",
            "flee_target/attack_when_avoiding=true"
        ],

        // 100-block player sight. follow_range = vanilla detection radius
        // (NOT targeting/alert_range, which only alerts nearby allies).
        farSight: [
            "attributes/follow_range=100",
            "targeting/target_chance=1",
            "targeting/unseen_forget_ticks=2400",
            "targeting/alert_range=64",
            "targeting/hurt_by_prefer_players=true"
        ]
    };

    function resolvePresets(names) {
        if (!Array.isArray(names)) return [];
        var out = [];
        for (var i = 0; i < names.length; i++) {
            var p = PRESETS[names[i]];
            if (!p) { warn(`unknown preset "${names[i]}"`); continue; }
            for (var j = 0; j < p.length; j++) out.push(p[j]);
        }
        return out;
    }

    function resolveArgs(presetNames, extraArgs) {
        var merged = resolvePresets(presetNames);
        if (Array.isArray(extraArgs)) {
            for (var i = 0; i < extraArgs.length; i++) merged.push(extraArgs[i]);
        }
        return merged;
    }

    function fromPresets(level, entityType, presetNames, extraArgs) {
        return create(level, entityType, resolveArgs(presetNames, extraArgs));
    }

    // ---------- Export -------------------------------------------------------

    global.enhancedAiFactory = enhancedAiFactory;
    global.EnhancedAI = {
        create:           create,
        apply:            apply,
        applyDeferred:    applyDeferred,
        fromPresets:      fromPresets,
        resolveArgs:      resolveArgs,
        fireListeners:    fireListeners,
        directApplyMiner: directApplyMiner,
        applyAttributes:  applyAttributes,
        injectMinerGoal:  injectMinerGoal,
        checkMobGriefing: checkMobGriefing,
        dumpGoals:        dumpGoals,
        rawMob:           rawMob,
        presets:          PRESETS,
        NAMESPACE:        NS
    };
})(this);
