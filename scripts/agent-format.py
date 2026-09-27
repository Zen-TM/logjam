#!/usr/bin/env python3
"""PostToolUse hook: format the file an agent just wrote.

Claude Code (.claude/settings.json) and Antigravity (.agents/hooks.json) pass
the tool call as JSON on stdin; a path given as the first argument also works.
Uses the repo's pinned Biome (root node_modules) and Ruff on PATH. When either
is missing it does nothing: the pre-commit hook and CI's format check still
catch the file, and a hook that fails would interrupt the agent's edit.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BIOME = REPO / "node_modules" / ".bin" / "biome"
BIOME_SUFFIXES = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".jsonc",
    ".css",
}


def edited_path() -> str | None:
    if len(sys.argv) > 1:
        return sys.argv[1]
    try:
        call = json.load(sys.stdin)
    except ValueError:
        return None
    claude = call.get("tool_input", {})
    antigravity = call.get("toolCall", {}).get("args", {})
    return (
        claude.get("file_path")
        or antigravity.get("TargetFile")
        or antigravity.get("AbsolutePath")
        or antigravity.get("path")
    )


def main() -> None:
    path = edited_path()
    if not path or not Path(path).is_file():
        return
    suffix = Path(path).suffix.lower()
    if suffix == ".py" and shutil.which("ruff"):
        subprocess.run(["ruff", "format", path], capture_output=True, cwd=REPO)
    elif suffix in BIOME_SUFFIXES and BIOME.exists():
        subprocess.run(
            [str(BIOME), "format", "--write", "--no-errors-on-unmatched", path],
            capture_output=True,
            cwd=REPO,
        )


if __name__ == "__main__":
    main()
