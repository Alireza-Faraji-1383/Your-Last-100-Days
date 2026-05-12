// priority: 0
// kubejs/server_scripts/factories.js
//
// EnhancedAI factory tester v2. Each item targets ONE preset/feature so we
// can verify whether NBT values actually stick post-spawn.
//
// Right-click  -> spawn 1 mob, log expected vs actual NBT to chat + console.
// Sneak-click  -> spawn 5 mobs in a ring (no NBT log spam).
//
// Bindings:
//   diamond         -> Zombie  : superMiner            (mining test)
//   gold_ingot      -> Zombie  : pearlThrower          (pearler tuning test)
//   iron_ingot      -> Zombie  : sharpTargeting        (targeting tuning test)
//   emerald         -> Zombie  : mobile                (mobility test)
//   ender_pearl     -> Zombie  : antiCheese            (anti-cheese test)
//   redstone        -> Creeper : tntCreeper            (creeper test)
//   bone            -> Skeleton: skirmisher            (skeleton tuning test)
//   string          -> Spider  : webShooter            (web test)
//   blaze_rod       -> Zombie  : superMiner + mobile + sharpTargeting (combo)
//   compass         -> NO SPAWN: dump enhancedai NBT of nearest mob within 16 blocks.



const TEST_BINDINGS = {
    "minecraft:diamond":     { type: "minecraft:zombie",          presets: ["superMiner"],     name: "Miner Test" },
    "minecraft:gold_ingot":  { type: "minecraft:zombie",          presets: ["pearlThrower"],   name: "Pearler Test" },
    "minecraft:iron_ingot":  { type: "minecraft:zombie",          presets: ["sharpTargeting"], name: "Targeting Test" },
    "minecraft:emerald":     { type: "minecraft:zombie",          presets: ["mobile"],         name: "Mobility Test" },
    "minecraft:ender_pearl": { type: "minecraft:zombie",          presets: ["antiCheese"],     name: "Anti-Cheese Test" },
    "minecraft:redstone":    { type: "minecraft:creeper",         presets: ["tntCreeper"],     name: "TNT Creeper Test" },
    "minecraft:bone":        { type: "minecraft:skeleton",        presets: ["skirmisher"],     name: "Skirmisher Test" },
    "minecraft:string":      { type: "minecraft:spider",          presets: ["webShooter"],     name: "Web Test" },
    "minecraft:blaze_rod":   { type: "minecraft:zombie",          presets: ["superMiner", "mobile", "sharpTargeting"], name: "Combo Nightmare" }
};

// ---------- Helpers ---------------------------------------------------------

function getServer(level) {
    if (!level) return null;
    if (typeof level.getServer === "function") return level.getServer();
    if (level.server) return level.server;
    return null;
}

function parseExpected(args) {
    // Map: "feature/subkey" -> expected coerced value (last write wins).
    const out = {};
    for (const a of args) {
        if (typeof a !== "string") continue;
        let body = a.indexOf(":") !== -1 ? a.substring(a.indexOf(":") + 1) : a;
        const eq = body.indexOf("=");
        if (eq === -1) continue;
        const path = body.substring(0, eq).trim();
        const raw  = body.substring(eq + 1).trim();
        out[path] = raw;
    }
    return out;
}

function readEntityEai(entity) {
    // Mod data attachment serializes under NeoForgeData.enhancedai.
    // entity.fullNBT() returns full save tag in KubeJS 1.21.1.
    try {
        var fnTag = (typeof entity.fullNBT === "function") ? entity.fullNBT()
                  : (typeof entity.getFullNBT === "function") ? entity.getFullNBT()
                  : entity.nbt;
        if (!fnTag) return null;
        var nfdTag = fnTag.getCompound ? fnTag.getCompound("NeoForgeData") : null;
        if (!nfdTag || (nfdTag.size && nfdTag.size() === 0)) return null;
        var eaiTag = nfdTag.getCompound("enhancedai");
        if (!eaiTag || (eaiTag.size && eaiTag.size() === 0)) return null;
        return eaiTag;
    } catch (e) {
        return null;
    }
}

function readNbtPath(entity, feature, subkey) {
    try {
        var eaiR = readEntityEai(entity);
        if (!eaiR) return undefined;
        var featR = eaiR.getCompound(feature);
        if (!featR || !featR.contains(subkey)) return undefined;
        return featR.get(subkey).toString();
    } catch (e) {
        return `<err:${e}>`;
    }
}

// Normalize either expected (script literal) or got (NBT toString) to a
// canonical comparable string.
//   true/false       -> "1" / "0"        (matches NBT byte form)
//   1b, 1.5d, 3L     -> "1", "1.5", "3"  (strip trailing type tag)
//   "foo" / 'foo'    -> foo              (strip quotes)
//   list/compound    -> trimmed, lowercased for loose match
function normCmp(s) {
    if (s === undefined || s === null) return "<undef>";
    var v = String(s).trim();
    if (v === "true")  return "1";
    if (v === "false") return "0";
    // Strip surrounding quotes.
    if ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') ||
        (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")) {
        v = v.substring(1, v.length - 1);
    }
    // Strip single trailing NBT type tag: b/s/l/f/d (case-insensitive).
    var last = v.charAt(v.length - 1);
    if (/[bslfdBSLFD]/.test(last) && /[0-9.]/.test(v.charAt(v.length - 2))) {
        v = v.substring(0, v.length - 1);
    }
    return v;
}

