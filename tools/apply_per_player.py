"""Mark every quest in the given FTB Quests chapters as per-player.

Adds `mqt_per_player: true` to each quest object, and
`mqt_exclusivity_scope: "PER_ACTOR"` to quests that use FTB's N-of-M
dependency gates (`min_required_dependencies` / `dependency_requirement`)
so those gates count the acting player's own completions instead of the
whole team's. Keys are inserted in alphabetical order to match the layout
FTB Quests writes back on save.
"""

import re
import sys

KEY_RE = re.compile(r"^\t\t\t([a-z_0-9]+):")
GATE_KEYS = {"min_required_dependencies", "dependency_requirement"}


def quest_spans(bare):
    """Yield (start, end) line indices of each quest object in `quests: [`."""
    try:
        start = bare.index("\tquests: [")
    except ValueError:
        return
    i = start + 1
    while i < len(bare):
        if bare[i] == "\t]":
            return
        if bare[i] == "\t\t{":
            j = i + 1
            while bare[j] != "\t\t}":
                j += 1
            yield i, j
            i = j + 1
        else:
            i += 1


def patch(path):
    with open(path, encoding="utf-8", newline="") as f:
        lines = f.readlines()
    eol = "\r\n" if lines and lines[0].endswith("\r\n") else "\n"
    bare = [line.rstrip("\r\n") for line in lines]

    edits = []  # (insert_at, text) collected before mutating
    for start, end in quest_spans(bare):
        keys = [
            (idx, KEY_RE.match(bare[idx]).group(1))
            for idx in range(start + 1, end)
            if KEY_RE.match(bare[idx])
        ]
        existing = {k for _, k in keys}
        additions = []
        if "mqt_per_player" not in existing:
            additions.append("mqt_per_player: true")
        if "mqt_exclusivity_scope" not in existing and existing & GATE_KEYS:
            additions.append('mqt_exclusivity_scope: "PER_ACTOR"')

        for addition in additions:
            name = addition.split(":", 1)[0]
            at = next((idx for idx, k in keys if k > name), end)
            edits.append((at, "\t\t\t%s%s" % (addition, eol)))
            keys.append((at, name))
            keys.sort()

    for at, text in sorted(edits, reverse=True):
        lines.insert(at, text)

    with open(path, "w", encoding="utf-8", newline="") as f:
        f.writelines(lines)
    return len(edits)


if __name__ == "__main__":
    for target in sys.argv[1:]:
        print("%s: %d line(s) added" % (target, patch(target)))
