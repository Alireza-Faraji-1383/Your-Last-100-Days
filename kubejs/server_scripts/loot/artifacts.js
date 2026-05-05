LootJS.modifiers((event) => {
  // Artifacts: 60% chance to void from any loot table
  event.addTableModifier(/.*/)
    .modifyLoot('#artifacts:artifacts', (item) => {
      if (Math.random() > 0.4) return Item.empty
      return item
    })

  // Relics: 90% chance to void from any loot table
  event.addTableModifier(/.*/)
    .modifyLoot('@relics', (item) => {
      if (Math.random() > 0.1) return Item.empty
      return item
    })
})
