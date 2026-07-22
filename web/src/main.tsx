import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Starfield } from "./components/Starfield";
import { WasmGate } from "./components/WasmGate";
import "@fontsource-variable/doto";
import "./styles.css";

// the static build (VITE_BACKEND=wasm) boots the in-browser engine first;
// dev / the native lab mount the app directly (build-time constant, so the
// unused branch is dead code)
const WASM = import.meta.env.VITE_BACKEND === "wasm";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Starfield />
    {WASM ? (
      <WasmGate>
        <App />
      </WasmGate>
    ) : (
      <App />
    )}
  </StrictMode>,
);
