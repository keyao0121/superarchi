// Decompresses Draco GLBs for the acde asset mirror: acde pages have no Web Worker, which
// three's DRACOLoader needs. Build time only, on the main thread, with the Draco decoder
// three ships (draco_wasm_wrapper.js + draco_decoder.wasm); the GLB is parsed and rewritten
// here, so the build adds no dependency.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

export const DRACO_EXTENSION = 'KHR_draco_mesh_compression'

const GLB_MAGIC = 0x46546c67 // 'glTF'
const JSON_CHUNK = 0x4e4f534a // 'JSON'
const BIN_CHUNK = 0x004e4942 // 'BIN'
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963

type DracoPtr = { ptr: number }
type DracoStatus = { ok(): boolean; error_msg(): string }
type DracoMesh = DracoPtr & { num_points(): number; num_faces(): number }
type DracoAttribute = DracoPtr & { num_components(): number }
type DracoDecoder = DracoPtr & {
  GetEncodedGeometryType(buffer: DracoPtr): number
  DecodeBufferToMesh(buffer: DracoPtr, mesh: DracoMesh): DracoStatus
  GetAttributeByUniqueId(mesh: DracoMesh, id: number): DracoAttribute
  GetAttributeDataArrayForAllPoints(
    mesh: DracoMesh,
    attribute: DracoAttribute,
    dataType: number,
    byteLength: number,
    ptr: number,
  ): boolean
  GetTrianglesUInt16Array(mesh: DracoMesh, byteLength: number, ptr: number): boolean
  GetTrianglesUInt32Array(mesh: DracoMesh, byteLength: number, ptr: number): boolean
}
type DracoModule = {
  Decoder: new () => DracoDecoder
  DecoderBuffer: new () => DracoPtr & { Init(bytes: Int8Array, length: number): void }
  Mesh: new () => DracoMesh
  TRIANGULAR_MESH: number
  HEAPU8: Uint8Array
  _malloc(byteLength: number): number
  _free(ptr: number): void
  destroy(object: DracoPtr): void
} & Record<string, number>

type Accessor = {
  bufferView?: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
  sparse?: { indices: { bufferView: number }; values: { bufferView: number } }
}
type BufferView = {
  buffer: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
  target?: number
}
type DracoPrimitiveExtension = { bufferView: number; attributes: Record<string, number> }
type Primitive = {
  attributes: Record<string, number>
  indices?: number
  extensions?: Record<string, unknown>
}
type Gltf = {
  buffers?: { byteLength: number; uri?: string }[]
  bufferViews?: BufferView[]
  accessors?: Accessor[]
  images?: { bufferView?: number }[]
  meshes?: { primitives: Primitive[] }[]
  extensionsUsed?: string[]
  extensionsRequired?: string[]
}

const COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
}
/** glTF componentType → [bytes per component, Draco data type name]. */
const COMPONENT_TYPES: Record<number, [number, string]> = {
  5120: [1, 'DT_INT8'],
  5121: [1, 'DT_UINT8'],
  5122: [2, 'DT_INT16'],
  5123: [2, 'DT_UINT16'],
  5125: [4, 'DT_UINT32'],
  5126: [4, 'DT_FLOAT32'],
}

let decoderModule: Promise<DracoModule> | undefined

/** three's Draco decoder, loaded once. The wrapper is a classic script, not a module. */
export function loadDracoDecoder(): Promise<DracoModule> {
  decoderModule ??= (async () => {
    const wrapperPath = require.resolve('three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js')
    const [script, wasmBinary] = await Promise.all([
      readFile(wrapperPath, 'utf8'),
      readFile(path.join(path.dirname(wrapperPath), 'draco_decoder.wasm')),
    ])
    const factory = new Function(
      'require',
      '__filename',
      '__dirname',
      `${script}\nreturn DracoDecoderModule`,
    )(require, wrapperPath, path.dirname(wrapperPath)) as (config: object) => unknown
    // As DRACOLoader does: the module object is handed over in onModuleLoaded.
    return new Promise<DracoModule>((resolve) => {
      factory({ wasmBinary, onModuleLoaded: resolve })
    })
  })()
  return decoderModule
}

