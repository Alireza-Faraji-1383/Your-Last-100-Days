LootJS.modifiers((event) => {

  // Netherite Upgrade Smithing Template: 0% chance in overworld
  event.addTableModifier(/^(?!.*(bastion|fortress|end_city|end_ship|nether|end)).*:(chests|barrels)\/.*$/)
    .modifyLoot('minecraft:netherite_upgrade_smithing_template', (item) => {
      return Item.empty
    })

  // Other netherite items: 80% void in overworld (keep 20%)
  const netheriteItems = [
    'minecraft:netherite_ingot',
    'minecraft:netherite_scrap',
    'minecraft:netherite_sword',
    'minecraft:netherite_pickaxe',
    'minecraft:netherite_axe',
    'minecraft:netherite_shovel',
    'minecraft:netherite_hoe',
    'minecraft:netherite_helmet',
    'minecraft:netherite_chestplate',
    'minecraft:netherite_leggings',
    'minecraft:netherite_boots',
  ]

  netheriteItems.forEach((id) => {
    event.addTableModifier(/^(?!.*(bastion|fortress|end_city|end_ship|nether|end)).*:(chests|barrels)\/.*$/)
      .modifyLoot(id, (item) => {
        if (Math.random() > 0.2) return Item.empty
        return item
      })
  })
})