function diffNbt(player, entity, args, label) {
    var expected = parseExpected(args);
    var lines = [];
    var okCount = 0, badCount = 0;
    for (var path in expected) {
        var slash = path.indexOf("/");
        var feature = path.substring(0, slash);
        var subkey  = path.substring(slash + 1);
        var exp = expected[path];
        var got = readNbtPath(entity, feature, subkey);
        var ok = (got !== undefined) && (normCmp(got) === normCmp(exp));
        if (ok) okCount++; else badCount++;
        lines.push(`${ok ? "§a✓" : "§c✗"} §7${path}§r exp=§e${exp}§r got=§b${got}§r`);
    }
    var head = `§6[${label}] §a${okCount} ok §c${badCount} mismatch`;
    player.tell(head);
    console.info(`[EnhancedAI diff:${label}] ${okCount} ok / ${badCount} mismatch`);
    for (var li = 0; li < lines.length; li++) {
        var ln = lines[li];
        player.tell(ln);
        console.info(`[EnhancedAI diff:${label}] ${ln.replace(/§[a-z0-9]/g, "")}`);
    }
}

function dumpNearestMob(player, level) {
    const px = player.x, py = player.y, pz = player.z;
    let best = null, bestEai = null, bestDist = 16 * 16;
    var mobs = level.getEntitiesWithin
        ? level.getEntitiesWithin(player.boundingBox.inflate(16))
        : [];
    for (var mi = 0; mi < mobs.length; mi++) {
        var ent = mobs[mi];
        if (ent === player) continue;
        var eaiD = readEntityEai(ent);
        if (!eaiD) continue;
        var dx = ent.x - px, dy = ent.y - py, dz = ent.z - pz;
        var d = dx*dx + dy*dy + dz*dz;
        if (d < bestDist) { bestDist = d; best = ent; bestEai = eaiD; }
    }
    if (!best) {
        player.tell("§c[dump] no enhancedai mob within 16 blocks");
        return;
    }
    player.tell(`§6[dump] §b${best.type} §7${best.uuid}`);
    console.info(`[EnhancedAI dump] ${best.type} ${best.uuid}`);
    console.info(`[EnhancedAI dump] ${bestEai.toString()}`);
    player.tell(`§7see console for full NBT`);
}

// ---------- Spawning --------------------------------------------------------

function spawnTestMob(player, level, binding, offsetX, offsetZ, withDiff) {
    const pos = player.blockPosition();
    const x = pos.x + offsetX + 0.5;
    const y = pos.y + 1;
    const z = pos.z + offsetZ + 0.5;

    const args = EnhancedAI.resolveArgs(binding.presets, binding.extra || []);
    const entity = EnhancedAI.create(level, binding.type, args);
    if (!entity) {
        player.tell(`§c[EnhancedAI] failed to create ${binding.type}`);
        return null;
    }

    entity.setPos(x, y, z);
    if (binding.name) {
        entity.setCustomName(binding.name);
        entity.setCustomNameVisible(true);
    }
    entity.spawn();

    EnhancedAI.apply(entity, args);
    EnhancedAI.applyDeferred(level, entity, args);
    if (typeof EnhancedAI.fireListeners === "function") {
        EnhancedAI.fireListeners(entity, args);
    }
    if (typeof EnhancedAI.dumpGoals === "function") {
        EnhancedAI.dumpGoals(entity);
        // Dump again after 60 ticks in case goal added later.
        var srvDg = getServer(level);
        if (srvDg && typeof srvDg.scheduleInTicks === "function") {
            srvDg.scheduleInTicks(60, () => {
                if (entity.isAlive && entity.isAlive()) EnhancedAI.dumpGoals(entity);
            });
        }
    }

    if (withDiff) {
        let srv = getServer(level);
        if (srv && typeof srv.scheduleInTicks === "function") {
            srv.scheduleInTicks(60, () => {
                if (entity.isAlive && entity.isAlive()) {
                    diffNbt(player, entity, args, binding.name || binding.type);
                }
            });
        }
    }

    return entity;
}

// ---------- Event hook ------------------------------------------------------

ItemEvents.rightClicked(event => {
    const player = event.player;
    if (!player || player.level.isClientSide()) return;

    const id = event.item.id;
    const level = event.level || (typeof player.level === "function" ? player.level() : player.level);

    if (id === "minecraft:compass") {
        dumpNearestMob(player, level);
        return;
    }

    const binding = TEST_BINDINGS[id];
    if (!binding) return;

    const sneak = player.isShiftKeyDown();
    const count = sneak ? 5 : 1;

    let spawned = 0;
    for (let i = 0; i < count; i++) {
        let angle = (i / count) * Math.PI * 2;
        let dx = Math.round(Math.cos(angle) * 3);
        let dz = Math.round(Math.sin(angle) * 3);
        let e = null;
        try {
            e = spawnTestMob(player, level, binding, dx, dz, !sneak);
        } catch (err) {
            player.tell(`§c[EnhancedAI] spawn err: ${err}`);
            console.error(err);
        }
        if (e) spawned++;
    }

    player.tell(
        `§a[EnhancedAI] §rspawned §e${spawned}§r × §b${binding.name || binding.type}§r ` +
        `[${binding.presets.join(", ")}]`
    );
    if (!sneak) player.tell(`§7running NBT diff in 60 ticks (3s)...`);
});

ServerEvents.loaded(event => {
    const names = Object.keys(EnhancedAI.presets);
    console.info(`[EnhancedAI test] presets: ${names.join(", ")}`);
    console.info(`[EnhancedAI test] bindings: ${Object.keys(TEST_BINDINGS).join(", ")}`);
    console.info(`[EnhancedAI test] compass = dump nearest enhancedai mob NBT`);
});
