import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "/",
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
