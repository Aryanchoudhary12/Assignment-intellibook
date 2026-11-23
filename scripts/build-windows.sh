#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$root"
output="${1:-$root/Clausebook-Start-win-x64.exe}"
if [[ "$output" != /* ]]; then output="$(pwd)/$output"; fi
[[ $# -le 1 ]] || { printf 'Usage: %s [output.exe]\n' "$0" >&2; exit 2; }
command -v go >/dev/null && command -v python3 >/dev/null ||
  { printf 'Go 1.24+ and Python 3 are required to build the launcher.\n' >&2; exit 1; }
payload="$root/launcher/windows/payload.zip"
if [[ -e "$payload" ]]; then
  printf 'Remove the existing launcher/windows/payload.zip before building.\n' >&2
  exit 1
fi
trap 'rm -f -- "$payload"' EXIT
python3 - "$payload" <<'PY'
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import sys

roots = [
    "app", "lib", "prisma", "public", "samples", "scripts/init-mongo.mjs", "tests",
    ".dockerignore", ".env.example", "Dockerfile", "README.md", "compose.yaml", "compose.local.yaml",
    "instrumentation.js", "next.config.mjs", "package.json", "pnpm-lock.yaml",
    "pnpm-workspace.yaml", "start-clausebook.sh",
]
with ZipFile(sys.argv[1], "x", compression=ZIP_DEFLATED) as archive:
    for name in roots:
        candidate = Path(name)
        entries = sorted(candidate.rglob("*")) if candidate.is_dir() else [candidate]
        for entry in entries:
            if entry.is_file() and not entry.is_symlink() and (
                entry == candidate or all(not part.startswith(".") for part in entry.parts)
            ):
                archive.write(entry, entry.as_posix())
PY
cd launcher/windows
go test ./...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$output" .
printf 'Created %s\n' "$output"
