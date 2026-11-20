import { clampNormalized } from './slider';
import { formatLocalIsoWithMs, injectPngTextMetadata } from './pngMetadata';

export interface ExportOptions {
  sourceCanvas: HTMLCanvasElement;
  sliderValue: number;
  accentColor: string;
  timestampMs?: number;
}

export function computeExportStripWidth(canvasW: number, canvasH: number): number {
  const minW = Math.max(36, Math.round(canvasH * 0.045));
  const maxW = Math.max(minW, Math.round(Math.max(180, canvasW * 0.14)));
  const idealW = Math.round(canvasW * 0.09);
  return Math.max(minW, Math.min(maxW, idealW));
}

export function composeExportCanvas(options: ExportOptions): HTMLCanvasElement {
  const { sourceCanvas, accentColor } = options;
  const value = clampNormalized(options.sliderValue);

  const artW = sourceCanvas.width;
  const artH = sourceCanvas.height;
  const stripW = computeExportStripWidth(artW, artH);

  const out = document.createElement('canvas');
  out.width = artW + stripW;
  out.height = artH;

  const ctx = out.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to acquire export 2D context');
  }

  // 1. Artwork canvas
  ctx.drawImage(sourceCanvas, 0, 0);

  // 2. Narrow right-side dark strip
  ctx.fillStyle = '#101012';
  ctx.fillRect(artW, 0, stripW, artH);

  // Faint 1px hairline seam so pure #000000 dark-mode artwork stays cleanly bounded
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fillRect(artW, 0, 1, artH);

  // 3. Embedded hairline vertical track
  const cx = artW + stripW / 2;
  const trackH = Math.max(48, Math.round(artH * 0.56));
  const trackTop = (artH - trackH) / 2;
  const trackBottom = trackTop + trackH;
  const trackWidth = Math.max(1.5, Math.min(3.5, stripW * 0.024));

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = trackWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, trackTop);
  ctx.lineTo(cx, trackBottom);
  ctx.stroke();

  // 4. Settled AccentColor dot at exact normalized position (top = 1, bottom = 0)
  const dotY = trackTop + (1 - value) * trackH;
  const dotRadius = Math.max(4, Math.min(stripW * 0.165, trackH * 0.028));

  ctx.shadowColor = 'rgba(0, 0, 0, 0.78)';
  ctx.shadowBlur = Math.max(3, dotRadius * 0.55);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.max(1, dotRadius * 0.18);

  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(cx, dotY, dotRadius, 0, Math.PI * 2);
  ctx.fill();

  // Subtle rim for legibility if AccentColor is very dark
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = Math.max(0.75, dotRadius * 0.08);
  ctx.stroke();
  ctx.restore();

  return out;
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      blob
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(() => resolve(null));
    }, 'image/png');
  });
}

export async function buildExportPngBlob(options: ExportOptions): Promise<{
  blob: Blob;
  filename: string;
  timestampMs: number;
} | null> {
  const timestampMs = options.timestampMs ?? Date.now();
  const value = clampNormalized(options.sliderValue);
  const composite = composeExportCanvas({ ...options, sliderValue: value });

  try {
    const rawBytes = await canvasToPngBytes(composite);
    if (!rawBytes) return null;

    const taggedBytes = injectPngTextMetadata(rawBytes, {
      'Experiences-Value': String(value),
      'Experiences-Timestamp-Ms': String(timestampMs),
      'Experiences-Timestamp-ISO': formatLocalIsoWithMs(timestampMs)
    });

    const blob = new Blob([taggedBytes.buffer as ArrayBuffer], {
      type: 'image/png'
    });
    return {
      blob,
      filename: `experiences-${timestampMs}.png`,
      timestampMs
    };
  } finally {
    // Release WebKit / mobile GPU backing store immediately
    composite.width = 0;
    composite.height = 0;
  }
}

export async function exportExperiencePng(options: ExportOptions): Promise<boolean> {
  const built = await buildExportPngBlob(options);
  if (!built) return false;

  const url = URL.createObjectURL(built.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = built.filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Delay revocation so Safari / Firefox complete download cleanly
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);

  return true;
}
