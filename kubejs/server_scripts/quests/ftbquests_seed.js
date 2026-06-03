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
        if (!Files.isDirectory(chapters)) return true;
        var s = Files.list(chapters);   // stream must be closed (Windows holds a dir handle otherwise)
        try { return !s.findAny().isPresent(); }
        catch (e) { return true; }
        finally { try { s.close(); } catch (e2) {} }
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
