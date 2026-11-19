// Renders assets/icon.svg into assets/icon.ico (16-256 px). Run: npm run make:icon
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const A = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const svg = fs.readFileSync(path.join(A, 'icon.svg'));
const pngs = await Promise.all([16, 24, 32, 48, 64, 128, 256].map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer()));
fs.writeFileSync(path.join(A, 'icon.png'), pngs[pngs.length - 1]);
fs.writeFileSync(path.join(A, 'icon.ico'), await pngToIco(pngs));
console.log('Wrote assets/icon.ico');
