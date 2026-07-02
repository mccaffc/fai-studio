import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist-site",
    // ES2022 is needed for top-level await support (corpus-mode dynamic import).
    // Chrome 89+, Firefox 89+, Safari 15+, Edge 89+ all ship ES2022 async features.
    target: "es2022",
  },
});
