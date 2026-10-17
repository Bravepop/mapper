import { defineConfig } from 'vite';

// GitHub Pages serves the app from https://bravepop.github.io/mapper/, so
// production builds (and `vite preview` of them) use that sub-path. The dev
// server stays at the root.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/mapper/' : '/',
}));
