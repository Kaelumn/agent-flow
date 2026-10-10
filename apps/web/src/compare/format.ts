import type { EdgeField, FlowNode, NodeField } from '@agent-flow/core';

export const NODE_FIELD_LABEL: Record<NodeField, string> = {
  type: 'Kind',
  title: 'Title',
  instruction: 'Instruction',
  inputs: 'Run inputs',
  tool: 'Tool',
  skill: 'Skill',
  outputKey: 'Saved as',
  outputs: 'Expected fields',
  onError: 'If the step fails',
  outcome: 'Outcome',
};

export const EDGE_FIELD_LABEL: Record<EdgeField, string> = {
  source: 'From',
  target: 'To',
  condition: 'Condition',
  isDefault: 'Default path',
};

const NONE = '—';

/** A field value as the lines a person would read; an empty value reads as a dash. */
export function showValue(field: NodeField | EdgeField, value: unknown, title: (id: string) => string = (id) => id): string {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return NONE;
  switch (field) {
    case 'inputs':
      return (value as NonNullable<FlowNode['inputs']>).map((i) => `${i.name}${i.required ? '' : ' (optional)'}${i.description ? `: ${i.description}` : ''}`).join('\n');
    case 'outputs':
      return (value as NonNullable<FlowNode['outputs']>).map((o) => `${o.name}${o.description ? `: ${o.description}` : ''}`).join('\n');
    case 'tool': {
      const tool = value as NonNullable<FlowNode['tool']>;
      const args = Object.entries(tool.argsHint).map(([k, v]) => `  ${k} ← ${v}`);
      return [tool.name, ...args].join('\n');
    }
    case 'skill':
      return (value as NonNullable<FlowNode['skill']>).name;
    case 'onError': {
      const e = value as NonNullable<FlowNode['onError']>;
      return e.strategy === 'goto' ? `Jump to "${e.targetNodeId ? title(e.targetNodeId) : '?'}"` : e.strategy === 'continue' ? 'Continue' : 'Stop the run';
    }
    case 'source':
    case 'target':
      return title(String(value));
    case 'isDefault':
      return value ? 'Yes' : 'No';
    default:
      return String(value);
  }
}
