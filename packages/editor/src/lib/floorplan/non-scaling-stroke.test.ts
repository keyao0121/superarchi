import { describe, expect, test } from 'bun:test'
import { scaledStrokeValue } from './non-scaling-stroke'

const SCALED = (pixels: number) => `calc(${pixels}px * var(--pascal-floorplan-units-per-px))`

describe('scaledStrokeValue', () => {
  test('turns a pixel width into one that follows the plan scale', () => {
    expect(scaledStrokeValue('2px', 1)).toBe(SCALED(2))
    expect(scaledStrokeValue('1.25', 1)).toBe(SCALED(1.25))
  })

  test('turns each length of a dash list', () => {
    expect(scaledStrokeValue('6px, 4px', 1)).toBe(`${SCALED(6)} ${SCALED(4)}`)
    expect(scaledStrokeValue('6 4', 1)).toBe(`${SCALED(6)} ${SCALED(4)}`)
  })

  test('divides by the scale of a group the element sits in', () => {
    expect(scaledStrokeValue('3px', 2)).toBe(SCALED(1.5))
  })

  test('leaves a value without pixel lengths alone', () => {
    expect(scaledStrokeValue('none', 1)).toBeNull()
    expect(scaledStrokeValue('', 1)).toBeNull()
    expect(scaledStrokeValue('50%', 1)).toBeNull()
    expect(scaledStrokeValue('calc(2px * var(--x))', 1)).toBeNull()
  })
})
