import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ["infiltre.traillearn.org"],
    proxy: {
      "/socket.io": "http://localhost:3000",
      "/health": "http://localhost:3000"
    }
  },
  build: {
    outDir: "dist"
  }
});
