const DISABLED_ALEXSCAVES_CREATIVE_ITEMS = {
  'alexscaves:abyssal_chasm': ['alexscaves:submarine'],
  'alexscaves:toxic_caves': ['alexscaves:raygun']
}

// Remove disabled items from their Alex's Caves tabs and the global search tab.
for (const tabId in DISABLED_ALEXSCAVES_CREATIVE_ITEMS) {
  StartupEvents.modifyCreativeTab(tabId, event => {
    for (const itemId of DISABLED_ALEXSCAVES_CREATIVE_ITEMS[tabId]) {
      event.remove(itemId)
      event.removeFromSearch(itemId)
    }
  })
}

StartupEvents.modifyCreativeTab('minecraft:search', event => {
  for (const tabId in DISABLED_ALEXSCAVES_CREATIVE_ITEMS) {
    for (const itemId of DISABLED_ALEXSCAVES_CREATIVE_ITEMS[tabId]) {
      event.remove(itemId)
    }
  }
})
