import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_BASE=/studio/ cuando se compila para el panel de ChipsFinder (EasyPanel)
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
  css: { postcss: {} },
  server: {
    port: 5174,
    // El servidor y los datos no son parte de la web: que no recarguen la página al cambiar
    watch: { ignored: ["**/server/**", "**/data/**"] },
    proxy: {
      "/api": "http://localhost:4321",
      "/files": "http://localhost:4321",
    },
  },
});
