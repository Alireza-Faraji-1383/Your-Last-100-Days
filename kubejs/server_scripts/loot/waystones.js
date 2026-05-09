LootJS.modifiers((event) => {
  // WarpStone Smithing Template: 0% chance
  event.addTableModifier(/.*/)
    .modifyLoot('waystones:warp_stone', (item) => {
      return Item.empty
    })

})