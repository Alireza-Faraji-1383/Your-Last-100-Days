#!/usr/bin/env python3
"""Seed the pack's FTB Quests into world saves.

FTB Quests reads quest definitions only from <world>/ftbquests/quests/, and KubeJS
scripts are sandboxed away from file IO (java.nio/java.io denied by the class
filter), so the copy is done here, outside the game.

Copies the git-tracked master (kubejs/data/ftbquests_master/quests/) into a world's
ftbquests/quests/ when that world has no chapters yet — never clobbering an
established world's edits/progress.

Usage (run from anywhere; paths resolve relative to this file's instance root):
  python tools/seed_world.py --all            # every world under saves/ missing quests
  python tools/seed_world.py "saves/New World"  # one specific world dir
  python tools/seed_world.py --all --force     # re-copy even if chapters exist (overwrites defs)

Intended to run automatically via a PrismLauncher pre-launch command:
  "$INST_JAVA" is not needed — set the pre-launch command to:
    python "$INST_MC_DIR/tools/seed_world.py" --all
"""
import sys, shutil, pathlib

INSTANCE_ROOT = pathlib.Path(__file__).resolve().parent.parent
MASTER = INSTANCE_ROOT / "kubejs" / "data" / "ftbquests_master" / "quests"
SAVES = INSTANCE_ROOT / "saves"


def has_chapters(dest):
    chapters = dest / "chapters"
    return chapters.is_dir() and any(chapters.glob("*.snbt"))


def seed_world(world_dir, force=False):
    """Copy master -> <world>/ftbquests/quests/. Returns 'seeded' | 'skipped' | 'error'."""
    dest = world_dir / "ftbquests" / "quests"
    if not force and has_chapters(dest):
        print(f"  skip  {world_dir.name}: already has quests")
        return "skipped"
    try:
        dest.mkdir(parents=True, exist_ok=True)
        count = 0
        for src in MASTER.rglob("*"):
            rel = src.relative_to(MASTER)
            target = dest / rel
            if src.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, target)
                count += 1
        print(f"  seed  {world_dir.name}: copied {count} file(s) -> {dest}")
        return "seeded"
    except Exception as e:
        print(f"  ERROR {world_dir.name}: {e}")
        return "error"


def main(argv):
    if not MASTER.is_dir():
        print(f"master quests not found at {MASTER}")
        return 1
    force = "--force" in argv
    args = [a for a in argv if a != "--force"]

    if "--all" in args:
        if not SAVES.is_dir():
            print(f"no saves dir at {SAVES}")
            return 0
        worlds = [d for d in sorted(SAVES.iterdir())
                  if d.is_dir() and (d / "level.dat").exists()]
        if not worlds:
            print("no worlds found under saves/")
            return 0
        print(f"seeding {len(worlds)} world(s):")
        results = [seed_world(w, force) for w in worlds]
        return 1 if "error" in results else 0

    targets = [a for a in args if not a.startswith("--")]
    if not targets:
        print(__doc__)
        return 2
    rc = 0
    for t in targets:
        wd = pathlib.Path(t)
        if not wd.is_absolute():
            wd = INSTANCE_ROOT / wd
        if not wd.is_dir():
            print(f"  ERROR: not a directory: {wd}")
            rc = 1
            continue
        if seed_world(wd, force) == "error":
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
