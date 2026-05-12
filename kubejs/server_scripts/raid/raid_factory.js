// priority: 100
// kubejs/server_scripts/raid/raid_factory.js
//
// Small raid spawner factory for KubeJS 1.21.1 NeoForge.
//
// Input shape:
//   Raid.spawn(level, {
//       pos:      [x, y, z] | {x,y,z} | BlockPos,
//       distance: number,                   // spawn radius (blocks)
//       mobs:    [ { entity:"mod:id", count:N, args?:[...] }, ... ],
//       onSpawn?: (entity, mobDef) => void  // optional post-spawn hook
//   })
//
// Returns: Array of spawned entities (empty on failure).
//
// Pairs with EnhancedAI factory: pass `args` per-mob to apply AI keys,
// or use `onSpawn` for custom logic (potions, equipment, etc.).

(function (global) {
    "use strict";

    const DEBUG = false;

    function dbg(m) { if (DEBUG) console.info(`[Raid] ${m}`); }
    function warn(m) { console.warn(`[Raid] ${m}`); }
    function err(m)  { console.error(`[Raid] ${m}`); }

    // ---------- Validation ---------------------------------------------------

    function isLevel(o) {
        return o !== null && typeof o === "object" &&
               typeof o.createEntity === "function";
    }

    function isEntityTypeId(s) {
        return typeof s === "string" && s.indexOf(":") !== -1;
    }

    function toPos(p) {
        if (!p) return null;
        if (Array.isArray(p) && p.length >= 3) {
            return { x: +p[0], y: +p[1], z: +p[2] };
        }
        if (typeof p === "object") {
            const x = (typeof p.getX === "function") ? p.getX() : p.x;
            const y = (typeof p.getY === "function") ? p.getY() : p.y;
            const z = (typeof p.getZ === "function") ? p.getZ() : p.z;
            if (x !== undefined && y !== undefined && z !== undefined) {
                return { x: +x, y: +y, z: +z };
            }
        }
        return null;
    }

    // ---------- Spawn point picker ------------------------------------------

    function randomOffsetPos(center, distance) {
        const r     = Math.random() * distance;
        const theta = Math.random() * Math.PI * 2;
        return {
            x: center.x + Math.cos(theta) * r,
            y: center.y,
            z: center.z + Math.sin(theta) * r
        };
    }

    // ---------- Per-mob spawn ------------------------------------------------

    function spawnOne(level, entityType, pos, args, onSpawn, mobDef) {
        let entity;
        try {
            entity = level.createEntity(entityType);
        } catch (e) {
            err(`createEntity threw for ${entityType}: ${e}`);
            return null;
        }
        if (!entity) {
            err(`createEntity null for ${entityType}`);
            return null;
        }

        // Apply EnhancedAI pre-spawn if args provided + factory loaded.
        if (Array.isArray(args) && args.length > 0 &&
            global.EnhancedAI && typeof global.EnhancedAI.apply === "function") {
            try { global.EnhancedAI.apply(entity, args); }
            catch (e) { warn(`EnhancedAI.apply failed: ${e}`); }
        }

        try { entity.setPos(pos.x, pos.y, pos.z); }
        catch (e) { warn(`setPos failed: ${e}`); }

        try { entity.spawn(); }
        catch (e) {
            err(`spawn failed for ${entityType}: ${e}`);
            return null;
        }

        // Re-apply after spawn (mod may overwrite NBT on join).
        if (Array.isArray(args) && args.length > 0 &&
            global.EnhancedAI && typeof global.EnhancedAI.applyDeferred === "function") {
            try { global.EnhancedAI.applyDeferred(level, entity, args); }
            catch (e) { warn(`applyDeferred failed: ${e}`); }
        }

        // Fire mod's onChange listeners so AI goals (miner, etc.) actually attach.
        // Mod's join handler uses applyIfAbsent which skips listeners when our
        // pre-spawn NBT already set the value.
        if (Array.isArray(args) && args.length > 0 &&
            global.EnhancedAI && typeof global.EnhancedAI.fireListeners === "function") {
            try { global.EnhancedAI.fireListeners(entity, args); }
            catch (e) { warn(`fireListeners failed: ${e}`); }
        }

        if (typeof onSpawn === "function") {
            try { onSpawn(entity, mobDef); }
            catch (e) { warn(`onSpawn threw: ${e}`); }
        }

        return entity;
    }

    // ---------- Public API ---------------------------------------------------

    /**
     * Spawn a raid wave.
     * @param {Internal.Level} level
     * @param {{pos:any, distance:number, mobs:Array, onSpawn?:Function}} cfg
     * @returns {Array} spawned entities
     */
    function spawn(level, cfg) {
        if (!isLevel(level)) { err("spawn: invalid level"); return []; }
        if (!cfg || typeof cfg !== "object") { err("spawn: missing cfg"); return []; }

        const center = toPos(cfg.pos);
        if (!center) { err("spawn: invalid pos"); return []; }

        const distance = (typeof cfg.distance === "number" && cfg.distance >= 0)
            ? cfg.distance : 8;

        if (!Array.isArray(cfg.mobs) || cfg.mobs.length === 0) {
            err("spawn: mobs[] empty"); return [];
        }

        const out = [];
        for (let i = 0; i < cfg.mobs.length; i++) {
            const m = cfg.mobs[i];
            if (!m || !isEntityTypeId(m.entity)) {
                warn(`mob @${i}: invalid entity id`); continue;
            }
            const count = (typeof m.count === "number" && m.count > 0) ? (m.count | 0) : 1;
            for (let k = 0; k < count; k++) {
                const p = randomOffsetPos(center, distance);
                const e = spawnOne(level, m.entity, p, m.args, cfg.onSpawn, m);
                if (e) out.push(e);
            }
        }
        dbg(`spawned ${out.length} entities at ${center.x},${center.y},${center.z} r=${distance}`);
        return out;
    }

    // ---------- Export -------------------------------------------------------

    global.Raid = { spawn: spawn };
})(this);
