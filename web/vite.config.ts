import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// dev server proxies API calls to a running `suiron lab` on :4117,
// so `npm run dev` gives hot reload against the live model.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4117",
    },
  },
});
