# Quest Master (expandable)

Source of truth for the pack's FTB Quests. FTB Quests reads quests only from each
world's `ftbquests/quests/`, and KubeJS scripts are sandboxed away from file IO
(the class filter denies `java.nio`/`java.io`), so seeding is done by a standalone
tool — `tools/seed_world.py` — that copies this `quests/` folder into worlds.

## Get quests into worlds
- `python tools/seed_world.py --all` — seed every world under `saves/` that has no
  chapters yet (never clobbers an established world). Run from the instance root.
- `python tools/seed_world.py "saves/<World Name>"` — seed one world.
- Add `--force` to overwrite existing quest definitions in a world.

**Automatic seeding:** set a PrismLauncher pre-launch command (Instance →
Settings → Custom Commands → Pre-launch) to:
```
python "$INST_MC_DIR/tools/seed_world.py" --all
```
Every launch then seeds any world missing quests before the game starts.

(The day-spine — `kubejs/server_scripts/quests/ftbquests_day_spine.js` — grants the
`day_*` stages in-game and works inside the sandbox; only file-copying had to move
out to the tool.)

## Add a chapter
1. Copy `TEMPLATE.snbt` to `quests/chapters/NN_name.snbt` with a free 2-hex `NN`
   (10, 11, …). Replace every `NN` in the ids with that prefix.
2. Fill in quests: each quest/task/reward needs a unique id `NN` + 14 running hex
   digits. Task types: item, kill, advancement, structure, dimension, biome,
   checkmark, gamestage, observation, stat.
3. (Optional) gate it: make the first quest a `{ type:"gamestage", stage:"day_25" }`
   task and `dependencies` the rest on it.
4. (Optional) put it in a group: set `group` to a `chapter_groups.snbt` id.
5. Run `python tools/validate_quests.py` from the instance root.
6. Commit, then `python tools/seed_world.py --all --force` to push the update into
   existing worlds (or `--all` for only worlds with no quests yet). New worlds get it
   on next launch via the pre-launch command.

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
