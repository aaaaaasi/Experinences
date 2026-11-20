import { InkBrush, type BrushPoint } from './inkBrush';
import { SlashBrush } from './slashBrush';

export type CanvasTool = 'slash' | 'draw';

const MAX_IMAGE_EDGE = 2560;
const MAX_IMAGE_PIXELS = 4_200_000;

export interface CanvasEngineOptions {
  screenEl: HTMLElement;
  stageEl: HTMLElement;
  canvasEl: HTMLCanvasElement;
  uploadBtnEl: HTMLButtonElement;
  fileInputEl: HTMLInputElement;
  slashBtnEl: HTMLButtonElement;
  drawBtnEl: HTMLButtonElement;
  saveBtnEl: HTMLButtonElement;
  onSave: (canvas: HTMLCanvasElement) => Promise<void>;
}

export interface CanvasEngine {
  activate: () => void;
  getTool: () => CanvasTool;
  getCanvas: () => HTMLCanvasElement;
  destroy: () => void;
}

function isDarkColorScheme(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function getThemeBgColor(): string {
  return isDarkColorScheme() ? '#000000' : '#ffffff';
}

function getThemeInkColor(): string {
  return isDarkColorScheme() ? '#f2f2f2' : '#111111';
}

export function computeSafeImageDimensions(
  naturalWidth: number,
  naturalHeight: number
): { width: number; height: number } {
  let w = Math.max(1, naturalWidth);
  let h = Math.max(1, naturalHeight);

  const maxDim = Math.max(w, h);
  if (maxDim > MAX_IMAGE_EDGE) {
    const ratio = MAX_IMAGE_EDGE / maxDim;
    w *= ratio;
    h *= ratio;
  }

  const area = w * h;
  if (area > MAX_IMAGE_PIXELS) {
    const ratio = Math.sqrt(MAX_IMAGE_PIXELS / area);
    w *= ratio;
    h *= ratio;
  }

  return {
    width: Math.max(1, Math.round(w)),
    height: Math.max(1, Math.round(h))
  };
}

function loadImageElement(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';

    const cleanup = (): void => {
      URL.revokeObjectURL(url);
    };

    img.onload = () => {
      const done = (): void => {
        cleanup();
        resolve(img);
      };
      if (typeof img.decode === 'function') {
        img.decode().then(done, done);
      } else {
        done();
      }
    };

    img.onerror = () => {
      cleanup();
      resolve(null);
    };

    img.src = url;
  });
}

