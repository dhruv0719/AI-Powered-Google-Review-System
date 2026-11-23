import { describe, it, expect } from 'vitest';
import {
  parseHexColor,
  getRelativeLuminance,
  getContrastRatio,
  getContrastingTextColor,
} from './contrast.js';

describe('contrast utility (WCAG 2.1 compliance)', () => {
  it('parses valid 6-digit hex colors into RGB correctly', () => {
    expect(parseHexColor('#2563EB')).toEqual({ r: 37, g: 99, b: 235 });
    expect(parseHexColor('ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('safely falls back to default #2563EB for null, undefined, or invalid hex inputs', () => {
    const fallback = { r: 37, g: 99, b: 235 };
    expect(parseHexColor(null)).toEqual(fallback);
    expect(parseHexColor(undefined)).toEqual(fallback);
    expect(parseHexColor('not-hex')).toEqual(fallback);
    expect(parseHexColor('#FFF')).toEqual(fallback); // 3-digit hex falls back safely
    expect(parseHexColor('#1234567')).toEqual(fallback);
  });

  it('calculates relative luminance according to sRGB specification', () => {
    expect(getRelativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1.0, 3);
    expect(getRelativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0.0, 3);
  });

  it('calculates contrast ratio correctly between 1:1 and 21:1', () => {
    expect(getContrastRatio(1.0, 0.0)).toBeCloseTo(21.0, 1);
    expect(getContrastRatio(1.0, 1.0)).toBeCloseTo(1.0, 1);
  });

  it('selects white text (#ffffff) for dark backgrounds to satisfy WCAG AA >= 4.5:1', () => {
    // Default Royal Blue #2563EB
    expect(getContrastingTextColor('#2563EB')).toBe('#ffffff');
    // Dark Rose #E11D48
    expect(getContrastingTextColor('#E11D48')).toBe('#ffffff');
    // Indigo #4F46E5
    expect(getContrastingTextColor('#4F46E5')).toBe('#ffffff');
    // Pure Black #000000
    expect(getContrastingTextColor('#000000')).toBe('#ffffff');
  });

  it('selects pure black text (#000000) for light backgrounds to satisfy WCAG AA >= 4.5:1', () => {
    // Light Emerald Green #10B981
    expect(getContrastingTextColor('#10B981')).toBe('#000000');
    // Light Amber #F59E0B
    expect(getContrastingTextColor('#F59E0B')).toBe('#000000');
    // Pure White #FFFFFF
    expect(getContrastingTextColor('#FFFFFF')).toBe('#000000');
    // Bright Yellow #FFFF00
    expect(getContrastingTextColor('#FFFF00')).toBe('#000000');
  });

  it('guarantees WCAG AA contrast >= 4.5:1 for worst-case mid-grays and boundary colors (#808080, #777777, #767676)', () => {
    const boundaryColors = [
      '#808080', // Mid-gray (luminance ~0.216) - where #111827 failed at 4.42:1
      '#777777', // Boundary mid-gray (luminance ~0.181)
      '#767676', // Classic WCAG boundary color (luminance ~0.178)
      '#555555', // Dark gray
      '#999999', // Light gray
      '#2563EB', // Brand blue
      '#10B981', // Brand green
      '#F59E0B', // Brand amber
      '#E11D48', // Brand rose
      '#000000', // Pure black
      '#ffffff', // Pure white
      '#333333', // Very dark gray
      '#cccccc', // Very light gray
    ];

    for (const bgHex of boundaryColors) {
      const chosenColor = getContrastingTextColor(bgHex);
      expect(['#ffffff', '#000000']).toContain(chosenColor);

      const bgRgb = parseHexColor(bgHex);
      const bgLum = getRelativeLuminance(bgRgb);
      const chosenLum = chosenColor === '#ffffff' ? 1.0 : 0.0;
      const ratio = getContrastRatio(bgLum, chosenLum);

      // Every single color must mathematically guarantee >= 4.5:1 contrast
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }

    // Specific assertion for #808080: contrast with #000000 is ~5.32:1
    const grayLum = getRelativeLuminance(parseHexColor('#808080'));
    const grayRatio = getContrastRatio(grayLum, 0.0);
    expect(grayRatio).toBeCloseTo(5.32, 1);
    expect(getContrastingTextColor('#808080')).toBe('#000000');

    // Specific assertion for #777777: contrast with #000000 is ~4.69:1 (>= 4.5:1)
    const gray77Lum = getRelativeLuminance(parseHexColor('#777777'));
    const gray77Ratio = getContrastRatio(gray77Lum, 0.0);
    expect(gray77Ratio).toBeCloseTo(4.69, 1);
    expect(gray77Ratio).toBeGreaterThanOrEqual(4.5);
    expect(getContrastingTextColor('#777777')).toBe('#000000');
  });

  it('falls back safely for null, undefined, and malformed colors', () => {
    expect(getContrastingTextColor(null)).toBe('#ffffff');
    expect(getContrastingTextColor(undefined)).toBe('#ffffff');
    expect(getContrastingTextColor('invalid-hex')).toBe('#ffffff');
  });
});
