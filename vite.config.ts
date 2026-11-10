import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 9000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("openchemlib")) return "openchemlib";
          if (id.includes("node_modules/react") || id.includes("react-dom")) return "react";
          return undefined;
        },
      },
    },
  },
});
