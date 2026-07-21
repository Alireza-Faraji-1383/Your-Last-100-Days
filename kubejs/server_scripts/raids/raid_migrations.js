// priority: 65
// kubejs/server_scripts/raids/raid_migrations.js
//
// One-way NBT repairs for mobs saved by older script versions.
//
// Migration #1 — pick_up_and_throw/can_pick_up:
//   The thrower preset used to write "#minecraft:players". EnhancedAI stores
//   the value as a String and PickUpAndThrowGoal.canUse runs
//   ResourceLocation.parse(value) on it every tick — the "#" throws
//   ResourceLocationException and crashes the server as soon as a saved mob
//   with that NBT ticks its goal. The field must hold a plain entity-type TAG
//   id (no "#"); mobs matching the tag get picked up and thrown at the target.
//   Repair: strip the "#"; the known-bad "minecraft:players" (players can't
//   be picked up, tag doesn't exist) becomes the mod's default tag instead.
//
// Runs at two points so no stale mob can tick with the bad value:
//   - entity join (chunk load / spawn) — covers mobs streaming in later
//   - server tick sweep — first tick after script load (ServerEvents.loaded
//     does NOT re-fire on /reload, so a load-time sweep misses entities that
//     are already loaded when the script arrives mid-session — that exact gap
//     crashed a server on 2026-07-21), then repeated every 600 ticks as a
//     safety net in case a join event is ever missed.
//
// Rhino quirk (same as raid_core.js): function-internal declarations use var.

(function () {
    "use strict";

    var EAI_NS   = "enhancedai";
    var FEATURE  = "pick_up_and_throw";
    var KEY      = "can_pick_up";
    var BAD      = "minecraft:players";
    var GOOD_TAG = "enhancedai:mobs/pick_up_and_throw/can_be_picked_up";

    function warn(m) { console.warn("[RaidMigrate] " + m); }

    // Returns true when the entity's NBT was repaired.
    // persistentData IS the NeoForgeData compound (see enhancedai_factory.js).
    function fixCanPickUp(entity) {
        try {
            var pd = entity.persistentData;
            if (!pd || !pd.contains(EAI_NS)) return false;
            var eai = pd.getCompound(EAI_NS);
            if (!eai.contains(FEATURE)) return false;
            var feat = eai.getCompound(FEATURE);
            if (!feat.contains(KEY)) return false;
            var v = String(feat.getString(KEY));
            if (v.charAt(0) !== "#") return false;
            var stripped = v.substring(1);
            var fixed = (stripped === BAD) ? GOOD_TAG : stripped;
            feat.putString(KEY, fixed);
            warn("repaired " + KEY + ' "' + v + '" -> "' + fixed + '" on ' + entity.type);
            return true;
        } catch (e) { return false; }
    }

    // Chunk load / fresh spawn: repair before the goal can tick the bad value.
    EntityEvents.spawned(function (event) {
        fixCanPickUp(event.entity);
    });

    function sweepLoaded(server) {
        var fixed = 0;
        try {
            if (!server || typeof server.getAllLevels !== "function") return;
            var lit = server.getAllLevels().iterator();
            while (lit.hasNext()) {
                var lvl = lit.next();
                var getter = null;
                try { getter = lvl.getEntities(); } catch (eg) { continue; }
                if (!getter || typeof getter.getAll !== "function") continue;
                var eit = getter.getAll().iterator();
                while (eit.hasNext()) {
                    if (fixCanPickUp(eit.next())) fixed++;
                }
            }
        } catch (e) { warn("sweep: " + e); }
        if (fixed) console.info("[RaidMigrate] sweep repaired " + fixed + " mob(s)");
    }

    // First tick after script load (covers server start AND mid-session
    // /reload — a stale mob crashes on its very first goal tick, so this must
    // run before any grace period), then every 600 ticks (~30s) as a safety
    // net. NBT contains-check per entity is cheap.
    var SWEEP_EVERY = 600;
    var _sweepIn = 0;
    ServerEvents.tick(function (event) {
        if (_sweepIn-- > 0) return;
        _sweepIn = SWEEP_EVERY;
        sweepLoaded(event.server);
    });
})();
