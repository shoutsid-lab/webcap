/**
 * Screen grounding: fuse accessibility tree, OCR, and visual detection results.
 *
 * Ported from sensornet/sensors/grounding.py with TypeScript adaptations.
 * Produces per-element grounded descriptions that can be used for
 * page understanding and analysis.
 */
import { type Bounds, type UIElement, type VisualTrack, type OCRRegion, type GroundedElement, type WorldSnapshot, iou, boundsValid } from './models.js';

// --- Constants ---
const FUSION_IOU_THRESHOLD = 0.3;
const MAX_GROUNDED_ELEMENTS = 50;

// --- Confidence scoring (matching sensornet's algorithm) ---
const BASE_CONFIDENCE = 0.4;
const NAMED_BONUS = 0.3;
const INTERACTIVE_BONUS = 0.15;
const OCR_BONUS = 0.1;
const VISUAL_BONUS = 0.05;

/**
 * Fuse UI elements, OCR regions, and visual tracks into grounded elements.
 *
 * Matches sensornet's ground_snapshot() algorithm:
 * 1. For each UI element, find overlapping OCR regions (IoU >= threshold)
 * 2. For each UI element, find overlapping visual tracks (IoU >= threshold)
 * 3. Build description from role + name + OCR text + visual labels
 * 4. Score confidence based on named, interactive, OCR, visual presence
 *
 * @param snapshot - World snapshot with UI, visual, and text data
 * @returns Array of grounded elements sorted by confidence (descending)
 */
export function groundSnapshot(snapshot: WorldSnapshot): GroundedElement[] {
  const { ui, visual, text } = snapshot;
  const grounded: GroundedElement[] = [];

  for (const element of Object.values(ui)) {
    const ocrHits: string[] = [];
    const visualHits: string[] = [];

    if (element.bounds !== null && boundsValid(element.bounds)) {
      // Find overlapping OCR regions
      for (const region of Object.values(text)) {
        if (iou(element.bounds, region.bounds) >= FUSION_IOU_THRESHOLD) {
          const t = region.text.trim();
          if (t) ocrHits.push(t);
        }
      }

      // Find overlapping visual tracks
      for (const track of Object.values(visual)) {
        if (track.active && iou(element.bounds, track.bounds) >= FUSION_IOU_THRESHOLD) {
          const label = track.className;
          if (label) visualHits.push(label);
        }
      }
    }

    // Build description parts
    const parts: string[] = [];
    if (element.role) parts.push(element.role);
    if (element.name) parts.push(element.name);
    if (ocrHits.length > 0) parts.push('ocr=' + ocrHits.slice(0, 3).join(' | '));
    if (visualHits.length > 0) parts.push('visual=' + Array.from(new Set(visualHits)).slice(0, 4).join(','));

    // Calculate confidence (matching sensornet's algorithm)
    let confidence = BASE_CONFIDENCE;
    if (element.name) confidence += NAMED_BONUS;
    if (element.interactive) confidence += INTERACTIVE_BONUS;
    if (ocrHits.length > 0) confidence += OCR_BONUS;
    if (visualHits.length > 0) confidence += VISUAL_BONUS;

    grounded.push({
      id: element.id,
      role: element.role,
      name: element.name,
      application: element.application,
      interactive: element.interactive,
      bounds: element.bounds,
      states: element.states,
      actions: element.actions,
      ocrText: ocrHits.slice(0, 6),
      visualLabels: Array.from(new Set(visualHits)).slice(0, 6),
      description: parts.join(' · ') || element.role || 'unknown',
      confidence: Math.min(1.0, confidence),
    });
  }

  // Sort by confidence descending (matching sensornet's sort)
  grounded.sort((a, b) => b.confidence - a.confidence || a.description.localeCompare(b.description));

  return grounded.slice(0, MAX_GROUNDED_ELEMENTS);
}

/**
 * Generate a human-readable summary of the grounded screen.
 * Matches sensornet's describe_screen() function.
 */
export function describeScreen(snapshot: WorldSnapshot, limit = 25): string {
  const items = groundSnapshot(snapshot);
  const interactive = items.filter(g => g.interactive);

  const lines: string[] = [
    `Screen grounding: ${items.length} elements, ${interactive.length} interactive`,
  ];

  for (const g of interactive.slice(0, limit)) {
    const extra: string[] = [];
    if (g.ocrText.length > 0) extra.push('ocr=' + g.ocrText.slice(0, 2).join('/'));
    if (g.visualLabels.length > 0) extra.push('vis=' + g.visualLabels.slice(0, 2).join(','));
    const suffix = extra.length > 0 ? ` (${extra.join(', ')})` : '';
    lines.push(
      `  [${g.confidence.toFixed(2)}] ${g.application}/${g.role}/${JSON.stringify(g.name)}${suffix}`,
    );
  }

  return lines.join('\n');
}

/**
 * Search grounded elements by name, OCR, or visual label substring.
 * Matches sensornet's find_grounded() function.
 */
export function findGrounded(
  snapshot: WorldSnapshot,
  options: {
    textQuery: string;
    interactiveOnly?: boolean;
  },
): GroundedElement[] {
  const q = options.textQuery.toLowerCase().trim();
  const interactiveOnly = options.interactiveOnly ?? true;

  return groundSnapshot(snapshot).filter(g => {
    if (interactiveOnly && !g.interactive) return false;
    const bag = [
      g.name,
      g.role,
      g.application,
      g.description,
      ...g.ocrText,
      ...g.visualLabels,
    ].join(' ').toLowerCase();
    return bag.includes(q);
  });
}

/**
 * Filter grounded elements by attributes.
 * Matches sensornet's find_elements() function.
 */
export function findElements(
  snapshot: WorldSnapshot,
  filters: {
    id?: string;
    role?: string;
    name?: string;
    application?: string;
    interactive?: boolean;
    limit?: number;
  } = {},
): Array<Record<string, unknown>> {
  const { id, role, name, application, interactive, limit = 50 } = filters;
  const grounded = groundSnapshot(snapshot);

  const hits: Array<Record<string, unknown>> = [];
  for (const g of grounded) {
    if (id !== undefined && g.id !== id) continue;
    if (role !== undefined && role.toLowerCase() !== g.role.toLowerCase()) continue;
    if (name !== undefined && !g.name.toLowerCase().includes(name.toLowerCase())) continue;
    if (application !== undefined && !g.application.toLowerCase().includes(application.toLowerCase())) continue;
    if (interactive !== undefined && g.interactive !== interactive) continue;

    hits.push({
      id: g.id,
      role: g.role,
      name: g.name,
      application: g.application,
      bounds: g.bounds,
      interactive: g.interactive,
      actions: g.actions,
      states: g.states,
    });

    if (hits.length >= limit) break;
  }

  return hits;
}
