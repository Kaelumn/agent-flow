import type { GraphDoc } from '@agent-flow/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveChange } from '../useFlow';
import { diffDocs, isEmpty, schedule, type Beat } from './playback';

/** Removed elements fade and existing ones glide to their new spot before anything new appears. */
export const SETTLE_MS = 300;
/** How long an element keeps its entrance animation class. */
const ENTER_MS = 700;
const FLASH_MS = 1400;
/** The whole sequence stays under this, however large the change. */
const MAX_SEQUENCE_MS = 4000;
const BEAT_MS = { min: 90, max: 240 };
const ACTIVE_MS = 4000;

export interface Playback {
  /** Revision being played. */
  revision: number | null;
  /** Whether to animate at all: off in a background tab or with reduced motion. */
  animate: boolean;
  /** Added or redrawn elements still waiting for their turn. */
  hidden: Set<string>;
  /** Elements that just appeared and are animating in. */
  entering: Set<string>;
  /** Nodes whose content changed. */
  flashing: Set<string>;
  /** Elements that were removed, kept briefly so they can fade out. */
  ghosts: GraphDoc | null;
  /** Who is editing, while changes keep arriving. */
  actor: string | null;
}

const idle: Playback = { revision: null, animate: false, hidden: new Set(), entering: new Set(), flashing: new Set(), ghosts: null, actor: null };

/** The opening frame of a change and the beats that follow it. */
function plan(live: LiveChange): { start: Playback; beats: Beat[] } {
  const diff = diffDocs(live.from, live.to);
  const base = { ...idle, revision: live.revision, actor: live.actor, flashing: new Set(diff.changedNodes) };
  if (isEmpty(diff)) return { start: { ...base, animate: true }, beats: [] };
  // In a background tab or with reduced motion, show the result at once and only mark what changed.
  if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return { start: { ...base, flashing: new Set([...diff.changedNodes, ...diff.addedNodes]) }, beats: [] };
  }
  const beats = schedule(live.to, diff);
  const removed = { nodes: new Set(diff.removedNodes), edges: new Set(diff.removedEdges) };
  const ghosts = removed.nodes.size || removed.edges.size
    ? { nodes: live.from.nodes.filter((n) => removed.nodes.has(n.id)), edges: live.from.edges.filter((e) => removed.edges.has(e.id)) }
    : null;
  return { start: { ...base, animate: true, hidden: new Set(beats.map((b) => b.id)), ghosts }, beats };
}

/**
 * Plays someone else's change on the canvas: fades out what was removed, then reveals what was added in flow order,
 * one element per beat. `onReveal` gets the nodes each beat shows (an edge's two ends) so the view can follow along,
 * and null once the sequence is over.
 */
export function useLivePlayback(live: LiveChange | null, onReveal: (nodeIds: string[] | null) => void): Playback {
  const planned = useMemo(() => (live ? plan(live) : null), [live]);
  const [state, setState] = useState<Playback>(idle);
  const reveal = useRef(onReveal);
  reveal.current = onReveal;

  useEffect(() => {
    if (!live || !planned) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const patch = (fn: (s: Playback) => Partial<Playback>) => setState((s) => ({ ...s, ...fn(s) }));

    setState(planned.start);
    at(ACTIVE_MS, () => patch(() => ({ actor: null })));
    at(FLASH_MS, () => patch(() => ({ flashing: new Set() })));
    at(SETTLE_MS, () => patch(() => ({ ghosts: null })));

    const beat = Math.min(BEAT_MS.max, Math.max(BEAT_MS.min, MAX_SEQUENCE_MS / Math.max(planned.beats.length, 1)));
    const ends = (edgeId: string) => live.to.edges.filter((e) => e.id === edgeId).flatMap((e) => [e.source, e.target]);
    planned.beats.forEach(({ kind, id }, i) => {
      const t = SETTLE_MS + i * beat;
      at(t, () => {
        patch((s) => ({ hidden: without(s.hidden, id), entering: new Set(s.entering).add(id) }));
        reveal.current(kind === 'node' ? [id] : ends(id));
      });
      at(t + ENTER_MS, () => patch((s) => ({ entering: without(s.entering, id) })));
    });
    at(SETTLE_MS + planned.beats.length * beat + ENTER_MS, () => reveal.current(null));

    // A newer change replaces this one; whatever it had not shown yet is part of the new starting point.
    return () => timers.forEach(clearTimeout);
  }, [planned]);

  // Until the effect has run, render the opening frame so new elements never flash in before their turn.
  return planned && state.revision !== planned.start.revision ? planned.start : state;
}

function without(set: Set<string>, id: string) {
  const next = new Set(set);
  next.delete(id);
  return next;
}
