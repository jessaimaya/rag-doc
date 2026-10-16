#!/usr/bin/env bash
# Starts the Mastra backend (:4111) and the Next.js frontend (:3000) together.
# Ctrl+C stops both. Usage: ./dev.sh   (override ports: BACKEND_PORT=4111 FRONTEND_PORT=3000 ./dev.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-4111}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

if [[ ! -f "$ROOT/.env" ]]; then
  echo "Missing .env — copy .env.example to .env and fill in the keys first." >&2
  exit 1
fi

# Retrieval needs Postgres. Warn early instead of letting the first question fail.
db_url="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
db_hostport="$(sed -E 's#^[a-z]+://[^@]*@([^/?]+).*#\1#' <<<"$db_url")"
db_host="${db_hostport%%:*}"; db_port="${db_hostport##*:}"; [[ "$db_port" == "$db_hostport" ]] && db_port=5432
if ! (exec 3<>"/dev/tcp/$db_host/$db_port") 2>/dev/null; then
  echo "WARNING: Postgres at $db_host:$db_port is not reachable, so answers will fail until it is up." >&2
  if [[ "$db_host" == "localhost" || "$db_host" == "127.0.0.1" ]] && command -v docker >/dev/null; then
    # `docker ps --filter publish=` ignores stopped containers, so read the configured port bindings instead.
    name="$(docker ps -aq | xargs -r docker inspect --format '{{.Name}} {{json .HostConfig.PortBindings}}' 2>/dev/null | grep "\"HostPort\":\"$db_port\"" | head -1 | awk '{print $1}' | tr -d /)"
    [[ -n "$name" ]] && echo "         It looks like the container \"$name\" publishes that port: docker start $name" >&2
  fi
fi

[[ -d "$ROOT/node_modules" ]] || (cd "$ROOT" && npm install)
[[ -d "$ROOT/frontend/node_modules" ]] || (cd "$ROOT/frontend" && npm install)

# Prefix each line of a process's output so the two logs are easy to tell apart.
prefix() { sed -u "s/^/[$1] /"; }

pids=()
cleanup() {
  trap - INT TERM EXIT
  echo; echo "Stopping…"
  # Negative pid = whole process group, so child node processes die too.
  for pid in "${pids[@]}"; do kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM HUP EXIT

# setsid gives each service its own process group so cleanup can kill the full tree.
cd "$ROOT"
NODE_ENV=development PORT="$BACKEND_PORT" setsid npm run dev > >(prefix back) 2>&1 &
pids+=($!)

echo "Waiting for backend on :$BACKEND_PORT…"
for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://localhost:$BACKEND_PORT" && break
  sleep 1
done

cd "$ROOT/frontend"
API_URL="http://localhost:$BACKEND_PORT" setsid npm run dev -- -p "$FRONTEND_PORT" > >(prefix front) 2>&1 &
pids+=($!)

echo "Backend:  http://localhost:$BACKEND_PORT"
echo "Frontend: http://localhost:$FRONTEND_PORT"
wait
