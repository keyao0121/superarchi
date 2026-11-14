/**
 * Whether three's GTAONode can build its pipeline on this renderer. In WebGPU compatibility
 * mode (a device without `core-features-and-limits`, e.g. acde on Linux) three declares depth
 * textures as `texture_2d<f32>`, but GTAONode's depth `gather()` still emits the depth-texture
 * `textureGather` overload, which has no component argument: the shader is invalid and every
 * frame reports an invalid `renderPipeline_GTAO` (three r187).
 */
export function gtaoSupported(renderer: unknown): boolean {
  const backend = (renderer as { backend?: { compatibilityMode?: boolean | null } }).backend
  return backend?.compatibilityMode !== true
}
