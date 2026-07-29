import { describe, it, expect } from 'vitest';
import {
  PROMOTED_AD_MARKER,
  PROMOTED_AD_PREFIX,
  isPromotedName,
  addPromotedMarker,
  stripPromotedMarker,
} from '@/services/meta/constants';

describe('promoted-ad marker helpers', () => {
  describe('isPromotedName()', () => {
    it('detects a marked name', () => {
      expect(isPromotedName('+ Hero Ad')).toBe(true);
      expect(isPromotedName(`${PROMOTED_AD_MARKER}Hero Ad`)).toBe(true);
    });

    it('ignores leading whitespace', () => {
      expect(isPromotedName('  + Hero Ad')).toBe(true);
    });

    it('returns false for an unmarked name', () => {
      expect(isPromotedName('Hero Ad')).toBe(false);
      expect(isPromotedName('A + B split test')).toBe(false);
    });

    it('handles null/undefined/empty safely', () => {
      expect(isPromotedName(undefined)).toBe(false);
      expect(isPromotedName(null)).toBe(false);
      expect(isPromotedName('')).toBe(false);
    });
  });

  describe('addPromotedMarker()', () => {
    it('prefixes an unmarked name', () => {
      expect(addPromotedMarker('Hero Ad')).toBe('+ Hero Ad');
      expect(addPromotedMarker('Hero Ad').startsWith(PROMOTED_AD_PREFIX)).toBe(true);
    });

    it('is idempotent — never double-marks', () => {
      const once = addPromotedMarker('Hero Ad');
      const twice = addPromotedMarker(once);

      expect(twice).toBe(once);
      expect(twice).toBe('+ Hero Ad');
    });
  });

  describe('stripPromotedMarker()', () => {
    it('removes the marker and following space', () => {
      expect(stripPromotedMarker('+ Hero Ad')).toBe('Hero Ad');
    });

    it('leaves unmarked names unchanged', () => {
      expect(stripPromotedMarker('Hero Ad')).toBe('Hero Ad');
    });

    it('round-trips with addPromotedMarker', () => {
      expect(stripPromotedMarker(addPromotedMarker('Hero Ad'))).toBe('Hero Ad');
    });
  });
});
