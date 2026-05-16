#!/usr/bin/env node
/**
 * Generate extension icon PNGs from the LogoSentinel SVG mark.
 * Uses a canvas-based approach via the `sharp` package if available,
 * otherwise writes raw SVGs that can be converted manually.
 *
 * Usage: node scripts/generate_icons.mjs
 */
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(__dirname, '../extension/assets');

function logoSvg(size) {
  const viewBox = 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${viewBox} ${viewBox}">
  <defs>
    <radialGradient id="frame" cx="50%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#181318"/>
      <stop offset="100%" stop-color="#08070a"/>
    </radialGradient>
    <linearGradient id="blade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff5dc" stop-opacity="0.85"/>
      <stop offset="50%" stop-color="#f5a623"/>
      <stop offset="100%" stop-color="#f5a623" stop-opacity="0.55"/>
    </linearGradient>
    <radialGradient id="core" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#fff5dc" stop-opacity="0.9"/>
      <stop offset="40%" stop-color="#f5a623"/>
      <stop offset="100%" stop-color="#f5a623" stop-opacity="0.6"/>
    </radialGradient>
  </defs>
  <rect width="40" height="40" rx="9" fill="url(#frame)"/>
  <rect x="0.5" y="0.5" width="39" height="39" rx="8.5" fill="none" stroke="#f5a623" stroke-width="0.4" opacity="0.25"/>
  ${size >= 32 ? `
  <circle cx="20" cy="20" r="15.5" fill="none" stroke="#f5a623" stroke-width="0.35" opacity="0.18"/>
  <circle cx="20" cy="20" r="12" fill="none" stroke="#f5a623" stroke-width="0.5" opacity="0.4"/>
  ` : ''}
  <circle cx="20" cy="20" r="7.5" fill="none" stroke="#f5a623" stroke-width="0.6" opacity="0.7"/>
  ${[0, 60, 120, 180, 240, 300].map(deg =>
    `<path d="M 20 20 L ${size >= 32 ? '17.5 9.5 L 22.5 9.5' : '18 10 L 22 10'} Z" fill="url(#blade)" transform="rotate(${deg} 20 20)"/>`
  ).join('\n  ')}
  <circle cx="20" cy="20" r="${size >= 32 ? 3.2 : 4}" fill="url(#core)"/>
  ${size >= 32 ? '<circle cx="19" cy="19" r="0.9" fill="#fff5dc" opacity="0.85"/>' : ''}
  ${size >= 32 ? '<circle cx="32.5" cy="8" r="1.7" fill="#7ab787"/>' : ''}
</svg>`;
}

const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const svg = logoSvg(size);
  writeFileSync(resolve(ASSETS, `icon${size}.svg`), svg);
  console.log(`wrote icon${size}.svg`);
}

// Try to convert to PNG using sharp if available
try {
  const sharp = await import('sharp');
  for (const size of sizes) {
    const svg = logoSvg(size);
    await sharp.default(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(resolve(ASSETS, `icon${size}.png`));
    console.log(`converted icon${size}.png`);
  }
} catch {
  console.log('sharp not available — SVGs written, convert to PNG manually or install sharp');
  console.log('  npm i -D sharp && node scripts/generate_icons.mjs');
}
