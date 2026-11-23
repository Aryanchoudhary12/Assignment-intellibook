#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$root"

usage() {
  cat <<'USAGE'
Usage: ./start-clausebook.sh [--docker | --native]

Run from the Clausebook source directory. The default uses Docker Compose
when available and falls back to a native start. Set the Atlas DATABASE_URL
and your Clerk and OpenRouter keys in the same .env file.

Docker mode starts the app in the background and connects it to Atlas.
Native mode needs Node.js 24 and pnpm. An existing loopback DATABASE_URL
selects local MongoDB in either mode.
Use MONGOD_BIN to point to a MongoDB binary outside PATH.
USAGE
}

die() { printf '%s\n' "$*" >&2; exit 1; }
mode=auto
case "${1:-}" in
  "") ;;
  --docker) mode=docker ;;
  --native) mode=native ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { usage >&2; exit 2; }
[[ -f package.json && -f compose.yaml && -f .env.example ]] ||
  die "Put this script beside package.json and compose.yaml in the Clausebook source directory."

if [[ ! -f .env ]]; then
  (umask 077; set -o noclobber; cat .env.example > .env) ||
    die "Could not create .env. Check the source directory's permissions."
  printf 'Created %s/.env\nFill in the Atlas DATABASE_URL and your Clerk and OpenRouter keys, then run this script again.\n' "$root"
  exit 0
