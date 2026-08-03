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

## Per-player chapters (Per Player Quests mod)
`shop` and `bonty_hunter` are per-player: every quest in them carries
`mqt_per_player: true`, so completion and rewards are tracked for the individual
player instead of the team — one member buying from the shop does not hand the
purchase to the rest of the team. Quests in those chapters that gate on
`min_required_dependencies` / `dependency_requirement` also carry
`mqt_exclusivity_scope: "PER_ACTOR"` so the gate counts that player's own
completions. Tasks default to `INHERIT`, so they follow their quest with no extra
key. After adding quests to either chapter, re-run
`python tools/apply_per_player.py config/ftbquests/quests/chapters/shop.snbt config/ftbquests/quests/chapters/bonty_hunter.snbt`
(idempotent) or set the flags via the in-game editor's *Per-Player Quest* toggle.

## Notes
- The MineColonies chapter uses `checkmark` tasks (no verified item ids). Swap to
  `{ type: "item", item: "minecolonies:<id>" }` once confirmed in JEI.
- Capstone rewards reference `reward_tables/capstone_loot.snbt`
  (`{ type: "random", table_id: "FA00000000000001" }`).
- `data.snbt` is managed by FTB Quests (has a `version`, progression_mode, etc.) —
  change progression settings via the in-game editor rather than by hand.
