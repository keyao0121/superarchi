// SHA-256 (FIPS 180-4) for pages without WebCrypto, e.g. acde, whose page runtime has no
// crypto.subtle. Callers prefer crypto.subtle when it exists.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function compress(state: Uint32Array, w: Uint32Array, block: Uint8Array, offset: number) {
  for (let i = 0; i < 16; i++) {
    const j = offset + i * 4
    w[i] = (block[j]! << 24) | (block[j + 1]! << 16) | (block[j + 2]! << 8) | block[j + 3]!
  }
  for (let i = 16; i < 64; i++) {
    const a = w[i - 15]!
    const b = w[i - 2]!
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
    w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0
  }
  let a = state[0]!
  let b = state[1]!
  let c = state[2]!
  let d = state[3]!
  let e = state[4]!
  let f = state[5]!
  let g = state[6]!
  let h = state[7]!
  for (let i = 0; i < 64; i++) {
    const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
    const t1 = (h + s1 + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0
    const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
    const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0
    h = g
    g = f
    f = e
    e = (d + t1) | 0
    d = c
    c = b
    b = a
    a = (t1 + t2) | 0
  }
  state[0] = (state[0]! + a) | 0
  state[1] = (state[1]! + b) | 0
  state[2] = (state[2]! + c) | 0
  state[3] = (state[3]! + d) | 0
  state[4] = (state[4]! + e) | 0
  state[5] = (state[5]! + f) | 0
  state[6] = (state[6]! + g) | 0
  state[7] = (state[7]! + h) | 0
}

/** The message length in bits as big-endian [high, low] 32-bit words (exact below 2^53 bits). */
export function bitLengthWords(byteLength: number): [number, number] {
  return [Math.floor(byteLength / 0x20000000) >>> 0, (byteLength * 8) >>> 0]
}

/** Lowercase hex SHA-256 of the bytes `data` covers (a view's byteOffset/byteLength); `data` is not modified. */
export function sha256Hex(data: ArrayBuffer | ArrayBufferView): string {
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data)
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)
  const length = bytes.length
  const whole = length - (length % 64)
  for (let offset = 0; offset < whole; offset += 64) compress(state, w, bytes, offset)

  // The remaining bytes, the 0x80 terminator, zero padding and the 64-bit big-endian bit length.
  const tail = new Uint8Array(length - whole < 56 ? 64 : 128)
  tail.set(bytes.subarray(whole))
  tail[length - whole] = 0x80
  const [high, low] = bitLengthWords(length)
  const bits = new DataView(tail.buffer)
  bits.setUint32(tail.length - 8, high)
  bits.setUint32(tail.length - 4, low)
  for (let offset = 0; offset < tail.length; offset += 64) compress(state, w, tail, offset)

  let hex = ''
  for (const word of state) hex += word.toString(16).padStart(8, '0')
  return hex
}
