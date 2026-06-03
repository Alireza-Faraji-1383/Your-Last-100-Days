# FTB Quests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an expandable FTB Quests pack for the NeoForge 1.21.1 modpack — mod/theme chapters with rewards + dependency gating and a 100-day stage-gated progression spine — that auto-seeds into every world.

**Architecture:** Git-tracked master quest data lives at `kubejs/data/ftbquests_master/quests/` (one `.snbt` per chapter). A KubeJS seed script copies it into each world's `ftbquests/quests/` on load (FTB Quests is per-world only — verified). A second KubeJS script grants `day_*` FTB stages as world-days pass; gated chapters open via `gamestage` tasks. A standalone Python validator checks every `.snbt` without launching Minecraft.

**Tech Stack:** FTB Quests `2101.1.24` SNBT, KubeJS (Rhino) server scripts, FTB Teams `TeamStagesHelper` API, Python 3 (validator).

---

## Verified Facts (do not re-research)

- Quest data path: `<world>/ftbquests/quests/` via `ServerQuestFile` → `getWorldPath(LevelResource.ROOT)`. No config/datapack global source exists.
- Reload command: `/ftbquests reload` (exists; `doReload`).
- Task type ids (used as `type:` strings, no namespace): `item`, `kill`, `advancement`, `structure`, `dimension`, `biome`, `checkmark`, `gamestage`, `observation`, `stat`, `custom`.
- Stage gate task: `{ type: "gamestage", stage: "day_10" }`.
- Grant a stage from KubeJS: `TeamStagesHelper.addTeamStage(team, "day_10")` (`dev.ftb.mods.ftbteams.api.TeamStagesHelper`). Idempotent.
- All teams: `FTBTeamsAPI.api().getManager().getTeams()`.
- Reward types: `{ type:"item", item:"...", count:N }`, `{ type:"xp", xp:N }`, `{ type:"random", table_id:"<rewardTableId>" }`.
- KubeJS conventions (from `kubejs/server_scripts/raids/`): `// priority:` header, IIFE module, `var` inside functions (Rhino redeclare quirk — see [[feedback_rhino_quirks]]), `Java.loadClass(...)`, `event.server`, `ServerEvents.loaded`, `console.info/warn/error`.
- Minecraft runs with cwd = instance root, so the master folder is reachable as the relative path `kubejs/data/ftbquests_master/quests`.

## ID Scheme (16-hex, globally unique — the validator enforces this)

- Every quest object id is exactly 16 hex chars.
- **Chapters** are numbered `01`–`09`. Inside chapter `NN`, every object (the chapter, its quests, tasks, rewards) gets `NN` + a 14-digit zero-padded running counter:
  - chapter id: `NN00000000000000`
  - first object: `NN00000000000001`, second `NN00000000000002`, …
- **File-level** objects use an `F` prefix: chapter groups `F1000000000000xx`, reward tables `FA000000000000xx`.

This makes ids deterministic, readable, and collision-free across files.

## File Structure

```
tools/validate_quests.py                              # standalone SNBT checker (the test harness)
kubejs/data/ftbquests_master/
  README.md                                           # how to add chapters / sync from in-game editor
  TEMPLATE.snbt                                        # copy-paste chapter skeleton
  quests/
    data.snbt                                         # quest-file settings
    chapter_groups.snbt                               # 3 chapter groups
    reward_tables/capstone_loot.snbt                  # shared capstone loot table
    chapters/
      01_getting_started.snbt
      02_combat_and_gear.snbt
      03_artifacts_and_relics.snbt   (gate day_10)
      04_exploration.snbt            (gate day_10)
      05_magic_and_curios.snbt       (gate day_25)
      06_minecolonies.snbt           (gate day_25)
      07_cataclysm.snbt              (gate day_50)
      08_chaos_and_bosses.snbt       (gate day_50)
      09_endgame.snbt                (gate day_100)
kubejs/server_scripts/quests/
  ftbquests_seed.js                                   # copy master -> world on load
  ftbquests_day_spine.js                              # grant day_* stages over time
```

---

## Task 1: SNBT validator tool

**Files:**
- Create: `tools/validate_quests.py`

- [ ] **Step 1: Write the validator**

