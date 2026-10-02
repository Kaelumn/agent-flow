import type { FlowNode } from '@agent-flow/core';
import { NodeToolbar, Position } from '@xyflow/react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { Tooltip } from '../../components/ui';

/** What the floating toolbar of a selected node can do; null while the canvas is read-only or annotating. */
export interface NodeActions {
  addAfter: (nodeId: string) => void;
  duplicate: (nodeId: string) => void;
  remove: (nodeId: string) => void;
}

export const NodeActionsContext = createContext<NodeActions | null>(null);

/** Quick actions above the selected node, so common edits need no trip to the panel. */
export function NodeActionBar({ node, selected }: { node: FlowNode; selected: boolean }) {
  const actions = useContext(NodeActionsContext);
  if (!actions) return null;
  return (
    <NodeToolbar isVisible={selected} position={Position.Top} offset={10}>
      <div className="nodrag nopan flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 shadow-lg shadow-slate-900/10">
        {node.type !== 'end' && <Action label="Add a step after" onClick={() => actions.addAfter(node.id)}><Plus size={14} /></Action>}
        {node.type === 'tool' && <Action label="Duplicate" onClick={() => actions.duplicate(node.id)}><Copy size={13} /></Action>}
        {node.type !== 'start' && <Action label="Delete" danger onClick={() => actions.remove(node.id)}><Trash2 size={13} /></Action>}
      </div>
    </NodeToolbar>
  );
}

function Action({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={`grid size-7 place-items-center rounded-md text-slate-500 transition-colors ${danger ? 'hover:bg-rose-50 hover:text-rose-600' : 'hover:bg-slate-100 hover:text-slate-900'}`}
      >
        {children}
      </button>
    </Tooltip>
  );
}
