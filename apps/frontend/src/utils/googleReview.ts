import { isValidGoogleReviewUrl } from '@review-system/shared';

/**
 * Utilities for copying review drafts to clipboard and navigating to Google Reviews safely.
 */

/**
 * Synchronously initiates a clipboard write operation within the direct user gesture turn.
 * Crucial: this must be invoked synchronously before any window.open() or await statement
 * so that document.hasFocus() is true and navigator.userActivation.isActive is preserved.
 *
 * Security: This function strictly performs WRITE operations (writeText). It NEVER calls
 * readText() or read(), and NEVER requests clipboard-read permissions.
 */
export function initiateClipboardWrite(text: string): Promise<boolean> {
  if (!text || typeof text !== 'string') {
    return Promise.resolve(false);
  }

  // 1. Modern Async Clipboard API - writeText only
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      return navigator.clipboard.writeText(text).then(
        () => true,
        (err) => {
          // Log only safe diagnostic info (error name, secure context), never clipboard contents
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[Clipboard] writeText rejected:', err?.name || 'Error', getSafeBrowserDiagnostics());
          }
          return fallbackDomCopy(text);
        }
      );
    } catch (err: any) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[Clipboard] writeText threw synchronously:', err?.name || 'Error', getSafeBrowserDiagnostics());
      }
      return Promise.resolve(fallbackDomCopy(text));
    }
  }

  // 2. DOM fallback using offscreen textarea for older browsers / iframe contexts
  return Promise.resolve(fallbackDomCopy(text));
}

/**
 * Copies review draft text to clipboard.
 * Alias for initiateClipboardWrite.
 */
export function copyDraftToClipboard(text: string): Promise<boolean> {
  return initiateClipboardWrite(text);
}

function fallbackDomCopy(text: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
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

/**
 * Gathers non-sensitive browser capability diagnostic flags for logging.
 * NEVER logs clipboard contents, review text, tokens, cookies, or user PII.
 */
export function getSafeBrowserDiagnostics(): Record<string, unknown> {
  if (typeof window === 'undefined') {
    return { environment: 'server' };
  }
  return {
    isSecureContext: Boolean(window.isSecureContext),
    hasClipboard: typeof navigator !== 'undefined' && Boolean(navigator.clipboard),
    hasWriteText:
      typeof navigator !== 'undefined' &&
      Boolean(navigator.clipboard && typeof navigator.clipboard.writeText === 'function'),
    userActivationActive:
      typeof navigator !== 'undefined' && 'userActivation' in navigator
        ? (navigator as any).userActivation?.isActive
        : undefined,
  };
}
