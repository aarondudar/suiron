MODEL := models/Qwen3-0.6B-Q8_0.gguf
MODEL_URL := https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf
PORT := 4117

.PHONY: setup build web model dev lab static demo-data test check clean help

help: ## list targets
	@grep -E '^[a-z]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-8s %s\n", $$1, $$2}'

setup: model build web ## fresh clone → ready to run (model + engine + frontend)
	@echo "✓ setup complete — run: make lab   (or make dev for hot reload)"

build: ## release build of the engine
	cargo build --release

web/node_modules:
	cd web && npm install

web: web/node_modules ## build the frontend into web/dist
	cd web && npm run build

model: ## fetch the reference model if missing (~640 MB)
	@test -f $(MODEL) || (mkdir -p models && curl -L -o $(MODEL) "$(MODEL_URL)")

dev: build web/node_modules model ## lab + vite hot reload, opens browser
	@./scripts/dev.sh $(MODEL) $(PORT)

lab: build web model ## production mode: lab serves web/dist, opens browser
	@(sleep 2 && open http://127.0.0.1:$(PORT)) &
	./target/release/suiron lab $(MODEL) $(PORT)

demo-data: build model ## record the instant-demo payloads into web/public/demo
	@./scripts/demo-data.sh $(MODEL)

static: build web/node_modules model ## static WASM lab -> web/dist (self-contained, no server)
	wasm-pack build crates/suiron-wasm --target web --release --out-dir pkg
	mkdir -p web/public/wasm
	cp crates/suiron-wasm/pkg/suiron_wasm.js crates/suiron-wasm/pkg/suiron_wasm_bg.wasm web/public/wasm/
	cd web && VITE_BACKEND=wasm npx vite build --outDir dist-static
	@echo "✓ static lab in web/dist-static — serve it with the model alongside:"
	@echo "  cp $(MODEL) web/dist-static/model.gguf && python3 -m http.server -d web/dist-static 8080"

test: ## full test suite (release: model-loading tests are slow in debug)
	cargo test --workspace --release

check: ## lint everything (clippy -D warnings + tsc strict)
	cargo clippy --workspace -- -D warnings
	cd web && npx tsc

clean: ## remove build artifacts (keeps the model)
	cargo clean
	rm -rf web/dist web/node_modules
