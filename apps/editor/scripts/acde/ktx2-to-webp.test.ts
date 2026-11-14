import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { decodeKtx2, ktx2ToWebp, readKtx2Size } from './ktx2-to-webp'

const appDirectory = path.resolve(import.meta.dir, '../..')
const shipped = (relative: string) =>
  readFile(path.join(appDirectory, 'public/material', relative)).then(
    (bytes) => new Uint8Array(bytes),
  )

describe('ktx2ToWebp', () => {
  test('a shipped normal map becomes a WebP of the size its KTX2 header states', async () => {
    const ktx2 = await shipped('siding/lap_normal_512.ktx2')
    const { width, height } = readKtx2Size(ktx2)
    expect([width, height]).toEqual([512, 512])

    const webp = await ktx2ToWebp(ktx2)
    const info = await sharp(webp).metadata()
    expect(info.format).toBe('webp')
    expect([info.width, info.height]).toEqual([width, height])
  })

  test('the WebP keeps the decoded pixels: a normal map stays blue-dominant', async () => {
    const ktx2 = await shipped('siding/lap_normal_512.ktx2')
    const decoded = await decodeKtx2(ktx2)
    expect(decoded.rgba.length).toBe(decoded.width * decoded.height * 4)
    const stats = await sharp(await ktx2ToWebp(ktx2)).stats()
    const [r, g, b] = stats.channels.map((channel) => channel.mean)
    expect(b).toBeGreaterThan(200)
    expect(Math.abs((r as number) - 128)).toBeLessThan(16)
    expect(Math.abs((g as number) - 128)).toBeLessThan(16)
  })

  test('a base colour map converts too, opaque maps without an alpha channel', async () => {
    const ktx2 = await shipped('siding/lap_basecolor_512.ktx2')
    const info = await sharp(await ktx2ToWebp(ktx2)).metadata()
    expect([info.width, info.height]).toEqual([512, 512])
    expect(info.hasAlpha).toBe(false)
  })

  test('rejects bytes that are not KTX2', async () => {
    await expect(ktx2ToWebp(new Uint8Array(64))).rejects.toThrow('not a valid KTX2 file')
  })
})
