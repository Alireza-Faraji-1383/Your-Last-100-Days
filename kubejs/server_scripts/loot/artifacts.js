LootJS.modifiers((event) => {
  // Artifacts: 98% chance to void from any loot table
  event.addTableModifier(/.*/)
    .modifyLoot('#artifacts:artifacts', (item) => {
      if (Math.random() > 0.02) return Item.empty
      return item
    })

  // Relics: 99.5% chance to void from any loot table
  event.addTableModifier(/.*/)
    .modifyLoot('@relics', (item) => {
      if (Math.random() > 0.005) return Item.empty
      return item
    })

  // Enigmatic Legacy Plus spellstones: 99% chance to void from any loot table
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
      if (Math.random() > 0.01) return Item.empty
      return item
    })

  // Enigmatic Legacy Plus earth_heart_fragment: 50% chance to void from any loot table
  const elHeartFragment = [
    'enigmaticlegacyplus:earth_heart_fragment'
  ]
  event.addTableModifier(/.*/)
    .modifyLoot(elHeartFragment, (item) => {
      if (Math.random() > 0.5) return Item.empty
      return item
    })

     // Enigmatic Legacy Plus earth_heart: 100% chance to void from any loot table
  const elHeart = [
    'enigmaticlegacyplus:earth_heart'
  ]
  event.addTableModifier(/.*/)
    .modifyLoot(elHeart, (item) => {
      return Item.empty
    })

})

