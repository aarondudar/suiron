#!/bin/sh
# Dev orchestrator: suiron lab (API) in the background, vite (hot reload)
# in the foreground with the browser auto-opened. Ctrl-C stops both.
set -e
MODEL=${1:-models/Qwen3-0.6B-Q8_0.gguf}
PORT=${2:-4117}

./target/release/suiron lab "$MODEL" "$PORT" &
LAB=$!
trap 'kill $LAB 2>/dev/null' EXIT INT TERM

echo "lab pid $LAB on :$PORT — starting vite (proxies /api → :$PORT)"
cd web && npm run dev -- --open
