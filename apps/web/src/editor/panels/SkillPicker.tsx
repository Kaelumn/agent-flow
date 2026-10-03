import type { SkillDefinition } from '@agent-flow/core';
import { Check, ChevronsUpDown, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cx, Popover } from '../../components/ui';

interface Props {
  skills: SkillDefinition[];
  value: string;
  onChange: (name: string) => void;
}

/** Searchable list of the platform's skills, shown like the tool picker. */
export function SkillPicker({ skills, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const selected = skills.find((s) => s.name === value);

  const matches = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return skills.filter((s) => terms.every((t) => `${s.name} ${s.description}`.toLowerCase().includes(t))).sort((a, b) => a.name.localeCompare(b.name));
  }, [skills, query]);

  useEffect(() => setActive(0), [query, open]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (skill: SkillDefinition) => {
    onChange(skill.name);
    setOpen(false);
    setQuery('');
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, matches.length - 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
    else if (e.key === 'Enter' && matches[active]) choose(matches[active]);
    else return;
    e.preventDefault();
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      className="inset-x-0"
      trigger={
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cx('flex w-full items-center gap-2.5 rounded-lg border bg-white px-2.5 py-2 text-left shadow-xs transition-colors hover:border-slate-300', open ? 'border-indigo-500 ring-3 ring-indigo-500/15' : 'border-slate-200')}
        >
          {selected ? (
            <>
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-fuchsia-50 text-fuchsia-600 ring-1 ring-fuchsia-100"><Sparkles size={14} strokeWidth={1.75} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12.5px] font-medium text-slate-900">{selected.name}</span>
                <span className="block truncate text-[11.5px] text-slate-500">Skill</span>
              </span>
            </>
          ) : (
            <span className={cx('flex-1 text-[13px]', value ? 'font-mono text-rose-600' : 'text-slate-400')}>{value ? `${value} (not in the skill list)` : 'Choose a skill…'}</span>
          )}
          <ChevronsUpDown size={15} className="shrink-0 text-slate-400" />
        </button>
      }
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-3">
        <Search size={14} className="text-slate-400" />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} placeholder="Search skills…" className="h-10 flex-1 bg-transparent text-[13px] placeholder:text-slate-400 focus:outline-none" />
        <span className="text-[11px] text-slate-400 tabular-nums">{matches.length}</span>
      </div>
      <div ref={list} className="max-h-80 overflow-y-auto p-1.5">
        {!skills.length && <p className="px-3 py-6 text-center text-[12.5px] text-slate-500">No skills are available. The skill list comes from the MSPbots platform.</p>}
        {skills.length > 0 && !matches.length && <p className="px-3 py-6 text-center text-[12.5px] text-slate-500">No skill matches “{query}”.</p>}
        {matches.map((skill, i) => (
          <button
            key={skill.name}
            type="button"
            data-index={i}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(skill)}
            className={cx('flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left', i === active && 'bg-slate-100')}
          >
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-fuchsia-50 text-fuchsia-600 ring-1 ring-fuchsia-100"><Sparkles size={13} strokeWidth={1.75} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[12px] font-medium text-slate-900">{skill.name}</span>
              <span className="line-clamp-2 text-[11.5px] leading-snug text-slate-500">{skill.description}</span>
            </span>
            {skill.name === value && <Check size={14} className="mt-1 shrink-0 text-indigo-600" />}
          </button>
        ))}
      </div>
    </Popover>
  );
}
