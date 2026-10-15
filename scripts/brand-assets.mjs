// Generates web-ready brand assets from the master files in /logo. Re-run after replacing a master:
//   npm run brand:build
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const SRC = "logo";
const OUT = "src/assets/brand";
const NAVY = { r: 0, g: 34, b: 83, alpha: 1 }; // #002253, background of the reverse logo
mkdirSync(OUT, { recursive: true });

// Removes faint background-removal residue (alpha < 24) so trimming and edges stay clean.
async function cleanAlpha(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) if (data[i] < 24) data[i] = 0;
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

const trimmed = async (file) => sharp(await cleanAlpha(file)).trim().png().toBuffer();

// Light-background logos (transparent).
await sharp(await trimmed(`${SRC}/synclytics-horizontal.png`)).resize({ height: 120 }).png({ compressionLevel: 9 }).toFile(`${OUT}/synclytics-horizontal.png`);
await sharp(await trimmed(`${SRC}/synclytics-stacked.png`)).resize({ width: 560 }).png({ compressionLevel: 9 }).toFile(`${OUT}/synclytics-stacked.png`);
const mark = await trimmed(`${SRC}/ses-mark.png`);
await sharp(mark).resize({ width: 256 }).png({ compressionLevel: 9 }).toFile(`${OUT}/ses-mark.png`);

// Reverse logo: crop to the artwork, keeping its navy background (the footer uses the same navy).
const reverse = await sharp(`${SRC}/synclytics-horizontal-reverse.png`).trim({ background: "#002253", threshold: 30 }).toBuffer();
await sharp(reverse).extend({ top: 8, bottom: 8, left: 8, right: 8, background: NAVY }).resize({ height: 120 }).png({ compressionLevel: 9 }).toFile(`${OUT}/synclytics-horizontal-reverse.png`);

// App icons (Next.js file conventions in src/app).
const square = async (size, pad, background) => {
  const inner = Math.round(size * (1 - pad * 2));
  const art = await sharp(mark).resize({ width: inner, height: inner, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } }).composite([{ input: art, gravity: "center" }]).png();
};
// Browser tab: the mark on a white rounded tile, so it reads on light and dark tab bars alike.
const roundedWhite = async (size, pad) => {
  const tile = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#fff"/></svg>`);
  const art = await (await square(size, pad, { r: 0, g: 0, b: 0, alpha: 0 })).toBuffer();
  return sharp(tile).composite([{ input: art }]).png({ compressionLevel: 9 });
};
await (await roundedWhite(512, 0.1)).toFile("src/app/icon.png");
// Older browsers: the same tile as favicon.ico (PNG-in-ICO, 16/32/48).
const sizes = [16, 32, 48];
const ico = await Promise.all(sizes.map(async (n) => (await roundedWhite(n, 0.1)).toBuffer()));
const head = Buffer.alloc(6 + 16 * ico.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(ico.length, 4);
let offset = head.length;
ico.forEach((png, i) => {
  const e = 6 + i * 16;
  head[e] = head[e + 1] = sizes[i];
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(png.length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
writeFileSync("src/app/favicon.ico", Buffer.concat([head, ...ico]));
await (await square(180, 0.1, { r: 255, g: 255, b: 255, alpha: 1 })).toFile("src/app/apple-icon.png");

// Social sharing image (1200x630): reverse logo centred on brand navy.
const ogLogo = await sharp(reverse).resize({ width: 980 }).toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 4, background: NAVY } })
  .composite([{ input: ogLogo, gravity: "center" }])
  .png()
  .toFile("src/app/opengraph-image.png");

console.log("Brand assets written to", OUT, "and src/app/{icon,apple-icon,opengraph-image}.png");
