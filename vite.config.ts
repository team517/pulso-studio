import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  css: { postcss: {} },
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:4321",
      "/files": "http://localhost:4321",
    },
  },
});