/** The JSON and BIN chunks of a GLB. */
export function parseGlb(bytes: Uint8Array): { json: Gltf; bin: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('not a GLB')
  }
  let json: Gltf | undefined
  let bin: Uint8Array = new Uint8Array(0)
  for (let offset = 12; offset + 8 <= bytes.byteLength; ) {
    const length = view.getUint32(offset, true)
    const type = view.getUint32(offset + 4, true)
    const chunk = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(chunk)) as Gltf
    else if (type === BIN_CHUNK) bin = chunk
    offset += 8 + length
  }
  if (!json) throw new Error('GLB has no JSON chunk')
  return { json, bin }
}

const pad4 = (length: number) => Math.ceil(length / 4) * 4

/** A GLB from its JSON and BIN chunks, each padded to 4 bytes (JSON with spaces). */
export function writeGlb(json: Gltf, bin: Uint8Array): Uint8Array {
  let text = JSON.stringify(json)
  while (text.length % 4) text += ' '
  const jsonBytes = new TextEncoder().encode(text)
  const binLength = pad4(bin.byteLength)
  const total = 12 + 8 + jsonBytes.byteLength + (binLength ? 8 + binLength : 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, GLB_MAGIC, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonBytes.byteLength, true)
  view.setUint32(16, JSON_CHUNK, true)
  out.set(jsonBytes, 20)
  if (binLength) {
    const at = 20 + jsonBytes.byteLength
    view.setUint32(at, binLength, true)
    view.setUint32(at + 4, BIN_CHUNK, true)
    out.set(bin, at + 8)
  }
  return out
}

/** Copies `byteLength` bytes out of the decoder's heap, then frees them. */
function takeHeap(draco: DracoModule, ptr: number, byteLength: number): Uint8Array {
  const bytes = draco.HEAPU8.slice(ptr, ptr + byteLength)
  draco._free(ptr)
  return bytes
}

type DecodedView = { bytes: Uint8Array; byteStride?: number; target: number }

