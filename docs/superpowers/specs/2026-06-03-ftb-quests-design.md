# FTB Quests for the Modpack — Design

**Date:** 2026-06-03
**Status:** Approved design (pending user spec review)
**Branch:** `feat/ftb-quests`

## Goal

Add a quest/progression system to the NeoForge 1.21.1 modpack using FTB Quests
(`ftb-quests-neoforge-2101.1.24`). Quests must:

1. Reflect the installed mods (combat, bosses, exploration, colonies, magic, storage).
2. Be **expandable** — adding content later is copy-paste easy, no rewrites.
3. **Exist in all worlds** of the pack, including newly created ones.
4. Use **rewards + dependency gating** (quest trees that unlock, reward tables on completion).
5. Carry a **100-day progression spine** layered over mod/theme chapters.

## Key Constraint (verified)

FTB Quests `2101.1.24` reads quest definitions **only** from the active world at
`<world>/ftbquests/quests/`. Verified by decompiling `ServerQuestFile.class`:
it calls `getWorldPath(LevelResource)` and resolves `ftbquests/quests`. There is
**no** config-level or datapack-level global quest source in this version.

Consequence: to satisfy requirement #3 ("all worlds"), quests cannot simply be
authored into one world — they must be **seeded** into each world.

## Architecture

Three cooperating pieces:

```
kubejs/
  data/ftbquests_master/          <- git-tracked master copy of all quest data
    quests/
      data.snbt                   <- file-level settings (progression mode, etc.)
      chapter_groups.snbt         <- chapter group definitions
      chapters/<chapter>.snbt     <- one file per chapter (modular, expandable)
      reward_tables/<table>.snbt  <- loot/XP reward tables
    TEMPLATE.snbt                 <- copy-paste skeleton for a new chapter
    README.md                     <- how to add chapters + sync back from in-game editor
  server_scripts/
    ftbquests_seed.js             <- copies master -> world on load if world has no quests
    ftbquests_day_spine.js        <- grants day_* stages as world-days pass
```

### 1. Master quest data (source of truth)

All quest `.snbt` lives under `kubejs/data/ftbquests_master/quests/` (git-tracked,
since `kubejs/` is tracked but `saves/` is git-ignored). This is the authoritative
copy. The in-game world copy is disposable/regenerable.

Standard FTB Quests file layout:
- `data.snbt` — quest file settings (default reward team, progression mode, etc.).
- `chapter_groups.snbt` — ordered chapter groups (used to organize the chapter list).
- `chapters/*.snbt` — one chapter per file. **This is the expandability unit.**
- `reward_tables/*.snbt` — reusable reward tables referenced by quests.

### 2. Seed script — `ftbquests_seed.js`

On server load (`ServerEvents.loaded`):
1. Resolve world quests dir: `<world>/ftbquests/quests/`.
2. If it does not exist OR contains no `chapters/`, copy the entire master
   `quests/` tree into it (Java NIO `Files.copy`, recursive, via KubeJS `java()`).
3. If anything was copied, run `/ftbquests reload` so quests appear without a relog.

Timing note: FTB Quests loads its quest file during the server-start lifecycle,
*before* `ServerEvents.loaded`. On a brand-new world the first load finds nothing,
then this script seeds + reloads in the same session — so quests are visible on
first entry. On every subsequent start the files already exist and load normally.

Re-seed policy: seed only when world quests are absent/empty, so player edits and
progress in an established world are never clobbered. (To force a refresh, delete
the world's `ftbquests/quests/chapters/` and rejoin, or use the manual sync step.)

### 3. Day-spine script — `ftbquests_day_spine.js`

FTB Quests has no native "survive/reach day N" task. Instead we use **FTB stages**:
- On a server tick interval, compute the world day (`overworld.dayTime / 24000`).
- When the day crosses a milestone (10, 25, 50, 100), grant the corresponding
  stage (`day_10`, `day_25`, `day_50`, `day_100`) to every team.
- Quests/chapters that belong to a later era declare a **stage task** (or
  visibility/dependency on the stage) so they unlock as days pass.

Stages are idempotent flags — re-granting is a no-op, so the tick check is safe.

## Chapter Plan (initial build)

Organized **by mod/theme**, with the day-spine gating *when* later chapters open.

| Chapter (file) | Covers | Day gate |
|---|---|---|
| `getting_started.snbt` | onboarding, JEI, waystones, backpack basics | none (day 0) |
| `combat_and_gear.snbt` | Spartan Weaponry, Apothic Attributes/Enchanting, Advanced Netherite | none |
| `artifacts_and_relics.snbt` | Artifacts, Relics, Curios slots | day_10 |
| `exploration.snbt` | YUNG structures, Repurposed Structures, Towns & Towers, Explorify | day_10 |
| `magic_and_curios.snbt` | Enigmatic Legacy Plus, Curios, Apothic Enchanting deep cuts | day_25 |
| `minecolonies.snbt` | colony founding → town hall → builders → growth | day_25 |
| `cataclysm.snbt` | L_Ender's Cataclysm bosses + Reliquified rewards | day_50 |
| `chaos_and_bosses.snbt` | Born in Chaos, Block Factory's Bosses | day_50 |
| `endgame.snbt` | capstone goals, day_100 trophy | day_100 |

Each chapter is an independent dependency tree: early quests (obtain/craft basic
items) unlock mid quests (advanced gear, sub-structures), which unlock the
chapter's capstone (boss kill / colony milestone). Capstones grant reward tables.

Rewards: per-chapter reward tables in `reward_tables/` (common loot for routine
quests, rare loot for capstones, XP rewards throughout).

This is the **first build**. Remaining mods (Goblin Traders, Construction Wands,
TreeChop, Supplementaries, etc.) get added later as new `chapters/*.snbt` files —
no framework changes needed.

## Expandability Workflow

To add a chapter later:
1. Copy `kubejs/data/ftbquests_master/TEMPLATE.snbt` to
   `chapters/<new>.snbt`, give it a fresh quest-object id, fill in tasks/rewards.
2. (Optional) add it to a group in `chapter_groups.snbt` and gate with a `day_*`
   stage task.
3. Commit. New + existing worlds pick it up (existing worlds: delete their
   `chapters/` and rejoin, or merge manually — documented in README).

To capture edits made with the **in-game FTB Quests editor**: the editor writes to
`<world>/ftbquests/quests/`. Copy that tree back over `ftbquests_master/quests/`
and commit. README documents this round-trip.

## Error Handling

- Seed script wraps file IO in try/catch; on failure it logs and leaves the world
  untouched (never partially copies over existing data).
- Seed is gated on "world has no chapters" to avoid clobbering progress/edits.
- Day-spine guards milestones so stages are granted once and re-grants no-op.
- All `.snbt` validated by loading in-game (`/ftbquests reload`) during testing.

## Testing

- New world: confirm chapters appear on first join, day_0 chapters open.
- Existing world (no quests): confirm seed + reload makes them appear.
- Progression: use `/time set` to roll days and confirm `day_*` stages grant and
  gated chapters unlock.
- Quest completion: obtain a tracked item / kill a tracked boss, confirm task
  completes and reward table delivers.
- Expandability: drop a new chapter file, confirm it loads.

## Out of Scope (first build)

- Exhaustive coverage of all ~110 mods (incremental afterward).
- Custom quest textures/icons beyond item icons.
- Translation/localization files (English inline first).
```
