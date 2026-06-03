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

  // Enigmatic Legacy Plus spellstones: 75% chance to void from any loot table
  const elSpellstones = [
    'enigmaticlegacyplus:angel_blessing',
    'enigmaticlegacyplus:blazing_core',
    'enigmaticlegacyplus:eye_of_nebula',
    'enigmaticlegacyplus:forgotten_ice',
    'enigmaticlegacyplus:golem_heart',
    'enigmaticlegacyplus:lost_engine',
    'enigmaticlegacyplus:ocean_stone',
    'enigmaticlegacyplus:revival_leaf',
    'enigmaticlegacyplus:void_pearl',
  ]
  event.addTableModifier(/.*/)
    .modifyLoot(elSpellstones, (item) => {
      if (Math.random() > 0.25) return Item.empty
      return item
    })
})
