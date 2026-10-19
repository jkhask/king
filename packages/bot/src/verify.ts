import { subtle } from 'node:crypto';

function hexToUint8Array(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Verifies a Discord HTTP Interaction request using Ed25519 (Web Crypto API).
 */
export async function verifyDiscordSignature(params: {
  publicKeyHex: string;
  signatureHex: string;
  timestamp: string;
  rawBody: string;
}): Promise<boolean> {
  try {
    const { publicKeyHex, signatureHex, timestamp, rawBody } = params;
    if (!publicKeyHex || !signatureHex || !timestamp) {
      return false;
    }

    const publicKeyBytes = hexToUint8Array(publicKeyHex);
    const signatureBytes = hexToUint8Array(signatureHex);
    const messageBytes = new TextEncoder().encode(timestamp + rawBody);

    const key = await subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify']
    );

    return await subtle.verify('Ed25519', key, signatureBytes, messageBytes);
  } catch {
    return false;
  }
}
