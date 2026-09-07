import { describe, expect, it } from 'vitest';
import {
  boundsCenter,
  boundsArea,
  boundsValid,
  iou,
  type Bounds,
  type WorldSnapshot,
} from '../../src/ml/detection/models.js';
import {
  groundSnapshot,
  describeScreen,
  findGrounded,
  findElements,
} from '../../src/ml/detection/grounding.js';

describe('ml/detection/models', () => {
  describe('boundsCenter', () => {
    it('calculates center of bounds', () => {
      const bounds: Bounds = { x: 10, y: 20, width: 100, height: 50 };
      expect(boundsCenter(bounds)).toEqual({ x: 60, y: 45 });
    });
  });

  describe('boundsArea', () => {
    it('calculates area', () => {
      const bounds: Bounds = { x: 0, y: 0, width: 10, height: 20 };
      expect(boundsArea(bounds)).toBe(200);
    });

    it('returns 0 for invalid bounds', () => {
      const bounds: Bounds = { x: 0, y: 0, width: -1, height: 10 };
      expect(boundsArea(bounds)).toBe(0);
    });
  });

  describe('boundsValid', () => {
    it('returns true for valid bounds', () => {
      expect(boundsValid({ x: 0, y: 0, width: 10, height: 10 })).toBe(true);
    });

    it('returns false for zero width', () => {
      expect(boundsValid({ x: 0, y: 0, width: 0, height: 10 })).toBe(false);
    });

    it('returns false for zero height', () => {
      expect(boundsValid({ x: 0, y: 0, width: 10, height: 0 })).toBe(false);
    });
  });

  describe('iou', () => {
    it('returns 1 for identical boxes', () => {
      const box: Bounds = { x: 0, y: 0, width: 10, height: 10 };
      expect(iou(box, box)).toBe(1);
    });

    it('returns 0 for non-overlapping boxes', () => {
      const a: Bounds = { x: 0, y: 0, width: 10, height: 10 };
      const b: Bounds = { x: 20, y: 20, width: 10, height: 10 };
      expect(iou(a, b)).toBe(0);
    });

    it('calculates partial overlap', () => {
      const a: Bounds = { x: 0, y: 0, width: 10, height: 10 };
      const b: Bounds = { x: 5, y: 5, width: 10, height: 10 };
      const result = iou(a, b);
      // Intersection: 5x5 = 25, Union: 100+100-25 = 175, IoU = 25/175 ≈ 0.143
      expect(result).toBeGreaterThan(0.1);
      expect(result).toBeLessThan(0.2);
    });

    it('returns 0 for touching boxes', () => {
      const a: Bounds = { x: 0, y: 0, width: 10, height: 10 };
      const b: Bounds = { x: 10, y: 0, width: 10, height: 10 };
      expect(iou(a, b)).toBe(0);
    });
  });
});

describe('ml/detection/grounding', () => {
  const createSnapshot = (): WorldSnapshot => ({
    ui: {
      'btn-1': {
        id: 'btn-1',
        role: 'button',
        name: 'Submit',
        description: 'Submit button',
        application: 'webapp',
        bounds: { x: 100, y: 200, width: 80, height: 30 },
        states: [],
        actions: ['click'],
        interactive: true,
      },
      'heading-1': {
        id: 'heading-1',
        role: 'heading',
        name: 'Welcome',
        description: 'Page heading',
        application: 'webapp',
        bounds: { x: 50, y: 50, width: 200, height: 40 },
        states: [],
        actions: [],
        interactive: false,
      },
    },
    visual: {},
    text: {
      'ocr-1': {
        text: 'Submit',
        bounds: { x: 105, y: 205, width: 70, height: 20 },
        confidence: 0.95,
      },
    },
  });

  describe('groundSnapshot', () => {
    it('returns grounded elements', () => {
      const snapshot = createSnapshot();
      const grounded = groundSnapshot(snapshot);
      expect(grounded.length).toBe(2);
    });

    it('sorts by confidence descending', () => {
      const snapshot = createSnapshot();
      const grounded = groundSnapshot(snapshot);
      expect(grounded[0]!.confidence).toBeGreaterThanOrEqual(grounded[1]!.confidence);
    });

    it('fuses OCR text when IoU threshold met', () => {
      const snapshot = createSnapshot();
      const grounded = groundSnapshot(snapshot);
      const button = grounded.find(g => g.role === 'button');
      expect(button).toBeDefined();
      expect(button!.ocrText).toContain('Submit');
    });

    it('assigns higher confidence to named interactive elements', () => {
      const snapshot = createSnapshot();
      const grounded = groundSnapshot(snapshot);
      const button = grounded.find(g => g.role === 'button');
      const heading = grounded.find(g => g.role === 'heading');
      expect(button!.confidence).toBeGreaterThan(heading!.confidence);
    });
  });

  describe('describeScreen', () => {
    it('returns human-readable summary', () => {
      const snapshot = createSnapshot();
      const description = describeScreen(snapshot);
      expect(description).toContain('Screen grounding:');
      expect(description).toContain('elements');
      expect(description).toContain('interactive');
    });
  });

  describe('findGrounded', () => {
    it('finds elements by text query', () => {
      const snapshot = createSnapshot();
      const results = findGrounded(snapshot, { textQuery: 'submit' });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.name === 'Submit')).toBe(true);
    });

    it('filters by interactive when specified', () => {
      const snapshot = createSnapshot();
      const results = findGrounded(snapshot, { textQuery: 'welcome', interactiveOnly: true });
      expect(results.length).toBe(0); // heading is not interactive
    });
  });

  describe('findElements', () => {
    it('filters by role', () => {
      const snapshot = createSnapshot();
      const results = findElements(snapshot, { role: 'button' });
      expect(results.length).toBe(1);
      expect(results[0]!.role).toBe('button');
    });

    it('filters by name substring', () => {
      const snapshot = createSnapshot();
      const results = findElements(snapshot, { name: 'Submit' });
      expect(results.length).toBe(1);
    });

    it('filters by interactive', () => {
      const snapshot = createSnapshot();
      const results = findElements(snapshot, { interactive: true });
      expect(results.length).toBe(1);
      expect(results[0]!.interactive).toBe(true);
    });

    it('respects limit', () => {
      const snapshot = createSnapshot();
      const results = findElements(snapshot, { limit: 1 });
      expect(results.length).toBe(1);
    });
  });
});
