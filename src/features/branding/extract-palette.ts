/**
 * Lê a logo no navegador e deduz a identidade visual: cor principal, cor de destaque e se
 * a logo fica melhor em branco sobre o painel (logo com fundo transparente) ou com as cores
 * originais (logo com fundo próprio, como JPG em fundo branco).
 */

export type LogoPalette = { primary: string; secondary: string; logoWhite: boolean };

type Rgb = [number, number, number];

const hex = ([r, g, b]: Rgb) =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function luminance([r, g, b]: Rgb) {
  const c = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

/** Escurece até o texto branco do botão ter contraste legível (≥ 3,2:1). */
function readableOnWhiteText(rgb: Rgb): Rgb {
  let [h, s, l] = rgbToHsl(rgb);
  let out = rgb;
  while (1.05 / (luminance(out) + 0.05) < 3.2 && l > 0.12) {
    l -= 0.03;
    out = hslToRgb(h, s, l);
  }
  return out;
}

const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a imagem da logo."));
    };
    img.src = url;
  });
}

export async function extractLogoPalette(file: File): Promise<LogoPalette> {
  const img = await loadImage(file);
  const scale = Math.min(1, 160 / Math.max(img.naturalWidth || 160, img.naturalHeight || 160));
  const w = Math.max(1, Math.round((img.naturalWidth || 160) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || 160) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Navegador sem suporte para analisar a logo.");
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const at = (x: number, y: number): [Rgb, number] => {
    const i = (y * w + x) * 4;
    return [[px[i], px[i + 1], px[i + 2]], px[i + 3]];
  };

  // Fundo: cantos opacos e parecidos = a logo tem fundo próprio (não fica bem em branco).
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  const opaqueCorners = corners.filter(([, a]) => a > 200);
  const background =
    opaqueCorners.length >= 3 && opaqueCorners.every(([c]) => dist(c, opaqueCorners[0][0]) < 40)
      ? opaqueCorners[0][0]
      : null;

  // Agrupa as cores em faixas e dá mais peso às cores vivas (são as da marca).
  const buckets = new Map<string, { sum: Rgb; n: number; weight: number }>();
  let dark = 0;
  let counted = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [c, a] = at(x, y);
      if (a < 128) continue;
      if (background && dist(c, background) < 48) continue;
      const [, s, l] = rgbToHsl(c);
      counted++;
      if (l > 0.94) continue; // branco
      if (s < 0.15 || l < 0.08) {
        dark++;
        continue; // preto/cinza: só vira cor se não houver cor viva
      }
      const key = c.map((v) => v >> 4).join(",");
      const b = buckets.get(key) ?? { sum: [0, 0, 0] as Rgb, n: 0, weight: 0 };
      b.sum = [b.sum[0] + c[0], b.sum[1] + c[1], b.sum[2] + c[2]];
      b.n++;
      b.weight += 1 + s * 2;
      buckets.set(key, b);
    }
  }

  const ranked = [...buckets.values()]
    .map((b) => ({ rgb: [b.sum[0] / b.n, b.sum[1] / b.n, b.sum[2] / b.n] as Rgb, weight: b.weight }))
    .sort((a, b) => b.weight - a.weight);

  // Junta faixas vizinhas (tons da mesma cor) para achar as cores de fato diferentes.
  const families: { rgb: Rgb; weight: number }[] = [];
  for (const c of ranked) {
    const f = families.find((x) => dist(x.rgb, c.rgb) < 60);
    if (f) f.weight += c.weight;
    else families.push({ ...c });
  }
  families.sort((a, b) => b.weight - a.weight);

  const logoWhite = background === null;
  const chromaticShare = families.reduce((t, f) => t + f.weight, 0);

  // Logo preta/cinza (sem cor viva relevante): grafite elegante.
  if (!families.length || (dark > counted * 0.6 && chromaticShare < counted * 0.1)) {
    return { primary: "#2f3640", secondary: "#56606b", logoWhite };
  }

  const main = families[0].rgb;
  const [mh, ms, ml] = rgbToHsl(main);
  const primary = readableOnWhiteText(main);
  const other = families.slice(1).find((f) => {
    const [hh, ss] = rgbToHsl(f.rgb);
    return ss > 0.2 && hueGap(hh, mh) > 25 && f.weight > families[0].weight * 0.08;
  });
  // Sem segunda cor na logo: destaque = tom mais claro da principal.
  const secondary = other
    ? readableOnWhiteText(other.rgb)
    : hslToRgb(mh, Math.min(1, ms * 0.95), Math.min(0.62, Math.max(ml, rgbToHsl(primary)[2]) + 0.12));

  return { primary: hex(primary), secondary: hex(secondary), logoWhite };
}
