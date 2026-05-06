LootJS.modifiers((event) => {
  
    // All enchanted items: 40% chance to remove enchantments from chest loot tables
   event.addTableModifier(/^(?!.*(bastion|fortress|end_city|end_ship|nether|end)).*:(chests|barrels)\/.*$/)
        .modifyLoot(/.*/, (item) => {
          if (!item.enchantments.isEmpty()) {
            if (Math.random() > 0.6){            
            // item.remove("minecraft:stored_enchantments");
            item.remove("minecraft:enchantments");
          }}
          return item;
        });

    // Enchanted books: 20% chance to void from chest loot tables
    event.addTableModifier(/^(?!.*(bastion|fortress|end_city|end_ship|nether|end)).*:(chests|barrels)\/.*$/)
      .modifyLoot('minecraft:enchanted_book', (item) => {
        if (Math.random() > 0.8){
          return Item.empty;
        }
        return item;
      });
})