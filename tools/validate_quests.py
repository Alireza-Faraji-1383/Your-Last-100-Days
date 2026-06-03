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