```python
#!/usr/bin/env python3
"""Validate FTB Quests master SNBT without launching Minecraft.

Checks, across kubejs/data/ftbquests_master/quests/:
  - braces/brackets balance in every .snbt
  - every id: "..." is exactly 16 hex chars and globally unique
  - every task `type:` is a known FTB Quests task type
  - every reward `table_id:` resolves to a reward-table id
  - every quest `dependencies` entry resolves to some object id
Exit 0 = OK, 1 = problems (prints them).
"""
import re, sys, pathlib

ROOT = pathlib.Path("kubejs/data/ftbquests_master/quests")
TASK_TYPES = {"item","kill","advancement","structure","dimension","biome",
              "checkmark","gamestage","observation","stat","custom"}

def strip_strings(s):
    # blank out quoted strings so brace counting ignores braces in text
    return re.sub(r'"(?:\\.|[^"\\])*"', '""', s)

def main():
    if not ROOT.is_dir():
        print(f"no master dir at {ROOT} (nothing to validate)"); return 0
    files = sorted(ROOT.rglob("*.snbt"))
    errors, ids, id_files = [], {}, {}
    table_ids, ref_tables, dep_refs = set(), [], []
    for f in files:
        text = f.read_text(encoding="utf-8")
        bare = strip_strings(text)
        if bare.count("{") != bare.count("}"):
            errors.append(f"{f}: unbalanced {{ }} ({bare.count('{')} vs {bare.count('}')})")
        if bare.count("[") != bare.count("]"):
            errors.append(f"{f}: unbalanced [ ] ({bare.count('[')} vs {bare.count(']')})")
        for m in re.finditer(r'id:\s*"([^"]*)"', text):
            v = m.group(1)
            if not re.fullmatch(r"[0-9A-Fa-f]{16}", v):
                errors.append(f"{f}: id '{v}' is not 16 hex chars")
            elif v in ids:
                errors.append(f"{f}: duplicate id '{v}' (also in {id_files[v]})")
            else:
                ids[v] = True; id_files[v] = f.name
        for m in re.finditer(r'type:\s*"([^"]*)"', text):
            t = m.group(1)
            # task types live inside a tasks:[ ] block; reward types are a separate set.
            # accept known task types and the known reward types here.
            if t not in TASK_TYPES and t not in {"item","xp","random","command","loot","advancement","choice"}:
                errors.append(f"{f}: unknown type '{t}'")
        for m in re.finditer(r'table_id:\s*"([^"]*)"', text):
            ref_tables.append((f.name, m.group(1)))
        if "reward_tables" in str(f):
            for m in re.finditer(r'id:\s*"([0-9A-Fa-f]{16})"', text):
                table_ids.add(m.group(1))
        for m in re.finditer(r'dependencies:\s*\[([^\]]*)\]', text):
            for d in re.findall(r'"([^"]*)"', m.group(1)):
                dep_refs.append((f.name, d))
    for fn, t in ref_tables:
        if t not in table_ids:
            errors.append(f"{fn}: table_id '{t}' has no matching reward table")
    for fn, d in dep_refs:
        if d not in ids:
            errors.append(f"{fn}: dependency '{d}' resolves to no object id")
    if errors:
        print(f"FAIL ({len(errors)} problem(s)):")
        for e in errors: print("  -", e)
        return 1
    print(f"OK: {len(files)} file(s), {len(ids)} unique id(s)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run it (no master dir yet)**

Run: `python tools/validate_quests.py`
Expected: `no master dir at kubejs/data/ftbquests_master/quests (nothing to validate)` and exit 0.

- [ ] **Step 3: Commit**

```bash
git add tools/validate_quests.py
git commit -m "feat(quests): add standalone SNBT validator"
```

---

## Task 2: Scaffold the master quest file

**Files:**
- Create: `kubejs/data/ftbquests_master/quests/data.snbt`
- Create: `kubejs/data/ftbquests_master/quests/chapter_groups.snbt`
- Create: `kubejs/data/ftbquests_master/quests/reward_tables/capstone_loot.snbt`

- [ ] **Step 1: Write `data.snbt`**

```snbt
{
	default_autoclaim_rewards: "disabled"
	default_consume_items: false
	default_quest_disable_jei: false
	default_quest_shape: "circle"
	default_reward_team: false
	default_team_consume_items: false
	detection_delay: 20
	disable_gui: false
	drop_loot_crates: false
	emergency_items_cooldown: 300
	grid_scale: 0.5d
	lock_message: ""
	pause_default: false
	progression_mode: "flexible"
	title: "Modpack Quests"
}
```

- [ ] **Step 2: Write `chapter_groups.snbt`**

```snbt
{
	chapter_groups: [
		{ id: "F100000000000001", title: "Survival" }
		{ id: "F100000000000002", title: "Combat & Bosses" }
		{ id: "F100000000000003", title: "World & Magic" }
	]
}
```

- [ ] **Step 3: Write `reward_tables/capstone_loot.snbt`**

```snbt
{
	id: "FA00000000000001"
	loot_size: 1
	order_index: 0
	title: "Capstone Loot"
	use_title: true
	rewards: [
		{ item: "minecraft:diamond", count: 4 }
		{ item: "minecraft:netherite_scrap", count: 1 }
		{ item: "cataclysm:witherite_ingot", count: 1 }
	]
}
```

- [ ] **Step 4: Validate**

Run: `python tools/validate_quests.py`
Expected: `OK: 3 file(s), 4 unique id(s)`

- [ ] **Step 5: Commit**

```bash
git add kubejs/data/ftbquests_master/quests/
git commit -m "feat(quests): scaffold quest file, groups, capstone reward table"
```

---

## Task 3: Chapter 01 — Getting Started (ungated)

**Files:**
- Create: `kubejs/data/ftbquests_master/quests/chapters/01_getting_started.snbt`

- [ ] **Step 1: Write the chapter**

```snbt
{
	id: "0100000000000000"
	group: "F100000000000001"
	order_index: 0
	filename: "getting_started"
	title: "Getting Started"
	icon: "minecraft:crafting_table"
	default_quest_shape: "circle"
	default_hide_dependency_lines: false
	images: [ ]
	quest_links: [ ]
	quests: [
		{
			id: "0100000000000001"
			x: 0.0d
			y: 0.0d
			title: "Wood First"
			description: ["Punch a tree. Everything starts here."]
			tasks: [{ id: "0100000000000002", type: "item", item: "minecraft:oak_log", count: 4L }]
			rewards: [{ id: "0100000000000003", type: "xp", xp: 5 }]
		}
		{
			id: "0100000000000004"
			x: 1.5d
			y: 0.0d
			dependencies: ["0100000000000001"]
			title: "A Proper Workbench"
			tasks: [{ id: "0100000000000005", type: "item", item: "minecraft:crafting_table" }]
			rewards: [{ id: "0100000000000006", type: "item", item: "minecraft:bread", count: 4 }]
		}
		{
			id: "0100000000000007"
			x: 3.0d
			y: 0.0d
			dependencies: ["0100000000000004"]
			title: "Stone Tools"
			tasks: [{ id: "0100000000000008", type: "item", item: "minecraft:stone_pickaxe" }]
			rewards: [{ id: "0100000000000009", type: "xp", xp: 10 }]
		}
		{
			id: "010000000000000A"
			x: 3.0d
			y: 1.5d
			dependencies: ["0100000000000004"]
			title: "Pack It Up"
			subtitle: "Sophisticated Backpacks"
			description: ["Craft a Backpack — your inventory will thank you."]
			tasks: [{ id: "010000000000000B", type: "item", item: "sophisticatedbackpacks:backpack" }]
			rewards: [{ id: "010000000000000C", type: "item", item: "minecraft:leather", count: 4 }]
		}
		{
			id: "010000000000000D"
			x: 4.5d
			y: 0.0d
			dependencies: ["0100000000000007"]
			title: "Fast Travel"
			subtitle: "Waystones"
			description: ["Craft and place a Waystone to unlock fast travel."]
			tasks: [{ id: "010000000000000E", type: "item", item: "waystones:waystone" }]
			rewards: [{ id: "010000000000000F", type: "xp", xp: 20 }]
		}
	]
}
```

- [ ] **Step 2: Validate**

Run: `python tools/validate_quests.py`
Expected: `OK: 4 file(s), ...` and exit 0 (no FAIL lines).

- [ ] **Step 3: Commit**

```bash
git add kubejs/data/ftbquests_master/quests/chapters/01_getting_started.snbt
git commit -m "feat(quests): chapter 01 getting started"
```

---

## Task 4: Chapter 02 — Combat & Gear (ungated)

**Files:**
- Create: `kubejs/data/ftbquests_master/quests/chapters/02_combat_and_gear.snbt`

- [ ] **Step 1: Write the chapter**

```snbt
{
	id: "0200000000000000"
	group: "F100000000000002"
	order_index: 0
	filename: "combat_and_gear"
	title: "Combat & Gear"
	icon: "minecraft:iron_sword"
	default_quest_shape: "circle"
	default_hide_dependency_lines: false
	images: [ ]
	quest_links: [ ]
	quests: [
		{
			id: "0200000000000001"
			x: 0.0d
			y: 0.0d
			title: "Iron-Clad"
			tasks: [{ id: "0200000000000002", type: "item", item: "minecraft:iron_chestplate" }]
			rewards: [{ id: "0200000000000003", type: "xp", xp: 15 }]
		}
		{
			id: "0200000000000004"
			x: 1.5d
			y: 0.0d
			dependencies: ["0200000000000001"]
			title: "Diamond Edge"
			tasks: [{ id: "0200000000000005", type: "item", item: "minecraft:diamond_sword" }]
			rewards: [{ id: "0200000000000006", type: "item", item: "minecraft:diamond", count: 2 }]
		}
		{
			id: "0200000000000007"
			x: 3.0d
			y: 0.0d
			dependencies: ["0200000000000004"]
			title: "Enchanted"
			description: ["Enchant any item at an Enchanting Table."]
			tasks: [{ id: "0200000000000008", type: "item", item: "minecraft:enchanting_table" }]
			rewards: [{ id: "0200000000000009", type: "item", item: "minecraft:lapis_lazuli", count: 16 }]
		}
		{
			id: "020000000000000A"
			x: 3.0d
			y: 1.5d
			dependencies: ["0200000000000004"]
			title: "Cull the Herd"
			description: ["Prove your blade on a Ravager."]
			tasks: [{ id: "020000000000000B", type: "kill", entity: "minecraft:ravager", value: 1L }]
			rewards: [{ id: "020000000000000C", type: "xp", xp: 40 }]
		}
		{
			id: "020000000000000D"
			x: 4.5d
			y: 0.0d
			dependencies: ["0200000000000007"]
			title: "Beyond Netherite"
			subtitle: "Advanced Netherite"
			description: ["Forge a Netherite-Diamond Ingot."]
			tasks: [{ id: "020000000000000E", type: "item", item: "advancednetherite:netherite_diamond_ingot" }]
			rewards: [{ id: "020000000000000F", type: "random", table_id: "FA00000000000001" }]
		}
	]
}
```

- [ ] **Step 2: Validate**

Run: `python tools/validate_quests.py`
Expected: `OK` (no FAIL).

- [ ] **Step 3: Commit**

```bash
git add kubejs/data/ftbquests_master/quests/chapters/02_combat_and_gear.snbt
git commit -m "feat(quests): chapter 02 combat and gear"
```

---

## Task 5: Chapter 03 — Artifacts & Relics (gated: day_10)

**Files:**
- Create: `kubejs/data/ftbquests_master/quests/chapters/03_artifacts_and_relics.snbt`

The first quest is the **day gate**: a `gamestage` task that auto-completes once the
team has `day_10`. Every other quest depends on it, so the chapter opens on day 10.

- [ ] **Step 1: Write the chapter**

```snbt
{
	id: "0300000000000000"
	group: "F100000000000003"
	order_index: 0
	filename: "artifacts_and_relics"
	title: "Artifacts & Relics"
	icon: "artifacts:cross_necklace"
	default_quest_shape: "circle"
	default_hide_dependency_lines: false
	images: [ ]
	quest_links: [ ]
	quests: [
		{
			id: "0300000000000001"
			x: 0.0d
			y: 0.0d
			shape: "gear"
			title: "Day 10: Curiosities Surface"
			description: ["Survive to day 10 and the world's trinkets reveal themselves."]
			tasks: [{ id: "0300000000000002", type: "gamestage", stage: "day_10" }]
			rewards: [{ id: "0300000000000003", type: "xp", xp: 30 }]
		}
		{
			id: "0300000000000004"
			x: 1.5d
			y: -0.75d
			dependencies: ["0300000000000001"]
			title: "Cloud in a Bottle"
			tasks: [{ id: "0300000000000005", type: "item", item: "artifacts:cloud_in_a_bottle" }]
			rewards: [{ id: "0300000000000006", type: "xp", xp: 20 }]
		}
		{
			id: "0300000000000007"
			x: 1.5d
			y: 0.75d
			dependencies: ["0300000000000001"]
			title: "Cross Necklace"
			tasks: [{ id: "0300000000000008", type: "item", item: "artifacts:cross_necklace" }]
			rewards: [{ id: "0300000000000009", type: "xp", xp: 20 }]
		}
		{
			id: "030000000000000A"
			x: 3.0d
			y: -0.75d
			dependencies: ["0300000000000004"]
			title: "Mirror, Mirror"
			subtitle: "Relics"
			tasks: [{ id: "030000000000000B", type: "item", item: "relics:magic_mirror" }]
			rewards: [{ id: "030000000000000C", type: "xp", xp: 30 }]
		}
		{
			id: "030000000000000D"
			x: 3.0d
			y: 0.75d
			dependencies: ["0300000000000007"]
			title: "Holy Locket"
			subtitle: "Relics"
			tasks: [{ id: "030000000000000E", type: "item", item: "relics:holy_locket" }]
			rewards: [{ id: "030000000000000F", type: "item", item: "minecraft:experience_bottle", count: 8 }]
		}
	]
}
```

- [ ] **Step 2: Validate**

Run: `python tools/validate_quests.py`
Expected: `OK` (no FAIL).

- [ ] **Step 3: Commit**

```bash
git add kubejs/data/ftbquests_master/quests/chapters/03_artifacts_and_relics.snbt
git commit -m "feat(quests): chapter 03 artifacts and relics (day_10 gate)"
```

---

## Task 6: Chapter 04 — Exploration (gated: day_10)

**Files:**
- Create: `kubejs/data/ftbquests_master/quests/chapters/04_exploration.snbt`

Uses dimension/biome/advancement/item tasks (no structure-ids needed).

- [ ] **Step 1: Write the chapter**

```snbt
{
	id: "0400000000000000"
	group: "F100000000000003"
	order_index: 1
	filename: "exploration"
	title: "Exploration"
	icon: "minecraft:filled_map"
	default_quest_shape: "circle"
	default_hide_dependency_lines: false
	images: [ ]
	quest_links: [ ]
	quests: [
		{
			id: "0400000000000001"
			x: 0.0d
			y: 0.0d
			shape: "gear"
			title: "Day 10: Wanderlust"
			tasks: [{ id: "0400000000000002", type: "gamestage", stage: "day_10" }]
			rewards: [{ id: "0400000000000003", type: "item", item: "minecraft:map" }]
		}
		{
			id: "0400000000000004"
			x: 1.5d
			y: -0.75d
			dependencies: ["0400000000000001"]
			title: "Network of Waystones"
			description: ["Place a second Waystone to build a travel network."]
			tasks: [{ id: "0400000000000005", type: "item", item: "waystones:waystone", count: 1L }]
			rewards: [{ id: "0400000000000006", type: "xp", xp: 20 }]
		}
		{
			id: "0400000000000007"
			x: 1.5d
			y: 0.75d
			dependencies: ["0400000000000001"]
			title: "Into the Nether"
			tasks: [{ id: "0400000000000008", type: "dimension", dimension: "minecraft:the_nether" }]
			rewards: [{ id: "0400000000000009", type: "xp", xp: 30 }]
		}
		{
			id: "040000000000000A"
			x: 3.0d
			y: 0.75d
			dependencies: ["0400000000000007"]
			title: "Fortress Plunder"
			description: ["Loot a Nether Fortress for blaze rods."]
			tasks: [{ id: "040000000000000B", type: "item", item: "minecraft:blaze_rod", count: 2L }]
			rewards: [{ id: "040000000000000C", type: "xp", xp: 40 }]
		}
		{
			id: "040000000000000D"
			x: 3.0d
			y: -0.75d
			dependencies: ["0400000000000004"]
			title: "Adventuring Time"
			description: ["Earn the vanilla 'Adventuring Time' spirit — visit a new biome."]
			tasks: [{ id: "040000000000000E", type: "advancement", advancement: "minecraft:adventure/sleep_in_bed", criterion: "" }]
			rewards: [{ id: "040000000000000F", type: "item", item: "minecraft:emerald", count: 4 }]
		}
	]
}
```

- [ ] **Step 2: Validate + commit**

Run: `python tools/validate_quests.py` → Expected `OK`.

```bash
git add kubejs/data/ftbquests_master/quests/chapters/04_exploration.snbt
git commit -m "feat(quests): chapter 04 exploration (day_10 gate)"
```

---

## Task 7: Chapter 05 — Magic & Curios (gated: day_25)

**Files:**
- Create: `kubejs/data/ftbquests_master/quests/chapters/05_magic_and_curios.snbt`

- [ ] **Step 1: Write the chapter**

```snbt
{
	id: "0500000000000000"
	group: "F100000000000003"
	order_index: 2
	filename: "magic_and_curios"
	title: "Magic & Curios"
	icon: "minecraft:enchanted_book"
	default_quest_shape: "circle"
	default_hide_dependency_lines: false
	images: [ ]
	quest_links: [ ]
	quests: [
		{
			id: "0500000000000001"
			x: 0.0d
			y: 0.0d
			shape: "gear"
			title: "Day 25: Arcane Awakening"
			tasks: [{ id: "0500000000000002", type: "gamestage", stage: "day_25" }]
			rewards: [{ id: "0500000000000003", type: "xp", xp: 50 }]
		}
		{
			id: "0500000000000004"
			x: 1.5d
			y: -0.75d
			dependencies: ["0500000000000001"]
			title: "Bookshelf Sanctum"
			description: ["Surround an Enchanting Table with bookshelves (collect 15)."]
			tasks: [{ id: "0500000000000005", type: "item", item: "minecraft:bookshelf", count: 15L }]
			rewards: [{ id: "0500000000000006", type: "xp", xp: 30 }]
		}
		{
			id: "0500000000000007"
			x: 1.5d
			y: 0.75d
			dependencies: ["0500000000000001"]
			title: "Equip a Curio"
			description: ["Open your Curios slots and equip any trinket."]
			tasks: [{ id: "0500000000000008", type: "checkmark", title: "Equip a curio in a Curios slot" }]
			rewards: [{ id: "0500000000000009", type: "item", item: "minecraft:gold_ingot", count: 4 }]
		}
		{
			id: "050000000000000A"
			x: 3.0d
			y: 0.0d
			dependencies: ["0500000000000004", "0500000000000007"]
			title: "Ender's Hand"
			subtitle: "Relics"
			tasks: [{ id: "050000000000000B", type: "item", item: "relics:enders_hand" }]
			rewards: [{ id: "050000000000000C", type: "item", item: "minecraft:ender_pearl", count: 4 }]
		}
	]
}
```

- [ ] **Step 2: Validate + commit**

Run: `python tools/validate_quests.py` → Expected `OK`.

```bash
git add kubejs/data/ftbquests_master/quests/chapters/05_magic_and_curios.snbt
git commit -m "feat(quests): chapter 05 magic and curios (day_25 gate)"
```

---

## Task 8: Chapter 06 — MineColonies (gated: day_25)

**Files:**
- Create: `kubejs/data/ftbquests_master/quests/chapters/06_minecolonies.snbt`

Uses `checkmark` tasks (manual completion) to avoid unverified MineColonies item ids —
documented in the README as an expansion point to swap in `item` tasks later.

- [ ] **Step 1: Write the chapter**

```snbt
{
	id: "0600000000000000"
	group: "F100000000000001"
	order_index: 1
	filename: "minecolonies"
	title: "Found a Colony"
	icon: "minecraft:bell"
	default_quest_shape: "circle"
	default_hide_dependency_lines: false
	images: [ ]
	quest_links: [ ]
	quests: [
		{
			id: "0600000000000001"
			x: 0.0d
			y: 0.0d
			shape: "gear"
			title: "Day 25: Settle Down"
			tasks: [{ id: "0600000000000002", type: "gamestage", stage: "day_25" }]
			rewards: [{ id: "0600000000000003", type: "xp", xp: 50 }]
		}
		{
			id: "0600000000000004"
			x: 1.5d
			y: 0.0d
			dependencies: ["0600000000000001"]
			title: "Place the Supply Camp"
			description: ["Deploy a Supply Camp or Supply Ship to begin your colony."]
			tasks: [{ id: "0600000000000005", type: "checkmark", title: "Place a MineColonies supply camp/ship" }]
			rewards: [{ id: "0600000000000006", type: "xp", xp: 30 }]
		}
		{
			id: "0600000000000007"
			x: 3.0d
			y: 0.0d
			dependencies: ["0600000000000004"]
			title: "Raise the Town Hall"
			tasks: [{ id: "0600000000000008", type: "checkmark", title: "Build and place a Town Hall" }]
			rewards: [{ id: "0600000000000009", type: "item", item: "minecraft:gold_block", count: 2 }]
		}
		{
			id: "060000000000000A"
			x: 4.5d
			y: 0.0d
			dependencies: ["0600000000000007"]
			title: "A Growing Settlement"
			tasks: [{ id: "060000000000000B", type: "checkmark", title: "Reach colony level 5" }]
			rewards: [{ id: "060000000000000C", type: "random", table_id: "FA00000000000001" }]
		}
	]
}
```

- [ ] **Step 2: Validate + commit**

Run: `python tools/validate_quests.py` → Expected `OK`.

```bash
git add kubejs/data/ftbquests_master/quests/chapters/06_minecolonies.snbt
git commit -m "feat(quests): chapter 06 minecolonies (day_25 gate)"
```

---

## Task 9: Chapter 07 — Cataclysm (gated: day_50)

**Files:**
- Create: `kubejs/data/ftbquests_master/quests/chapters/07_cataclysm.snbt`

Verified Cataclysm entity ids: `cataclysm:ignis`, `cataclysm:netherite_monstrosity`,
`cataclysm:ender_guardian`, `cataclysm:the_leviathan`. Verified items:
`cataclysm:witherite_ingot`, `cataclysm:infernal_forge`, `cataclysm:brontes`.

- [ ] **Step 1: Write the chapter**

```snbt
{
	id: "0700000000000000"
	group: "F100000000000002"
	order_index: 1
	filename: "cataclysm"
	title: "Cataclysm"
	icon: "cataclysm:witherite_ingot"
	default_quest_shape: "hexagon"
	default_hide_dependency_lines: false
	images: [ ]
	quest_links: [ ]
	quests: [
		{
			id: "0700000000000001"
			x: 0.0d
			y: 0.0d
			shape: "gear"
			title: "Day 50: The Earth Trembles"
			tasks: [{ id: "0700000000000002", type: "gamestage", stage: "day_50" }]
			rewards: [{ id: "0700000000000003", type: "xp", xp: 100 }]
		}
		{
			id: "0700000000000004"
			x: 1.5d
			y: -0.75d
			dependencies: ["0700000000000001"]
			title: "Forge of Legends"
			description: ["Craft the Infernal Forge to make Cataclysm gear."]
			tasks: [{ id: "0700000000000005", type: "item", item: "cataclysm:infernal_forge" }]
			rewards: [{ id: "0700000000000006", type: "item", item: "minecraft:netherite_ingot", count: 1 }]
		}
		{
			id: "0700000000000007"
			x: 3.0d
			y: -0.75d
			dependencies: ["0700000000000004"]
			title: "Slay Ignis"
			subtitle: "The Fire Giant"
			tasks: [{ id: "0700000000000008", type: "kill", entity: "cataclysm:ignis", value: 1L }]
			rewards: [{ id: "0700000000000009", type: "random", table_id: "FA00000000000001" }]
		}
		{
			id: "070000000000000A"
			x: 3.0d
			y: 0.75d
			dependencies: ["0700000000000001"]
			title: "The Netherite Monstrosity"
			tasks: [{ id: "070000000000000B", type: "kill", entity: "cataclysm:netherite_monstrosity", value: 1L }]
			rewards: [{ id: "070000000000000C", type: "item", item: "cataclysm:witherite_ingot", count: 2 }]
		}
		{
			id: "070000000000000D"
			x: 4.5d
			y: 0.0d
			dependencies: ["0700000000000007", "070000000000000B"]
			title: "Guardian of the End"
			tasks: [{ id: "070000000000000E", type: "kill", entity: "cataclysm:ender_guardian", value: 1L }]
			rewards: [{ id: "070000000000000F", type: "random", table_id: "FA00000000000001" }]
		}
	]
}
```

- [ ] **Step 2: Validate + commit**

Run: `python tools/validate_quests.py` → Expected `OK`.

```bash
git add kubejs/data/ftbquests_master/quests/chapters/07_cataclysm.snbt
git commit -m "feat(quests): chapter 07 cataclysm (day_50 gate)"
```

---

## Task 10: Chapter 08 — Chaos & Bosses (gated: day_50)

**Files:**
- Create: `kubejs/data/ftbquests_master/quests/chapters/08_chaos_and_bosses.snbt`

Verified Block Factory's Bosses ids: entities `block_factorys_bosses:infernal_dragon`,
`block_factorys_bosses:kraken`; item `block_factorys_bosses:ancient_trial_key`,
`block_factorys_bosses:dragon_bone`.

- [ ] **Step 1: Write the chapter**

```snbt
{
	id: "0800000000000000"
	group: "F100000000000002"
	order_index: 2
	filename: "chaos_and_bosses"
	title: "Chaos & Bosses"
	icon: "block_factorys_bosses:dragon_bone"
	default_quest_shape: "hexagon"
	default_hide_dependency_lines: false
	images: [ ]
	quest_links: [ ]
	quests: [
		{
			id: "0800000000000001"
			x: 0.0d
			y: 0.0d
			shape: "gear"
			title: "Day 50: Trials Await"
			tasks: [{ id: "0800000000000002", type: "gamestage", stage: "day_50" }]
			rewards: [{ id: "0800000000000003", type: "xp", xp: 100 }]
		}
		{
			id: "0800000000000004"
			x: 1.5d
			y: 0.0d
			dependencies: ["0800000000000001"]
			title: "Ancient Trial Key"
			description: ["Obtain an Ancient Trial Key to open a boss trial."]
			tasks: [{ id: "0800000000000005", type: "item", item: "block_factorys_bosses:ancient_trial_key" }]
			rewards: [{ id: "0800000000000006", type: "xp", xp: 40 }]
		}
		{
			id: "0800000000000007"
			x: 3.0d
			y: -0.75d
			dependencies: ["0800000000000004"]
			title: "Release the Kraken"
			tasks: [{ id: "0800000000000008", type: "kill", entity: "block_factorys_bosses:kraken", value: 1L }]
			rewards: [{ id: "0800000000000009", type: "random", table_id: "FA00000000000001" }]
		}
		{
			id: "080000000000000A"
			x: 3.0d
			y: 0.75d
			dependencies: ["0800000000000004"]
			title: "Infernal Dragon"
			tasks: [{ id: "080000000000000B", type: "kill", entity: "block_factorys_bosses:infernal_dragon", value: 1L }]
			rewards: [{ id: "080000000000000C", type: "item", item: "block_factorys_bosses:dragon_bone", count: 4 }]
		}
	]
}
```

- [ ] **Step 2: Validate + commit**

Run: `python tools/validate_quests.py` → Expected `OK`.

```bash
git add kubejs/data/ftbquests_master/quests/chapters/08_chaos_and_bosses.snbt
git commit -m "feat(quests): chapter 08 chaos and bosses (day_50 gate)"
```

---

## Task 11: Chapter 09 — Endgame (gated: day_100)

**Files:**
- Create: `kubejs/data/ftbquests_master/quests/chapters/09_endgame.snbt`

- [ ] **Step 1: Write the chapter**

```snbt
{
	id: "0900000000000000"
	group: "F100000000000002"
	order_index: 3
	filename: "endgame"
	title: "Endgame"
	icon: "minecraft:nether_star"
	default_quest_shape: "diamond"
	default_hide_dependency_lines: false
	images: [ ]
	quest_links: [ ]
	quests: [
		{
			id: "0900000000000001"
			x: 0.0d
			y: 0.0d
			shape: "gear"
			title: "Day 100: Survivor"
			description: ["One hundred days. You have outlasted the world's worst."]
			tasks: [{ id: "0900000000000002", type: "gamestage", stage: "day_100" }]
			rewards: [{ id: "0900000000000003", type: "random", table_id: "FA00000000000001" }]
		}
		{
			id: "0900000000000004"
			x: 1.5d
			y: 0.0d
			dependencies: ["0900000000000001"]
			title: "Master of Netherite"
			tasks: [{ id: "0900000000000005", type: "item", item: "advancednetherite:netherite_diamond_chestplate" }]
			rewards: [{ id: "0900000000000006", type: "item", item: "minecraft:netherite_block", count: 1 }]
		}
		{
			id: "0900000000000007"
			x: 3.0d
			y: 0.0d
			dependencies: ["0900000000000004"]
			title: "Slayer of Giants"
			description: ["Defeat Ignis once more to claim the trophy."]
			tasks: [{ id: "0900000000000008", type: "kill", entity: "cataclysm:ignis", value: 1L }]
			rewards: [{ id: "0900000000000009", type: "item", item: "minecraft:totem_of_undying", count: 1 }]
		}
		{
			id: "090000000000000A"
			x: 4.5d
			y: 0.0d
			dependencies: ["0900000000000007"]
			title: "Legend"
			tasks: [{ id: "090000000000000B", type: "checkmark", title: "Claim your legend" }]
			rewards: [{ id: "090000000000000C", type: "random", table_id: "FA00000000000001" }]
		}
	]
}
```

- [ ] **Step 2: Validate + commit**

Run: `python tools/validate_quests.py` → Expected `OK: 12 file(s), ...`.

```bash
git add kubejs/data/ftbquests_master/quests/chapters/09_endgame.snbt
git commit -m "feat(quests): chapter 09 endgame (day_100 gate)"
```

---

## Task 12: Seed script — copy master into each world

**Files:**
- Create: `kubejs/server_scripts/quests/ftbquests_seed.js`

- [ ] **Step 1: Write the script**

```javascript
// priority: 50
// kubejs/server_scripts/quests/ftbquests_seed.js
//
// FTB Quests reads quest definitions only from <world>/ftbquests/quests/.
// To make the pack's quests appear in EVERY world, copy the git-tracked master
// (kubejs/data/ftbquests_master/quests) into a world that has none, then reload.
//
// Re-seeds only when the world has no chapters/ dir, so player edits/progress in
// an established world are never clobbered. Rhino: var inside functions only.

