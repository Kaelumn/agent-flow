import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { cx, Tooltip } from '../../components/ui';

export type EdgeKind = 'plain' | 'branch' | 'fallback' | 'error';
export type EdgeTone = 'normal' | 'selected' | 'invalid' | 'trace';

export interface FlowEdgeData extends Record<string, unknown> {
  kind: EdgeKind;
  tone: EdgeTone;
  label?: string;
  /** Present when a step can be inserted on this edge. */
  onInsert?: () => void;
}

export type CanvasEdge = Edge<FlowEdgeData, 'flow'>;

const STROKE: Record<EdgeTone, string> = { normal: '#94a3b8', selected: '#4f46e5', invalid: '#e11d48', trace: '#059669' };
const ERROR_STROKE = '#f43f5e';

export const edgeColor = (data: FlowEdgeData) => (data.kind === 'error' && data.tone === 'normal' ? ERROR_STROKE : STROKE[data.tone]);

const LABEL_STYLE: Record<EdgeKind, string> = {
  plain: '',
  branch: 'border-slate-200 bg-white text-slate-700',
  fallback: 'border-slate-200 bg-slate-50 text-slate-500 italic',
  error: 'border-rose-200 bg-rose-50 text-rose-600',
};

/**
 * Smooth-step edge. The label sits where the edge turns towards its target: branches from one node fan out
 * horizontally there and edges from different ranks turn at different heights, so labels rarely collide.
 * The insert button sits on the last stretch before the target of a selected edge.
 */
function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data, selected }: EdgeProps<CanvasEdge>) {
  const [path, , turnY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14, offset: 24 });
  const insertY = (turnY + targetY) / 2;
  if (!data) return null;
  const color = edgeColor(data);
  const emphasised = data.tone !== 'normal';
  const dashed = data.kind === 'fallback' || data.kind === 'error' || data.tone === 'trace';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={24}
        style={{
          stroke: color,
          strokeWidth: emphasised ? 2.25 : 1.5,
          strokeDasharray: dashed ? '6 5' : undefined,
          animation: data.tone === 'trace' ? 'af-dash 0.8s linear infinite' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        {data.label && (
          // Long labels are truncated; the tooltip shows them in full.
          <Tooltip content={data.label.length > 32 ? data.label : null}>
            <div
              style={{ transform: `translate(-50%, -50%) translate(${targetX}px, ${turnY}px)` }}
              className={cx(
                'nodrag nopan pointer-events-auto absolute max-w-[220px] cursor-pointer truncate rounded-full border px-2.5 py-0.5 text-[11px] leading-5 font-medium shadow-sm',
                LABEL_STYLE[data.kind],
                data.tone === 'selected' && 'border-indigo-300 text-indigo-700 ring-2 ring-indigo-500/15',
                data.tone === 'invalid' && 'border-rose-300 text-rose-700',
              )}
            >
              {data.label}
            </div>
          </Tooltip>
        )}
        {selected && data.onInsert && (
          // Positioned by the wrapper: CSS `scale` composes after `transform`, so scaling this element would scale its offset too.
          <div style={{ transform: `translate(-50%, -50%) translate(${targetX}px, ${insertY}px)` }} className="nodrag nopan pointer-events-auto absolute">
            <Tooltip content="Insert a step">
              <button
                type="button"
                aria-label="Insert a step"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onInsert?.();
                }}
                className="grid size-6 place-items-center rounded-full bg-indigo-600 text-white shadow-md ring-4 ring-white transition-transform hover:scale-110"
              >
                <Plus size={14} strokeWidth={2.5} />
              </button>
            </Tooltip>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes = { flow: FlowEdge };