/** One Draco primitive's attributes and indices as plain views, keyed by semantic ('indices' for the index). */
function decodePrimitive(
  draco: DracoModule,
  json: Gltf,
  primitive: Primitive,
  compressed: Uint8Array,
): Map<string, DecodedView> {
  const extension = primitive.extensions?.[DRACO_EXTENSION] as DracoPrimitiveExtension
  const accessors = json.accessors ?? []
  const decoder = new draco.Decoder()
  const buffer = new draco.DecoderBuffer()
  const mesh = new draco.Mesh()
  try {
    buffer.Init(
      new Int8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength),
      compressed.byteLength,
    )
    if (decoder.GetEncodedGeometryType(buffer) !== draco.TRIANGULAR_MESH) {
      throw new Error('Draco data is not a triangle mesh')
    }
    const status = decoder.DecodeBufferToMesh(buffer, mesh)
    if (!status.ok() || mesh.ptr === 0)
      throw new Error(`Draco decode failed: ${status.error_msg()}`)

    const views = new Map<string, DecodedView>()
    const count = mesh.num_points()
    for (const [semantic, uniqueId] of Object.entries(extension.attributes)) {
      const accessorIndex = primitive.attributes[semantic]
      const accessor = accessorIndex === undefined ? undefined : accessors[accessorIndex]
      if (accessorIndex === undefined || !accessor) {
        throw new Error(`Draco attribute ${semantic} has no accessor`)
      }
      const [componentBytes, dataType] = COMPONENT_TYPES[accessor.componentType] ?? []
      const components = COMPONENTS[accessor.type]
      if (!componentBytes || !dataType || !components) {
        throw new Error(
          `${semantic}: unsupported accessor ${accessor.type}/${accessor.componentType}`,
        )
      }
      if (accessor.count !== count) {
        throw new Error(`${semantic}: accessor count ${accessor.count}, Draco decoded ${count}`)
      }
      const attribute = decoder.GetAttributeByUniqueId(mesh, uniqueId)
      if (!attribute || attribute.ptr === 0 || attribute.num_components() !== components) {
        throw new Error(`${semantic}: Draco attribute ${uniqueId} missing or of another size`)
      }
      const elementBytes = components * componentBytes
      const byteLength = count * elementBytes
      const ptr = draco._malloc(byteLength)
      if (
        !decoder.GetAttributeDataArrayForAllPoints(
          mesh,
          attribute,
          draco[dataType] as number,
          byteLength,
          ptr,
        )
      ) {
        draco._free(ptr)
        throw new Error(`${semantic}: reading the decoded attribute failed`)
      }
      const packed = takeHeap(draco, ptr, byteLength)
      // Vertex attribute elements must start on 4-byte boundaries (glTF 2.0 §3.6.2.4).
      const stride = pad4(elementBytes)
      if (stride === elementBytes) {
        views.set(semantic, { bytes: packed, target: ARRAY_BUFFER })
      } else {
        const strided = new Uint8Array(count * stride)
        for (let i = 0; i < count; i++) {
          strided.set(packed.subarray(i * elementBytes, (i + 1) * elementBytes), i * stride)
        }
        views.set(semantic, { bytes: strided, byteStride: stride, target: ARRAY_BUFFER })
      }
    }

    if (primitive.indices !== undefined) {
      const accessor = accessors[primitive.indices]
      const indexCount = mesh.num_faces() * 3
      if (!accessor || accessor.count !== indexCount) {
        throw new Error(`indices: accessor count ${accessor?.count}, Draco decoded ${indexCount}`)
      }
      const wide = accessor.componentType === 5125
      if (!wide && accessor.componentType !== 5123) {
        throw new Error(`indices: unsupported componentType ${accessor.componentType}`)
      }
      const byteLength = indexCount * (wide ? 4 : 2)
      const ptr = draco._malloc(byteLength)
      const read = wide
        ? decoder.GetTrianglesUInt32Array(mesh, byteLength, ptr)
        : decoder.GetTrianglesUInt16Array(mesh, byteLength, ptr)
      if (!read) {
        draco._free(ptr)
        throw new Error('indices: reading the decoded triangles failed')
      }
      views.set('indices', {
        bytes: takeHeap(draco, ptr, byteLength),
        target: ELEMENT_ARRAY_BUFFER,
      })
    }
    return views
  } finally {
    draco.destroy(mesh)
    draco.destroy(buffer)
    draco.destroy(decoder)
  }
}

/**
 * The same GLB with every Draco primitive decoded into plain accessors and the extension
 * removed. Buffer views only the Draco data used are dropped; everything else (images,
 * other accessors, other extensions) is kept and re-indexed. A GLB without Draco comes
 * back unchanged.
 */
