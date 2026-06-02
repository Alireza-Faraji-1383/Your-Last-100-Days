// priority: 50
// kubejs/server_scripts/factories/enhancedai_factory_test.js
//
// In-game test for enhancedai_factory.js PRESETS.
//
// Usage (chat as op):
//   /eai_test_presets            -> spawn all presets in row in front of player
//   /eai_test_preset <name>      -> spawn one preset at player
//   /eai_test_combo <a> <b> ...  -> spawn ONE mob with multiple presets merged
//                                   (e.g. /eai_test_combo superMiner farSight)
//   /eai_test_clear              -> kill all test mobs (tagged eai_test)
//   /eai_test_dump               -> dump goals + NBT of nearest test mob
//
// Each test mob:
//   - tagged "eai_test" + "eai_test_<presetName>"
//   - named with preset label
//   - given any item the feature needs (bow for skirmisher, pickaxe backup
//     for superMiner, sword for thrower/sharpTargeting/antiCheese/mobile)
//   - applied via EnhancedAI.fromPresets so NBT + direct miner apply + goal
//     injection all run, then applyDeferred reapplies at +1/+5/+20/+60 ticks.

(function () {
    "use strict";

    // Preset -> { entity, items, note }
    // items: optional { mainhand, offhand } item ids; mod auto-equips rod for
    // fisher and pearl for pearler, so we leave those empty.
    const TEST_PLAN = {
        superMiner:     { entity: "minecraft:zombie",   items: null,
                          note: "should mine toward you when stuck (mobGriefing=true required; tool_requirement=NONE so no pickaxe needed — clearHands wipes hands anyway)" },
        pearlThrower:   { entity: "minecraft:zombie",   items: { mainhand: "minecraft:ender_pearl" },
                          note: "mod auto-gives ender pearl, throws inaccurately" },
        fisherAggro:    { entity: "minecraft:drowned",  items: { mainhand: "minecraft:fishing_rod" },
                          note: "mod auto-gives rod, reels you in" },
        webShooter:     { entity: "minecraft:zombie",   items: null,
                          note: "throws cobwebs (needs poisonous_web mod cfg)" },
        antiCheese:     { entity: "minecraft:zombie",   items: { mainhand: "minecraft:iron_sword" },
                          note: "won't ride boats/minecarts, breaks vehicles, flees TNT" },
        thrower:        { entity: "minecraft:zombie",   items: { mainhand: "minecraft:iron_sword" },
                          note: "picks up player and throws (close range to trigger)" },
        sharpTargeting: { entity: "minecraft:zombie",   items: { mainhand: "minecraft:iron_sword" },
                          note: "longer alert range + prefers players over mobs" },
        mobile:         { entity: "minecraft:zombie",   items: { mainhand: "minecraft:iron_sword" },
                          note: "climbs ladders/walls, parkour, opens doors, sprints" },
        tntCreeper:     { entity: "minecraft:creeper",  items: null,
                          note: "launches via TNT-like blast" },
        skirmisher:     { entity: "minecraft:skeleton", items: { mainhand: "minecraft:bow" },
                          note: "strafes + flees while shooting" }
    };

    function getEAI() {
        var EAI = (typeof EnhancedAI !== "undefined") ? EnhancedAI : null;
        if (!EAI) { console.error("[EAI-test] EnhancedAI global missing — factory not loaded"); return null; }
        return EAI;
    }

    function J(fqn) {
        try { return Java.loadClass(fqn); } catch (e) { return null; }
    }

    function giveItems(entity, items) {
        if (!items) return;
        try {
            var raw = getEAI().rawMob(entity);
            if (!raw || typeof raw.setItemSlot !== "function") return;
            var EquipmentSlot = J("net.minecraft.world.entity.EquipmentSlot");
            var ItemStack     = J("net.minecraft.world.item.ItemStack");
            var BuiltIn       = J("net.minecraft.core.registries.BuiltInRegistries");
            var ResLoc        = J("net.minecraft.resources.ResourceLocation");
            if (!EquipmentSlot || !ItemStack || !BuiltIn || !ResLoc) return;
            var slots = { mainhand: EquipmentSlot.MAINHAND, offhand: EquipmentSlot.OFFHAND };
            for (var key in slots) {
                if (!items[key]) continue;
                var id = items[key];
                var rl = ResLoc.parse(id);
                var item = BuiltIn.ITEM.get(rl);
                if (!item) { console.warn("[EAI-test] unknown item " + id); continue; }
                raw.setItemSlot(slots[key], new ItemStack(item));
                if (typeof raw.setDropChance === "function") {
                    raw.setDropChance(slots[key], -1.0);
                }
            }
        } catch (e) { console.warn("[EAI-test] giveItems: " + e); }
    }

    function spawnOne(level, presetName, x, y, z, target) {
        var plan = TEST_PLAN[presetName];
        if (!plan) { console.warn("[EAI-test] unknown preset " + presetName); return null; }
        var EAI = getEAI();
        if (!EAI) return null;

        var entity = EAI.fromPresets(level, plan.entity, [presetName]);
        if (!entity) { console.error("[EAI-test] fromPresets returned null for " + presetName); return null; }

        try { entity.setPos(x, y, z); } catch (eP) { console.warn("[EAI-test] setPos: " + eP); }
        try { entity.addTag("eai_test"); } catch (eT1) {}
        try { entity.addTag("eai_test_" + presetName); } catch (eT2) {}
        try { entity.setCustomName(Text.of("[" + presetName + "]")); } catch (e1) { console.warn("[EAI-test] setCustomName: " + e1); }
        try { entity.setCustomNameVisible(true); } catch (e2) {}
        try { entity.setPersistenceRequired(); } catch (e3) {}

        giveItems(entity, plan.items);

        // miner needs offhand pickaxe only if tool_requirement != NONE;
        // superMiner uses NONE, so no item is given (clearHands wipes hands).

        try { entity.spawn(); }
        catch (eSp) { console.error("[EAI-test] entity.spawn() failed: " + eSp); return null; }
        EAI.applyDeferred(level, entity, EAI.resolveArgs([presetName], []));

        // Force target on player so goals (miner, fisher, web) actually engage.
        if (target) {
            try {
                var raw = EAI.rawMob(entity);
                if (raw && typeof raw.setTarget === "function") raw.setTarget(target);
            } catch (eT) {}
        }

        function fmt(n) { return (Math.round(Number(n) * 10) / 10).toString(); }
        console.info("[EAI-test] spawned " + presetName + " (" + plan.entity + ") at "
                     + fmt(x) + "," + fmt(y) + "," + fmt(z) + " — " + plan.note);
        return entity;
    }

    // Spawn ONE mob with MULTIPLE presets merged (e.g. superMiner + farSight).
    // Entity type taken from first known preset in the list, else zombie.
    function spawnCombo(level, names, x, y, z, target) {
        var EAI = getEAI();
        if (!EAI || !names || names.length === 0) return null;

        var entityType = "minecraft:zombie";
        for (var i = 0; i < names.length; i++) {
            if (TEST_PLAN[names[i]]) { entityType = TEST_PLAN[names[i]].entity; break; }
        }
        var hasMiner = false;
        for (var m = 0; m < names.length; m++) { if (names[m] === "superMiner") hasMiner = true; }

        var entity = EAI.fromPresets(level, entityType, names);
        if (!entity) { console.error("[EAI-test] combo fromPresets returned null"); return null; }

        var label = names.join("+");
        try { entity.setPos(x, y, z); } catch (eP) {}
        try { entity.addTag("eai_test"); } catch (eT1) {}
        try { entity.addTag("eai_test_combo"); } catch (eT2) {}
        try { entity.setCustomName(Text.of("[" + label + "]")); } catch (e1) {}
        try { entity.setCustomNameVisible(true); } catch (e2) {}
        try { entity.setPersistenceRequired(); } catch (e3) {}

        // sword only if no miner — superMiner's clearHands wipes held items.
        if (!hasMiner) giveItems(entity, { mainhand: "minecraft:iron_sword" });

        try { entity.spawn(); }
        catch (eSp) { console.error("[EAI-test] combo spawn failed: " + eSp); return null; }
        EAI.applyDeferred(level, entity, EAI.resolveArgs(names, []));

        if (target) {
            try {
                var raw = EAI.rawMob(entity);
                if (raw && typeof raw.setTarget === "function") raw.setTarget(target);
            } catch (eT) {}
        }
        console.info("[EAI-test] spawned combo " + label + " (" + entityType + ")");
        return entity;
    }

    function playerLevel(player) {
        return (typeof player.level === "function") ? player.level() : player.level;
    }

    function spawnAll(player) {
        var level = playerLevel(player);
        var look  = player.getLookAngle();
        // Normalize look to horizontal.
        var lx = look.x, lz = look.z;
        var ln = Math.sqrt(lx * lx + lz * lz) || 1;
        lx /= ln; lz /= ln;
        // Right vector (perpendicular).
        var rx = -lz, rz = lx;

        var origin = player.position();
        var startDist = 4;     // first mob 4 blocks in front
        var step      = 3;     // 3 blocks between mobs

        var names = Object.keys(TEST_PLAN);
        for (var i = 0; i < names.length; i++) {
            var name = names[i];
            var dx = lx * startDist + rx * (i * step - ((names.length - 1) * step) / 2);
            var dz = lz * startDist + rz * (i * step - ((names.length - 1) * step) / 2);
            var x = origin.x + dx;
            var z = origin.z + dz;
            var y = origin.y;
            spawnOne(level, name, x, y, z, player);
        }
        player.tell("[EAI-test] spawned " + names.length + " preset mobs. Use /eai_test_clear to remove.");
    }

    function clearAll(player) {
        var level = playerLevel(player);
        var removed = 0;
        try {
            var entities = level.getEntities();
            var iter = entities.iterator();
            while (iter.hasNext()) {
                var e = iter.next();
                try {
                    if (e.tags && e.tags.contains && e.tags.contains("eai_test")) {
                        e.kill();
                        removed++;
                    }
                } catch (eK) {}
            }
        } catch (eL) { console.warn("[EAI-test] clearAll: " + eL); }
        player.tell("[EAI-test] removed " + removed + " test mobs.");
    }

    function dumpNearest(player) {
        var EAI = getEAI();
        if (!EAI) return;
        var level = playerLevel(player);
        var pp = player.position();
        var nearest = null, bestDist = 1e9;
        try {
            var entities = level.getEntities();
            var iter = entities.iterator();
            while (iter.hasNext()) {
                var e = iter.next();
                try {
                    if (!e.tags || !e.tags.contains || !e.tags.contains("eai_test")) continue;
                    var p = e.position();
                    var d = (p.x - pp.x) * (p.x - pp.x) + (p.y - pp.y) * (p.y - pp.y) + (p.z - pp.z) * (p.z - pp.z);
                    if (d < bestDist) { bestDist = d; nearest = e; }
                } catch (eN) {}
            }
        } catch (eL) {}
        if (!nearest) { player.tell("[EAI-test] no test mob nearby"); return; }
        EAI.dumpGoals(nearest);
        var name = "";
        try { name = String(nearest.customName || nearest.getType()); } catch (eC) {}
        player.tell("[EAI-test] dumped goals for nearest test mob " + name + " (see server log)");
    }

    // ---------- Commands -----------------------------------------------------

    ServerEvents.commandRegistry(event => {
        var Commands  = event.commands;
        var StringArg = Java.loadClass("com.mojang.brigadier.arguments.StringArgumentType");

        function getPlayer(src) {
            try { return src.getPlayer(); }
            catch (e) { try { return src.getPlayerOrException(); } catch (e2) { return null; } }
        }
        function safeExec(src, fn) {
            try { return fn(); }
            catch (e) {
                console.error("[EAI-test] command threw: " + e);
                try { src.sendFailure(Text.of("[EAI-test] " + e)); } catch (eS) {}
                return 0;
            }
        }

        event.register(
            Commands.literal("eai_test_presets")
                .requires(src => src.hasPermission(2))
                .executes(ctx => safeExec(ctx.source, function () {
                    var player = getPlayer(ctx.source);
                    if (!player) { ctx.source.sendFailure(Text.of("must be a player")); return 0; }
                    spawnAll(player);
                    return 1;
                }))
        );

        event.register(
            Commands.literal("eai_test_preset")
                .requires(src => src.hasPermission(2))
                .then(Commands.argument("name", StringArg.word())
                    .executes(ctx => safeExec(ctx.source, function () {
                        var player = getPlayer(ctx.source);
                        if (!player) { ctx.source.sendFailure(Text.of("must be a player")); return 0; }
                        var name = StringArg.getString(ctx, "name");
                        var pos = player.position();
                        var look = player.getLookAngle();
                        var x = pos.x + look.x * 3;
                        var y = pos.y;
                        var z = pos.z + look.z * 3;
                        var lvl = (typeof player.level === "function") ? player.level() : player.level;
                        var ent = spawnOne(lvl, name, x, y, z, player);
                        return ent ? 1 : 0;
                    })))
        );

        event.register(
            Commands.literal("eai_test_combo")
                .requires(src => src.hasPermission(2))
                .then(Commands.argument("presets", StringArg.greedyString())
                    .executes(ctx => safeExec(ctx.source, function () {
                        var player = getPlayer(ctx.source);
                        if (!player) { ctx.source.sendFailure(Text.of("must be a player")); return 0; }
                        var asStr = String(StringArg.getString(ctx, "presets") || "");
                        console.info("[EAI-test] combo raw arg: '" + asStr + "'");
                        // Manual tokenize on space/comma/tab — avoids Rhino
                        // Java-String regex-split + .filter pitfalls.
                        var names = [];
                        var tok = "";
                        for (var ci = 0; ci < asStr.length; ci++) {
                            var ch = asStr.charAt(ci);
                            if (ch === " " || ch === "," || ch === "\t") {
                                if (tok.length > 0) { names.push(tok); tok = ""; }
                            } else {
                                tok += ch;
                            }
                        }
                        if (tok.length > 0) names.push(tok);
                        if (names.length === 0) {
                            ctx.source.sendFailure(Text.of("usage: /eai_test_combo <preset> [preset...]"));
                            return 0;
                        }
                        var pos = player.position();
                        var look = player.getLookAngle();
                        var x = pos.x + look.x * 3;
                        var y = pos.y;
                        var z = pos.z + look.z * 3;
                        var lvl = (typeof player.level === "function") ? player.level() : player.level;
                        var ent = spawnCombo(lvl, names, x, y, z, player);
                        return ent ? 1 : 0;
                    })))
        );

        event.register(
            Commands.literal("eai_test_clear")
                .requires(src => src.hasPermission(2))
                .executes(ctx => safeExec(ctx.source, function () {
                    var player = getPlayer(ctx.source);
                    if (!player) { ctx.source.sendFailure(Text.of("must be a player")); return 0; }
                    clearAll(player);
                    return 1;
                }))
        );

        event.register(
            Commands.literal("eai_test_dump")
                .requires(src => src.hasPermission(2))
                .executes(ctx => safeExec(ctx.source, function () {
                    var player = getPlayer(ctx.source);
                    if (!player) { ctx.source.sendFailure(Text.of("must be a player")); return 0; }
                    dumpNearest(player);
                    return 1;
                }))
        );
    });

    console.info("[EAI-test] commands registered: /eai_test_presets /eai_test_preset <name> /eai_test_combo <names...> /eai_test_clear /eai_test_dump");
})();
