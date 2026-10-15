import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// react-rnd (via react-draggable) reads process.env.NODE_ENV for dev warnings; the
// browser has no `process`, so we replace the expression with a literal at build time.
export default defineConfig(({ mode }) => ({
  // Relative asset URLs, so the build works wherever it is served — GitHub Pages hosts it
  // under /pres-sure/, `npm run preview` at the root.
  base: "./",
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify(mode === "production" ? "production" : "development"),
  },
  server: { port: 5173 },
}));
