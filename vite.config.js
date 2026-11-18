import { defineConfig } from "vite";
import { resolve } from "path";
import { offlinePlugin } from "./build/offline-plugin.js";

export default defineConfig({
  base: "/",
  plugins: [offlinePlugin()],
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    allowedHosts: ["board.zoni.edu", ".zoni.edu"],
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
      },
    },
  },
});
