// priority: 0
// kubejs/server_scripts/raid/raid_test.js
//
// Raid factory in-game tester. Pairs with raid_factory.js + EnhancedAI factory.
//
// Right-click  -> spawn raid wave around player at configured distance.
// Sneak-click  -> double count + double distance (stress test).
//
// Bindings:
//   rotten_flesh -> zombie horde (mobile + sharpTargeting)
//   bone         -> skeleton kite squad (skirmisher)
//   spider_eye   -> spider web pack (webShooter)
//   gunpowder    -> creeper raid (tntCreeper)
//   blaze_powder -> miner zombie dig team (superMiner + mobile)
//   ender_pearl  -> mixed nightmare wave (zombies + skeletons + spiders)
//   nether_star  -> boss combo wave (all elites)

const RAID_BINDINGS = {
    "minecraft:rotten_flesh": {
        name:     "Zombie Horde",
        distance: 8,
        mobs: [
            { entity: "minecraft:zombie", count: 6, presets: ["mobile", "sharpTargeting"] }
        ]
    },
    "minecraft:bone": {
        name:     "Skeleton Kite Squad",
        distance: 12,
        mobs: [
            { entity: "minecraft:skeleton", count: 4, presets: ["skirmisher", "sharpTargeting"] }
        ]
    },
    "minecraft:spider_eye": {
        name:     "Web Pack",
        distance: 6,
        mobs: [
            { entity: "minecraft:spider", count: 4, presets: ["webShooter", "mobile"] }
        ]
    },
    "minecraft:gunpowder": {
        name:     "Creeper Raid",
        distance: 10,
        mobs: [
            { entity: "minecraft:creeper", count: 5, presets: ["tntCreeper", "mobile"] }
        ]
    },
    "minecraft:blaze_powder": {
        name:     "Miner Dig Team",
        distance: 14,
        mobs: [
            { entity: "minecraft:zombie", count: 5, presets: ["superMiner", "mobile", "sharpTargeting"] }
        ]
    },
    "minecraft:ender_pearl": {
        name:     "Nightmare Wave",
        distance: 12,
        mobs: [
            { entity: "minecraft:zombie",   count: 4, presets: ["mobile", "sharpTargeting"] },
            { entity: "minecraft:skeleton", count: 3, presets: ["skirmisher"] },
            { entity: "minecraft:spider",   count: 2, presets: ["webShooter"] }
        ]
    },
    "minecraft:nether_star": {
        name:     "Boss Combo",
        distance: 16,
        mobs: [
            { entity: "minecraft:zombie",   count: 3, presets: ["superMiner", "mobile", "sharpTargeting", "antiCheese"] },
            { entity: "minecraft:skeleton", count: 3, presets: ["skirmisher", "sharpTargeting"] },
            { entity: "minecraft:spider",   count: 2, presets: ["webShooter", "mobile"] },
            { entity: "minecraft:creeper",  count: 2, presets: ["tntCreeper"] }
        ]
    }
};

// ---------- Helpers ---------------------------------------------------------

function buildMobs(binding) {
    const out = [];
    for (const m of binding.mobs) {
        const args = (m.presets && m.presets.length > 0)
            ? EnhancedAI.resolveArgs(m.presets, m.extra || [])
            : [];
        out.push({ entity: m.entity, count: m.count, args: args });
    }
    return out;
}

function nameSpawned(entity, mobDef, label) {
    try {
        entity.setCustomName(label);
        entity.setCustomNameVisible(false);
    } catch (e) { /* ignore */ }
}

// ---------- Event hook ------------------------------------------------------

ItemEvents.rightClicked(event => {
    const player = event.player;
    if (!player || player.level.isClientSide()) return;

    const id = event.item.id;
    const binding = RAID_BINDINGS[id];
    if (!binding) return;

    const level = event.level || (typeof player.level === "function" ? player.level() : player.level);

    const sneak    = player.isShiftKeyDown();
    const distance = binding.distance * (sneak ? 2 : 1);
    const mult     = sneak ? 2 : 1;

    const pos = player.blockPosition();
    const center = [pos.x + 0.5, pos.y + 1, pos.z + 0.5];

    // Apply count multiplier on sneak.
    const mobs = buildMobs(binding).map(m => ({
        entity: m.entity,
        count:  m.count * mult,
        args:   m.args
    }));

    let spawned = [];
    try {
        spawned = Raid.spawn(level, {
            pos:      center,
            distance: distance,
            mobs:     mobs,
            onSpawn:  (e, mobDef) => nameSpawned(e, mobDef, binding.name)
        });
    } catch (err) {
        player.tell(`§c[Raid] spawn err: ${err}`);
        console.error(err);
        return;
    }

    const presetSummary = binding.mobs
        .map(m => `${m.entity.replace("minecraft:", "")}×${m.count * mult}[${(m.presets || []).join("+")}]`)
        .join(", ");

    player.tell(
        `§a[Raid] §rspawned §e${spawned.length}§r mobs §7(${binding.name})§r ` +
        `r=§b${distance}§r ${sneak ? "§c[STRESS]§r " : ""}`
    );
    player.tell(`§7${presetSummary}`);
    console.info(`[Raid test] ${binding.name}: ${spawned.length} mobs, r=${distance}, sneak=${sneak}`);
});

ServerEvents.loaded(event => {
    const ids = Object.keys(RAID_BINDINGS);
    console.info(`[Raid test] bindings: ${ids.join(", ")}`);
    console.info(`[Raid test] sneak-click = 2× count + 2× distance`);
});
