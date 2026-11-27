import { isValidGoogleReviewUrl } from '@review-system/shared';

/**
 * Utilities for copying review drafts to clipboard and navigating to Google Reviews safely.
 */

/**
 * Synchronously reserves a blank browser tab within the direct user interaction turn.
 * Retains window reference if opened, or returns null if blocked by the browser or not running in a browser.
 */
export function reserveExternalTab(): Window | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const tab = window.open('about:blank', '_blank');
    if (!tab || tab.closed || typeof tab.closed === 'undefined') {
      return null;
    }
    try {
      tab.opener = null;
    } catch {
      // Ignore if browser restricts setting opener on about:blank
    }
    return tab;
  } catch {
    return null;
  }
}

/**
 * Safely navigates a reserved tab to a validated Google Review URL with opener protection.
 * Closes the reserved tab if navigation fails or if the URL is invalid.
 * Returns true if navigation was successfully initiated on the tab, false otherwise.
 */
export function navigateReservedTab(tab: Window | null, url: string): boolean {
  if (!tab || tab.closed) {
    return false;
  }
  if (!url || typeof url !== 'string' || !isValidGoogleReviewUrl(url)) {
    try {
      tab.close();
    } catch {}
    return false;
  }
  try {
    tab.location.href = url;
    return true;
  } catch {
    try {
      tab.close();
    } catch {}
    return false;
  }
}

/**
 * Safely closes a reserved tab, e.g. when clipboard copying fails or an unsafe URL is detected.
 */
export function closeReservedTab(tab: Window | null): void {
  if (!tab || tab.closed) {
    return;
  }
  try {
    tab.close();
  } catch {}
}

/**
 * Copies review draft text to clipboard with modern Async Clipboard API and DOM textarea fallback.
 * Reports actual success or failure accurately.
 */
export async function copyDraftToClipboard(text: string): Promise<boolean> {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // 1. Modern Async Clipboard API
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to fallback
    }
  }

  // 2. DOM fallback using offscreen textarea for older browsers / iframe contexts
  if (typeof document !== 'undefined') {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.width = '2em';
      textArea.style.height = '2em';
      textArea.style.padding = '0';
      textArea.style.border = 'none';
      textArea.style.outline = 'none';
      textArea.style.boxShadow = 'none';
      textArea.style.background = 'transparent';
      textArea.style.opacity = '0';
      textArea.setAttribute('readonly', '');

      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      return Boolean(success);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Opens an external Google Review URL safely using window.open.
 * Validates URL with isValidGoogleReviewUrl and applies noopener, noreferrer.
 * Returns true if window.open succeeded, false if blocked or failed.
 */
export function openExternalGoogleReview(url: string): boolean {
  if (!url || typeof url !== 'string' || !isValidGoogleReviewUrl(url)) {
    return false;
  }
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win || win.closed || typeof win.closed === 'undefined') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
