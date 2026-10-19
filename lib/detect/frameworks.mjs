// Frameworks / runtime packs from dependencies and config files (doc 05 §6). Pack *data* arrives in a later phase.
import { basename } from 'node:path';
import { dirOf } from './manifests.mjs';

const DEP_FRAMEWORKS = [
  ['next', 'next'], ['remix', '@remix-run/react'], ['react-router', 'react-router'], ['astro', 'astro'], ['nuxt', 'nuxt'], ['sveltekit', '@sveltejs/kit'],
  ['nest', '@nestjs/core'], ['express', 'express'], ['fastify', 'fastify'], ['hono', 'hono'], ['vite', 'vite'], ['angular', '@angular/core'],
  ['expo', 'expo'], ['react-native', 'react-native'], ['storybook', 'storybook'], ['vue', 'vue'], ['svelte', 'svelte'], ['react', 'react'],
  ['vitest', 'vitest'], ['jest', 'jest'], ['mocha', 'mocha'], ['ava', 'ava'], ['playwright', '@playwright/test'], ['cypress', 'cypress'],
  ['tailwind', 'tailwindcss'], ['postcss', 'postcss'], ['prisma', '@prisma/client'], ['typeorm', 'typeorm'], ['mikro-orm', '@mikro-orm/core'],
  ['drizzle', 'drizzle-orm'], ['trpc', '@trpc/server'], ['msw', 'msw'], ['turbo', 'turbo'], ['nx', 'nx'], ['zod', 'zod'], ['valibot', 'valibot'],
];

export function detectFrameworks(depNames, manifests) {
  const out = new Set();
  for (const [name, dep] of DEP_FRAMEWORKS) if (depNames.has(dep) || (name === 'storybook' && [...depNames].some((d) => d.startsWith('@storybook/')))) out.add(name);
  if (manifests.all.some((f) => /(^|\/)next\.config\.[cm]?[jt]s$/.test(f))) out.add('next');
  if (manifests.markers.includes('turbo.json')) out.add('turbo');
  if (manifests.markers.includes('nx.json')) out.add('nx');
  return [...out].sort();
}

/** Runtime packs: workerd when wrangler config exists or wrangler/@cloudflare/* deps are present. */
export function detectPacks(manifests, packages) {
  const packs = [];
  const wranglerDirs = [...new Set(manifests.wrangler.map(dirOf))].map((d) => d || '.');
  const depDirs = packages.filter((p) => p.deps.some((d) => d === 'wrangler' || d === '@cloudflare/workers-types' || d === '@cloudflare/vitest-pool-workers')).map((p) => p.path);
  const paths = [...new Set([...wranglerDirs, ...depDirs])].sort();
  if (paths.length) packs.push({ name: 'workerd', paths });
  if (manifests.markers.some((m) => basename(m).startsWith('deno.json'))) packs.push({ name: 'deno', paths: [...new Set(manifests.markers.filter((m) => basename(m).startsWith('deno.json')).map((m) => dirOf(m) || '.'))] });
  return packs;
}
