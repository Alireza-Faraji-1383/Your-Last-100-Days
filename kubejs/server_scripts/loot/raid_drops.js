// Strange Keys are progression loot from naturally encountered Aptrgangr.
// Raid copies must never become a farm for them. Filtering at the living-drop
// event keeps the normal Cataclysm loot table intact outside raids.
(function () {
  "use strict";

  var ItemRegistry = Java.loadClass("net.minecraft.core.registries.BuiltInRegistries").ITEM;
  var STRANGE_KEY = "cataclysm:strange_key";

  EntityEvents.drops(function (event) {
    var entity = event.entity;
    if (!entity) return;

    try {
      var tags = entity.getTags();
      if (!tags || !tags.contains("raid_mob")) return;
    } catch (eTags) {
      return;
    }

    var drops = event.getDrops();
    var it = drops.iterator();
    while (it.hasNext()) {
      var drop = it.next();
      try {
        var stack = drop.getItem();
        var id = String(ItemRegistry.getKey(stack.getItem()));
        if (id === STRANGE_KEY) it.remove();
      } catch (eDrop) {}
    }
  });
})();
