#!/usr/bin/env bash
# Prod-Smoke-Test (PLAN Phase 10): Health, Graph, ein public-Chat, Golden-Eval.
# Aufruf vom VPS (oder lokal gegen den public-Stack):
#   BASE_URL=https://wissen.example.com/api ./scripts/smoke_prod.sh
# Default: http://localhost/api (Caddy auf :80).
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost/api}"
FAIL=0

check() {
  local name="$1" ok="$2" detail="${3:-}"
  if [ "$ok" = "0" ]; then
    echo "  ✓ $name $detail"
  else
    echo "  ✗ $name $detail"
    FAIL=1
  fi
}

echo "Smoke-Test gegen $BASE_URL"

# 1. Health
if curl -fsS --max-time 10 "$BASE_URL/health" | grep -q '"ok"'; then ok=0; else ok=1; fi
check "/health" $ok

# 2. Graph hat Knoten
NODES=$(curl -fsS --max-time 15 "$BASE_URL/graph" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["nodes"]))' 2>/dev/null || echo 0)
if [ "$NODES" -gt 0 ]; then ok=0; else ok=1; fi
check "/graph" $ok "($NODES Knoten)"

# 3. Ein public-Chat streamt bis [DONE]
if curl -fsS --max-time 120 -X POST "$BASE_URL/chat" \
  -H 'Content-Type: application/json' \
  -d '{"query": "Was ist Retrieval-Augmented Generation?"}' | grep -q '\[DONE\]'; then ok=0; else ok=1; fi
check "/chat (public, bis [DONE])" $ok

# 4. Golden-Eval als Qualitäts-Smoke (läuft im Backend-Container)
if [ "${SKIP_EVAL:-0}" != "1" ]; then
  if docker compose exec -T backend python eval/run_eval.py; then ok=0; else ok=1; fi
  check "Golden-Eval" $ok
fi

echo
if [ "$FAIL" = "1" ]; then
  echo "SMOKE ROT — Deployment prüfen."
  exit 1
fi
echo "SMOKE GRÜN."
