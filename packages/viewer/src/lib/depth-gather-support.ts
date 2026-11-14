/**
 * Whether three's screen-space AO nodes (GTAONode, SSGINode) can build their pipelines on this
 * renderer. In WebGPU compatibility mode (a device without `core-features-and-limits`, e.g. acde
 * on Linux) three declares depth textures as `texture_2d<f32>`, but both nodes' depth `gather()`
 * still emits the depth-texture `textureGather` overload, which has no component argument: the
 * shader is invalid, the pass never writes, and its AO reads as 0 (three r187).
 */
export function depthGatherSupported(renderer: unknown): boolean {
  const backend = (renderer as { backend?: { compatibilityMode?: boolean | null } }).backend
  return backend?.compatibilityMode !== true
}
