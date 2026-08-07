"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const scriptPath = path.join(
    __dirname,
    "..",
    "kubejs",
    "server_scripts",
    "raids",
    "raid_time_rewind.js"
);

function loadScript(playerDays) {
    let recipeCallback = null;
    let usedItemId = null;
    let useCallback = null;

    const scope = {
        PlayerDays: playerDays,
        ServerEvents: {
            recipes(callback) { recipeCallback = callback; }
        },
        ItemEvents: {
            rightClicked(itemId, callback) {
                usedItemId = itemId;
                useCallback = callback;
            }
        },
        Text: { of(message) { return message; } },
        console
    };

    vm.runInNewContext(fs.readFileSync(scriptPath, "utf8"), scope, { filename: scriptPath });
    return { recipeCallback, usedItemId, useCallback };
}

function captureRecipe(callback) {
    let captured = null;
    callback({
        shaped(output, pattern, keys) { captured = { output, pattern, keys }; }
    });
    return captured;
}

function useItem(handler, playerDays, currentDays) {
    const item = { count: 1 };
    const player = { messages: [], tell(message) { this.messages.push(message); } };
    const server = {};
    let savedDays = null;

    playerDays.get = () => currentDays;
    playerDays.uuidOf = () => "test-player";
    playerDays.set = (_server, _uuid, days) => {
        savedDays = days;
        return true;
    };

    handler({ server, player, item });
    return { item, player, savedDays };
}

const api = {};
const registered = loadScript(api);

assert.equal(registered.usedItemId, "kubejs:raid_time_rewind");
assert.deepEqual(captureRecipe(registered.recipeCallback), {
    output: "kubejs:raid_time_rewind",
    pattern: ["DDD", "DED", "DDD"],
    keys: { D: "minecraft:diamond", E: "minecraft:ender_pearl" }
});

const normalUse = useItem(registered.useCallback, api, 27);
assert.equal(normalUse.savedDays, 17, "rewinds ten days when enough progress exists");
assert.equal(normalUse.item.count, 0, "consumes the item after a successful save");

const clampedUse = useItem(registered.useCallback, api, 7);
assert.equal(clampedUse.savedDays, 0, "clamps personal raid days at zero");

const failedApi = {
    get() { return 27; },
    uuidOf() { return "test-player"; },
    set() { return false; }
};
const failedRegistered = loadScript(failedApi);
const failedItem = { count: 1 };
failedRegistered.useCallback({ server: {}, player: { tell() {} }, item: failedItem });
assert.equal(failedItem.count, 1, "does not consume the item when the progress save fails");

console.log("raid_time_rewind.test.js: PASS");
