#!/bin/sh
# Record the instant-demo payloads (docs/19): run the REAL lab once over the
# canonical prompt and save its own endpoint responses — byte-identical shapes,
# nothing synthesized. Output: web/public/demo/ (gitignored; regenerate anytime).
set -e
MODEL=${1:-models/Qwen3-0.6B-Q8_0.gguf}
PORT=${2:-4361}
API="http://127.0.0.1:$PORT/api/v1"
OUT=web/public/demo
mkdir -p "$OUT"

./target/release/suiron lab "$MODEL" "$PORT" >/dev/null 2>&1 &
LAB=$!
trap 'kill $LAB 2>/dev/null' EXIT INT TERM
until curl -s -m 2 -o /dev/null "$API/trace"; do sleep 0.3; done

# the canonical run: greedy, seed 7, q8 — the same run "go live" replays
curl -s -X POST "$API/generate?n=1&temp=0&top_k=40&top_p=0.95&seed=7&chat=0&backend=q8" \
  --data "The capital of France is" >/dev/null
until [ "$(curl -s "$API/trace" | python3 -c 'import sys,json;print(json.load(sys.stdin)["busy"])')" = "False" ]; do sleep 0.3; done

curl -s "$API/trace" > "$OUT/trace.json"
curl -s "$API/merges" > "$OUT/merges.json"
curl -s "$API/quant-sample" > "$OUT/quant-sample.json"

LAST=$(python3 -c 'import json;print(len(json.load(open("'$OUT'/trace.json"))["tokens"])-1)')
PROD=$((LAST - 1))
for P in $(seq 0 $PROD); do curl -s "$API/lens?pos=$P&k=5" > "$OUT/lens-$P.json"; done

for ID in $(python3 -c 'import json;print(" ".join(str(t["id"]) for t in json.load(open("'$OUT'/trace.json"))["tokens"]))'); do
  curl -s "$API/neighbors?id=$ID&n=12" > "$OUT/neighbors-$ID.json"
done

# deep inspection at the producing position: every layer, every head (the tour
# and any layer/head the visitor picks), the final stage, and the inspected
# token's own embedding/rope reads
for L in $(seq 0 27); do
  curl -s "$API/inspect?pos=$PROD&layer=$L" > "$OUT/inspect-$PROD-$L.json"
  for H in $(seq 0 15); do
    curl -s "$API/inspect?pos=$PROD&layer=$L&head=$H" > "$OUT/inspect-$PROD-$L-h$H.json"
  done
done
curl -s "$API/inspect?pos=$PROD&layer=28" > "$OUT/inspect-$PROD-28.json"
curl -s "$API/inspect?pos=$LAST&layer=0" > "$OUT/inspect-$LAST-0.json"
curl -s "$API/inspect?pos=$LAST&layer=0&head=0" > "$OUT/inspect-$LAST-0-h0.json"

for F in silu rmsnorm softmax dot matmul rope embedding forward attention ffn; do
  curl -s "$API/source?fn=$F" > "$OUT/source-$F.txt"
done

echo "✓ demo data in $OUT ($(ls "$OUT" | wc -l | tr -d ' ') files, $(du -sh "$OUT" | cut -f1))"
