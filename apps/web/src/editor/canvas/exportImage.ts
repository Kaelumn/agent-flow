import { getNodesBounds } from '@xyflow/react';
import { toPng } from 'html-to-image';
import type { CanvasInstance } from './FlowCanvas';

const MARGIN = 48;
const PIXEL_RATIO = 2;
/** Browsers refuse canvases much past this many pixels per side. */
const MAX_SIDE = 16_000;

/**
 * Renders the whole flow, not just what is on screen, to a PNG and downloads it. The canvas chrome (toolbar,
 * minimap, panels) lives outside the viewport element, so it never ends up in the picture.
 */
export async function exportPng(rf: CanvasInstance, container: HTMLElement, title: string) {
  const viewport = container.querySelector<HTMLElement>('.react-flow__viewport');
  const nodes = rf.getNodes().filter((n) => !n.hidden);
  if (!viewport || !nodes.length) throw new Error('There is nothing on the canvas to export.');

  const bounds = getNodesBounds(nodes);
  const width = Math.ceil(bounds.width + MARGIN * 2);
  const height = Math.ceil(bounds.height + MARGIN * 2);
  const url = await toPng(viewport, {
    backgroundColor: getComputedStyle(container).backgroundColor || '#f8fafc',
    width,
    height,
    pixelRatio: Math.min(PIXEL_RATIO, MAX_SIDE / Math.max(width, height)),
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${MARGIN - bounds.x}px, ${MARGIN - bounds.y}px) scale(1)` },
  });

  const link = document.createElement('a');
  link.download = `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'flow'}.png`;
  link.href = url;
  link.click();
}
