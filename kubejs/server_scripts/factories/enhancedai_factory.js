// priority: 100
// kubejs/server_scripts/factories/enhancedai_factory.js
//
// EnhancedAI v4.1.0.0 (Insane96) data-key factory for KubeJS 1.21.1 NeoForge.
//
// Storage model verified against decompiled mod bytecode:
//   InsaneLib.ModNBTData reads from entity.getPersistentData() which IS
//   the NeoForgeData compound. Data key `enhancedai:miner_mobs/miner`
//   resolves to NBT path NeoForgeData.enhancedai.miner_mobs.miner.
//
// Goal-attach flow:
//   1. Pre-spawn: write nested NBT (NeoForgeData.enhancedai.<feature>.<key>).
//   2. Mod's EntityJoinLevelEvent calls EAIData.applyIfAbsent → no-op
//      because value already present → onChange listener (which adds the
//      MineTowardsTargetGoal etc.) NEVER fires.
//   3. We fix that by calling EAIData.changed(rawMob) post-spawn —
//      changed() bypasses applyIfAbsent's "skip" branch and runs onChange.
//
// Miner-specific gotchas (from MineTowardsTargetGoal.canUse bytecode):
//   - mobGriefing gamerule must be TRUE
//   - tool_requirement=ANY_TOOL requires DiggerItem in offhand
//     (mod only auto-equips stone pickaxe when its own minerChance roll
//     picks the mob; our pre-spawn NBT bypasses that path, so offhand is
//     empty). Use tool_requirement=NONE to skip the offhand check.
//   - max_target_distance=0 means UNLIMITED; any other value caps mining
//     range. superMiner preset uses 0.
//   - Mob must be stuck for ~60 ticks with target aggroed.

