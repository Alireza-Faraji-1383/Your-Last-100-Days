const DISABLED_ALEXSCAVES_ITEMS = [
  'alexscaves:submarine',
  'alexscaves:raygun'
]

function isDisabledAlexsCavesItem(stack) {
  return DISABLED_ALEXSCAVES_ITEMS.some(itemId => stack.is(itemId))
}

// Remove every data-driven recipe that could create or use a disabled item.
ServerEvents.recipes(event => {
  for (const itemId of DISABLED_ALEXSCAVES_ITEMS) {
    event.remove({ output: itemId })
    event.remove({ input: itemId })
  }
})

// Hide disabled items and all their recipe-viewer references (JEI/REI/EMI).
RecipeViewerEvents.removeEntriesCompletely('item', event => {
  for (const itemId of DISABLED_ALEXSCAVES_ITEMS) {
    event.remove(itemId)
  }
})

// Prevent any loot table, including tables added later, from yielding them.
LootJS.modifiers(event => {
  event.addTableModifier(/.*/)
    .modifyLoot(DISABLED_ALEXSCAVES_ITEMS, () => Item.empty)
})

// Remove newly created submarines and old submarines when their chunks load.
EntityEvents.spawned('alexscaves:submarine', event => {
  event.entity.discard()
})

// Remove dropped disabled items, including old drops when chunks load.
EntityEvents.spawned('minecraft:item', event => {
  if (isDisabledAlexsCavesItem(event.entity.item)) {
    event.entity.discard()
  }
})

// Delete disabled items immediately if any source puts one in a player inventory.
for (const itemId of DISABLED_ALEXSCAVES_ITEMS) {
  PlayerEvents.inventoryChanged(itemId, event => {
    event.item.setCount(0)
  })
}

// Purge copies that were already stored in a player inventory before these rules existed.
PlayerEvents.loggedIn(event => {
  for (const itemId of DISABLED_ALEXSCAVES_ITEMS) {
    event.player.inventory.clear(itemId)
  }
})

// Purge old copies from chests, backpacks and other containers when opened.
PlayerEvents.inventoryOpened(event => {
  const menu = event.inventoryContainer
  let changed = false

  for (const slot of menu.slots) {
    if (isDisabledAlexsCavesItem(slot.item)) {
      slot.item.setCount(0)
      slot.setChanged()
      changed = true
    }
  }

  if (changed) {
    menu.broadcastChanges()
  }
})
