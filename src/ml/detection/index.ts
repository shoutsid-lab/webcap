/**
 * Object detection and OCR module for webcap ML features.
 *
 * Provides YOLO object detection, Tesseract OCR, and screen grounding
 * via Python bridges to sensornet.
 */
export {
  type Bounds,
  type ObjectDetection,
  type OCRRegion,
  type OCRResult,
  type VisualTrack,
  type UIElement,
  type GroundedElement,
  type WorldSnapshot,
  boundsCenter,
  boundsArea,
  boundsValid,
  iou,
  detectObjects,
  extractTextFromImage,
} from './models.js';

export {
  groundSnapshot,
  describeScreen,
  findGrounded,
  findElements,
} from './grounding.js';
