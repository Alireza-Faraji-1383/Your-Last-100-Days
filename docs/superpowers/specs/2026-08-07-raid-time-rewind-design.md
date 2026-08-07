# Raid Time Rewind design

## Purpose

Give a player whose personal raid progression is too far ahead a craftable
single-use item that moves only that player's raid day counter back by ten
days.  It must not change the overworld time or any other player's progress.

## Player experience

- The item is named `Raid Time Rewind` (`kubejs:raid_time_rewind`).
- Its shaped 3x3 recipe is eight `minecraft:diamond` surrounding one
  `minecraft:ender_pearl`.
- Right-clicking the item consumes one copy and changes the user's personal
  play-day count from `D` to `max(0, D - 10)`.
- The user is told the resulting personal day.  The item is not consumed if
  the player-day system is unavailable or its state cannot be saved.

## Architecture

- A startup script registers the custom item and its display text/tooltip.
- A server script in `kubejs/server_scripts/raids/` owns the recipe and the
  right-click handler.
- The handler uses the existing `PlayerDays.get` and `PlayerDays.set` API.
  This preserves the existing persistent-store format and resets the stored
  world-day checkpoint as `PlayerDays.set` already does.

## Constraints and edge cases

- Progress never becomes negative: a player with fewer than ten days is set
  to zero.
- It affects only the player who used it.
- It must not alter completed-raid flags; it merely gives the scheduler more
  time before future personal-day raid thresholds.
- The recipe must be defined server-side so it is available after `/reload`.

## Verification

- Syntax-check the changed JavaScript files.
- Confirm the registered item id, right-click handler, and recipe ingredients
  by static inspection/search.
- In-game: craft the item, use it with personal days above ten and below ten,
  and confirm the counter becomes `D - 10` and `0` respectively.