fi
missing="$(awk '
  BEGIN { split("CLERK_PUBLISHABLE_KEY CLERK_JWT_KEY OPENROUTER_API_KEY DATABASE_URL", required, " ") }
  /^[[:space:]]*(export[[:space:]]+)?[A-Z_]+[[:space:]]*=/ {
    key = $0
    sub(/^[[:space:]]*(export[[:space:]]+)?/, "", key)
    sub(/[[:space:]]*=.*/, "", key)
    value = substr($0, index($0, "=") + 1)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
    present[key] = (value != "" && value != "\"\"" && value != "\047\047" && value !~ /^#/)
  }
  END { for (i = 1; i <= 4; i++) if (!present[required[i]]) print required[i] }
' .env)"
[[ -z "$missing" ]] || die "Fill in these values in $root/.env and run again:
$missing"

if [[ "$mode" == auto ]]; then
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    mode=docker
  else
    mode=native
  fi
fi

if [[ "$mode" == docker ]]; then
  command -v docker >/dev/null && docker compose version >/dev/null 2>&1 ||
    die "Docker Engine and Docker Compose are required for --docker."
  docker info >/dev/null 2>&1 || die "Start Docker Engine and run this script again."
  endpoint="${DOCKER_HOST:-}"
  if [[ -z "$endpoint" ]]; then
    endpoint="$(docker context inspect --format '{{.Endpoints.docker.Host}}')" ||
      die "Could not identify the Docker Engine for this context."
  fi
  [[ "$endpoint" == unix://* ]] || die "Use a local Docker Engine for this launcher."
  compose=(docker compose --project-name clausebook --file compose.yaml)
  if awk '
    /^[[:space:]]*(export[[:space:]]+)?DATABASE_URL[[:space:]]*=/ {
      value = substr($0, index($0, "=") + 1)
      local_url = value ~ /^[[:space:]\"\047]*mongodb:\/\/(localhost|127[.]0[.]0[.]1)(:|\/)/
    }
    END { exit !local_url }
  ' .env; then
    compose+=(--file compose.local.yaml)
  fi
  "${compose[@]}" up --build --detach --wait
  ready=false
  for ((attempt = 0; attempt < 40; attempt++)); do
    if "${compose[@]}" exec -T app node -e       'fetch("http://127.0.0.1:3000/config", {signal: AbortSignal.timeout(1000)}).then(response => { if (!response.ok) process.exitCode = 1; }).catch(() => { process.exitCode = 1; })' >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 1
  done
  [[ "$ready" == true ]] || die "Clausebook did not become ready. Check docker compose --project-name clausebook logs app."
  printf 'Clausebook is ready at http://localhost:3000/\n'
  exit 0
fi

command -v node >/dev/null && [[ "$(node -p 'process.versions.node.split(".")[0]')" == 24 ]] ||
  die "Native mode requires Node.js 24. Use --docker if you prefer Docker Compose."
command -v pnpm >/dev/null || die "Install the project's pnpm version from package.json for native mode."

settings="$(node --env-file=.env --input-type=module <<'JS'
const origin = new URL(process.env.APP_ORIGIN || "http://localhost:3000");
if (origin.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(origin.hostname) ||
    origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
  console.error("APP_ORIGIN must be an HTTP loopback URL in native mode.");
  process.exit(1);
}
console.log(origin.origin);
console.log(origin.hostname);
console.log(origin.port || "80");
const local = /^mongodb:\/\/(?:localhost|127\.0\.0\.1)(?::(\d+))?\/[^/?]*(?:\?([^#]*))?$/.exec(process.env.DATABASE_URL || "");
if (local) {
  const port = Number(local[1] || "27017");
  const replica = new URLSearchParams(local[2]).get("replicaSet");
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[A-Za-z0-9_-]{1,64}$/.test(replica || "")) {
    console.error("A local DATABASE_URL needs a valid port and replicaSet parameter.");
    process.exit(1);
  }
  console.log(port);
  console.log(replica);
}
JS
)" || die "Check the local environment settings."
mapfile -t config <<< "$settings"
origin="${config[0]}"
app_host="${config[1]}"
app_port="${config[2]}"

if CLAUSEBOOK_CHECK_URL="$origin" node --input-type=module <<'JS'
try {
  const response = await fetch(process.env.CLAUSEBOOK_CHECK_URL + "/config", {signal: AbortSignal.timeout(700)});
  const body = await response.json();
  process.exit(response.ok && typeof body.publishableKey === "string" && typeof body.clerkDomain === "string" ? 0 : 1);
} catch { process.exit(1); }
JS
then
  printf 'Clausebook is already running at %s/\n' "$origin"
  exit 0
fi

export NEXT_TELEMETRY_DISABLED=1
pnpm install --frozen-lockfile
pnpm generate

mongo_pid=
app_pid=
cleanup() {
  if [[ -n "$app_pid" ]]; then kill "$app_pid" 2>/dev/null || true; wait "$app_pid" 2>/dev/null || true; fi
  if [[ -n "$mongo_pid" ]]; then kill "$mongo_pid" 2>/dev/null || true; wait "$mongo_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mongo_status=0
if [[ ${#config[@]} -eq 5 ]]; then
  node scripts/init-mongo.mjs "${config[3]}" "${config[4]}" --probe || mongo_status=$?
  [[ "$mongo_status" != 2 ]] ||
    die "MongoDB is reachable but its configured replica set has no writable primary."
fi
if [[ "$mongo_status" == 1 ]]; then
  mongod="${MONGOD_BIN:-mongod}"
  command -v "$mongod" >/dev/null ||
    die "MongoDB is unavailable. Install mongod, set MONGOD_BIN, or use --docker."
  data="${CLAUSEBOOK_MONGO_DATA:-$root/.clausebook/mongo-${config[3]}}"
  mkdir -p -- "$data"
  "$mongod" --replSet "${config[4]}" --bind_ip 127.0.0.1 --port "${config[3]}" \
    --dbpath "$data" --logpath "$data/mongod.log" &
  mongo_pid=$!
  node scripts/init-mongo.mjs "${config[3]}" "${config[4]}"
fi

pnpm db:push
pnpm build
printf 'Starting Clausebook at %s/\n' "$origin"
node node_modules/next/dist/bin/next start --hostname "$app_host" --port "$app_port" &
app_pid=$!
wait "$app_pid"
