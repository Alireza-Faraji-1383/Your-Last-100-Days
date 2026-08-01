# Raid Factory — Design Spec

**Date:** 2026-06-02
**Target:** KubeJS 1.21.1 NeoForge modpack
**Depends on:** `kubejs/server_scripts/factories/enhancedai_factory.js` (EnhancedAI global, priority 100)

## Goal

A modular, professional raid system. Each raid has ordered rounds; each round has mob
groups (type + count + AI presets). Rounds run strictly sequentially — never overlap.
Mobs are attracted to the target player even at distance. No lose condition: the player
wins by completing all rounds (all mobs of all rounds dead).

## Decisions (from brainstorming)

- **Triggers:** Command (`/raid`) + Auto/event. Both sit on a shared JS API core.
- **Raid definition:** Fluent builder (`Raid("id").round(...).mob(...).build()`).
- **Round end:** All mobs dead → breather delay → next round. OR per-round max timer
  elapses → force-advance early.
- **Timer force-end survivors:** carry into next round (must still die for the win).
- **Spawn location:** ring around the target player (configurable min/max radius), follows
  the player.
- **Players:** single target player per raid.
- **Win:** `onWin(ctx)` callback in the raid def (plus optional `onStart`/`onRoundStart`/
  `onRoundEnd` lifecycle hooks). Modular — user drops in loot/commands/advancements.
- **Player death/disconnect:** raid keeps running; mobs persist and re-aggro when player
  returns. No pause, no loss.

## File Layout

| File | priority | Role |
|------|----------|------|
| `server_scripts/raids/raid_core.js` | 90 | Engine: Builder + Registry + Spawner + Instance + Manager + tick driver. Exports `global.Raid`, `global.RaidManager`, `global.RAIDS`. |
| `server_scripts/raids/raid_commands.js` | 80 | `/raid` command tree. |
| `server_scripts/raids/raid_definitions.js` | 70 | Sample raids (fluent builder) + sample auto/event trigger. User-editable. |

Priority < 100 guarantees load after `enhancedai_factory.js`, so the `EnhancedAI` global
is ready. Core is a single file because KubeJS scripts share state only via globals;
internally it is split into clear sub-modules, matching the EAI factory's style.

## Components

Each has one responsibility, communicates through a defined interface.

### 1. RaidBuilder
`Raid(id)` returns a fluent builder; `.build()` validates and auto-registers a `RaidDef`.

Builder state machine:
- `.round(name)` opens a new round (appends to rounds list).
- `.mob(type)` opens a new mob group in the current round.
- `.count(n)` / `.presets(...names)` / `.extraArgs(...strs)` / `.noDefaults()` mutate the
  current mob group.
- Raid-level methods valid any time: `.spawn(minR, maxR)`, `.defaultPresets(...names)`,
  `.onStart(fn)`, `.onRoundStart(fn)`, `.onRoundEnd(fn)`, `.onWin(fn)`.
- Round-level: `.breather(ticks)`, `.timeLimit(ticks)` apply to the current round.

Validation in `build()`: rounds non-empty; each mob has a `type` with `:` and `count >= 1`;
named presets exist in `EnhancedAI.presets`. Failures are logged via `console.warn` and the
def is skipped — never throws/crashes the script load.

### 2. RaidRegistry (`RAIDS`)
Map of `id -> RaidDef`. API: `get(id)`, `has(id)`, `list()`, `register(def)`. Rebuilt on
script reload (active instances are not persisted across reloads — acceptable).

### 3. RaidDef (data shape)
```
{
  id: string,
  spawn: { minRadius: number, maxRadius: number },   // default 20 / 40
  defaultPresets: string[],
  rounds: [
    {
      name: string,
      breather: number,        // ticks after all-dead before next round; default e.g. 60
      timeLimit: number|null,  // ticks; null = no force-advance
      mobs: [
        { type: string, count: number, presets: string[], extraArgs: string[], noDefaults: bool }
      ]
    }
  ],
  callbacks: { onStart, onRoundStart, onRoundEnd, onWin }   // any may be undefined
}
```
Effective preset args for a mob = (`noDefaults` ? [] : `defaultPresets`) + mob `presets`,
resolved via `EnhancedAI.resolveArgs(presetNames, extraArgs)`.

### 4. MobSpawner
`spawnRound(level, player, round, instanceId)` -> array of spawned entity refs.

Per mob group, per count:
1. Pick a ring position: random angle, radius in `[minRadius, maxRadius]` around the
   player; find ground Y by scanning down from `player.y + 3` for a solid block with 2 air
   above (fallback to player.y).
2. `entity = EnhancedAI.fromPresets(level, type, presetNames, extraArgs)`.
3. `entity.setPos(x, y, z)`; `entity.addTag("raid_mob")`; `entity.addTag("raid_" + instanceId)`;
   `entity.setPersistenceRequired()`; optional `setCustomName("[" + roundName + "]")`.
4. `entity.spawn()`.
5. `EnhancedAI.applyDeferred(level, entity, EnhancedAI.resolveArgs(presetNames, extraArgs))`.
6. `setTarget(player)` via `EnhancedAI.rawMob(entity)`.

