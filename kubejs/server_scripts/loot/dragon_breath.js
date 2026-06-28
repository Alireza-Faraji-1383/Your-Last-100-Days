LootJS.modifiers((event) => {
  // Dragon's Breath: 100% void from Overworld and Nether loot tables
  // It's an End-only item — should only come from the Ender Dragon fight.
  event.addTableModifier(/^(?!.*(end_city|end_ship|end)).*:(chests|barrels)\/.*$/)
    .modifyLoot('minecraft:dragon_breath', (item) => {
      return Item.empty
    })
})
