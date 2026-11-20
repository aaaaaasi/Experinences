export type SliderState = 'floating' | 'dragging' | 'settled';

export interface SliderResult {
  value: number;
  accentColor: string;
}

export function clampNormalized(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Converts a clientY coordinate relative to a vertical track's top and height
 * into a normalized value in [0, 1] where top = 1 and bottom = 0.
 */
export function clientYToNormalizedValue(
  clientY: number,
  trackTop: number,
  trackHeight: number
): number {
  if (trackHeight <= 0) return 0.5;
  const ratioFromTop = (clientY - trackTop) / trackHeight;
  return clampNormalized(1 - ratioFromTop);
}

/**
 * Converts a normalized value in [0, 1] (top = 1, bottom = 0)
 * into a top-offset percentage in [0, 100].
 */
export function normalizedValueToTopPercent(value: number): number {
  return (1 - clampNormalized(value)) * 100;
}

export class SliderStateMachine {
  private _state: SliderState = 'floating';
  private _value = 0.5;

  get state(): SliderState {
    return this._state;
  }

  get value(): number {
    return this._value;
  }

  get canContinue(): boolean {
    return this._state === 'settled';
  }

  startDrag(): SliderState {
    this._state = 'dragging';
    return this._state;
  }

  updateValue(nextValue: number): number {
    this._value = clampNormalized(nextValue);
    return this._value;
  }

  endDrag(): SliderState {
    if (this._state === 'dragging') {
      this._state = 'floating';
    }
    return this._state;
  }

  tapOutside(): SliderState {
    if (this._state === 'floating') {
      this._state = 'settled';
    }
    return this._state;
  }
}

export function resolveAccentColor(probeEl: HTMLElement | null): string {
  const fallback = '#5b6cf9';
  if (!probeEl) return fallback;
  const computed = window.getComputedStyle(probeEl).backgroundColor;
  if (
    !computed ||
    computed === 'transparent' ||
    computed === 'rgba(0, 0, 0, 0)'
  ) {
    return fallback;
  }
  return computed;
}

export interface SliderControllerOptions {
  screenEl: HTMLElement;
  trackEl: HTMLElement;
  dotHitEl: HTMLElement;
  dotEl: HTMLElement;
  continueBtnEl: HTMLButtonElement;
  probeEl: HTMLElement;
  onContinue: (result: SliderResult) => void;
}

export interface SliderController {
  getValue: () => number;
  getAccentColor: () => string;
  destroy: () => void;
}

export function createSliderController(
  options: SliderControllerOptions
): SliderController {
  const {
    screenEl,
    trackEl,
    dotHitEl,
    dotEl,
    continueBtnEl,
    probeEl,
    onContinue
  } = options;

  const machine = new SliderStateMachine();
  let activePointerId: number | null = null;
  let dragOffsetY = 0;

  const syncView = (): void => {
    screenEl.dataset.state = machine.state;
    dotHitEl.style.top = `${normalizedValueToTopPercent(machine.value)}%`;
    continueBtnEl.tabIndex = machine.canContinue ? 0 : -1;
  };

  const applyClientY = (clientY: number): void => {
    const rect = trackEl.getBoundingClientRect();
    const nextValue = clientYToNormalizedValue(
      clientY - dragOffsetY,
      rect.top,
      rect.height
    );
    machine.updateValue(nextValue);
    syncView();
  };

  const onDotPointerDown = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    e.stopPropagation();
    e.preventDefault();

    activePointerId = e.pointerId;
    try {
      dotHitEl.setPointerCapture(e.pointerId);
    } catch {
      // Some synthetic environments do not support pointer capture
    }

    const dotRect = dotEl.getBoundingClientRect();
    const dotCenterY = dotRect.top + dotRect.height / 2;
    dragOffsetY = e.clientY - dotCenterY;

    machine.startDrag();
    syncView();
  };

  const onDotPointerMove = (e: PointerEvent): void => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    e.preventDefault();

    const events =
      typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const latest = events.length > 0 ? events[events.length - 1] : e;
    applyClientY(latest.clientY);
  };

  const finishDrag = (e: PointerEvent): void => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    activePointerId = null;
    dragOffsetY = 0;

    if (dotHitEl.hasPointerCapture?.(e.pointerId)) {
      try {
        dotHitEl.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    machine.endDrag();
    syncView();
  };

  const onScreenPointerDown = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const target = e.target as Node | null;
    if (!target) return;
    if (dotHitEl.contains(target) || continueBtnEl.contains(target)) {
      return;
    }

    machine.tapOutside();
    syncView();
  };

  const onContinueClick = (e: MouseEvent): void => {
    e.stopPropagation();
    if (!machine.canContinue) return;
    onContinue({
      value: machine.value,
      accentColor: resolveAccentColor(probeEl)
    });
  };

  const onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  dotHitEl.addEventListener('pointerdown', onDotPointerDown);
  dotHitEl.addEventListener('pointermove', onDotPointerMove);
  dotHitEl.addEventListener('pointerup', finishDrag);
  dotHitEl.addEventListener('pointercancel', finishDrag);
  dotHitEl.addEventListener('lostpointercapture', finishDrag);
  screenEl.addEventListener('pointerdown', onScreenPointerDown);
  screenEl.addEventListener('contextmenu', onContextMenu);
  continueBtnEl.addEventListener('click', onContinueClick);

  syncView();

  return {
    getValue: () => machine.value,
    getAccentColor: () => resolveAccentColor(probeEl),
    destroy: () => {
      dotHitEl.removeEventListener('pointerdown', onDotPointerDown);
      dotHitEl.removeEventListener('pointermove', onDotPointerMove);
      dotHitEl.removeEventListener('pointerup', finishDrag);
      dotHitEl.removeEventListener('pointercancel', finishDrag);
      dotHitEl.removeEventListener('lostpointercapture', finishDrag);
      screenEl.removeEventListener('pointerdown', onScreenPointerDown);
      screenEl.removeEventListener('contextmenu', onContextMenu);
      continueBtnEl.removeEventListener('click', onContinueClick);
    }
  };
}