(function () {
    "use strict";

    var Files  = Java.loadClass("java.nio.file.Files");
    var Paths  = Java.loadClass("java.nio.file.Paths");
    var LevelResource = Java.loadClass("net.minecraft.world.level.storage.LevelResource");
    var StandardCopyOption = Java.loadClass("java.nio.file.StandardCopyOption");

    function log(m)  { console.info("[QuestSeed] " + m); }
    function warn(m) { console.warn("[QuestSeed] " + m); }

    function masterDir() {
        // cwd = instance root; master is git-tracked under kubejs/.
        return Paths.get("kubejs", "data", "ftbquests_master", "quests").toAbsolutePath();
    }

    function worldQuestsDir(server) {
        return server.getWorldPath(LevelResource.ROOT).resolve("ftbquests").resolve("quests");
    }

    function isEmptyOrMissing(dir) {
        var chapters = dir.resolve("chapters");
        try { return !Files.isDirectory(chapters) || !Files.list(chapters).findAny().isPresent(); }
        catch (e) { return true; }
    }

    // Recursive copy master -> dest (REPLACE_EXISTING on files, create dirs).
    function copyTree(src, dest) {
        var stream = Files.walk(src);
        try {
            var it = stream.iterator();
            while (it.hasNext()) {
                var p = it.next();
                var rel = src.relativize(p);
                var target = dest.resolve(rel.toString());
                if (Files.isDirectory(p)) {
                    if (!Files.exists(target)) Files.createDirectories(target);
                } else {
                    if (target.getParent() != null && !Files.exists(target.getParent()))
                        Files.createDirectories(target.getParent());
                    Files.copy(p, target, [StandardCopyOption.REPLACE_EXISTING]);
                }
            }
        } finally { try { stream.close(); } catch (e) {} }
    }

    ServerEvents.loaded(function (event) {
        var server = event.server;
        try {
            var master = masterDir();
            if (!Files.isDirectory(master)) { warn("master not found at " + master); return; }
            var dest = worldQuestsDir(server);
            if (!isEmptyOrMissing(dest)) { log("world already has quests — skip"); return; }
            if (!Files.exists(dest)) Files.createDirectories(dest);
            copyTree(master, dest);
            log("seeded quests into " + dest + " — reloading");
            try { server.runCommandSilent("ftbquests reload"); } catch (e) { warn("reload failed: " + e); }
        } catch (e) { warn("seed failed: " + e); }
    });

    console.info("[QuestSeed] ready");
})();
```

- [ ] **Step 2: Syntax-check the JS**

Run: `node --check kubejs/server_scripts/quests/ftbquests_seed.js`
Expected: no output, exit 0. (Rhino-isms like `Java.loadClass` are not run, only parsed.)

- [ ] **Step 3: Commit**

```bash
git add kubejs/server_scripts/quests/ftbquests_seed.js
git commit -m "feat(quests): seed master quests into each world on load"
```

---

## Task 13: Day-spine script — grant day_* stages

**Files:**
- Create: `kubejs/server_scripts/quests/ftbquests_day_spine.js`

- [ ] **Step 1: Write the script**

```javascript
// priority: 50
// kubejs/server_scripts/quests/ftbquests_day_spine.js
//
// 100-day progression spine. Grants FTB Teams stages day_10 / day_25 / day_50 /
// day_100 to every team as the overworld day count crosses each milestone.
// Gated quest chapters carry a `gamestage` task on those stages (see chapters/).
//
// Stages are idempotent (addTeamStage no-ops if present), so we just re-assert
// every milestone <= current day on a throttled tick. Rhino: var-only.

