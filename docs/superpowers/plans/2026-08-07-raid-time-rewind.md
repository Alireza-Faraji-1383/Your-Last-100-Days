# Raid Time Rewind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a craftable single-use item that reduces the using player's personal raid day by ten, stopping at zero.

**Architecture:** Register the item in the existing KubeJS startup registry. A focused raid server script provides the recipe and right-click handler, delegating state persistence to the existing `PlayerDays` API.

**Tech Stack:** KubeJS 1.21.1 JavaScript, Rhino, Minecraft item events, Node.js test harness.

## Global Constraints

- Item id is exactly `kubejs:raid_time_rewind`.
- Recipe is eight `minecraft:diamond` around one central `minecraft:ender_pearl`.
- Right-click changes `D` to `max(0, D - 10)` for the using player only.
- The item is not consumed if `PlayerDays` is unavailable or persistence fails.
- Do not modify world time or scheduled-raid completion flags.

---

## File structure

- Modify: `kubejs/startup_scripts/main.js` — register the custom item.
- Create: `kubejs/server_scripts/raids/raid_time_rewind.js` — recipe and use logic.
- Create: `tests/raid_time_rewind.test.js` — stubs KubeJS globals and asserts observable behavior.

### Task 1: Specify the server script behavior

**Files:**
- Create: `tests/raid_time_rewind.test.js`

**Interfaces:**
- Consumes: KubeJS globals `ServerEvents`, `ItemEvents`, `PlayerDays`, `Text`.
- Produces: captured recipe and right-click callbacks for the production script.

- [ ] **Step 1: Write the failing test**

```js
assert.deepEqual(shapedRecipe, {
  output: 'kubejs:raid_time_rewind',
  pattern: ['DDD', 'DED', 'DDD'],
  keys: { D: 'minecraft:diamond', E: 'minecraft:ender_pearl' }
});
assert.equal(useWithDays(27).days, 17);
assert.equal(useWithDays(7).days, 0);
assert.equal(useWithUnavailableApi().item.count, 1);
assert.equal(useWithFailedSave().item.count, 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/raid_time_rewind.test.js`

Expected: FAIL because `kubejs/server_scripts/raids/raid_time_rewind.js` does not yet exist.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/raid_time_rewind.test.js
git commit -m "test: define raid time rewind behavior"
```

### Task 2: Register and implement Raid Time Rewind

**Files:**
- Modify: `kubejs/startup_scripts/main.js`
- Create: `kubejs/server_scripts/raids/raid_time_rewind.js`
- Test: `tests/raid_time_rewind.test.js`

**Interfaces:**
- Consumes: `PlayerDays.get(server, uuid) -> number`, `PlayerDays.uuidOf(player) -> string`, and `PlayerDays.set(server, uuid, days) -> boolean`.
- Produces: `kubejs:raid_time_rewind`, its 3x3 recipe, and an item right-click event handler.

- [ ] **Step 1: Add minimal item registration**

```js
event.create('raid_time_rewind')
  .displayName('Raid Time Rewind')
  .tooltip('Right-click to rewind your personal raid day by 10.');
```

- [ ] **Step 2: Add the server script**

```js
ServerEvents.recipes(function (event) {
  event.shaped('kubejs:raid_time_rewind', ['DDD', 'DED', 'DDD'], {
    D: 'minecraft:diamond', E: 'minecraft:ender_pearl'
  });
});

ItemEvents.rightClicked('kubejs:raid_time_rewind', function (event) {
  var days = (typeof PlayerDays !== 'undefined') ? PlayerDays : null;
  if (!days) return event.player.tell(Text.of('§cRaid progress is not ready.'));
  var uuid = days.uuidOf(event.player);
  var next = Math.max(0, days.get(event.server, uuid) - 10);
  if (!days.set(event.server, uuid, next)) return event.player.tell(Text.of('§cCould not save raid progress.'));
  event.item.count--;
  event.player.tell(Text.of('§aPersonal raid day rewound to ' + next + '.'));
});
```

- [ ] **Step 3: Run the behavior test to verify it passes**

Run: `node tests/raid_time_rewind.test.js`

Expected: PASS for recipe, normal rewind, zero floor, missing API, and failed persistence.

- [ ] **Step 4: Syntax-check changed KubeJS files**

Run: `node --check kubejs/startup_scripts/main.js; node --check kubejs/server_scripts/raids/raid_time_rewind.js`

Expected: both commands exit 0.

- [ ] **Step 5: Commit the implementation**

```bash
git add kubejs/startup_scripts/main.js kubejs/server_scripts/raids/raid_time_rewind.js tests/raid_time_rewind.test.js
git commit -m "feat: add raid time rewind item"
```

## Self-review

- Spec coverage: Task 2 implements the fixed id, recipe, zero-clamped rewind, safe failed-save handling, and preserves time and raid-completion data.
- Placeholder scan: no incomplete steps remain.
- Interface consistency: all `PlayerDays` methods and parameter order match `player_days.js`.
