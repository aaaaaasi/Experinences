export interface BrushPoint {
  x: number;
  y: number;
  time: number;
  pressure: number;
}

export interface InkStrokeConfig {
  color: string;
  pixelScale: number;
}

export class InkBrush {
  private prevPoint: BrushPoint | null = null;
  private prevMidX = 0;
  private prevMidY = 0;
  private currentWidth = 2.6;
  private hasMoved = false;

  begin(
    ctx: CanvasRenderingContext2D,
    pt: BrushPoint,
    config: InkStrokeConfig
  ): void {
    this.prevPoint = pt;
    this.prevMidX = pt.x;
    this.prevMidY = pt.y;
    this.hasMoved = false;

    const baseWidth = this.computeTargetWidth(0.2, pt.pressure, config.pixelScale);
    this.currentWidth = baseWidth;

    ctx.save();
    ctx.fillStyle = config.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, baseWidth * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  move(
    ctx: CanvasRenderingContext2D,
    pt: BrushPoint,
    config: InkStrokeConfig
  ): void {
    if (!this.prevPoint) {
      this.begin(ctx, pt, config);
      return;
    }

    const dx = pt.x - this.prevPoint.x;
    const dy = pt.y - this.prevPoint.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.35 * config.pixelScale) return;

    this.hasMoved = true;

    const dt = Math.max(1, pt.time - this.prevPoint.time);
    // Speed normalized to CSS px/ms
    const cssSpeed = dist / config.pixelScale / dt;
    const targetWidth = this.computeTargetWidth(
      cssSpeed,
      pt.pressure,
      config.pixelScale
    );

    const startWidth = this.currentWidth;
    const endWidth = startWidth + (targetWidth - startWidth) * 0.32;
    this.currentWidth = endWidth;

    const midX = (this.prevPoint.x + pt.x) * 0.5;
    const midY = (this.prevPoint.y + pt.y) * 0.5;

    this.stampQuadratic(
      ctx,
      this.prevMidX,
      this.prevMidY,
      this.prevPoint.x,
      this.prevPoint.y,
      midX,
      midY,
      startWidth,
      endWidth,
      config.color
    );

    this.prevMidX = midX;
    this.prevMidY = midY;
    this.prevPoint = pt;
  }

  end(ctx: CanvasRenderingContext2D, config: InkStrokeConfig): void {
    if (this.prevPoint && this.hasMoved) {
      const endWidth = Math.max(1.1 * config.pixelScale, this.currentWidth * 0.72);
      this.stampQuadratic(
        ctx,
        this.prevMidX,
        this.prevMidY,
        this.prevPoint.x,
        this.prevPoint.y,
        this.prevPoint.x,
        this.prevPoint.y,
        this.currentWidth,
        endWidth,
        config.color
      );
    }
    this.prevPoint = null;
    this.hasMoved = false;
  }

  private computeTargetWidth(
    cssSpeed: number,
    pressure: number,
    pixelScale: number
  ): number {
    // Fast strokes taper razor-thin; slow deliberate strokes widen organically
    const speedNorm = Math.min(1, cssSpeed / 2.2);
    const speedFactor = 1 - speedNorm * 0.68;
    const hasRealPressure = pressure > 0 && pressure !== 0.5 && pressure < 1;
    const pressureFactor = hasRealPressure ? 0.55 + pressure * 0.9 : 1;

    const cssWidth = Math.max(
      1.35,
      Math.min(7.2, (1.5 + 4.2 * speedFactor) * pressureFactor)
    );
    return cssWidth * pixelScale;
  }

  private stampQuadratic(
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    cx: number,
    cy: number,
    x1: number,
    y1: number,
    w0: number,
    w1: number,
    color: string
  ): void {
    const chord = Math.hypot(x1 - x0, y1 - y0);
    const ctrl = Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy);
    const approxLen = (chord + ctrl) * 0.5;
    const minRadius = Math.max(0.5, Math.min(w0, w1) * 0.5);
    const step = Math.max(0.55, minRadius * 0.34);
    const steps = Math.max(1, Math.ceil(approxLen / step));

    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
      const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
      const r = Math.max(0.45, (w0 + (w1 - w0) * t) * 0.5);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }

    ctx.fill();
    ctx.restore();
  }
}
