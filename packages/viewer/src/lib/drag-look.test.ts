// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { attachDragLook, createDragLook, pointerLockSupported } from './drag-look'

const savedAcdeAppId = process.env.ACDE_APP_ID

afterEach(() => {
  if (savedAcdeAppId === undefined) delete process.env.ACDE_APP_ID
  else process.env.ACDE_APP_ID = savedAcdeAppId
})

describe('pointerLockSupported', () => {
  test('is true outside acde', () => {
    expect(pointerLockSupported()).toBe(true)
  })

  test('is false in acde, where requestPointerLock exists but throws', () => {
    // bun test has no window, so isAcde() reads ACDE_APP_ID.
    process.env.ACDE_APP_ID = 'pascal-editor'
    expect(pointerLockSupported()).toBe(false)
  })
})

describe('createDragLook', () => {
  test('a press that stays within the threshold is a click', () => {
    const drag = createDragLook({ threshold: 4 })
    expect(drag.down(10, 10, 0)).toBe(true)
    expect(drag.move(12, 11)).toBeNull()
    expect(drag.dragging).toBe(false)
    expect(drag.up()).toEqual({ click: true })
  })

  test('past the threshold each move turns by its delta, the first one from the press', () => {
    const drag = createDragLook({ threshold: 4 })
    drag.down(10, 10, 0)
    expect(drag.move(12, 10)).toBeNull()
    expect(drag.move(16, 13)).toEqual({ dx: 6, dy: 3 })
    expect(drag.dragging).toBe(true)
    expect(drag.move(14, 13)).toEqual({ dx: -2, dy: 0 })
    expect(drag.up()).toEqual({ click: false })
  })

  test('ignores buttons other than the primary one', () => {
    const drag = createDragLook()
    expect(drag.down(0, 0, 2)).toBe(false)
    expect(drag.move(50, 50)).toBeNull()
    expect(drag.up()).toBeNull()
  })

  test('stops turning after up or cancel', () => {
    const drag = createDragLook({ threshold: 0 })
    drag.down(0, 0, 0)
    expect(drag.move(5, 0)).toEqual({ dx: 5, dy: 0 })
    drag.up()
    expect(drag.move(10, 0)).toBeNull()

    drag.down(0, 0, 0)
    drag.move(5, 0)
    drag.cancel()
    expect(drag.dragging).toBe(false)
    expect(drag.move(10, 0)).toBeNull()
    expect(drag.up()).toBeNull()
  })
})

function fakeCanvas() {
  const target = new EventTarget()
  const captured = new Set<number>()
  return Object.assign(target, {
    captured,
    setPointerCapture: (id: number) => captured.add(id),
    releasePointerCapture: (id: number) => captured.delete(id),
    hasPointerCapture: (id: number) => captured.has(id),
  }) as unknown as HTMLElement & { captured: Set<number> }
}

function pointer(
  type: string,
  init: { x: number; y: number; button?: number; pointerId?: number; isPrimary?: boolean },
) {
  return Object.assign(new Event(type), {
    button: init.button ?? 0,
    clientX: init.x,
    clientY: init.y,
    isPrimary: init.isPrimary ?? true,
    pointerId: init.pointerId ?? 1,
  })
}

describe('attachDragLook', () => {
  test('a drag turns the look and captures the pointer until release', () => {
    const canvas = fakeCanvas()
    const onLook = mock((_dx: number, _dy: number) => {})
    const onClick = mock(() => {})
    attachDragLook(canvas, { onLook, onClick })

    canvas.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }))
    expect(canvas.captured.has(1)).toBe(true)
    canvas.dispatchEvent(pointer('pointermove', { x: 120, y: 90 }))
    canvas.dispatchEvent(pointer('pointermove', { x: 125, y: 90 }))
    canvas.dispatchEvent(pointer('pointerup', { x: 125, y: 90 }))

    expect(onLook.mock.calls).toEqual([
      [20, -10],
      [5, 0],
    ])
    expect(onClick).not.toHaveBeenCalled()
    expect(canvas.captured.size).toBe(0)
  })

  test('a press without a drag is a click', () => {
    const canvas = fakeCanvas()
    const onLook = mock(() => {})
    const onClick = mock(() => {})
    attachDragLook(canvas, { onLook, onClick })

    canvas.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }))
    canvas.dispatchEvent(pointer('pointermove', { x: 11, y: 11 }))
    canvas.dispatchEvent(pointer('pointerup', { x: 11, y: 11 }))

    expect(onLook).not.toHaveBeenCalled()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test('ignores secondary buttons, other pointers, and everything after detach', () => {
    const canvas = fakeCanvas()
    const onLook = mock(() => {})
    const onClick = mock(() => {})
    const detach = attachDragLook(canvas, { onLook, onClick })

    canvas.dispatchEvent(pointer('pointerdown', { x: 0, y: 0, button: 2 }))
    canvas.dispatchEvent(pointer('pointermove', { x: 50, y: 0 }))
    canvas.dispatchEvent(pointer('pointerdown', { x: 0, y: 0 }))
    canvas.dispatchEvent(pointer('pointermove', { x: 50, y: 0, pointerId: 2 }))
    expect(onLook).not.toHaveBeenCalled()

    detach()
    expect(canvas.captured.size).toBe(0)
    canvas.dispatchEvent(pointer('pointermove', { x: 80, y: 0 }))
    canvas.dispatchEvent(pointer('pointerup', { x: 80, y: 0 }))
    expect(onLook).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  test('a cancelled press neither turns nor clicks', () => {
    const canvas = fakeCanvas()
    const onLook = mock(() => {})
    const onClick = mock(() => {})
    attachDragLook(canvas, { onLook, onClick })

    canvas.dispatchEvent(pointer('pointerdown', { x: 0, y: 0 }))
    canvas.dispatchEvent(pointer('pointercancel', { x: 0, y: 0 }))
    canvas.dispatchEvent(pointer('pointermove', { x: 50, y: 0 }))
    canvas.dispatchEvent(pointer('pointerup', { x: 50, y: 0 }))

    expect(onLook).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })
})
