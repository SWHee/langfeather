import {defineConfig} from "vitest/config";
import react from "@vitejs/plugin-react";

const apiProxyTarget =
  process.env.LANGFEATHER_API_PROXY ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: apiProxyTarget,
      },
    },
  },
  test: {
    clearMocks: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
