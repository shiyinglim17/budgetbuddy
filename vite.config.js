import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base is set for GitHub Pages project sites: https://<user>.github.io/budgetbuddy/
// If you deploy to Vercel/Netlify or a custom domain instead, change base to "/".
export default defineConfig({
  plugins: [react()],
  base: "/budgetbuddy/",
});
