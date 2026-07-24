// Ten non-craftable, placeable raid standards. Their item/block models are
// authored under kubejs/assets; ignition behavior lives in server_scripts.
StartupEvents.registry("block", function (event) {
    var standards = [
        [10,  "The Rotting Dawn"],
        [20,  "Night of Bones"],
        [30,  "The Warband"],
        [40,  "Night of Spirits"],
        [50,  "The Arcane Covenant"],
        [60,  "Rise of the Deep"],
        [70,  "The Rotten Legion"],
        [80,  "The Burning Siege"],
        [90,  "The Dark Concord"],
        [100, "The Last Dawn"]
    ];

    for (var i = 0; i < standards.length; i++) {
        var day = standards[i][0];
        var title = standards[i][1];
        var id = "raid_standard_day" + day;
        var block = event.create(id, "cardinal");

        block.displayName("Raid Standard: " + title);
        block.hardness(0.5);
        block.resistance(1.0);
        block.woodSoundType();
        block.fullBlock(false);
        block.opaque(false);
        block.notSolid();
        block.noCollision();
        block.noValidSpawns(true);
        block.suffocating(false);
        block.viewBlocking(false);
        block.redstoneConductor(false);
        block.defaultCutout();
        // Vanilla-style standing banner: one placed block with a two-block-tall
        // visual/selection shape. It intentionally has no collision.
        block.box(0.75, 0, 6.75, 15.25, 32, 9.75);
        block.item(function (item) {
            item.maxStackSize(1);
            item.rarity("rare");
            item.tooltip("Place this standard and ignite it. The raid begins after 1 second.");
            item.parentModel("kubejs:item/" + id);
        });
        block.parentModel("kubejs:block/" + id);
    }
});
