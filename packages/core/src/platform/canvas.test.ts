import { afterEach, describe, expect, test } from 'bun:test'
import { canvasToBlob, createCanvas2D, decodeImage, getContext2D, releaseImage } from './canvas'

const scope = globalThis as Record<string, unknown>
const stubbed: [string, PropertyDescriptor | undefined][] = []

// Bun has neither OffscreenCanvas nor document; each test installs the stubs it needs and
// afterEach puts back whatever was there before (another test file may have set one).
function stub(name: string, value: unknown) {
  stubbed.push([name, Object.getOwnPropertyDescriptor(scope, name)])
  Object.defineProperty(scope, name, { value, configurable: true, writable: true })
}

afterEach(() => {
  for (const [name, previous] of stubbed.splice(0).reverse()) {
    if (previous) Object.defineProperty(scope, name, previous)
    else delete scope[name]
  }
})

class FakeOffscreenCanvas {
  static created: FakeOffscreenCanvas[] = []
  converted: ImageEncodeOptions[] = []
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    FakeOffscreenCanvas.created.push(this)
  }
  getContext(id: string) {
    return { id, kind: 'offscreen' }
  }
  async convertToBlob(options?: ImageEncodeOptions) {
    this.converted.push(options ?? {})
    return new Blob(['offscreen'], { type: options?.type })
  }
}

class FakeCanvasElement {
  width = 0
  height = 0
  encoded: [string | undefined, number | undefined][] = []
  constructor(private readonly result: Blob | null) {}
  getContext(id: string) {
    return { id, kind: 'element' }
  }
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number) {
    this.encoded.push([type, quality])
    queueMicrotask(() => callback(this.result))
  }
}

function stubDocument(result: Blob | null = new Blob(['element'])) {
  const created: { tag: string; canvas: FakeCanvasElement }[] = []
  stub('document', {
    createElement(tag: string) {
      const canvas = new FakeCanvasElement(result)
      created.push({ tag, canvas })
      return canvas
    },
  })
  return created
}

describe('with OffscreenCanvas', () => {
  test('creates an OffscreenCanvas and encodes it with convertToBlob', async () => {
    FakeOffscreenCanvas.created = []
    stub('OffscreenCanvas', FakeOffscreenCanvas)
    const created = stubDocument()

    const canvas = createCanvas2D(320, 180)
    expect(canvas).toBeInstanceOf(FakeOffscreenCanvas)
    expect([canvas.width, canvas.height]).toEqual([320, 180])
    expect(created).toEqual([])
    expect(getContext2D(canvas)).toEqual({ id: '2d', kind: 'offscreen' } as never)

    const options = { type: 'image/webp', quality: 0.9 }
    const blob = await canvasToBlob(canvas, options)
    expect(await blob.text()).toBe('offscreen')
    expect((canvas as unknown as FakeOffscreenCanvas).converted).toEqual([options])
  })
})

describe('without OffscreenCanvas', () => {
  test('creates a sized <canvas> and encodes it with toBlob', async () => {
    const created = stubDocument()

    const canvas = createCanvas2D(640, 360)
    expect(created.map(({ tag }) => tag)).toEqual(['canvas'])
    expect(canvas).toBe(created[0]!.canvas as never)
    expect([canvas.width, canvas.height]).toEqual([640, 360])
    expect(getContext2D(canvas)).toEqual({ id: '2d', kind: 'element' } as never)

    const blob = await canvasToBlob(canvas, { type: 'image/jpeg', quality: 0.85 })
    expect(await blob.text()).toBe('element')
    expect(created[0]!.canvas.encoded).toEqual([['image/jpeg', 0.85]])
  })

  test('passes no type or quality when none are given', async () => {
    const created = stubDocument()
    await canvasToBlob(createCanvas2D(1, 1))
    expect(created[0]!.canvas.encoded).toEqual([[undefined, undefined]])
  })

  test('rejects when toBlob yields null', async () => {
    stubDocument(null)
    await expect(canvasToBlob(createCanvas2D(1, 1), { type: 'image/png' })).rejects.toThrow(
      'The canvas could not be encoded',
    )
  })
})

describe('decodeImage', () => {
  test('uses createImageBitmap where it exists', async () => {
    const blob = new Blob(['png'])
    const bitmap = {
      width: 4,
      height: 2,
      closed: false,
      close() {
        this.closed = true
      },
    }
    const calls: Blob[] = []
    stub('createImageBitmap', async (input: Blob) => {
      calls.push(input)
      return bitmap
    })
    stub(
      'Image',
      class {
        constructor() {
          throw new Error('Image must not be used when createImageBitmap exists')
        }
      },
    )

    const image = await decodeImage(blob)
    expect(image).toBe(bitmap as never)
    expect(calls).toEqual([blob])
    releaseImage(image)
    expect(bitmap.closed).toBe(true)
  })

  describe('without createImageBitmap', () => {
    const created: string[] = []
    const revoked: string[] = []
    let createObjectURL: typeof URL.createObjectURL
    let revokeObjectURL: typeof URL.revokeObjectURL

    class FakeImage {
      static instances: FakeImage[] = []
      src = ''
      width = 4
      height = 2
      constructor() {
        FakeImage.instances.push(this)
      }
      async decode() {
        // The URL must still be live while the image decodes.
        expect(revoked).not.toContain(this.src)
        if (FakeImage.failNext) throw new Error('decode failed')
      }
      static failNext = false
    }

    const install = () => {
      created.length = 0
      revoked.length = 0
      FakeImage.instances = []
      FakeImage.failNext = false
      createObjectURL = URL.createObjectURL
      revokeObjectURL = URL.revokeObjectURL
      URL.createObjectURL = () => {
        const url = `blob:test/${created.length}`
        created.push(url)
        return url
      }
      URL.revokeObjectURL = (url: string) => {
        revoked.push(url)
      }
      stub('Image', FakeImage)
    }
    const uninstall = () => {
      URL.createObjectURL = createObjectURL
      URL.revokeObjectURL = revokeObjectURL
    }

    test('decodes an <img> from an object URL and revokes the URL', async () => {
      install()
      try {
        const image = await decodeImage(new Blob(['png']))
        expect(image).toBe(FakeImage.instances[0] as never)
        expect((image as unknown as FakeImage).src).toBe('blob:test/0')
        expect(revoked).toEqual(['blob:test/0'])
        expect(() => releaseImage(image)).not.toThrow()
      } finally {
        uninstall()
      }
    })

    test('revokes the URL and rejects when decoding fails', async () => {
      install()
      FakeImage.failNext = true
      try {
        await expect(decodeImage(new Blob(['bad']))).rejects.toThrow('decode failed')
        expect(revoked).toEqual(created)
      } finally {
        uninstall()
      }
    })
  })
})