(function () {
    "use strict";

    var FTBTeamsAPI      = Java.loadClass("dev.ftb.mods.ftbteams.api.FTBTeamsAPI");
    var TeamStagesHelper = Java.loadClass("dev.ftb.mods.ftbteams.api.TeamStagesHelper");

    var MILESTONES = [10, 25, 50, 100];
    var CHECK_EVERY = 100;   // server ticks between checks (~5s)
    var _accum = 0;

    function log(m)  { console.info("[DaySpine] " + m); }
    function warn(m) { console.warn("[DaySpine] " + m); }

    function currentDay(server) {
        try {
            var ow = server.overworld();
            var t = (typeof ow.getDayTime === "function") ? ow.getDayTime() : ow.dayTime;
            return Math.floor(Number(t) / 24000);
        } catch (e) { return 0; }
    }

    function eachTeam(fn) {
        try {
            var mgr = FTBTeamsAPI.api().getManager();
            var teams = mgr.getTeams();
            var it = teams.iterator();
            while (it.hasNext()) fn(it.next());
        } catch (e) { warn("team iteration: " + e); }
    }

    ServerEvents.tick(function (event) {
        _accum++;
        if (_accum < CHECK_EVERY) return;
        _accum = 0;
        var server = event.server;
        var day = currentDay(server);
        if (day < MILESTONES[0]) return;
        eachTeam(function (team) {
            for (var i = 0; i < MILESTONES.length; i++) {
                if (day >= MILESTONES[i]) {
                    var stage = "day_" + MILESTONES[i];
                    try {
                        if (!TeamStagesHelper.hasTeamStage(team, stage))
                            TeamStagesHelper.addTeamStage(team, stage);
                    } catch (e) { warn("addTeamStage " + stage + ": " + e); }
                }
            }
        });
    });

    console.info("[DaySpine] ready — milestones " + MILESTONES.join(", "));
})();
```

- [ ] **Step 2: Syntax-check**

Run: `node --check kubejs/server_scripts/quests/ftbquests_day_spine.js`
Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
git add kubejs/server_scripts/quests/ftbquests_day_spine.js
git commit -m "feat(quests): day-spine grants day_* stages over 100 days"
```

