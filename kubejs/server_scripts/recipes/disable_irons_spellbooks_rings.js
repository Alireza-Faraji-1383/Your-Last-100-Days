const DISABLED_IRONS_SPELLBOOKS_RINGS = [
  'irons_spellbooks:poisonward_ring',
  'irons_spellbooks:fireward_ring',
  'irons_spellbooks:emerald_stoneplate_ring'
]

// Remove every data-driven recipe whose result is one of these rings.
ServerEvents.recipes(event => {
  for (const itemId of DISABLED_IRONS_SPELLBOOKS_RINGS) {
    event.remove({ output: itemId })
  }
})

// Prevent these rings from appearing in any generated loot, including all chests.
LootJS.modifiers(event => {
  event.addTableModifier(/.*/)
    .modifyLoot(DISABLED_IRONS_SPELLBOOKS_RINGS, () => Item.empty)
})
