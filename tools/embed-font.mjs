/**
 * Embeds a font file into ac-control-card.js as Base64, so the distributed
 * card carries everything it needs and makes no network request for it.
 *
 *   node tools/embed-font.mjs path/to/ChocoCooky.woff2
 *   node tools/embed-font.mjs --clear        (remove the embedded font again)
 *
 * WOFF2 is much the smallest and is preferred; TTF/OTF/WOFF are accepted and
 * reported honestly, since an uncompressed TTF can be several times the size.
 * The card is written between two markers, so re-running replaces the previous
 * font rather than accumulating copies.
 */

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";

const CARD = new URL("../ac-control-card.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const START = "/* -- embedded font: start (written by tools/embed-font.mjs) -- */";
const END = "/* -- embedded font: end -- */";

const FORMATS = {
  ".woff2": { format: "woff2", mime: "font/woff2" },
  ".woff": { format: "woff", mime: "font/woff" },
  ".ttf": { format: "truetype", mime: "font/ttf" },
  ".otf": { format: "opentype", mime: "font/otf" },
};

const kb = (n) => (n / 1024).toFixed(1) + " KB";

function replaceBlock(source, body) {
  const a = source.indexOf(START);
  const b = source.indexOf(END);
  if (a === -1 || b === -1) throw new Error("markers not found in ac-control-card.js");
  return source.slice(0, a) + START + "\n" + body + END + source.slice(b + END.length);
}

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node tools/embed-font.mjs <font file> | --clear");
  process.exit(1);
}

const before = statSync(CARD).size;
let card = readFileSync(CARD, "utf8");

if (arg === "--clear") {
  card = replaceBlock(card, 'const FONT_DATA = "";\nconst FONT_FORMAT = "";\nconst FONT_MIME = "";\n');
  writeFileSync(CARD, card);
  console.log(`cleared. card ${kb(before)} -> ${kb(statSync(CARD).size)}`);
  process.exit(0);
}

const ext = extname(arg).toLowerCase();
const spec = FORMATS[ext];
if (!spec) {
  console.error(`unsupported font type ${ext}; expected one of ${Object.keys(FORMATS).join(", ")}`);
  process.exit(1);
}

const bytes = readFileSync(arg);
const b64 = bytes.toString("base64");

card = replaceBlock(
  card,
  `const FONT_DATA =\n  "${b64}";\n` +
    `const FONT_FORMAT = "${spec.format}";\n` +
    `const FONT_MIME = "${spec.mime}";\n`,
);
writeFileSync(CARD, card);

const after = statSync(CARD).size;
console.log(`embedded ${basename(arg)} (${spec.format})`);
console.log(`  raw font      ${kb(bytes.length)}`);
console.log(`  as Base64     ${kb(b64.length)}  (+${((b64.length / bytes.length - 1) * 100).toFixed(0)}% over raw)`);
console.log(`  card before   ${kb(before)}`);
console.log(`  card after    ${kb(after)}`);
console.log(`  added         ${kb(after - before)}  (+${(((after - before) / before) * 100).toFixed(0)}%)`);
if (spec.format !== "woff2") {
  console.log("\n  note: this is not WOFF2. Converting first would typically cut the");
  console.log("        embedded size by half or more.");
}
