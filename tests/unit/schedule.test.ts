import { describe, it, expect } from 'vitest';
import { inSchedule, parseHHMM, nextStart } from '../../src/shared/schedule';

const at = (h: number, m: number) => new Date(2026, 9, 31, h, m);
describe('programación', () => {
  it('interpreta horas', () => {
    expect(parseHHMM('18:30')).toBe(1110);
    expect(parseHHMM('7:05')).toBe(425);
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('abc')).toBeNull();
  });
  it('periodo normal', () => {
    expect(inSchedule(at(18, 29), '18:30', '22:00')).toBe(false);
    expect(inSchedule(at(18, 30), '18:30', '22:00')).toBe(true);
    expect(inSchedule(at(21, 59), '18:30', '22:00')).toBe(true);
    expect(inSchedule(at(22, 0), '18:30', '22:00')).toBe(false);
  });
  it('periodo que cruza la medianoche', () => {
    expect(inSchedule(at(23, 30), '20:00', '01:00')).toBe(true);
    expect(inSchedule(at(0, 30), '20:00', '01:00')).toBe(true);
    expect(inSchedule(at(1, 0), '20:00', '01:00')).toBe(false);
  });
  it('inicio igual a fin no programa nada', () => {
    expect(inSchedule(at(10, 0), '10:00', '10:00')).toBe(false);
  });
  it('próximo inicio', () => {
    expect(nextStart(at(17, 0), '18:30')!.getHours()).toBe(18);
    expect(nextStart(at(19, 0), '18:30')!.getDate()).toBe(1);
  });
});