---

## Task 14: Template + README (expandability)

**Files:**
- Create: `kubejs/data/ftbquests_master/TEMPLATE.snbt`
- Create: `kubejs/data/ftbquests_master/README.md`

- [ ] **Step 1: Write `TEMPLATE.snbt`**

```snbt
{
	id: "NN00000000000000"
	group: ""
	order_index: 0
	filename: "my_chapter"
	title: "My Chapter"
	icon: "minecraft:book"
	default_quest_shape: "circle"
	default_hide_dependency_lines: false
	images: [ ]
	quest_links: [ ]
	quests: [
		{
			id: "NN00000000000001"
			x: 0.0d
			y: 0.0d
			title: "First Quest"
			description: ["What to do."]
			tasks: [{ id: "NN00000000000002", type: "item", item: "minecraft:stick" }]
			rewards: [{ id: "NN00000000000003", type: "xp", xp: 10 }]
		}
	]
}
```

- [ ] **Step 2: Write `README.md`**

````markdown
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
````

- [ ] **Step 3: Validate (TEMPLATE uses NN — exclude it) + commit**

The validator only scans `quests/`, so `TEMPLATE.snbt` (outside that dir) is ignored.
Run: `python tools/validate_quests.py`
Expected: `OK` (no FAIL).

```bash
git add kubejs/data/ftbquests_master/TEMPLATE.snbt kubejs/data/ftbquests_master/README.md
git commit -m "docs(quests): chapter template + expandability README"
```

