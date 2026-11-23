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

  it('selects dark text (#111827) for light backgrounds to satisfy WCAG AA >= 4.5:1', () => {
    // Light Emerald Green #10B981
    expect(getContrastingTextColor('#10B981')).toBe('#111827');
    // Light Amber #F59E0B
    expect(getContrastingTextColor('#F59E0B')).toBe('#111827');
    // Pure White #FFFFFF
    expect(getContrastingTextColor('#FFFFFF')).toBe('#111827');
    // Bright Yellow #FFFF00
    expect(getContrastingTextColor('#FFFF00')).toBe('#111827');
  });

  it('falls back safely for null, undefined, and malformed colors', () => {
    expect(getContrastingTextColor(null)).toBe('#ffffff');
    expect(getContrastingTextColor(undefined)).toBe('#ffffff');
    expect(getContrastingTextColor('invalid-hex')).toBe('#ffffff');
  });
});
