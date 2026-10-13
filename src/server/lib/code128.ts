/**
 * Code 128 (subset B) barcode encoder: printable ASCII → bar widths. Used for shelf and product labels, which any
 * USB or phone barcode scanner reads back as the same text.
 */
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const STOP = 106;

/** Module widths (bar, space, bar, …) including start, checksum and stop; throws on characters outside ASCII 32–126. */
export function code128B(text: string): number[] {
  if (!text) throw new Error("Nothing to encode");
  const codes = [START_B];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`Character not allowed in a barcode: ${JSON.stringify(ch)}`);
    codes.push(c - 32);
  }
  const checksum = codes.reduce((sum, code, i) => sum + code * (i === 0 ? 1 : i), 0) % 103;
  codes.push(checksum, STOP);
  return codes.flatMap((c) => PATTERNS[c]!.split("").map(Number));
}

/** SVG markup for a barcode `height` px tall with a quiet zone, scaled to `moduleWidth` px per module. */
export function code128Svg(text: string, opts: { height?: number; moduleWidth?: number } = {}) {
  const widths = code128B(text);
  const m = opts.moduleWidth ?? 2;
  const h = opts.height ?? 60;
  const quiet = 10 * m;
  let x = quiet;
  const bars: string[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w * m}" height="${h}"/>`);
    x += w * m;
  });
  const total = x + quiet;
  return { width: total, height: h, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${h}" width="${total}" height="${h}" shape-rendering="crispEdges"><rect width="${total}" height="${h}" fill="#fff"/><g fill="#000">${bars.join("")}</g></svg>` };
}
