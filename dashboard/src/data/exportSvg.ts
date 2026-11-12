/** Export a set of chart <svg> elements as one standalone SVG or PNG file. */

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export interface LegendItem { color: string; label: string }

/** Stack the given SVGs vertically under a title and legend; returns the serialized SVG text. */
export function composeSvg(svgs: SVGSVGElement[], title: string, legend: LegendItem[], ink = "#1f2933"): string {
  const width = Math.max(...svgs.map((s) => Number(s.getAttribute("width")) || s.clientWidth), 320);
  const header = 48;
  let y = header;
  const parts: string[] = [];
  for (const s of svgs) {
    const clone = s.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll("[style]").forEach((el) => el.removeAttribute("style"));   // drop hover dimming
    const h = Number(s.getAttribute("height")) || s.clientHeight;
    clone.removeAttribute("style");
    clone.setAttribute("x", "0");
    clone.setAttribute("y", String(y));
    parts.push(new XMLSerializer().serializeToString(clone));
    y += h + 8;
  }
  const legendX = legend.map((_, i) => 0 + i * 230);
  const legendSvg = legend
    .map((l, i) => `<rect x="${legendX[i]}" y="30" width="10" height="10" rx="2" fill="${l.color}"/><text x="${legendX[i] + 14}" y="39" font-size="12" fill="${ink}">${esc(l.label)}</text>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}" viewBox="0 0 ${width} ${y}" font-family="${FONT}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="0" y="18" font-size="15" font-weight="600" fill="${ink}">${esc(title)}</text>
${legendSvg}
${parts.join("\n")}
</svg>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

export function downloadSvg(svgText: string, fileName: string): void {
  downloadBlob(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }), fileName);
}

/** Rasterise the SVG at `scale`× its size and download as PNG. */
export async function downloadPng(svgText: string, fileName: string, scale = 2): Promise<void> {
  const m = /width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/.exec(svgText);
  const w = m ? Number(m[1]) : 800, h = m ? Number(m[2]) : 600;
  const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("Could not render chart")); img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (blob) downloadBlob(blob, fileName);
  } finally {
    URL.revokeObjectURL(url);
  }
}
