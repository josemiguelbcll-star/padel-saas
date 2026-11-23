/**
 * Logo MatchGo para PDFs (raster del SVG público).
 */
export const LOGO_MATCHGO_SRC = '/matchgo_logo.svg';

const LOGO_W_MM = 36;
const LOGO_H_MM = 11.7;

export async function dataUrlLogoMatchgo(): Promise<string | null> {
  try {
    const img = new Image();
    img.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('logo'));
    });
    img.src = LOGO_MATCHGO_SRC;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = 736;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

export function dibujarLogoPdf(
  doc: {
    addImage: (
      data: string,
      format: string,
      x: number,
      y: number,
      w: number,
      h: number,
    ) => void;
  },
  dataUrl: string | null,
  x = 10,
  y = 6,
): { w: number; h: number } {
  if (dataUrl) {
    doc.addImage(dataUrl, 'PNG', x, y, LOGO_W_MM, LOGO_H_MM);
  }
  return { w: LOGO_W_MM, h: LOGO_H_MM };
}
