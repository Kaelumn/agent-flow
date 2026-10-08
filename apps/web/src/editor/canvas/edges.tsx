import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
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
  /** Live playback of someone else's change: the line draws itself in, or fades out. */
  motion?: 'enter' | 'leave';
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
 * Curved edge. Branch conditions live on the source card, so only error jumps carry a label, at the middle of the path.
 * A selected edge offers "insert a step": inside its label when it has one, otherwise at the middle of the path, so the
 * button never covers the two end handles used to drag the edge onto another node.
 */
function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data, selected }: EdgeProps<CanvasEdge>) {
  const [path, midX, midY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  if (!data) return null;
  const insert = selected && data.onInsert ? data.onInsert : undefined;
  const color = edgeColor(data);
  const emphasised = data.tone !== 'normal';
  const drawing = data.motion === 'enter';
  const dashed = !drawing && (data.kind === 'fallback' || data.kind === 'error' || data.tone === 'trace');

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={drawing ? undefined : markerEnd}
        interactionWidth={24}
        // A unit path length lets the draw-in animation run the same way on short and long edges.
        pathLength={drawing ? 1 : undefined}
        className={drawing ? 'af-draw' : data.motion === 'leave' ? 'af-leave' : undefined}
        style={{
          stroke: color,
          strokeWidth: emphasised ? 2.25 : 1.5,
          strokeDasharray: dashed ? '6 5' : undefined,
          animation: data.tone === 'trace' && !drawing ? 'af-dash 0.8s linear infinite' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        {data.label && (
          // Long labels are truncated; the tooltip shows them in full.
          <Tooltip content={data.label.length > 32 ? data.label : null}>
            <div
              style={{ transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px)` }}
              className={cx(
                'nodrag nopan pointer-events-auto absolute flex max-w-[240px] cursor-pointer items-center gap-1 rounded-full border py-0.5 pl-2.5 text-[11px] leading-5 font-medium shadow-sm',
                insert ? 'pr-0.5' : 'pr-2.5',
                LABEL_STYLE[data.kind],
                drawing && 'af-label-enter',
                data.motion === 'leave' && 'af-leave',
                data.tone === 'selected' && 'border-indigo-300 text-indigo-700 ring-2 ring-indigo-500/15',
                data.tone === 'invalid' && 'border-rose-300 text-rose-700',
              )}
            >
              <span className="truncate">{data.label}</span>
              {insert && <InsertButton onInsert={insert} small />}
            </div>
          </Tooltip>
        )}
        {insert && !data.label && (
          // Positioned by the wrapper: CSS `scale` composes after `transform`, so scaling this element would scale its offset too.
          <div style={{ transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px)` }} className="nodrag nopan pointer-events-auto absolute">
            <InsertButton onInsert={insert} />
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

function InsertButton({ onInsert, small }: { onInsert: () => void; small?: boolean }) {
  return (
    <Tooltip content="Insert a step">
      <button
        type="button"
        aria-label="Insert a step"
        onClick={(e) => {
          e.stopPropagation();
          onInsert();
        }}
        className={cx(
          'grid shrink-0 place-items-center rounded-full bg-indigo-600 text-white transition-transform hover:scale-110',
          small ? 'size-5' : 'size-6 shadow-md ring-4 ring-white',
        )}
      >
        <Plus size={small ? 12 : 14} strokeWidth={2.5} />
      </button>
    </Tooltip>
  );
}

export const edgeTypes = { flow: FlowEdge };
