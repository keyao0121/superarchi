import { isAcde } from '@pascal-app/core/platform'

/**
 * False where pointer lock is known not to work: acde defines
 * `requestPointerLock` on every platform but throws `NotSupportedError`
 * synchronously when it is called. Browsers keep their pointer-lock path even
 * without the method, where the optional call stays the no-op it always was.
 */
export function pointerLockSupported(): boolean {
  return !isAcde()
}

export const DRAG_LOOK_THRESHOLD_PX = 4

export type DragLook = {
  /** Starts tracking a primary-button press; returns whether it did. */
  down(x: number, y: number, button: number): boolean
  /** The look delta since the last one, once the press has moved past the threshold. */
  move(x: number, y: number): { dx: number; dy: number } | null
  /** Ends the press; `click` when it never became a drag. Null when nothing was pressed. */
  up(): { click: boolean } | null
  cancel(): void
  readonly dragging: boolean
}

/**
 * Hold-and-drag look for runtimes without pointer lock. Deltas come from
 * pointer coordinates rather than `movementX/Y`, whose units differ between
 * browsers when the pointer is not locked.
 */
export function createDragLook({ threshold = DRAG_LOOK_THRESHOLD_PX } = {}): DragLook {
  let pressed = false
  let dragging = false
  let startX = 0
  let startY = 0
  let lastX = 0
  let lastY = 0

  return {
    down(x, y, button) {
      if (button !== 0) return false
      pressed = true
      dragging = false
      startX = lastX = x
      startY = lastY = y
      return true
    },
    move(x, y) {
      if (!pressed) return null
      if (!dragging) {
        if (Math.hypot(x - startX, y - startY) <= threshold) return null
        dragging = true
      }
      const delta = { dx: x - lastX, dy: y - lastY }
      lastX = x
      lastY = y
      return delta
    },
    up() {
      if (!pressed) return null
      const click = !dragging
      pressed = false
      dragging = false
      return { click }
    },
    cancel() {
      pressed = false
      dragging = false
    },
    get dragging() {
      return dragging
    },
  }
}

export type DragLookHandlers = {
  onLook: (dx: number, dy: number) => void
  /** A primary press on the canvas that did not turn into a drag. */
  onClick?: (event: PointerEvent) => void
  threshold?: number
}

/** Binds a drag look to the canvas; returns the detach function. */
export function attachDragLook(
  canvas: HTMLElement,
  { onLook, onClick, threshold }: DragLookHandlers,
): () => void {
  const drag = createDragLook({ threshold })
  let pointerId: number | null = null

  const release = () => {
    if (pointerId === null) return
    try {
      if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId)
    } catch {}
    pointerId = null
  }
  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || pointerId !== null) return
    if (!drag.down(event.clientX, event.clientY, event.button)) return
    pointerId = event.pointerId
    try {
      canvas.setPointerCapture?.(event.pointerId)
    } catch {}
  }
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    const delta = drag.move(event.clientX, event.clientY)
    if (delta) onLook(delta.dx, delta.dy)
  }
  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    const result = drag.up()
    release()
    if (result?.click) onClick?.(event)
  }
  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    drag.cancel()
    release()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('lostpointercapture', onPointerCancel)
  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerCancel)
    canvas.removeEventListener('lostpointercapture', onPointerCancel)
    drag.cancel()
    release()
  }
}
