// priority: 50
// Manual raid summoning via the ten placeable raid standards.
(function () {
    "use strict";

    var STANDARDS = [
        [10,  "day10_rotting_dawn"],
        [20,  "day20_night_of_bones"],
        [30,  "day30_warband"],
        [40,  "day40_night_of_spirits"],
        [50,  "day50_arcane_covenant"],
        [60,  "day60_rise_of_the_deep"],
        [70,  "day70_rotten_legion"],
        [80,  "day80_burning_siege"],
        [90,  "day90_dark_concord"],
        [100, "day100_last_dawn"]
    ];
    var PENDING = {};

    function heldId(stack) {
        try {
            var direct = String(stack.id);
            if (direct && direct !== "undefined" && direct !== "null") return direct;
        } catch (e) {}
        try {
            var fallback = String(stack.getItem());
            if (fallback && fallback !== "undefined" && fallback !== "null") return fallback;
        } catch (e2) {}
        return "";
    }

    function creative(player) {
        try { return !!player.getAbilities().instabuild; } catch (e) {}
        return false;
    }

    function consumeIgniter(player, stack, id) {
        if (creative(player)) return;
        try {
            if (id === "minecraft:fire_charge") {
                stack.shrink(1);
                return;
            }
            var next = stack.getDamageValue() + 1;
            if (next >= stack.getMaxDamage()) stack.shrink(1);
            else stack.setDamageValue(next);
        } catch (e) {
            console.warn("[RaidStandards] could not damage ignition item: " + e);
        }
    }

    function blockId(block) {
        try {
            var direct = String(block.id);
            if (direct && direct !== "undefined" && direct !== "null") return direct;
        } catch (e) {}
        try {
            var fallback = String(block.kjs$getId());
            if (fallback && fallback !== "undefined" && fallback !== "null") return fallback;
        } catch (e2) {}
        return "";
    }

    function pendingKey(block) {
        var dim = "";
        try { dim = String(block.dimension); } catch (e) {}
        return dim + ":" + block.x + "," + block.y + "," + block.z;
    }

    function clearVisualFire(fireBlock) {
        try {
            if (blockId(fireBlock) === "minecraft:fire") fireBlock.set("minecraft:air");
        } catch (e) {}
    }

    function flamePulse(server, block) {
        try {
            if (!server || typeof server.runCommandSilent !== "function") return;
            var dim = String(block.dimension);
            var x = Number(block.x) + 0.5;
            var y = Number(block.y) + 0.8;
            var z = Number(block.z) + 0.5;
            server.runCommandSilent(
                "execute in " + dim + " run particle minecraft:flame " +
                x.toFixed(1) + " " + y.toFixed(1) + " " + z.toFixed(1) +
                " 0.45 0.65 0.20 0.015 18 force"
            );
        } catch (e) {}
    }

    function registerStandard(day, raidId) {
        var standardId = "kubejs:raid_standard_day" + day;
        BlockEvents.rightClicked(standardId, function (event) {
            var itemId = heldId(event.item);
            if (itemId !== "minecraft:flint_and_steel" &&
                itemId !== "minecraft:fire_charge") return;

            var player = event.player;
            var manager = (typeof RaidManager !== "undefined") ? RaidManager : null;
            if (!manager || !player) {
                if (player) player.tell(Text.of("§cThe raid system is not ready."));
                event.cancel();
                return;
            }

            if ((manager.isOwnerInRaid && manager.isOwnerInRaid(player)) ||
                (!manager.isOwnerInRaid && manager.isInRaid(player))) {
                player.tell(Text.of("§eThis standard cannot be ignited while you are already in a raid."));
                event.cancel();
                return;
            }

            var standardBlock = event.block;
            var key = pendingKey(standardBlock);
            if (PENDING[key]) {
                player.tell(Text.of("§6The standard is already burning..."));
                event.cancel();
                return;
            }

            var server = player.server;
            if (!server || typeof server.scheduleInTicks !== "function") {
                player.tell(Text.of("§cThe ignition timer is unavailable."));
                event.cancel();
                return;
            }

            var fireBlock = null;
            try {
                fireBlock = standardBlock.getUp();
                if (fireBlock.getBlockState().isAir()) fireBlock.set("minecraft:fire");
            } catch (eFire) {
                console.warn("[RaidStandards] visual fire " + standardId + ": " + eFire);
            }

            var playerUuid = String(player.uuid);
            PENDING[key] = true;
            consumeIgniter(player, event.item, itemId);
            player.tell(Text.of("§6The standard burns... §cThe raid answers in 1 second."));
            flamePulse(server, standardBlock);
            try {
                server.runCommandSilent(
                    "playsound minecraft:item.firecharge.use block " + player.username +
                    " " + standardBlock.x + " " + standardBlock.y + " " + standardBlock.z +
                    " 1 0.85"
                );
            } catch (eSound) {}

            // Four short visual pulses make the cloth itself appear alight.
            for (var pulse = 5; pulse < 20; pulse += 5) {
                server.scheduleInTicks(pulse, (function () {
                    return function () {
                        if (PENDING[key]) flamePulse(server, standardBlock);
                    };
                })());
            }

            server.scheduleInTicks(20, function () {
                delete PENDING[key];
                clearVisualFire(fireBlock);

                try {
                    // Breaking or replacing the standard during the one-second
                    // ignition safely cancels the summon.
                    if (blockId(standardBlock) !== standardId) return;

                    var target = manager.findOnlinePlayer(server, function (candidate) {
                        return String(candidate.uuid) === playerUuid;
                    });
                    if (!target) return;

                    var instanceId = manager.start(manager.playerLevel(target), target, raidId);
                    if (!instanceId) {
                        target.tell(Text.of("§eThe standard stopped burning because another raid is active."));
                        return;
                    }

                    // Only a confirmed start consumes the standard. Scheduled
                    // raid-day transaction flags remain deliberately untouched.
                    standardBlock.set("minecraft:air");
                    target.tell(Text.of("§cThe standard is consumed. The raid has answered."));
                } catch (eStart) {
                    console.error("[RaidStandards] delayed start " + raidId + ": " + eStart);
                }
            });

            event.cancel();
        });
    }

    for (var i = 0; i < STANDARDS.length; i++) {
        registerStandard(STANDARDS[i][0], STANDARDS[i][1]);
    }

    console.info("[RaidStandards] registered 10 manual raid standards");
})();
