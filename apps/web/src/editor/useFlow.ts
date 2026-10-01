import type { GraphOp, ToolDefinition } from '@agent-flow/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type GraphWithIssues } from '../api/client';
import { subscribe } from '../api/events';
import { useToast } from '../components/ui';

/** Counters bumped by server events; panels refetch when theirs changes. */
export interface Signals {
  runs: number;
  versions: number;
}

export function useFlow(graphId: string) {
  const { fail, notify } = useToast();
  const [graph, setGraph] = useState<GraphWithIssues | null>(null);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [signals, setSignals] = useState<Signals>({ runs: 0, versions: 0 });
  const [missing, setMissing] = useState(false);
  const revision = useRef(0);

  const accept = useCallback((next: GraphWithIssues) => {
    revision.current = next.revision;
    setGraph(next);
  }, []);

  const reload = useCallback(
    () =>
      api.getGraph(graphId).then(accept, (err) => {
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else fail(err);
      }),
    [graphId],
  );

  useEffect(() => {
    setGraph(null);
    setMissing(false);
    void reload();
    api.tools().then(setTools, fail);

    const resync = () => {
      void reload();
      setSignals((s) => ({ runs: s.runs + 1, versions: s.versions + 1 }));
    };

    return subscribe(graphId, (event) => {
      switch (event.type) {
        case 'graph.changed':
          if (event.revision > revision.current) {
            void reload();
            if (event.source === 'mcp') notify(`${event.actor} (agent) updated the flow`);
          }
          break;
        case 'graph.published':
          void reload();
          setSignals((s) => ({ ...s, versions: s.versions + 1 }));
          break;
        case 'graph.archived':
          setMissing(true);
          break;
        case 'run.changed':
          setSignals((s) => ({ ...s, runs: s.runs + 1 }));
          break;
      }
    }, resync);
  }, [graphId]);

  /** Applies ops at the current revision. On a conflict the latest draft is loaded and null is returned. */
  const edit = useCallback(
    async (ops: GraphOp[]) => {
      try {
        const result = await api.edit(graphId, ops, revision.current);
        accept(result.graph);
        return result;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          notify('The flow changed in the meantime. Showing the latest version; please redo your change.');
          await reload();
        } else {
          fail(err);
        }
        return null;
      }
    },
    [graphId],
  );

  const toolsByName = useMemo(() => new Map(tools.map((t) => [t.name, t])), [tools]);

  return { graph, missing, tools, toolsByName, signals, edit, reload, accept };
}

export type FlowState = ReturnType<typeof useFlow>;
