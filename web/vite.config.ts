import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the app on :5173 and proxies the API to a local
// `go run .` on :8080. `npm run build` writes dist/, which Go embeds.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8080" } },
  build: { outDir: "dist", emptyOutDir: false }, // keep dist/.gitkeep
});
