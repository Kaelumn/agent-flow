import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import { cx } from '../../components/ui';

export interface FlowEdgeData extends Record<string, unknown> {
  label?: string;
  /** The default branch without its own condition. */
  fallback: boolean;
  tone: 'normal' | 'selected' | 'error' | 'trace';
}

export type CanvasEdge = Edge<FlowEdgeData, 'condition'>;

export const EDGE_COLORS: Record<FlowEdgeData['tone'], string> = {
  normal: '#94a3b8',
  selected: '#4f46e5',
  error: '#dc2626',
  trace: '#059669',
};

/**
 * Smooth-step edge whose label sits just above the target node.
 * Branches from one node share their first segment, so midpoint labels would collide.
 */
function ConditionEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps<CanvasEdge>) {
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 8 });
  const tone = data?.tone ?? 'normal';
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: EDGE_COLORS[tone], strokeWidth: tone === 'normal' ? 1.5 : 2.5 }} />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -100%) translate(${targetX}px, ${targetY - 14}px)` }}
            className={cx(
              'nodrag nopan pointer-events-auto absolute max-w-56 cursor-pointer rounded border bg-white px-1.5 py-0.5 text-center text-[11px] leading-tight shadow-sm',
              tone === 'selected' ? 'border-indigo-400 text-indigo-700' : tone === 'error' ? 'border-red-300 text-red-700' : 'border-slate-200 text-slate-600',
              data.fallback && 'italic',
            )}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { condition: ConditionEdge };