Mirrors the proven spawn path in `enhancedai_factory_test.js`.

### 5. RaidInstance (state machine)
State: `id`, `defId`, `player`, `level`, `roundIdx`, `phase`, `tickCounter`,
`breatherLeft`, `roundTimeLeft`, `roundMobs` (live set, current round), `carryover` (live
set, timed-out survivors).

Phases: `SPAWNING -> FIGHTING -> BREATHER -> (next) ... -> WIN_WAIT -> DONE`.

`tick()` (called by manager on a throttle, e.g. every 5 ticks):
- **SPAWNING:** `startRound(roundIdx)` — spawn via MobSpawner into `roundMobs`, fire
  `onRoundStart`, set `roundTimeLeft = round.timeLimit`, phase = FIGHTING.
- **FIGHTING:**
  - Prune dead refs from `roundMobs` and `carryover` (filter `isAlive()`).
  - Re-aggro: for each live mob, `setTarget(player)` if player present (forces attraction
    regardless of distance; `farSight` preset supplies the sightline).
  - If `roundMobs` empty (all dead): fire `onRoundEnd`; if more rounds → phase = BREATHER,
    `breatherLeft = round.breather`; else → phase = WIN_WAIT.
  - Else if `roundTimeLeft` set and `<= 0`: move `roundMobs` into `carryover`; fire
    `onRoundEnd`; if more rounds → `roundIdx++`, phase = SPAWNING (no breather); else →
    phase = WIN_WAIT. Decrement `roundTimeLeft` by throttle each tick otherwise.
- **BREATHER:** decrement `breatherLeft`; when `<= 0` → `roundIdx++`, phase = SPAWNING.
- **WIN_WAIT:** prune dead + re-aggro; when `roundMobs` + `carryover` both empty → fire
  `onWin`, phase = DONE.
- **DONE:** manager removes the instance.

Rounds never overlap: a new round only spawns at BREATHER end or timer force-advance.

`ctx` passed to callbacks: `{ player, level, raid: RaidDef, instance: RaidInstance }`.

### 6. RaidManager
Owns active instances keyed by instance id. Driven by `ServerEvents.tick` with an internal
throttle (default every 5 ticks).
- `start(level, player, defId)` -> instance id (or null if unknown def / player already in
  a raid).
- `stop(instanceId | player)` — fire nothing, kill all `raid_<id>` tagged mobs, remove
  instance.
- `stopAll()`.
- `getActive()` / `status()` — list of `{ id, defId, round: "X/Y", phase, alive }`.

One active raid per player (start refuses if the player already has one).

## Commands (maximum op permission level 4)

- `/raid start <id>` — start at the executing player.
- `/raid start <id> <player>` — start targeting a named player.
- `/raid stop` — stop the executing player's raid, clean its mobs.
- `/raid stopall` — stop every active raid.
- `/raid list` — list registered raid ids.
- `/raid status` — list active raids with round/phase/alive count.

Built with `ServerEvents.commandRegistry`, mirroring the arg/safeExec patterns in
`enhancedai_factory_test.js`.

## Auto / Event Triggers

The manager's `start()` API is the trigger primitive. `raid_definitions.js` ships a
commented sample showing an event-driven trigger (e.g. on a player entering an area /
advancement / first-time condition) calling `RaidManager.start(level, player, "id")` with a
guard flag so it fires once.

## EAI Integration

Reuses the EAI factory verbatim through `fromPresets` / `resolveArgs` / `applyDeferred` /
`rawMob`. Far-aggro = `farSight` default preset (follow_range=100) + per-tick `setTarget`
loop. New preset names can be added to the EAI factory `PRESETS` if a raid needs them; the
raid layer only references preset names + raw extra-arg strings.

## Constraints / Conventions

- **Rhino-safe:** `var` only inside re-entrant functions, indexed `for` loops, IIFE module
  pattern (per `feedback_rhino_quirks`: `const`/`let` in `try{}` blows up on 2nd call).
- Top-level module constants may use `const`.
- No crashes on bad input — log via `console.warn`/`console.error`, degrade gracefully.
- Match the EAI factory's section-comment style and naming.

## Out of Scope (YAGNI)

- Multiplayer / multi-player raids.
- Pause-resume on death/disconnect.
- Persisting active raids across server restart or script reload.
- Block/item triggers (API supports them; no built-in block shipped).
- Boss bars / scoreboard UI (can be added later via callbacks).

## Testing

- `/raid list` shows sample raids after load (validation passed).
- `/raid start <sample>` spawns round 1 in a ring; mobs aggro the player from across the map.
- Kill round 1 → breather → round 2 spawns (never simultaneously).
- A round with `timeLimit` left uncleared force-advances; survivors persist into the next
  round.
- Complete all rounds → `onWin` fires once.
- `/raid status` reflects round/phase/alive throughout. `/raid stop` cleans all raid mobs.
- Reuses the EAI test mob spawn path, already verified by `enhancedai_factory_test.js`.
