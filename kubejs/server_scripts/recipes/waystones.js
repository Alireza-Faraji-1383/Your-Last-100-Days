ServerEvents.recipes(event => {
    event.remove({ output: 'waystones:warp_stone' });

    event.shaped('waystones:warp_stone', [
        ' N ',
        'EDE',
        ' N '
    ], {
        E: 'minecraft:ender_eye',
        D: 'minecraft:diamond_block',
        N: 'minecraft:nether_star'
    });
});