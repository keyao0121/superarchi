import { describe, expect, test } from 'bun:test'
import { compileGeometryScript } from './compile'
import { bitLengthWords, sha256Hex } from './sha256'

const encode = (text: string) => new TextEncoder().encode(text)

async function subtleHex(data: BufferSource) {
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
}

// Deterministic so a failure reproduces.
function bytesOf(length: number, seed: number) {
  const bytes = new Uint8Array(length)
  let state = seed >>> 0 || 1
  for (let i = 0; i < length; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[i] = state & 0xff
  }
  return bytes
}

describe('sha256Hex', () => {
  test.each([
    ['the empty string', '', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['"abc"', 'abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'the 56-character message',
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ])('matches the NIST vector for %s', (_label, message, expected) => {
    expect(sha256Hex(encode(message))).toBe(expected)
  })

  test('matches the NIST vector for one million "a"', () => {
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    )
  })

  test.each([55, 56, 57, 63, 64, 65, 119, 120])(
    'matches crypto.subtle at the padding boundary length %d',
    async (length) => {
      const bytes = bytesOf(length, length)
      expect(sha256Hex(bytes)).toBe(await subtleHex(bytes))
    },
  )

  test('matches crypto.subtle for random content of every length 0–300', async () => {
    for (let length = 0; length <= 300; length++) {
      const bytes = bytesOf(length, 0x9e3779b9 + length)
      expect([length, sha256Hex(bytes)]).toEqual([length, await subtleHex(bytes)])
    }
  })

  test('matches crypto.subtle for a 1 MiB random buffer', async () => {
    const bytes = bytesOf(1 << 20, 42)
    expect(sha256Hex(bytes)).toBe(await subtleHex(bytes))
  })

  describe('input types', () => {
    const backing = bytesOf(256, 7)
    const window = backing.subarray(13, 13 + 160)

    test('an ArrayBuffer', async () => {
      const buffer = backing.slice().buffer
      expect(sha256Hex(buffer)).toBe(await subtleHex(buffer))
    })

    test('a Uint8Array', async () => {
      expect(sha256Hex(backing)).toBe(await subtleHex(backing))
    })

    test('a subarray hashes only its own bytes', async () => {
      expect(window.byteOffset).toBe(13)
      expect(sha256Hex(window)).toBe(await subtleHex(window.slice()))
      expect(sha256Hex(window)).not.toBe(sha256Hex(backing))
    })

    test('a DataView with an offset', async () => {
      const view = new DataView(backing.buffer, 5, 99)
      expect(sha256Hex(view)).toBe(await subtleHex(backing.slice(5, 104)))
    })

    test('a Float32Array hashes its bytes', async () => {
      const floats = new Float32Array([1.5, -2, Math.PI, 0, Number.NaN])
      const sub = floats.subarray(1, 4)
      expect(sha256Hex(floats)).toBe(await subtleHex(new Uint8Array(floats.buffer).slice()))
      expect(sha256Hex(sub)).toBe(await subtleHex(new Uint8Array(floats.buffer, 4, 12).slice()))
    })

    test('the input is not modified', () => {
      const before = backing.slice()
      sha256Hex(backing)
      sha256Hex(window)
      sha256Hex(new DataView(backing.buffer, 5, 99))
      expect(backing).toEqual(before)
    })
  })
})

describe('bitLengthWords', () => {
  test.each<[number, [number, number]]>([
    [0, [0, 0]],
    [3, [0, 24]],
    [0x1fffffff, [0, 0xfffffff8]],
    // 2^29 bytes = 2^32 bits: the first length whose high word is not 0.
    [0x20000000, [1, 0]],
    [0x20000001, [1, 8]],
    [2 ** 40 + 5, [0x800, 40]],
  ])('%d bytes → %p', (byteLength, words) => {
    expect(bitLengthWords(byteLength)).toEqual(words)
  })
})

// Hides crypto.subtle as an acde page or an opaque-origin sandbox lacks it, then restores it.
async function withoutSubtle<T>(run: () => Promise<T>): Promise<T> {
  Object.defineProperty(crypto, 'subtle', { value: undefined, configurable: true })
  try {
    return await run()
  } finally {
    delete (crypto as { subtle?: unknown }).subtle
  }
}

describe('compileGeometryScript hashes', () => {
  const code = `
import * as THREE from 'three'
export default function build() {
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
}
`

  test('without crypto.subtle it leaves them to the host, which gets the same hashes', async () => {
    const native = await compileGeometryScript({ code })
    const hidden = await withoutSubtle(() => compileGeometryScript({ code }))
    expect(typeof crypto.subtle.digest).toBe('function')
    expect([hidden.sha256, hidden.script]).toEqual(['', ''])
    expect(native.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(sha256Hex(hidden.glb)).toBe(native.sha256)
    expect(sha256Hex(new TextEncoder().encode(code))).toBe(native.script)
  })
})
