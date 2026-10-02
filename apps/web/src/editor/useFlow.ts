import type { GraphDoc, GraphOp, ToolDefinition } from '@agent-flow/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type GraphWithIssues } from '../api/client';
import { subscribe } from '../api/events';
import { useToast } from '../components/ui';

/** Counters bumped by server events; panels refetch when theirs changes. */
export interface Signals {
  runs: number;
  versions: number;
}

/** A change someone else made (usually the agent), for the canvas to play back. */
export interface LiveChange {
  revision: number;
  actor: string;
  from: GraphDoc;
  to: GraphDoc;
}

export function useFlow(graphId: string) {
  const { fail, notify } = useToast();
  const [graph, setGraph] = useState<GraphWithIssues | null>(null);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [signals, setSignals] = useState<Signals>({ runs: 0, versions: 0 });
  const [missing, setMissing] = useState(false);
  const [live, setLive] = useState<LiveChange | null>(null);
  const revision = useRef(0);
  const current = useRef<GraphWithIssues | null>(null);

  const accept = useCallback((next: GraphWithIssues) => {
    revision.current = next.revision;
    current.current = next;
    setGraph(next);
  }, []);

  /** With `actor`, the reload follows someone else's edit and is handed to the canvas as a live change. */
  const reload = useCallback(
    (actor?: string) =>
      api.getGraph(graphId).then(
        (next) => {
          const before = current.current;
          if (actor && before && next.revision > before.revision) setLive({ revision: next.revision, actor, from: before.draft, to: next.draft });
          accept(next);
        },
        (err) => {
          if (err instanceof ApiError && err.status === 404) setMissing(true);
          else fail(err);
        },
      ),
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
          if (event.revision > revision.current) void reload(event.actor);
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

  return { graph, missing, tools, toolsByName, signals, live, edit, reload, accept };
}

export type FlowState = ReturnType<typeof useFlow>;
