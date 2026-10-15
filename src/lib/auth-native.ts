import * as Crypto from 'expo-crypto'

import type { AuthDeps } from '@/lib/hermes/auth'

/** base64 → base64url, no padding (what PKCE wants). */
function base64url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

/** The crypto the pure sign-in module needs, from `expo-crypto`. */
export const authDeps: AuthDeps = {
  sha256: async input => base64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input, { encoding: Crypto.CryptoEncoding.BASE64 })),
  random: bytes => base64url(bytesToBase64(Crypto.getRandomBytes(bytes))),
}

/** Lowercase hex SHA-256 of a string (the Bot Screen lease shows its holder as a hash of their viewer id). */
export async function sha256Hex(input: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input, { encoding: Crypto.CryptoEncoding.HEX })
}
