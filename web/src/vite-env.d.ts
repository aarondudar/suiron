/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "wasm" for the static in-browser build (`make static`); unset in dev/native. */
  readonly VITE_BACKEND?: string;
  /** where the static build fetches the model; defaults to {BASE_URL}model.gguf */
  readonly VITE_MODEL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv & { readonly BASE_URL: string };
}
