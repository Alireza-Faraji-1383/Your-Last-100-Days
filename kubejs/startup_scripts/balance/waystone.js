BlockEvents.modification(event => {
    event.modify(/^waystones:.*$/, block => {
        block.destroySpeed = -1.0;
        block.explosionResistance = 1200.0;
    });
});