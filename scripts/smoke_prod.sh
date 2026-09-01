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

# 3. Rate-Limit trennt Besucher voneinander.
# Steht die Proxy-IP nicht in --forwarded-allow-ips (Default: nur 127.0.0.1),
# verwirft uvicorn den X-Forwarded-For und alle Besucher landen im selben Eimer —
# ein Nutzer sperrt dann alle anderen aus. Genau das lief unbemerkt in Produktion;
# der Fehler ist von aussen nur an diesem Verhalten zu erkennen.
if [ "${SKIP_XFF:-0}" != "1" ]; then
  probe() {  # Statuscode fuer /documents als angegebener Besucher
    curl -s -o /dev/null -w '%{http_code}' --max-time 10       -H "X-Forwarded-For: $1" "$BASE_URL/documents" || echo 000
  }
  hit429=0
  for _ in $(seq 1 40); do
    if [ "$(probe 203.0.113.10)" = "429" ]; then hit429=1; break; fi
  done
  if [ "$hit429" = "1" ]; then
    other=$(probe 203.0.113.99)
    if [ "$other" = "429" ]; then ok=1; else ok=0; fi
    check "Rate-Limit trennt Besucher (X-Forwarded-For)" $ok "(zweiter Client: $other)"
  else
    echo "  ~ Rate-Limit trennt Besucher — unbestimmt (kein 429 nach 40 Anfragen)"
  fi
fi

# 4. Ein public-Chat streamt bis [DONE]
if curl -fsS --max-time 120 -X POST "$BASE_URL/chat" \
  -H 'Content-Type: application/json' \
  -d '{"query": "Was ist Retrieval-Augmented Generation?"}' | grep -q '\[DONE\]'; then ok=0; else ok=1; fi
check "/chat (public, bis [DONE])" $ok

# 5. Golden-Eval als Qualitäts-Smoke (läuft im Backend-Container)
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
