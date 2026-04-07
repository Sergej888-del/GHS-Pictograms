// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';

// Tailwind v4: плагин @tailwindcss/vite (в Astro 6 официальный @astrojs/tailwind пока без peer astro@6)
export default defineConfig({
  site: 'https://ghspictograms.com',
  output: 'server',
  adapter: cloudflare(),

  integrations: [react(), mdx(), sitemap()],

  vite: {
    plugins: [tailwindcss()]
  }
});
