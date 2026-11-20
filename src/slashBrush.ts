import type { BrushPoint } from './inkBrush';

export interface SlashConfig {
  pixelScale: number;
}

function hash1D(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function valueNoise1D(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1D(i + seed * 57.3);
  const b = hash1D(i + 1 + seed * 57.3);
  return a + (b - a) * u;
}

function fbm1D(x: number, seed: number): number {
  return (
    valueNoise1D(x * 0.618, seed) * 0.56 +
    valueNoise1D(x * 1.732 + 13.1, seed + 19.7) * 0.29 +
    valueNoise1D(x * 4.141 + 37.9, seed + 83.3) * 0.15
  );
}

function hash2D(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Composite pixel-level slash/tear engine.
 * Operates directly on the backing canvas pixel buffer (photo + existing ink strokes +
 * previous tears) to displace pixels outward across an organic jagged fissure and leave
 * a dry, restrained crimson trace along the fractured edge.
 */
export class SlashBrush {
  private prevPoint: BrushPoint | null = null;
  private strokeSeed = 0;
  private arcLength = 0;
  private smoothedSpeed = 0.6;

  begin(pt: BrushPoint): void {
    this.prevPoint = pt;
    this.strokeSeed = Math.random() * 1000;
    this.arcLength = 0;
    this.smoothedSpeed = 0.6;
  }

  move(
    ctx: CanvasRenderingContext2D,
    pt: BrushPoint,
    config: SlashConfig
  ): void {
    if (!this.prevPoint) {
      this.begin(pt);
      return;
    }

    const dx = pt.x - this.prevPoint.x;
    const dy = pt.y - this.prevPoint.y;
    const totalDist = Math.hypot(dx, dy);
    const scale = Math.max(0.85, Math.min(config.pixelScale, 8));

    if (totalDist < 1.1 * scale) return;

    const dt = Math.max(1, pt.time - this.prevPoint.time);
    const instantSpeed = totalDist / scale / dt;
    this.smoothedSpeed = this.smoothedSpeed * 0.65 + instantSpeed * 0.35;

    // Fast slash: tight razor split; slow/heavy slash: deeper wider tear
    const speedNorm = Math.min(1, this.smoothedSpeed / 2.6);
    const hasRealPressure =
      pt.pressure > 0 && pt.pressure !== 0.5 && pt.pressure < 1;
    const pressureBoost = hasRealPressure ? 0.75 + pt.pressure * 0.55 : 1;

    const tearRadius = (11 + (1 - speedNorm) * 6.5) * scale * pressureBoost;
    const displaceAmp = (3.8 + (1 - speedNorm) * 3.8) * scale * pressureBoost;
    const shearAmp = (1.8 + speedNorm * 2.4) * scale;
    const baseCoreW = (0.72 + (1 - speedNorm) * 0.95) * scale * pressureBoost;
    const redSpread = (2.1 + (1 - speedNorm) * 2.1) * scale * pressureBoost;

    // Subdivide long swipes into compact local segments so each AABB stays tiny and fast
    const maxStep = Math.max(12 * scale, tearRadius * 1.25);
    const subSteps = Math.max(1, Math.ceil(totalDist / maxStep));

    let sx0 = this.prevPoint.x;
    let sy0 = this.prevPoint.y;

    for (let i = 1; i <= subSteps; i++) {
      const ratio = i / subSteps;
      const sx1 = this.prevPoint.x + dx * ratio;
      const sy1 = this.prevPoint.y + dy * ratio;
      const segLen = totalDist / subSteps;

      this.applySegment(
        ctx,
        sx0,
        sy0,
        sx1,
        sy1,
        segLen,
        this.arcLength,
        scale,
        tearRadius,
        displaceAmp,
        shearAmp,
        baseCoreW,
        redSpread
      );

      this.arcLength += segLen;
      sx0 = sx1;
      sy0 = sy1;
    }

    this.prevPoint = pt;
  }

  end(): void {
    this.prevPoint = null;
  }

  private applySegment(
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    segLen: number,
    arcStart: number,
    scale: number,
    tearRadius: number,
    displaceAmp: number,
    shearAmp: number,
    baseCoreW: number,
    redSpread: number
  ): void {
    const canvasW = ctx.canvas.width;
    const canvasH = ctx.canvas.height;
    if (canvasW === 0 || canvasH === 0 || segLen <= 0.001) return;

    const tx = (x1 - x0) / segLen;
    const ty = (y1 - y0) / segLen;
    const nx = -ty;
    const ny = tx;

    const pad = Math.ceil(tearRadius + displaceAmp + shearAmp + 4 * scale);
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
    const maxX = Math.min(canvasW - 1, Math.ceil(Math.max(x0, x1) + pad));
    const maxY = Math.min(canvasH - 1, Math.ceil(Math.max(y0, y1) + pad));

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    if (boxW <= 0 || boxH <= 0) return;

    const imageData = ctx.getImageData(minX, minY, boxW, boxH);
    const src = imageData.data;
    const dst = new Uint8ClampedArray(src);

    const maxXLocal = boxW - 1;
    const maxYLocal = boxH - 1;
    const invScale = 1 / scale;

    for (let ly = 0; ly < boxH; ly++) {
      const py = minY + ly;
      const relY = py - y0;

      for (let lx = 0; lx < boxW; lx++) {
        const px = minX + lx;
        const relX = px - x0;

        // Exact half-open axial slice prevents double-displacement seams between consecutive segments
        const proj = relX * tx + relY * ty;
        if (proj < 0 || proj >= segLen) continue;

        const arcPos = arcStart + proj;
        const arcNorm = arcPos * invScale;

        // Sharp entry taper at the beginning of a slash
        const entryTaper = smoothstep(0, 14 * scale, arcPos);
        const taper = 0.28 + 0.72 * entryTaper;

        // Organic aperiodic jagged tear centerline
        const wobble = (fbm1D(arcNorm * 0.085, this.strokeSeed) - 0.5) * 3.2 * scale;
        const microJag =
          (valueNoise1D(arcNorm * 0.31, this.strokeSeed + 71.3) - 0.5) *
          0.95 *
          scale;
        const signedD = relX * nx + relY * ny - (wobble + microJag);
        const absD = Math.abs(signedD);

        if (absD > tearRadius) continue;

        const side = signedD >= 0 ? 1 : -1;
        const grain = hash2D(px + 0.37, py + 0.71);
        const sideNoise = fbm1D(
          arcNorm * 0.19 + side * 17.3,
          this.strokeSeed + 203.1
        );

        // 1. Physical pixel tear (sample inward toward crack -> pushes pixels outward)
        const radial = 1 - absD / tearRadius;
        const falloff = radial * radial * (3 - 2 * radial);
        const dispMag =
          displaceAmp * falloff * taper * (0.68 + 0.64 * sideNoise);
        const shearMag = shearAmp * falloff * taper * (0.45 + 0.55 * grain);

        const sampleLx = Math.max(
          0,
          Math.min(maxXLocal, lx + nx * (-side * dispMag) + tx * (-shearMag))
        );
        const sampleLy = Math.max(
          0,
          Math.min(maxYLocal, ly + ny * (-side * dispMag) + ty * (-shearMag))
        );

        // Bilinear sample from pre-step composite buffer
        const sx0i = Math.floor(sampleLx);
        const sy0i = Math.floor(sampleLy);
        const sx1i = Math.min(maxXLocal, sx0i + 1);
        const sy1i = Math.min(maxYLocal, sy0i + 1);
        const fx = sampleLx - sx0i;
        const fy = sampleLy - sy0i;
        const mfx = 1 - fx;
        const mfy = 1 - fy;

        const i00 = (sy0i * boxW + sx0i) * 4;
        const i10 = (sy0i * boxW + sx1i) * 4;
        const i01 = (sy1i * boxW + sx0i) * 4;
        const i11 = (sy1i * boxW + sx1i) * 4;

        const w00 = mfx * mfy;
        const w10 = fx * mfy;
        const w01 = mfx * fy;
        const w11 = fx * fy;

        let r = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
        let g =
          src[i00 + 1] * w00 +
          src[i10 + 1] * w10 +
          src[i01 + 1] * w01 +
          src[i11 + 1] * w11;
        let b =
          src[i00 + 2] * w00 +
          src[i10 + 2] * w10 +
          src[i01 + 2] * w01 +
          src[i11 + 2] * w11;

        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        // 2. Jagged recessed fissure core + dark-surface torn fiber rim
        const widthMod = 0.58 + 0.88 * valueNoise1D(arcNorm * 0.34, this.strokeSeed + 41.9);
        const coreW = baseCoreW * widthMod * (0.45 + 0.55 * entryTaper);

        if (absD < coreW * 2.2) {
          if (absD < coreW) {
            const coreStrength =
              smoothstep(coreW, coreW * 0.15, absD) * taper * (0.82 + 0.18 * grain);
            const coreR = lum > 44 ? 22 : 8;
            const coreG = lum > 44 ? 8 : 3;
            const coreB = lum > 44 ? 10 : 4;
            r += (coreR - r) * coreStrength;
            g += (coreG - g) * coreStrength;
            b += (coreB - b) * coreStrength;
          } else if (lum < 48) {
            // Subtle distressed fiber highlight along tear rim on pure black surfaces
            const rimBand =
              smoothstep(coreW * 2.15, coreW * 1.15, absD) *
              smoothstep(coreW * 0.85, coreW * 1.15, absD);
            const rimAlpha = rimBand * taper * (0.28 + 0.44 * grain) * 0.55;
            r += (110 - r) * rimAlpha;
            g += (52 - g) * rimAlpha;
            b += (56 - b) * rimAlpha;
          }
        }

        // 3. Dry, crisp asymmetric crimson trace along the fractured edge
        const redZone = coreW + redSpread * (0.35 + 1.05 * sideNoise);
        if (absD < redZone) {
          const edgeDist = Math.max(0, absD - coreW * 0.3);
          const redFalloff = Math.max(0, 1 - edgeDist / Math.max(0.5, redZone - coreW * 0.3));
          const dryTexture = 0.26 + 0.74 * (grain * 0.52 + sideNoise * 0.48);

          // Occasional subtle frayed parallel splinter scratches
          const splinter =
            absD > coreW * 1.25 &&
            absD < coreW * 2.3 &&
            sideNoise > 0.78 &&
            grain > 0.64
              ? 0.24
              : 0;

          const redAlpha = Math.min(
            0.82,
            (redFalloff * redFalloff * dryTexture * 0.76 + splinter) * taper
          );

          // Deeper oxblood near fissure core, sharper dry crimson along outer scrape
          const outerMix = Math.min(1, absD / Math.max(1, redZone));
          const pigR = 122 + outerMix * 68;
          const pigG = 14 + outerMix * 16;
          const pigB = 20 + outerMix * 18;

          r += (pigR - r) * redAlpha;
          g += (pigG - g) * redAlpha;
          b += (pigB - b) * redAlpha;
        }

        const dstIdx = (ly * boxW + lx) * 4;
        dst[dstIdx] = r;
        dst[dstIdx + 1] = g;
        dst[dstIdx + 2] = b;
        dst[dstIdx + 3] = 255;
      }
    }

    imageData.data.set(dst);
    ctx.putImageData(imageData, minX, minY);
  }
}