---

## Task 15: In-game verification

No code — this confirms the system end-to-end in Minecraft.

- [ ] **Step 1: New world seeds quests**

Launch the pack, create a NEW world. Open the FTB Quests book (quest item or `/ftbquests editing_mode` off). Expected: all 9 chapters visible; Getting Started quests open; gated chapters show locked behind their "Day N" gear quest.

- [ ] **Step 2: Existing world with no quests seeds**

Quit to an existing world that has no `ftbquests/quests/chapters/`. Expected: log line `[QuestSeed] seeded quests into …`, then quests appear after the auto `ftbquests reload`.

- [ ] **Step 3: Day-spine unlocks chapters**

In a creative/test world run `/time add 240000` (10 days) and wait ~5s. Expected: `day_10` granted; the "Day 10" gear quests in Artifacts & Relics and Exploration auto-complete and their chapters open. Repeat to day 25/50/100 and confirm each tier opens.

- [ ] **Step 4: Task detection + rewards**

Craft a `minecraft:crafting_table` → "A Proper Workbench" completes and grants bread.
Kill a `cataclysm:ignis` (after day 50) → "Slay Ignis" completes and the capstone loot
table delivers.

- [ ] **Step 5: Expandability smoke test**

Copy `TEMPLATE.snbt` to `quests/chapters/10_test.snbt`, replace `NN`→`10`, run
`python tools/validate_quests.py` (expect `OK`), delete the test world's
`ftbquests/quests/chapters/`, rejoin, confirm the new chapter loads. Then delete
`10_test.snbt`.

- [ ] **Step 6: Final commit (if any fixes were made during verification)**

```bash
git add -A
git commit -m "fix(quests): verification adjustments"
```

---

## Self-Review Notes

- **Spec coverage:** all-worlds seed (Task 12) ✓; expandable modular SNBT + template/README (Tasks 3–11, 14) ✓; rewards + dependency gating (every chapter) ✓; 100-day spine (Task 13 + gamestage gates) ✓; by-mod/theme chapters (Tasks 3–11) ✓; framework-first scope ✓.
- **Deviation:** MineColonies chapter uses `checkmark` tasks (unverified item ids) — documented as an expansion point. Reward tables limited to one shared capstone table (inline xp/item rewards elsewhere) to keep field usage verified.
- **Id consistency:** every id is 16 hex, chapter-prefixed, and the validator (Task 1) enforces uniqueness + reference resolution on every commit.
```
