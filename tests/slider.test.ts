import { describe, expect, it } from 'vitest';
import {
  SliderStateMachine,
  clampNormalized,
  clientYToNormalizedValue,
  normalizedValueToTopPercent
} from '../src/slider';

describe('slider math and state machine', () => {
  it('maps top of track to 1, middle to 0.5, bottom to 0, with clamping', () => {
    expect(clientYToNormalizedValue(100, 100, 200)).toBe(1);
    expect(clientYToNormalizedValue(200, 100, 200)).toBe(0.5);
    expect(clientYToNormalizedValue(300, 100, 200)).toBe(0);
    expect(clientYToNormalizedValue(50, 100, 200)).toBe(1);
    expect(clientYToNormalizedValue(450, 100, 200)).toBe(0);
    expect(clampNormalized(Number.NaN)).toBe(0.5);
    expect(normalizedValueToTopPercent(1)).toBe(0);
    expect(normalizedValueToTopPercent(0.5)).toBe(50);
    expect(normalizedValueToTopPercent(0)).toBe(100);
  });

  it('enforces floating -> dragging -> floating -> settled -> re-drag lift transitions', () => {
    const sm = new SliderStateMachine();

    expect(sm.state).toBe('floating');
    expect(sm.value).toBe(0.5);
    expect(sm.canContinue).toBe(false);

    // Drag dot
    sm.startDrag();
    expect(sm.state).toBe('dragging');
    expect(sm.canContinue).toBe(false);

    sm.updateValue(0.783412);
    expect(sm.value).toBe(0.783412);

    // Release dot stays floating (not yet settled)
    sm.endDrag();
    expect(sm.state).toBe('floating');
    expect(sm.canContinue).toBe(false);

    // Click outside settles dot and enables 继续
    sm.tapOutside();
    expect(sm.state).toBe('settled');
    expect(sm.canContinue).toBe(true);

    // Re-dragging dot lifts it back up and hides 继续 until re-settled
    sm.startDrag();
    expect(sm.state).toBe('dragging');
    expect(sm.canContinue).toBe(false);

    sm.updateValue(0.214);
    sm.endDrag();
    expect(sm.state).toBe('floating');
    expect(sm.canContinue).toBe(false);

    sm.tapOutside();
    expect(sm.state).toBe('settled');
    expect(sm.canContinue).toBe(true);
    expect(sm.value).toBe(0.214);
  });

  it('allows settling immediately at initial 0.5 without dragging first', () => {
    const sm = new SliderStateMachine();
    sm.tapOutside();
    expect(sm.state).toBe('settled');
    expect(sm.value).toBe(0.5);
    expect(sm.canContinue).toBe(true);
  });
});
