// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';

// Чистый статический деплой на Cloudflare Pages (без SSR-воркера Astro).
// Edge-функции в /functions (например api/leads) по-прежнему поддерживаются Pages отдельно.

export default defineConfig({
  site: 'https://ghspictograms.com',
  trailingSlash: 'always',
  output: 'static',

  integrations: [react(), mdx()],

  vite: {
    plugins: [tailwindcss()]
  }
});
