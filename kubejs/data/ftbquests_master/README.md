# Quest Master (expandable)

Source of truth for the pack's FTB Quests. The KubeJS seed script
(`kubejs/server_scripts/quests/ftbquests_seed.js`) copies `quests/` into any world
that has none, so changes here reach every world.

## Add a chapter
1. Copy `TEMPLATE.snbt` to `quests/chapters/NN_name.snbt` with a free 2-hex `NN`
   (10, 11, …). Replace every `NN` in the ids with that prefix.
2. Fill in quests: each quest/task/reward needs a unique id `NN` + 14 running hex
   digits. Task types: item, kill, advancement, structure, dimension, biome,
   checkmark, gamestage, observation, stat.
3. (Optional) gate it: make the first quest a `{ type:"gamestage", stage:"day_25" }`
   task and `dependencies` the rest on it.
4. (Optional) put it in a group: set `group` to a `chapter_groups.snbt` id.
5. Run `python ../../../tools/validate_quests.py` from the instance root.
6. Commit. New worlds get it automatically; an existing world picks it up after you
   delete its `<world>/ftbquests/quests/chapters/` and rejoin (or merge by hand).

## Sync edits made in-game
The in-game FTB Quests editor writes to `<world>/ftbquests/quests/`. To keep them,
copy that folder back over `kubejs/data/ftbquests_master/quests/` and commit.

## Swap checkmark tasks for item detection
The MineColonies chapter uses `checkmark` tasks. To auto-detect instead, replace a
checkmark task with `{ id:"...", type:"item", item:"minecolonies:<id>" }` once you
confirm the id in JEI.

## Add reward tables
Drop a file in `quests/reward_tables/` with a `FA…` id and reference it from a
reward: `{ id:"...", type:"random", table_id:"FA00000000000002" }`.
