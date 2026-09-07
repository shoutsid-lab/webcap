/**
 * Data models for object detection and OCR results.
 *
 * Ported from sensornet/sensornet/core/models.py with TypeScript adaptations.
 */

// --- Bounds (axis-aligned rectangle) ---
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function boundsCenter(bounds: Bounds): { x: number; y: number } {
  return {
    x: bounds.x + Math.floor(bounds.width / 2),
    y: bounds.y + Math.floor(bounds.height / 2),
  };
}

export function boundsArea(bounds: Bounds): number {
  return Math.max(0, bounds.width) * Math.max(0, bounds.height);
}

export function boundsValid(bounds: Bounds): boolean {
  return bounds.width > 0 && bounds.height > 0;
}

/**
 * Intersection over Union (IoU) for two bounding boxes.
 * Matches sensornet's iou() function.
 */
export function iou(a: Bounds, b: Bounds): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  if (x1 >= x2 || y1 >= y2) return 0;

  const intersection = (x2 - x1) * (y2 - y1);
  const areaA = boundsArea(a);
  const areaB = boundsArea(b);
  const union = areaA + areaB - intersection;

  return union > 0 ? intersection / union : 0;
}

// --- Object Detection ---
export interface ObjectDetection {
  readonly className: string;
  readonly confidence: number;
  readonly bounds: Bounds;
}

// --- OCR Text Region ---
export interface OCRRegion {
  readonly text: string;
  readonly bounds: Bounds;
  readonly confidence: number;
}

// --- OCR Result ---
export interface OCRResult {
  readonly text: string;
  readonly regions: OCRRegion[];
}

// --- Visual Track (multi-frame identity) ---
export interface VisualTrack {
  readonly id: number;
  readonly className: string;
  readonly confidence: number;
  readonly bounds: Bounds;
  readonly firstSeen: number;
  readonly lastSeen: number;
  readonly observations: number;
  readonly missedFrames: number;
  readonly active: boolean;
}

// --- UI Element (from accessibility tree) ---
export interface UIElement {
  readonly id: string;
  readonly role: string;
  readonly name: string;
  readonly description: string;
  readonly application: string;
  readonly bounds: Bounds | null;
  readonly states: string[];
  readonly actions: string[];
  readonly interactive: boolean;
}

// --- Grounded Element (fused UI + OCR + Visual) ---
export interface GroundedElement {
  readonly id: string;
  readonly role: string;
  readonly name: string;
  readonly application: string;
  readonly interactive: boolean;
  readonly bounds: Bounds | null;
  readonly states: string[];
  readonly actions: string[];
  readonly ocrText: string[];
  readonly visualLabels: string[];
  readonly description: string;
  readonly confidence: number;
}

// --- World Snapshot ---
export interface WorldSnapshot {
  readonly ui: Record<string, UIElement>;
  readonly visual: Record<string, VisualTrack>;
  readonly text: Record<string, OCRRegion>;
}

/**
 * Detect objects in a screenshot using YOLO.
 * Returns array of detected objects with class, confidence, and bounds.
 */
export async function detectObjects(screenshotPath: string): Promise<ObjectDetection[]> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  const script = `
import sys
sys.path.insert(0, '/home/shoutsid/code/sensornet')
from ultralytics import YOLO
import json

model = YOLO('yolo26n.pt')
results = model('${screenshotPath.replace(/'/g, "\\'")}', verbose=False)

detections = []
for r in results:
    if r.boxes is not None:
        for i in range(len(r.boxes.xyxy)):
            x1, y1, x2, y2 = r.boxes.xyxy[i].cpu().numpy()
            detections.append({
                'className': model.names[int(r.boxes.cls[i])],
                'confidence': float(r.boxes.conf[i]),
                'bounds': {
                    'x': int(x1),
                    'y': int(y1),
                    'width': int(x2 - x1),
                    'height': int(y2 - y1)
                }
            })

print(json.dumps(detections))
`;

  try {
    const { stdout } = await execAsync(
      `PYTHONPATH=/home/shoutsid/code/sensornet python3 -c "${script.replace(/"/g, '\\"')}"`,
      { timeout: 30_000 },
    );
    return JSON.parse(stdout.trim()) as ObjectDetection[];
  } catch (err) {
    throw new Error(`YOLO detection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Extract text from a screenshot using Tesseract OCR.
 * Returns full text and individual regions with bounds.
 */
export async function extractTextFromImage(imagePath: string): Promise<OCRResult> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  const script = `
import sys
sys.path.insert(0, '/home/shoutsid/code/sensornet')
import cv2
import pytesseract
from pytesseract import Output
import json

frame = cv2.imread('${imagePath.replace(/'/g, "\\'")}')
if frame is None:
    print(json.dumps({'text': '', 'regions': []}))
else:
    # Preprocessing: resize, grayscale, blur
    height, width = frame.shape[:2]
    target_width = min(width, 1440)
    if width > target_width:
        scale = target_width / width
        working = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    else:
        working = frame

    gray = cv2.cvtColor(working, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)

    data = pytesseract.image_to_data(gray, output_type=Output.DICT, config='--psm 11')

    regions = []
    text_parts = []
    for i in range(len(data['text'])):
        if data['text'][i].strip():
            regions.append({
                'text': data['text'][i],
                'bounds': {
                    'x': data['left'][i],
                    'y': data['top'][i],
                    'width': data['width'][i],
                    'height': data['height'][i]
                },
                'confidence': data['conf'][i] / 100.0
            })
            text_parts.append(data['text'][i])

    print(json.dumps({
        'text': ' '.join(text_parts),
        'regions': regions
    }))
`;

  try {
    const { stdout } = await execAsync(
      `PYTHONPATH=/home/shoutsid/code/sensornet python3 -c "${script.replace(/"/g, '\\"')}"`,
      { timeout: 30_000 },
    );
    return JSON.parse(stdout.trim()) as OCRResult;
  } catch (err) {
    throw new Error(`OCR extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