export function createCanvasEngine(options: CanvasEngineOptions): CanvasEngine {
  const {
    screenEl,
    stageEl,
    canvasEl,
    uploadBtnEl,
    fileInputEl,
    slashBtnEl,
    drawBtnEl,
    saveBtnEl,
    onSave
  } = options;

  const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to acquire 2D canvas context');
  }

  const slashBrush = new SlashBrush();
  const inkBrush = new InkBrush();

  let activeTool: CanvasTool = 'slash';
  let untouched = true;
  let hasImage = false;
  let activePointerId: number | null = null;
  let isSaving = false;
  let initialized = false;
  let uploadPendingPointer: {
    pointerId: number;
    clientX: number;
    clientY: number;
    startPoint: BrushPoint;
    startPixelScale: number;
  } | null = null;
  let suppressNextUploadClick = false;

  const syncToolUi = (): void => {
    slashBtnEl.classList.toggle('tool-btn--active', activeTool === 'slash');
    drawBtnEl.classList.toggle('tool-btn--active', activeTool === 'draw');
  };

  const markTouched = (): void => {
    if (!untouched) return;
    untouched = false;
    screenEl.dataset.untouched = 'false';
  };

  const fitCanvasDisplaySize = (): void => {
    if (!hasImage && untouched) {
      const rect = stageEl.getBoundingClientRect();
      const cssW = Math.max(1, Math.round(rect.width || window.innerWidth));
      const cssH = Math.max(1, Math.round(rect.height || window.innerHeight));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      const safe = computeSafeImageDimensions(cssW * dpr, cssH * dpr);
      canvasEl.width = safe.width;
      canvasEl.height = safe.height;
      canvasEl.style.width = `${cssW}px`;
      canvasEl.style.height = `${cssH}px`;

      ctx.fillStyle = getThemeBgColor();
      ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
      return;
    }

    // Preserve existing artwork pixels; only compute fitted CSS dimensions
    const stageStyle = window.getComputedStyle(stageEl);
    const padX =
      parseFloat(stageStyle.paddingLeft || '0') +
      parseFloat(stageStyle.paddingRight || '0');
    const padY =
      parseFloat(stageStyle.paddingTop || '0') +
      parseFloat(stageStyle.paddingBottom || '0');

    const availW = Math.max(1, stageEl.clientWidth - padX);
    const availH = Math.max(1, stageEl.clientHeight - padY);
    const artW = Math.max(1, canvasEl.width);
    const artH = Math.max(1, canvasEl.height);

    const scale = Math.min(availW / artW, availH / artH);
    canvasEl.style.width = `${Math.max(1, Math.floor(artW * scale))}px`;
    canvasEl.style.height = `${Math.max(1, Math.floor(artH * scale))}px`;
  };

  const handleImageFile = async (file: File | null | undefined): Promise<void> => {
    if (!file || !untouched) return;
    if (file.type && !file.type.startsWith('image/')) return;

    const img = await loadImageElement(file);
    if (!img || !untouched) return;

    const natW = img.naturalWidth || img.width;
    const natH = img.naturalHeight || img.height;
    if (natW <= 0 || natH <= 0) return;

    const target = computeSafeImageDimensions(natW, natH);
    canvasEl.width = target.width;
    canvasEl.height = target.height;

    // Fill solid background first so transparent PNG/WebP has an opaque tearable surface
    ctx.fillStyle = getThemeBgColor();
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(img, 0, 0, target.width, target.height);

    hasImage = true;
    screenEl.dataset.hasImage = 'true';
    markTouched();
    fitCanvasDisplaySize();
  };

  const getPointerCanvasMetrics = (
    e: PointerEvent
  ): { point: BrushPoint; pixelScale: number } => {
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvasEl.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvasEl.height / rect.height : 1;
    const pixelScale = (scaleX + scaleY) * 0.5;

    return {
      point: {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
        time: e.timeStamp || performance.now(),
        pressure: e.pressure
      },
      pixelScale
    };
  };

  const onCanvasPointerDown = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (activePointerId !== null) return;

    e.preventDefault();
    activePointerId = e.pointerId;
    try {
      canvasEl.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    markTouched();

    const { point, pixelScale } = getPointerCanvasMetrics(e);
    if (activeTool === 'slash') {
      slashBrush.begin(point);
    } else {
      inkBrush.begin(ctx, point, {
        color: getThemeInkColor(),
        pixelScale
      });
    }
  };

  const onCanvasPointerMove = (e: PointerEvent): void => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    e.preventDefault();

    const coalesced =
      typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const samples = coalesced.length > 0 ? coalesced : [e];

    for (const sample of samples) {
      const { point, pixelScale } = getPointerCanvasMetrics(sample);
      if (activeTool === 'slash') {
        slashBrush.move(ctx, point, { pixelScale });
      } else {
        inkBrush.move(ctx, point, {
          color: getThemeInkColor(),
          pixelScale
        });
      }
    }
  };

  const finishStroke = (e: PointerEvent): void => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    activePointerId = null;

    if (canvasEl.hasPointerCapture?.(e.pointerId)) {
      try {
        canvasEl.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    const { pixelScale } = getPointerCanvasMetrics(e);
    if (activeTool === 'slash') {
      slashBrush.end();
    } else {
      inkBrush.end(ctx, {
        color: getThemeInkColor(),
        pixelScale
      });
    }
  };

  const onUploadPointerDown = (e: PointerEvent): void => {
    if (!untouched || !e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    suppressNextUploadClick = false;
    const { point, pixelScale } = getPointerCanvasMetrics(e);
    uploadPendingPointer = {
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      startPoint: point,
      startPixelScale: pixelScale
    };
  };

  const onUploadPointerMove = (e: PointerEvent): void => {
    if (!uploadPendingPointer || e.pointerId !== uploadPendingPointer.pointerId) {
      return;
    }
    const dist = Math.hypot(
      e.clientX - uploadPendingPointer.clientX,
      e.clientY - uploadPendingPointer.clientY
    );
    if (dist < 6) return;

    // User started swiping directly over the center icon -> dismiss upload icon & draw seamlessly
    const pending = uploadPendingPointer;
    uploadPendingPointer = null;
    suppressNextUploadClick = true;

    activePointerId = e.pointerId;
    try {
      canvasEl.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    markTouched();

    const { point, pixelScale } = getPointerCanvasMetrics(e);
    if (activeTool === 'slash') {
      slashBrush.begin(pending.startPoint);
      slashBrush.move(ctx, point, { pixelScale });
    } else {
      inkBrush.begin(ctx, pending.startPoint, {
        color: getThemeInkColor(),
        pixelScale: pending.startPixelScale
      });
      inkBrush.move(ctx, point, {
        color: getThemeInkColor(),
        pixelScale
      });
    }
  };

  const clearUploadPending = (e: PointerEvent): void => {
    if (uploadPendingPointer && e.pointerId === uploadPendingPointer.pointerId) {
      uploadPendingPointer = null;
    }
  };

  const onUploadClick = (e: MouseEvent): void => {
    e.stopPropagation();
    if (suppressNextUploadClick) {
      suppressNextUploadClick = false;
      return;
    }
    if (!untouched) return;
    fileInputEl.value = '';
    fileInputEl.click();
  };

  const onFileChange = (): void => {
    const file = fileInputEl.files?.[0];
    fileInputEl.value = '';
    void handleImageFile(file);
  };

  const onDragOver = (e: DragEvent): void => {
    if (!untouched) return;
    e.preventDefault();
  };

  const onDrop = (e: DragEvent): void => {
    if (!untouched) return;
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    void handleImageFile(file);
  };

  const onPaste = (e: ClipboardEvent): void => {
    if (screenEl.hidden || !untouched) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void handleImageFile(file);
          return;
        }
      }
    }
  };

  const onSlashClick = (): void => {
    activeTool = 'slash';
    syncToolUi();
  };

  const onDrawClick = (): void => {
    activeTool = 'draw';
    syncToolUi();
  };

  const onSaveClick = async (): Promise<void> => {
    if (isSaving) return;
    isSaving = true;
    saveBtnEl.classList.add('is-saving');
    try {
      await onSave(canvasEl);
    } finally {
      window.setTimeout(() => {
        saveBtnEl.classList.remove('is-saving');
        isSaving = false;
      }, 160);
    }
  };

  const onResize = (): void => {
    if (!initialized || screenEl.hidden) return;
    fitCanvasDisplaySize();
  };

  const colorSchemeMedia =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  const onColorSchemeChange = (): void => {
    if (!initialized || !untouched || hasImage) return;
    ctx.fillStyle = getThemeBgColor();
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
  };

  const onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  canvasEl.addEventListener('pointerdown', onCanvasPointerDown);
  canvasEl.addEventListener('pointermove', onCanvasPointerMove);
  canvasEl.addEventListener('pointerup', finishStroke);
  canvasEl.addEventListener('pointercancel', finishStroke);
  canvasEl.addEventListener('lostpointercapture', finishStroke);
  canvasEl.addEventListener('contextmenu', onContextMenu);

  const onSaveBtnClick = (): void => {
    void onSaveClick();
  };

  uploadBtnEl.addEventListener('pointerdown', onUploadPointerDown);
  window.addEventListener('pointermove', onUploadPointerMove);
  window.addEventListener('pointerup', clearUploadPending);
  window.addEventListener('pointercancel', clearUploadPending);
  uploadBtnEl.addEventListener('click', onUploadClick);
  fileInputEl.addEventListener('change', onFileChange);
  screenEl.addEventListener('dragover', onDragOver);
  screenEl.addEventListener('drop', onDrop);
  window.addEventListener('paste', onPaste);
  window.addEventListener('resize', onResize);

  slashBtnEl.addEventListener('click', onSlashClick);
  drawBtnEl.addEventListener('click', onDrawClick);
  saveBtnEl.addEventListener('click', onSaveBtnClick);

  if (colorSchemeMedia) {
    if (typeof colorSchemeMedia.addEventListener === 'function') {
      colorSchemeMedia.addEventListener('change', onColorSchemeChange);
    }
  }

  syncToolUi();

  return {
    activate: () => {
      if (!initialized) {
        initialized = true;
        screenEl.dataset.hasImage = 'false';
        screenEl.dataset.untouched = 'true';
      }
      fitCanvasDisplaySize();
    },
    getTool: () => activeTool,
    getCanvas: () => canvasEl,
    destroy: () => {
      canvasEl.removeEventListener('pointerdown', onCanvasPointerDown);
      canvasEl.removeEventListener('pointermove', onCanvasPointerMove);
      canvasEl.removeEventListener('pointerup', finishStroke);
      canvasEl.removeEventListener('pointercancel', finishStroke);
      canvasEl.removeEventListener('lostpointercapture', finishStroke);
      canvasEl.removeEventListener('contextmenu', onContextMenu);
      uploadBtnEl.removeEventListener('pointerdown', onUploadPointerDown);
      window.removeEventListener('pointermove', onUploadPointerMove);
      window.removeEventListener('pointerup', clearUploadPending);
      window.removeEventListener('pointercancel', clearUploadPending);
      uploadBtnEl.removeEventListener('click', onUploadClick);
      fileInputEl.removeEventListener('change', onFileChange);
      screenEl.removeEventListener('dragover', onDragOver);
      screenEl.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('resize', onResize);
      slashBtnEl.removeEventListener('click', onSlashClick);
      drawBtnEl.removeEventListener('click', onDrawClick);
      saveBtnEl.removeEventListener('click', onSaveBtnClick);
      if (colorSchemeMedia?.removeEventListener) {
        colorSchemeMedia.removeEventListener('change', onColorSchemeChange);
      }
    }
  };
}
