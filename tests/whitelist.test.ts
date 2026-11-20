import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeSafeImageDimensions } from '../src/canvasEngine';
import { computeExportStripWidth } from '../src/pngExport';

const WHITELIST = new Set(['继续', '划', '画', '保存']);

describe('strict 4-word whitelist & responsive safety bounds', () => {
  it('contains strictly and exclusively the 4 whitelisted words inside index.html body', () => {
    const htmlPath = resolve(process.cwd(), 'index.html');
    const html = readFileSync(htmlPath, 'utf-8');
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const texts: string[] = [];
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parentTag = node.parentElement?.tagName.toLowerCase();
      if (parentTag === 'script' || parentTag === 'style') continue;
      const trimmed = (node.textContent ?? '').trim();
      if (trimmed.length > 0) {
        texts.push(trimmed);
      }
    }

    expect(texts.sort()).toEqual(Array.from(WHITELIST).sort());
    for (const word of texts) {
      expect(WHITELIST.has(word)).toBe(true);
    }

    // Ensure zero native hover tooltips / placeholder / alt attributes leak text
    const allElements = Array.from(doc.body.querySelectorAll('*'));
    for (const el of allElements) {
      expect(el.hasAttribute('title')).toBe(false);
      expect(el.hasAttribute('placeholder')).toBe(false);
      expect(el.hasAttribute('alt')).toBe(false);
      expect(el.hasAttribute('aria-label')).toBe(false);
    }
  });

  it('caps uploaded photo dimensions safely below iOS Safari memory limits while preserving aspect ratio', () => {
    // 48MP iPhone photo (8000x6000 = 4:3)
    const big = computeSafeImageDimensions(8000, 6000);
    expect(big.width * big.height).toBeLessThanOrEqual(4_200_000);
    expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(2560);
    expect(big.width / big.height).toBeCloseTo(4 / 3, 2);

    // Tall phone screenshot (1170x2532)
    const tall = computeSafeImageDimensions(1170, 2532);
    expect(tall.width).toBe(1170);
    expect(tall.height).toBe(2532);
  });

  it('computes a graceful narrow dark export strip width across extreme aspect ratios', () => {
    const normal = computeExportStripWidth(1200, 900);
    expect(normal).toBe(108); // 9% of 1200

    const ultrawide = computeExportStripWidth(2400, 600);
    expect(ultrawide).toBeGreaterThanOrEqual(180);
    expect(ultrawide).toBeLessThanOrEqual(336);

    const narrow = computeExportStripWidth(360, 800);
    expect(narrow).toBeGreaterThanOrEqual(36);
  });
});
