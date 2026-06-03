# FTB Quests (expandable)

In FTB Quests `2101.x`, quest **definitions** are global and live in
`config/ftbquests/quests/` — this folder. Every world (existing and newly created)
reads from here, so there is **no per-world copying and no seed script**. Per-world
data is only player/team *progress*, stored under `<world>/ftbquests/`.

This folder is git-tracked, so the quests travel with the pack.

```
config/ftbquests/
  TEMPLATE.snbt                 <- copy-paste skeleton (kept OUT of quests/ so FTB won't load it)
  README.md                     <- this file
  quests/
    data.snbt                   <- file settings (FTB-managed; don't hand-clobber)
    chapter_groups.snbt         <- chapter groups
    chapters/NN_name.snbt       <- one file per chapter (the expandable unit)
    reward_tables/*.snbt        <- reward tables referenced by quests
    lang/en_us.snbt             <- FTB-managed translations
```

## Add a chapter
1. Copy `TEMPLATE.snbt` to `quests/chapters/NN_name.snbt` with a free 2-hex `NN`
   (10, 11, …). Replace every `NN` in the ids with that prefix.
2. Fill in quests: each quest/task/reward needs a unique id = `NN` + 14 running hex
   digits. Task types: item, kill, advancement, structure, dimension, biome,
   checkmark, gamestage, observation, stat. Item fields accept a registry id
   string (`item: "minecraft:diamond"`) or a compound (`item: { id: "...", count: 1 }`).
3. (Optional) gate it by day: make the first quest a
   `{ type: "gamestage", stage: "day_25" }` task and `dependencies` the rest on it.
   The day stages are granted in-game by
   `kubejs/server_scripts/quests/ftbquests_day_spine.js` (day_10/25/50/100).
4. (Optional) put it in a group: set `group` to a `chapter_groups.snbt` id.
5. Validate: `python tools/validate_quests.py` (run from the instance root).
6. In a running world, `/ftbquests reload` to pick up changes. New worlds get it
   automatically. Commit when happy.

## Editing in-game
The in-game FTB Quests editor writes straight into this folder, so edits are
already in the tracked master — just commit them.

## Notes
- The MineColonies chapter uses `checkmark` tasks (no verified item ids). Swap to
  `{ type: "item", item: "minecolonies:<id>" }` once confirmed in JEI.
- Capstone rewards reference `reward_tables/capstone_loot.snbt`
  (`{ type: "random", table_id: "FA00000000000001" }`).
- `data.snbt` is managed by FTB Quests (has a `version`, progression_mode, etc.) —
  change progression settings via the in-game editor rather than by hand.
