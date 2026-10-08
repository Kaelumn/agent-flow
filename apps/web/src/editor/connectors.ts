import type { FlowNode, ToolDefinition } from '@agent-flow/core';
import { Bot, Cloud, MessagesSquare, Sparkles, Ticket, Wrench, type LucideIcon } from 'lucide-react';

export interface ConnectorStyle {
  label: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon tile. */
  tile: string;
  /** Solid fill for the icon square on canvas cards. */
  solid: string;
}

/** Visual identity per system, so a step's system is recognisable at a glance. */
const STYLES: Record<string, ConnectorStyle> = {
  'microsoft-graph': { label: 'Microsoft 365', icon: Cloud, tile: 'bg-sky-50 text-sky-600 ring-sky-100', solid: 'bg-sky-500' },
  autotask: { label: 'Autotask', icon: Ticket, tile: 'bg-orange-50 text-orange-600 ring-orange-100', solid: 'bg-orange-500' },
  mspbots: { label: 'Teams', icon: MessagesSquare, tile: 'bg-violet-50 text-violet-600 ring-violet-100', solid: 'bg-violet-500' },
};

const FALLBACK: ConnectorStyle = { label: 'Tool', icon: Wrench, tile: 'bg-slate-100 text-slate-500 ring-slate-200', solid: 'bg-slate-500' };

export const connectorStyle = (connector?: string): ConnectorStyle =>
  connector ? (STYLES[connector] ?? { ...FALLBACK, label: connector }) : FALLBACK;

const SKILL: ConnectorStyle = { label: 'Skill', icon: Sparkles, tile: 'bg-fuchsia-50 text-fuchsia-600 ring-fuchsia-100', solid: 'bg-fuchsia-500' };
const AGENT: ConnectorStyle = { label: 'Agent', icon: Bot, tile: 'bg-indigo-50 text-indigo-600 ring-indigo-100', solid: 'bg-indigo-500' };

/** How a step is shown: the tool's system, a skill, or the agent working from the instruction alone. */
export function stepStyle(node: Pick<FlowNode, 'tool' | 'skill'>, tool?: ToolDefinition): ConnectorStyle & { detail?: string } {
  if (node.tool) return { ...connectorStyle(tool?.connector), detail: node.tool.name };
  if (node.skill) return { ...SKILL, detail: node.skill.name };
  return AGENT;
}
