import crypto from 'crypto';
import QRCode from 'qrcode';

export function generateCampaignCode(): string {
  // 16 cryptographically random bytes = 128 bits of entropy
  // base64url encoding produces 22 URL-safe characters [A-Za-z0-9_-]
  const raw = crypto.randomBytes(16).toString('base64url');
  return `q_${raw}`;
}

export function getPublicCampaignUrl(code: string): string {
  const baseUrl = (process.env.PUBLIC_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${baseUrl}/q/${code}`;
}

export async function generateQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    margin: 2,
    errorCorrectionLevel: 'M',
  });
}

export async function generateQrPng(url: string, size: number = 512): Promise<Buffer> {
  const width = Math.min(Math.max(size, 256), 2048);
  return QRCode.toBuffer(url, {
    type: 'png',
    width,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
}
