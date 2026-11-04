import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brand = path.join(root, "public", "brand");
const social = await readFile(path.join(brand, "conectaflow-social.svg"));
const mark = await readFile(path.join(brand, "conectaflow-mark.svg"));
await sharp(social).resize(1200, 630).png().toFile(path.join(brand, "conectaflow-social.png"));
for (const size of [192, 512]) {
  await sharp(mark).resize(size, size).png().toFile(path.join(brand, `conectaflow-icon-${size}.png`));
}
console.log("ConectaFlow: 1 social image and 2 app icons generated.");
