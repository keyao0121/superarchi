/**
 * `vector-effect: non-scaling-stroke` for a runtime that lacks it.
 *
 * The 2D plan is drawn in metres and keeps its line work in screen pixels with
 * `vector-effect`. acdert ignores the property, so a 2 px line there is drawn
 * 2 m wide and the plan turns into blobs. Here each such stroke gets its width
 * in user units instead, `calc(<px> * var(--units-per-px))`: a pan or a zoom
 * then only changes one variable on the plan's root.
 */

const UNITS_PER_PIXEL = '--pascal-floorplan-units-per-px'
const STROKE_PROPERTIES = ['stroke-width', 'stroke-dasharray', 'stroke-dashoffset'] as const
const NON_SCALING = '[vector-effect="non-scaling-stroke"], [style*="non-scaling-stroke"]'

type StrokeProperty = (typeof STROKE_PROPERTIES)[number]
/** What the app set inline for a property, and what stands there for it now. */
type Applied = Partial<Record<StrokeProperty, { source: string; written: string }>>

export function supportsNonScalingStroke(): boolean {
  return typeof CSS === 'undefined' || CSS.supports('vector-effect', 'non-scaling-stroke')
}

/**
 * A computed stroke length, or dash list, in pixels as lengths that follow the
 * plan's scale. `scale` is the element's own scale within the plan (1 unless a
 * group above it scales). Null for a value with no pixel lengths (`none`, a
 * percentage).
 */
export function scaledStrokeValue(computed: string, scale: number): string | null {
  const parts = computed.split(/[\s,]+/).filter(Boolean)
  if (parts.length === 0 || parts.some((part) => !/^-?[\d.]+(?:e-?\d+)?(?:px)?$/.test(part))) {
    return null
  }
  return parts
    .map((part) => `calc(${Number.parseFloat(part) / scale}px * var(${UNITS_PER_PIXEL}))`)
    .join(' ')
}

/** Pixels per user unit of an element, whatever its rotation. */
function scaleOf(element: Element): number {
  const matrix = (element as SVGGraphicsElement).getScreenCTM?.()
  return matrix ? Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) : 0
}

/** Keeps the plan's `non-scaling-stroke` line work at its pixel widths until the returned stop. */
export function emulateNonScalingStroke(svg: SVGSVGElement): () => void {
  const applied = new WeakMap<Element, Applied>()

  const updateUnitsPerPixel = () => {
    const scale = scaleOf(svg)
    if (scale > 0) svg.style.setProperty(UNITS_PER_PIXEL, String(1 / scale))
  }

  const apply = (element: Element) => {
    const { style } = element as SVGElement
    const state = applied.get(element) ?? {}
    // First put back what the app set, so the computed style is the stroke it asked for.
    const sources = STROKE_PROPERTIES.map((property) => {
      const current = style.getPropertyValue(property)
      const previous = state[property]
      const source = previous && current === previous.written ? previous.source : current
      if (source) style.setProperty(property, source)
      else style.removeProperty(property)
      return source
    })
    if (!element.matches(NON_SCALING)) {
      applied.delete(element)
      return
    }
    const rootScale = scaleOf(svg)
    const ownScale = scaleOf(element)
    const scale = rootScale > 0 && ownScale > 0 ? ownScale / rootScale : 1
    const computed = getComputedStyle(element)
    const asked = STROKE_PROPERTIES.map((property) => computed.getPropertyValue(property))
    STROKE_PROPERTIES.forEach((property, index) => {
      const scaled = scaledStrokeValue(asked[index] ?? '', scale)
      if (scaled === null) {
        delete state[property]
        return
      }
      style.setProperty(property, scaled)
      // Read back: the runtime may serialize the value its own way.
      state[property] = { source: sources[index] ?? '', written: style.getPropertyValue(property) }
    })
    applied.set(element, state)
  }

  const observer = new MutationObserver((records) => {
    const targets = new Set<Element>()
    let rescale = false
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue
          if (node.matches(NON_SCALING)) targets.add(node)
          for (const descendant of node.querySelectorAll(NON_SCALING)) targets.add(descendant)
        }
      } else if (record.target === svg) {
        if (record.attributeName === 'viewBox') rescale = true
      } else if (record.target instanceof Element) {
        if (record.target.matches(NON_SCALING) || applied.has(record.target)) {
          targets.add(record.target)
        } else if (record.attributeName?.startsWith('stroke-')) {
          // A group's stroke is inherited by the line work under it.
          for (const descendant of record.target.querySelectorAll(NON_SCALING)) {
            targets.add(descendant)
          }
        }
      }
    }
    if (rescale) updateUnitsPerPixel()
    for (const target of targets) apply(target)
    // Drop what these writes queued, or every pass would start another.
    observer.takeRecords()
  })

  updateUnitsPerPixel()
  for (const element of svg.querySelectorAll(NON_SCALING)) apply(element)
  observer.observe(svg, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['viewBox', ...STROKE_PROPERTIES, 'vector-effect', 'class', 'style'],
  })
  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateUnitsPerPixel)
  resizeObserver?.observe(svg)

  return () => {
    observer.disconnect()
    resizeObserver?.disconnect()
  }
}
