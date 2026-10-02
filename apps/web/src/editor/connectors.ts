import type { FlowNode, ToolDefinition } from '@agent-flow/core';
import { Bot, Cloud, MessagesSquare, Sparkles, Ticket, Wrench, type LucideIcon } from 'lucide-react';

export interface ConnectorStyle {
  label: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon tile. */
  tile: string;
}

/** Visual identity per system, so a step's system is recognisable at a glance. */
const STYLES: Record<string, ConnectorStyle> = {
  'microsoft-graph': { label: 'Microsoft 365', icon: Cloud, tile: 'bg-sky-50 text-sky-600 ring-sky-100' },
  autotask: { label: 'Autotask', icon: Ticket, tile: 'bg-orange-50 text-orange-600 ring-orange-100' },
  mspbots: { label: 'Teams', icon: MessagesSquare, tile: 'bg-violet-50 text-violet-600 ring-violet-100' },
};

const FALLBACK: ConnectorStyle = { label: 'Tool', icon: Wrench, tile: 'bg-slate-100 text-slate-500 ring-slate-200' };

export const connectorStyle = (connector?: string): ConnectorStyle =>
  connector ? (STYLES[connector] ?? { ...FALLBACK, label: connector }) : FALLBACK;

const SKILL: ConnectorStyle = { label: 'Skill', icon: Sparkles, tile: 'bg-fuchsia-50 text-fuchsia-600 ring-fuchsia-100' };
const AGENT: ConnectorStyle = { label: 'Agent', icon: Bot, tile: 'bg-indigo-50 text-indigo-600 ring-indigo-100' };

/** How a step is shown: the tool's system, a skill, or the agent working from the instruction alone. */
export function stepStyle(node: Pick<FlowNode, 'tool' | 'skill'>, tool?: ToolDefinition): ConnectorStyle & { detail?: string } {
  if (node.tool) return { ...connectorStyle(tool?.connector), detail: node.tool.name };
  if (node.skill) return { ...SKILL, detail: node.skill.name };
  return AGENT;
}
