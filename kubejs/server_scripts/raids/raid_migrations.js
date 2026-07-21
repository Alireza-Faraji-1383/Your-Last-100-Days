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
//   - server loaded — covers entities already loaded after a /reload
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

    // Post-/reload safety net: entities already loaded never re-fire spawned.
    ServerEvents.loaded(function (event) {
        var fixed = 0;
        try {
            var server = event.server;
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
        } catch (e) { warn("load sweep: " + e); }
        if (fixed) console.info("[RaidMigrate] load sweep repaired " + fixed + " mob(s)");
    });
})();
