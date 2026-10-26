import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  server: { host: true }, // listen on 0.0.0.0 so the LAN can reach dev mode
  preview: { host: true },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png"],
      manifest: {
        name: "Coverly — EPUB cover editor",
        short_name: "Coverly",
        description:
          "Add or replace the cover of an EPUB. Pick a cover from Open Library or upload your own. Everything runs in your browser.",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#F8FAFC",
        theme_color: "#1E3A5F",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2,woff,ttf}"],
        navigateFallback: "index.html",
      },
    }),
  ],
});
