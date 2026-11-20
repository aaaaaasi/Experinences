import './styles.css';
import { createSliderController, resolveAccentColor } from './slider';
import { createCanvasEngine } from './canvasEngine';
import { exportExperiencePng } from './pngExport';

function mustGetEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required element #${id}`);
  }
  return el as T;
}

function bootstrap(): void {
  const screenSlider = mustGetEl<HTMLElement>('screen-slider');
  const sliderTrack = mustGetEl<HTMLElement>('slider-track');
  const sliderDotHit = mustGetEl<HTMLElement>('slider-dot-hit');
  const sliderDot = mustGetEl<HTMLElement>('slider-dot');
  const btnContinue = mustGetEl<HTMLButtonElement>('btn-continue');

  const screenCanvas = mustGetEl<HTMLElement>('screen-canvas');
  const canvasStage = mustGetEl<HTMLElement>('canvas-stage');
  const artCanvas = mustGetEl<HTMLCanvasElement>('art-canvas');
  const btnUpload = mustGetEl<HTMLButtonElement>('btn-upload');
  const fileInput = mustGetEl<HTMLInputElement>('file-input');
  const toolSlash = mustGetEl<HTMLButtonElement>('tool-slash');
  const toolDraw = mustGetEl<HTMLButtonElement>('tool-draw');
  const btnSave = mustGetEl<HTMLButtonElement>('btn-save');
  const accentProbe = mustGetEl<HTMLElement>('accent-probe');

  let settledSliderValue = 0.5;
  let settledAccentColor = resolveAccentColor(accentProbe);

  const canvasEngine = createCanvasEngine({
    screenEl: screenCanvas,
    stageEl: canvasStage,
    canvasEl: artCanvas,
    uploadBtnEl: btnUpload,
    fileInputEl: fileInput,
    slashBtnEl: toolSlash,
    drawBtnEl: toolDraw,
    saveBtnEl: btnSave,
    onSave: async (canvas) => {
      const liveAccent = resolveAccentColor(accentProbe) || settledAccentColor;
      await exportExperiencePng({
        sourceCanvas: canvas,
        sliderValue: settledSliderValue,
        accentColor: liveAccent
      });
    }
  });

  let hasContinued = false;

  createSliderController({
    screenEl: screenSlider,
    trackEl: sliderTrack,
    dotHitEl: sliderDotHit,
    dotEl: sliderDot,
    continueBtnEl: btnContinue,
    probeEl: accentProbe,
    onContinue: ({ value, accentColor }) => {
      if (hasContinued) return;
      hasContinued = true;
      settledSliderValue = value;
      settledAccentColor = accentColor;

      screenSlider.classList.remove('screen--active');
      screenCanvas.hidden = false;
      canvasEngine.activate();

      // Force style flush so opacity transition begins cleanly from 0 -> 1 on frame 1
      void screenCanvas.offsetWidth;
      screenCanvas.classList.add('screen--active');

      window.setTimeout(() => {
        screenSlider.hidden = true;
      }, 280);
    }
  });
}

bootstrap();
