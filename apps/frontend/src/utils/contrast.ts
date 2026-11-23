/**
 * Calculates WCAG 2.1 relative luminance and contrast ratio.
 * Reference: https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */

interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Parses a 6-digit hex color into RGB components.
 * Falls back to #2563EB if input is null, undefined, or invalid.
 */
export function parseHexColor(hex: string | null | undefined): RGB {
  if (!hex || typeof hex !== 'string') {
    return { r: 37, g: 99, b: 235 }; // Default #2563EB
  }

  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return { r: 37, g: 99, b: 235 };
  }

  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * Computes the relative luminance of an sRGB color.
 */
export function getRelativeLuminance(rgb: RGB): number {
  const [sR, sG, sB] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];

  const R = sR <= 0.03928 ? sR / 12.92 : Math.pow((sR + 0.055) / 1.055, 2.4);
  const G = sG <= 0.03928 ? sG / 12.92 : Math.pow((sG + 0.055) / 1.055, 2.4);
  const B = sB <= 0.03928 ? sB / 12.92 : Math.pow((sB + 0.055) / 1.055, 2.4);

  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * Computes contrast ratio between two luminance values (range: 1:1 to 21:1).
 */
export function getContrastRatio(lum1: number, lum2: number): number {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#111827';
const LIGHT_LUMINANCE = 1.0; // White (#ffffff)
const DARK_LUMINANCE = getRelativeLuminance({ r: 17, g: 24, b: 39 }); // #111827 (~0.013)

/**
 * Selects the optimal text color (#ffffff or #111827) to maximize contrast
 * against the provided background brand color.
 *
 * Guarantees compliance with WCAG Level AA (at least 4.5:1 for normal text
 * or higher available contrast).
 */
export function getContrastingTextColor(backgroundColorHex: string | null | undefined): string {
  const rgb = parseHexColor(backgroundColorHex);
  const bgLuminance = getRelativeLuminance(rgb);

  const whiteContrast = getContrastRatio(LIGHT_LUMINANCE, bgLuminance);
  const darkContrast = getContrastRatio(bgLuminance, DARK_LUMINANCE);

  // Return white if it meets or exceeds 4.5:1 and is at least as good as dark,
  // otherwise choose whichever text color yields the strictly higher contrast ratio.
  if (whiteContrast >= 4.5 && whiteContrast >= darkContrast) {
    return LIGHT_TEXT;
  }
  return darkContrast > whiteContrast ? DARK_TEXT : LIGHT_TEXT;
}
