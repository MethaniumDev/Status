import { methaniumUi } from "@methanium/ui/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { mtp } from "mtp/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => ({
  server:
    command === "serve"
      ? {
          https: {
            cert: fs.readFileSync(path.resolve(root, "../../.dev/cert.pem")),
            key: fs.readFileSync(path.resolve(root, "../../.dev/key.pem")),
          },
        }
      : undefined,
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    tailwindcss(),
    react(),
    methaniumUi({ defaultThemeId: "methanium" }),
    mtp({
      typeMaps: "./type-maps.yaml",
      wasmPackArgs: command === "build" ? ["--mode", "no-install"] : undefined,
    }) as Plugin,
  ],
  resolve: {
    alias: {
      "@methanium/status-mtp": path.resolve(
        root,
        "../../packages/mtp/index.ts",
      ),
    },
  },
}));
