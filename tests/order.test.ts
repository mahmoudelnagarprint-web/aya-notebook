import { describe, expect, test } from 'bun:test';
import { ORDER_GAP, orderKeyAfter, orderKeyBefore, orderKeyBetween, padOrderKey, rebalanceOrderKeys, sortByOrderKey } from '@ayatodoist/core-kernel';

describe('fractional order keys', () => {
  test('appending and prepending keep ordering', () => {
    const first = orderKeyAfter(null);
    const second = orderKeyAfter(first);
    const third = orderKeyAfter(second);
    expect(first < second && second < third).toBe(true);

    const before = orderKeyBefore(first);
    expect(before < first).toBe(true);
  });

  test('between always sorts strictly between neighbours', () => {
    const a = padOrderKey(ORDER_GAP);
    const b = padOrderKey(ORDER_GAP * 2);
    const middle = orderKeyBetween(a, b);
    expect(a < middle && middle < b).toBe(true);
    const again = orderKeyBetween(a, middle);
    expect(a < again && again < middle).toBe(true);
    expect(() => orderKeyBetween(a, a)).toThrow();
  });

  test('rebalance produces evenly spaced keys', () => {
    const map = rebalanceOrderKeys(['x', 'y', 'z']);
    const rows = ['x', 'y', 'z'].map((id) => ({ id, orderKey: map.get(id)! }));
    expect(sortByOrderKey(rows).map((row) => row.id)).toEqual(['x', 'y', 'z']);
    expect(map.get('x')! < map.get('y')! && map.get('y')! < map.get('z')!).toBe(true);
  });
});
