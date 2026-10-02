import type { SkillDefinition } from '@agent-flow/core';
import { z } from 'zod';
import type { Config } from '../config.js';

/** Skills a step may follow, as listed by the MSPbots platform. */
export interface SkillCatalog {
  list(filter?: { query?: string }): SkillDefinition[];
  get(name: string): SkillDefinition | undefined;
}

const SkillList = z.object({ skills: z.array(z.object({ name: z.string().min(1), description: z.string().default('') })) });

const REFRESH_MS = 5 * 60_000;

/**
 * Reads the skill list from an HTTP endpoint returning { skills: [{ name, description }] }. Until the MSPbots
 * platform API is wired in, that endpoint is mock-msp's /skills. A failed refresh keeps the last list.
 */
export class HttpSkillCatalog implements SkillCatalog {
  private skills = new Map<string, SkillDefinition>();

  private constructor(
    private readonly url: string,
    private readonly onError: (err: unknown) => void,
  ) {}

  static async fromUrl(url: string, onError: (err: unknown) => void): Promise<HttpSkillCatalog> {
    const catalog = new HttpSkillCatalog(url, onError);
    await catalog.refresh();
    setInterval(() => void catalog.refresh(), REFRESH_MS).unref();
    return catalog;
  }

  async refresh() {
    try {
      const res = await fetch(this.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { skills } = SkillList.parse(await res.json());
      this.skills = new Map(skills.map((s) => [s.name, s]));
    } catch (err) {
      this.onError(err);
    }
  }

  list({ query }: { query?: string } = {}): SkillDefinition[] {
    const terms = query?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    return [...this.skills.values()].filter((s) => terms.every((t) => `${s.name} ${s.description}`.toLowerCase().includes(t)));
  }

  get(name: string) {
    return this.skills.get(name);
  }
}

/** No skill source configured: steps can still use a tool or the agent alone. */
const noSkills: SkillCatalog = { list: () => [], get: () => undefined };

export function loadSkillCatalog(config: Pick<Config, 'SKILLS_URL'>): Promise<SkillCatalog> {
  return config.SKILLS_URL
    ? HttpSkillCatalog.fromUrl(config.SKILLS_URL, (err) => console.error(`skill catalog: cannot read ${config.SKILLS_URL}: ${(err as Error).message}`))
    : Promise.resolve(noSkills);
}
