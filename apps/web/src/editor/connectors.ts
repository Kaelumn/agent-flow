import { Cloud, MessagesSquare, Ticket, Wrench, type LucideIcon } from 'lucide-react';

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