(function (global) {
    "use strict";

    const NS    = "enhancedai";
    const DEBUG = false;

    function dbg(m) { if (DEBUG) console.info(`[EnhancedAI] ${m}`); }
    function warn(m) { console.warn(`[EnhancedAI] ${m}`); }
    function err(m)  { console.error(`[EnhancedAI] ${m}`); }

    // ---------- Type guards --------------------------------------------------

    function isLevel(o) {
        return o !== null && typeof o === "object" &&
               typeof o.createEntity === "function";
    }
    function isEntity(o) {
        if (o === null || typeof o !== "object") return false;
        if (typeof o.setPos === "function") return true;
        if (typeof o.getPersistentData === "function") return true;
        if (o.persistentData !== undefined) return true;
        return false;
    }
    function isEntityTypeId(s) {
        return typeof s === "string" && s.length > 0 && s.indexOf(":") !== -1;
    }

    // ---------- Value parsing ------------------------------------------------

    function coerce(raw) {
        if (raw === "true")  return true;
        if (raw === "false") return false;
        if (raw.startsWith("[") && raw.endsWith("]")) {
            var innerStr = raw.substring(1, raw.length - 1).trim();
            if (innerStr.length === 0) return [];
            return innerStr.split(",").map(function (x) { return coerce(x.trim()); });
        }
        if ((raw.startsWith("\"") && raw.endsWith("\"")) ||
            (raw.startsWith("'")  && raw.endsWith("'"))) {
            return raw.substring(1, raw.length - 1);
        }
        if (/^-?\d+$/.test(raw))      return parseInt(raw, 10);
        if (/^-?\d*\.\d+$/.test(raw)) return parseFloat(raw);
        return raw;
    }

    function parseString(s) {
        // Strip optional namespace prefix "enhancedai:" only if ":" appears
        // before "/" (path-separator). Otherwise ":" is part of a value.
        var colon = s.indexOf(":");
        var slashFirst = s.indexOf("/");
        var body = (colon !== -1 && colon < slashFirst) ? s.substring(colon + 1) : s;
        var eq = body.indexOf("=");
        if (eq === -1) return null;
        var path  = body.substring(0, eq).trim();
        var raw   = body.substring(eq + 1).trim();
        var slash = path.indexOf("/");
        if (slash === -1) return null;
        return {
            feature: path.substring(0, slash),
            subkey:  path.substring(slash + 1),
            value:   coerce(raw)
        };
    }

    function normalize(item) {
        if (item === null || item === undefined) return null;
        if (typeof item === "string") {
            const p = parseString(item);
            return p ? [p] : null;
        }
        if (Array.isArray(item)) {
            if (item.length === 3 &&
                typeof item[0] === "string" &&
                typeof item[1] === "string") {
                return [{ feature: item[0], subkey: item[1], value: item[2] }];
            }
            return null;
        }
        if (typeof item === "object") {
            if (item.feature && item.values && typeof item.values === "object") {
                const out = [];
                for (const k in item.values) {
                    out.push({ feature: item.feature, subkey: k, value: item.values[k] });
                }
                return out;
            }
            if (item.feature && item.subkey !== undefined) {
                return [{ feature: item.feature, subkey: item.subkey, value: item.value }];
            }
        }
        return null;
    }

    // ---------- NBT construction --------------------------------------------

    function buildNbt(args) {
        var inner = {};
        var root  = { NeoForgeData: {} };
        root.NeoForgeData[NS] = inner;
        var count = 0;

        if (!args || !Array.isArray(args)) return { root: root, count: 0, entries: [] };

        var entries = [];
        for (var i = 0; i < args.length; i++) {
            var list = normalize(args[i]);
            if (!list) { warn(`bad arg @${i}: ${JSON.stringify(args[i])}`); continue; }
            for (var j = 0; j < list.length; j++) {
                var e = list[j];
                if (!inner[e.feature]) inner[e.feature] = {};
                inner[e.feature][e.subkey] = e.value;
                entries.push(e);
                count++;
            }
        }
        return { root: root, count: count, entries: entries };
    }

    function applyNbt(entity, root) {
        try {
            if (typeof entity.mergeNbt === "function") {
                entity.mergeNbt(root);
                if (DEBUG) {
                    try { console.info(`[EnhancedAI] merged: ${JSON.stringify(root)}`); }
                    catch (eLog) { /* circular safe */ }
                }
                return true;
            }
        } catch (e) { warn(`mergeNbt failed: ${e}`); }
        err("no mergeNbt on entity");
        return false;
    }

    // ---------- Raw Mob unwrap ----------------------------------------------
    // KubeJS 1.21.1 exposes entities as their raw Java type, so most calls
    // pass through. Some helpers (custom data) wrap; try every reasonable
    // accessor to get the underlying net.minecraft.world.entity.Mob.

    function rawMob(entity) {
        if (!entity) return null;
        const candidates = [
            entity,
            entity.minecraftEntity,
            entity.entity,
            entity.unwrap && entity.unwrap()
        ];
        for (const c of candidates) {
            if (!c) continue;
            try {
                if (typeof c.getGoalSelector === "function" || c.goalSelector !== undefined) {
                    return c;
                }
            } catch (e) { /* keep going */ }
        }
        return entity;
    }

    function getServer(target) {
        try {
            if (target && typeof target.getServer === "function") return target.getServer();
            if (target && target.server) return target.server;
            if (target && target.level) {
                const l = (typeof target.level === "function") ? target.level() : target.level;
                if (l && typeof l.getServer === "function") return l.getServer();
                if (l && l.server) return l.server;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    // ---------- mobGriefing gate --------------------------------------------
    // MineTowardsTargetGoal.canUse() short-circuits on !mobGriefing.
    // Warn loudly if the gamerule is off (don't silently flip it).

    function checkMobGriefing(level) {
        try {
            var lvl = level && (typeof level === "object")
                ? (typeof level.getLevel === "function" ? level.getLevel() : level)
                : null;
            if (!lvl) return null;
            var rules = (typeof lvl.getGameRules === "function") ? lvl.getGameRules() : lvl.gameRules;
            if (!rules) return null;
            var GameRules = Java.loadClass("net.minecraft.world.level.GameRules");
            var key = GameRules.RULE_MOBGRIEFING;
            var on = rules.getBoolean(key);
            if (DEBUG) console.info(`[EnhancedAI] mobGriefing=${on}`);
            if (!on) warn("mobGriefing=false → miner goal canUse() returns false. Run /gamerule mobGriefing true");
            return on;
        } catch (ex) { return null; }
    }

    // Direct goal injection — bypass EAIData entirely. Use as last-resort
    // when changed() listener path fails to attach MineTowardsTargetGoal.
    function injectMinerGoal(entity, priority) {
        try {
            var raw = rawMob(entity);
            if (!raw) return false;
            var sel = raw.goalSelector;
            if (!sel) return false;
            var GoalClass = loadClassSafe("insane96mcp.enhancedai.module.mobs.miner.MineTowardsTargetGoal");
            if (!GoalClass) { err("injectMinerGoal: MineTowardsTargetGoal class missing"); return false; }
            var GoalHelper = loadClassSafe("insane96mcp.enhancedai.utils.GoalHelper");
            if (GoalHelper && typeof GoalHelper.removeGoal === "function") {
                try { GoalHelper.removeGoal(sel, GoalClass); } catch (e1) { /* ignore */ }
            }
            var goal = new GoalClass(raw);
            sel.addGoal((typeof priority === "number") ? priority : 1, goal);
            if (DEBUG) console.info(`[EnhancedAI] MineTowardsTargetGoal injected on ${raw.type}`);
            return true;
        } catch (ex) { err(`injectMinerGoal failed: ${ex}`); return false; }
    }

    // ---------- Direct mod-API apply ----------------------------------------
    // Skip JS-NBT merge entirely. For miner_mobs entries, call the mod's own
    // EAIData.apply(rawMob, value) — writes NBT + fires onChange (attaches
    // goal). Bypasses any KubeJS mergeNbt quirks.

    function directApplyMiner(entity, entries) {
        try {
            if (!entries || entries.length === 0) return 0;
            var minerEntries = [];
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].feature === "miner_mobs") minerEntries.push(entries[i]);
            }
            if (minerEntries.length === 0) return 0;

            var MinerMobs = loadClassSafe("insane96mcp.enhancedai.module.mobs.miner.MinerMobs");
            if (!MinerMobs) { err("directApplyMiner: MinerMobs class not loaded"); return 0; }
            var ToolReq = loadClassSafe("insane96mcp.enhancedai.module.mobs.miner.MinerMobs$ToolRequirement");
            var JBoolean = Java.loadClass("java.lang.Boolean");
            var JInteger = Java.loadClass("java.lang.Integer");
            var JDouble  = Java.loadClass("java.lang.Double");
            var JArrayList = Java.loadClass("java.util.ArrayList");

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
                        if (ToolReq) {
                            try { jval = ToolReq.valueOf(String(en.value)); }
                            catch (eEnum) { err(`directApplyMiner: bad ToolRequirement "${en.value}"`); continue; }
                        }
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
                        if (Array.isArray(en.value)) {
                            var jList = new JArrayList();
                            for (var di = 0; di < en.value.length; di++) jList.add(String(en.value[di]));
                            jval = jList;
                        } else {
                            err(`directApplyMiner: dimension_whitelist not array: ${en.value}`);
                            continue;
                        }
                        break;
                    default:
                        continue;
                }
                if (!field || jval === null || jval === undefined) continue;
                try {
                    field.apply(raw, jval);
                    written++;
                    if (DEBUG) console.info(`[EnhancedAI] directApplyMiner WROTE: ${en.subkey} = ${en.value}`);
                } catch (eApp) {
                    err(`directApplyMiner ${en.subkey} apply threw: ${eApp}`);
                }
            }
            return written;
        } catch (ex) { err(`directApplyMiner outer threw: ${ex}`); return 0; }
    }

    // ---------- Clear hands -------------------------------------------------
    // EnhancedAI's fisher_mobs/pearler_mobs/shielding features randomly equip
    // fishing rod / ender pearl / shield into zombie hands. Those items shift
    // goalSelector priority away from MineTowardsTargetGoal and break aggro
    // logic. Wipe both hands when we want a pure miner.

    function clearHands(entity) {
        try {
            var raw = rawMob(entity);
            if (!raw || typeof raw.setItemSlot !== "function") return;
            var EquipmentSlot = Java.loadClass("net.minecraft.world.entity.EquipmentSlot");
            var ItemStack = Java.loadClass("net.minecraft.world.item.ItemStack");
            raw.setItemSlot(EquipmentSlot.MAINHAND, ItemStack.EMPTY);
            raw.setItemSlot(EquipmentSlot.OFFHAND, ItemStack.EMPTY);
            if (typeof raw.setDropChance === "function") {
                raw.setDropChance(EquipmentSlot.MAINHAND, 0.0);
                raw.setDropChance(EquipmentSlot.OFFHAND, 0.0);
            }
        } catch (ex) { warn(`clearHands failed: ${ex}`); }
    }

    // Strip non-miner EnhancedAI goals (pearl-throwing, fishing) so they
    // don't outcompete MineTowardsTargetGoal in goal selection.
    var STRIP_GOALS = [
        "insane96mcp.enhancedai.module.mobs.pearler.PearlUseGoal",
        "insane96mcp.enhancedai.module.mobs.fisher.FishingTargetGoal"
    ];
    function stripDistractionGoals(entity) {
        try {
            var raw = rawMob(entity);
            if (!raw || !raw.goalSelector) return;
            var GoalHelper = loadClassSafe("insane96mcp.enhancedai.utils.GoalHelper");
            if (!GoalHelper || typeof GoalHelper.removeGoal !== "function") return;
            for (var i = 0; i < STRIP_GOALS.length; i++) {
                var GoalClass = loadClassSafe(STRIP_GOALS[i]);
                if (!GoalClass) continue;
                try { GoalHelper.removeGoal(raw.goalSelector, GoalClass); }
                catch (eRm) { /* ignore */ }
            }
        } catch (ex) { warn(`stripDistractionGoals failed: ${ex}`); }
    }

    // ---------- Pickaxe insurance -------------------------------------------
    // tool_requirement=ANY_TOOL needs a DiggerItem in offhand. The mod's
    // auto-equip path only runs when its own minerChance roll picks the mob
    // — which is bypassed when we pre-set MINER=true. Equip manually.

    function equipPickaxeIfNeeded(entity, entries) {
        var needs = false;
        var toolReq = null;
        for (var i = 0; i < entries.length; i++) {
            var en = entries[i];
            if (en.feature === "miner_mobs" && en.subkey === "miner" && en.value === true) needs = true;
            if (en.feature === "miner_mobs" && en.subkey === "tool_requirement") toolReq = String(en.value);
        }
        if (!needs) return;
        if (toolReq === "NONE") return;

        try {
            var raw = rawMob(entity);
            if (!raw || typeof raw.getOffhandItem !== "function") return;
            var off = raw.getOffhandItem();
            if (off && typeof off.isEmpty === "function" && !off.isEmpty()) return;
            var ItemStack = Java.loadClass("net.minecraft.world.item.ItemStack");
            var Items = Java.loadClass("net.minecraft.world.item.Items");
            var EquipmentSlot = Java.loadClass("net.minecraft.world.entity.EquipmentSlot");
            var stack = new ItemStack(Items.STONE_PICKAXE);
            raw.setItemSlot(EquipmentSlot.OFFHAND, stack);
            if (typeof raw.setDropChance === "function") {
                raw.setDropChance(EquipmentSlot.OFFHAND, -1.0);
            }
            dbg("equipped stone pickaxe in offhand");
        } catch (ex) { warn(`equipPickaxeIfNeeded failed: ${ex}`); }
    }

    // ---------- Public API ---------------------------------------------------

    function create(level, entityType, args) {
        if (!isLevel(level)) { err("create: invalid level"); return null; }
        if (!isEntityTypeId(entityType)) { err(`create: bad type "${entityType}"`); return null; }

        var entity;
        try { entity = level.createEntity(entityType); }
        catch (e) { err(`createEntity threw: ${e}`); return null; }
        if (!entity) { err(`createEntity returned null: ${entityType}`); return null; }

        var built = buildNbt(args || []);
        if (built.count > 0) {
            applyNbt(entity, built.root);
            directApplyMiner(entity, built.entries);
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
        }
        return entity;
    }

    /**
     * Reapply NBT + fire listeners + equip pickaxe at multiple tick offsets.
     * Counters mod re-init on EntityJoinLevelEvent and ensures the AI goal
     * actually attaches.
     */
    function applyDeferred(level, entity, args, ticks) {
        var server = getServer(level) || getServer(entity);
        if (!server || typeof server.scheduleInTicks !== "function") {
            warn("applyDeferred: no scheduler");
            return;
        }
        var offsets = Array.isArray(ticks) ? ticks : [1, 5, 20, 60];
        var built = buildNbt(args || []);
        if (built.count === 0) return;
        var wantMiner = false;
        for (var bi = 0; bi < built.entries.length; bi++) {
            var be = built.entries[bi];
            if (be.feature === "miner_mobs" && be.subkey === "miner" && be.value === true) wantMiner = true;
        }
        var scheduleOne = function (t, isLast) {
            try {
                server.scheduleInTicks(t, () => {
                    try {
                        if (!entity || (entity.isAlive && !entity.isAlive())) return;
                        applyNbt(entity, built.root);
                        if (wantMiner) {
                            clearHands(entity);
                            directApplyMiner(entity, built.entries);
                            stripDistractionGoals(entity);
                        }
                        equipPickaxeIfNeeded(entity, built.entries);
                        fireListeners(entity, args);
                        if (wantMiner) injectMinerGoal(entity, 1);
                    } catch (e) { warn(`deferred t=${t}: ${e}`); }
                });
            } catch (e) { warn(`scheduleInTicks(${t}): ${e}`); }
        };
        for (var oi = 0; oi < offsets.length; oi++) {
            scheduleOne(offsets[oi], oi === offsets.length - 1);
        }
    }

    function enhancedAiFactory(a, b, c) {
        if (isLevel(a) && isEntityTypeId(b)) return create(a, b, c);
        if (isEntity(a) && (b === undefined || Array.isArray(b))) return apply(a, b);
        err("ambiguous call");
        return null;
    }

    // ---------- Presets ------------------------------------------------------
    // KEY FIXES vs prior version:
    //   - tool_requirement=NONE (not ANY_TOOL) — skips offhand check
    //   - max_target_distance removed (default 0 = unlimited)
    //   - max_y bumped to 320 (matches mod default; previous 80 capped too low)

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

        pearlThrower: [
            "pearler_mobs/inaccuracy=8"
        ],

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
        ]
    };

    function resolvePresets(names) {
        if (!Array.isArray(names)) return [];
        var out = [];
        for (var ni = 0; ni < names.length; ni++) {
            var n = names[ni];
            var p = PRESETS[n];
            if (!p) { warn(`unknown preset "${n}"`); continue; }
            for (var pi = 0; pi < p.length; pi++) out.push(p[pi]);
        }
        if (DEBUG) console.info(`[EnhancedAI] resolvePresets(${JSON.stringify(names)}) → ${out.length} items`);
        return out;
    }

    function fromPresets(level, entityType, presetNames, extraArgs) {
        return create(level, entityType, resolveArgs(presetNames, extraArgs));
    }

    function resolveArgs(presetNames, extraArgs) {
        var merged = resolvePresets(presetNames);
        if (Array.isArray(extraArgs)) {
            for (var ei = 0; ei < extraArgs.length; ei++) merged.push(extraArgs[ei]);
        }
        return merged;
    }

    // ---------- Listener firing ---------------------------------------------
    // Each entry: { cls: FQN, fields: [staticFieldName,...] }.
    // changed(mob) reads current NBT value via the data key and fires the
    // onChange BiConsumer — that's what attaches MineTowardsTargetGoal etc.

    const LISTENER_REFS = {
        "miner_mobs": [
            { cls: "insane96mcp.enhancedai.module.mobs.miner.MinerMobs",
              fields: ["MINER", "TOOL_REQUIREMENT", "MAX_Y", "MAX_TARGET_DISTANCE",
                       "TIME_TO_BREAK_MULTIPLIER", "DIMENSION_WHITELIST"] }
        ]
    };

    function loadClassSafe(fqn) {
        try {
            if (typeof Java !== "undefined" && typeof Java.loadClass === "function") {
                return Java.loadClass(fqn);
            }
        } catch (e1) { /* fall through */ }
        try {
            if (typeof Packages !== "undefined") {
                var parts = fqn.split(".");
                var cur = Packages;
                for (var i = 0; i < parts.length; i++) cur = cur[parts[i]];
                return cur;
            }
        } catch (e2) { /* fall through */ }
        return null;
    }

    function fireFeatureListener(entity, featureName) {
        var refs = LISTENER_REFS[featureName];
        if (!refs) return false;
        var raw = rawMob(entity);
        if (!raw) { warn(`fire: no rawMob for ${featureName}`); return false; }
        var any = false;
        for (var ri = 0; ri < refs.length; ri++) {
            var r = refs[ri];
            var cls = loadClassSafe(r.cls);
            if (!cls) { err(`class not loaded: ${r.cls}`); continue; }
            for (var fi = 0; fi < r.fields.length; fi++) {
                var fieldName = r.fields[fi];
                var data = null;
                try { data = cls[fieldName]; }
                catch (e3) { err(`field ${r.cls}.${fieldName}: ${e3}`); continue; }
                if (!data) continue;
                try {
                    if (typeof data.changed === "function") {
                        data.changed(raw);
                        dbg(`changed() ${featureName}/${fieldName}`);
                        any = true;
                    }
                } catch (e4) { err(`changed() ${featureName}/${fieldName}: ${e4}`); }
            }
        }
        return any;
    }

    function fireListeners(entity, args) {
        if (!isEntity(entity) || !Array.isArray(args)) return;
        const seen = new Set();
        for (const a of args) {
            const list = normalize(a);
            if (!list) continue;
            for (const e of list) {
                if (seen.has(e.feature)) continue;
                seen.add(e.feature);
                fireFeatureListener(entity, e.feature);
            }
        }
    }

    function dumpGoals(entity) {
        try {
            var raw = rawMob(entity);
            var sel = raw && raw.goalSelector;
            if (!sel) { warn("no goalSelector"); return; }
            var goals = (typeof sel.getAvailableGoals === "function") ? sel.getAvailableGoals() : sel.availableGoals;
            if (!goals) { warn("no availableGoals"); return; }
            var iter = goals.iterator();
            var names = [];
            while (iter.hasNext()) {
                var wrap = iter.next();
                var g = null;
                try { g = (typeof wrap.getGoal === "function") ? wrap.getGoal() : wrap.goal; } catch (e1) { g = wrap; }
                var cn = "?";
                try { cn = g.getClass().getName(); } catch (e2) { cn = String(g); }
                names.push(cn);
            }
            console.info(`[EnhancedAI] goals on ${raw.type}: ${names.join(", ")}`);
        } catch (ex) { err(`dumpGoals: ${ex}`); }
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
        injectMinerGoal:  injectMinerGoal,
        checkMobGriefing: checkMobGriefing,
        dumpGoals:        dumpGoals,
        rawMob:           rawMob,
        presets:          PRESETS,
        NAMESPACE:        NS
    };
})(this);
