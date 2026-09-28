import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/extension.ts"],
    format: "cjs",
    external: ["vscode"],
    outDir: "dist",
    sourcemap: true,
    target: "node20",
    loader: {
      ".html": "text",
    },
  },
  {
    // Webview entry: replaces the upstream assets/main.mjs.
    entry: { main: "src/webview/main.ts" },
    format: "esm",
    platform: "browser",
    // The pdf.js viewer is loaded at runtime from assets/, not bundled.
    external: [/\/viewer\.mjs$/u],
    outDir: "dist/webview",
    sourcemap: true,
    target: "es2022",
  },
]);