export async function decompressDracoGlb(bytes: Uint8Array): Promise<Uint8Array> {
  const { json, bin } = parseGlb(bytes)
  const primitives = (json.meshes ?? [])
    .flatMap((mesh) => mesh.primitives)
    .filter((primitive) => primitive.extensions?.[DRACO_EXTENSION])
  if (!primitives.length) return bytes
  if ((json.buffers ?? []).length !== 1 || json.buffers?.[0]?.uri !== undefined) {
    throw new Error('only GLBs with their one buffer in the BIN chunk are supported')
  }

  const bufferViews = json.bufferViews ?? []
  const accessors = json.accessors ?? []
  const viewBytes = (index: number) => {
    const view = bufferViews[index]
    if (!view) throw new Error(`missing bufferView ${index}`)
    const start = view.byteOffset ?? 0
    return bin.subarray(start, start + view.byteLength)
  }

  const draco = await loadDracoDecoder()
  const decoded = new Map<number, DecodedView>()
  const dracoViews = new Set<number>()
  for (const primitive of primitives) {
    const extension = primitive.extensions?.[DRACO_EXTENSION] as DracoPrimitiveExtension
    dracoViews.add(extension.bufferView)
    const views = decodePrimitive(draco, json, primitive, viewBytes(extension.bufferView))
    for (const [semantic, view] of views) {
      let accessor = (
        semantic === 'indices' ? primitive.indices : primitive.attributes[semantic]
      ) as number
      // Draco primitives' accessors only describe the data, and encoders share them between
      // primitives whose Draco data differs: each decoded set gets an accessor of its own.
      if (decoded.has(accessor) || accessors[accessor]?.bufferView !== undefined) {
        accessor = accessors.push(structuredClone(accessors[accessor] as Accessor)) - 1
        if (semantic === 'indices') primitive.indices = accessor
        else primitive.attributes[semantic] = accessor
      }
      decoded.set(accessor, view)
    }
    delete primitive.extensions?.[DRACO_EXTENSION]
    if (primitive.extensions && !Object.keys(primitive.extensions).length)
      delete primitive.extensions
  }

  // Views still referenced elsewhere stay; the compressed Draco data goes.
  const referenced = new Set<number>()
  for (const accessor of accessors) {
    if (accessor.bufferView !== undefined) referenced.add(accessor.bufferView)
    if (accessor.sparse) {
      referenced.add(accessor.sparse.indices.bufferView)
      referenced.add(accessor.sparse.values.bufferView)
    }
  }
  for (const image of json.images ?? []) {
    if (image.bufferView !== undefined) referenced.add(image.bufferView)
  }

  const parts: Uint8Array[] = []
  let length = 0
  const append = (data: Uint8Array) => {
    const offset = length
    parts.push(data)
    length = pad4(offset + data.byteLength)
    if (length > offset + data.byteLength)
      parts.push(new Uint8Array(length - offset - data.byteLength))
    return offset
  }
  const newViews: BufferView[] = []
  const remap = new Map<number, number>()
  bufferViews.forEach((view, index) => {
    if (dracoViews.has(index) && !referenced.has(index)) return
    remap.set(index, newViews.length)
    newViews.push({ ...view, byteOffset: append(viewBytes(index)) })
  })
  const moved = (index: number) => {
    const next = remap.get(index)
    if (next === undefined) throw new Error(`bufferView ${index} was dropped but is still used`)
    return next
  }
  for (const accessor of accessors) {
    if (accessor.bufferView !== undefined) accessor.bufferView = moved(accessor.bufferView)
    if (accessor.sparse) {
      accessor.sparse.indices.bufferView = moved(accessor.sparse.indices.bufferView)
      accessor.sparse.values.bufferView = moved(accessor.sparse.values.bufferView)
    }
  }
  for (const image of json.images ?? []) {
    if (image.bufferView !== undefined) image.bufferView = moved(image.bufferView)
  }
  for (const [accessorIndex, view] of [...decoded].sort(([a], [b]) => a - b)) {
    const accessor = accessors[accessorIndex] as Accessor
    accessor.bufferView = newViews.length
    delete accessor.byteOffset
    newViews.push({
      buffer: 0,
      byteOffset: append(view.bytes),
      byteLength: view.bytes.byteLength,
      ...(view.byteStride ? { byteStride: view.byteStride } : {}),
      target: view.target,
    })
  }

  json.bufferViews = newViews
  ;(json.buffers as { byteLength: number }[])[0] = { byteLength: length }
  for (const key of ['extensionsUsed', 'extensionsRequired'] as const) {
    const list = json[key]?.filter((name) => name !== DRACO_EXTENSION)
    if (list?.length) json[key] = list
    else delete json[key]
  }

  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return writeGlb(json, out)
}
