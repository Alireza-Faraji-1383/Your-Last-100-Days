// Remove the guaranteed signature drops from these two Cataclysm minibosses.
// Exact loot-table targeting leaves recipes, chests, commands and every other
// source of the items untouched.
LootJS.modifiers(event => {
  event.addTableModifier('cataclysm:entities/ender_golem')
    .modifyLoot('cataclysm:void_core', () => Item.empty)

  event.addTableModifier('cataclysm:entities/ignited_revenant')
    .modifyLoot('cataclysm:burning_ashes', () => Item.empty)
})
