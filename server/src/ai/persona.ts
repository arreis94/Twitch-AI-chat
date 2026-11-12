import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { PERSONAS_DIR } from '../config';

export const personaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  personality: z.string().min(1),
  interests: z.array(z.string()).default([]),
  favoriteEmotes: z.array(z.string()).default([]),
  chattiness: z.number().positive().max(20).default(2), // target messages/min
  verbosity: z.enum(['short', 'medium']).default('short'),
  language: z.string().default('English'),
  // Azure agent cache — managed by agentService, not user-editable
  azureAgentId: z.string().optional(),
  instructionsHash: z.string().optional(),
});

export type Persona = z.infer<typeof personaSchema>;

export const personaInputSchema = personaSchema.omit({ id: true, azureAgentId: true, instructionsHash: true });
export type PersonaInput = z.infer<typeof personaInputSchema>;

function personaPath(id: string): string {
  return path.join(PERSONAS_DIR, `${id}.json`);
}

export class PersonaStore {
  private personas = new Map<string, Persona>();

  async load(): Promise<void> {
    this.personas.clear();
    let files: string[] = [];
    try {
      files = await fs.readdir(PERSONAS_DIR);
    } catch {
      return;
    }
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(PERSONAS_DIR, file), 'utf-8'));
        const persona = personaSchema.parse(raw);
        this.personas.set(persona.id, persona);
      } catch (err) {
        console.warn(`Skipping invalid persona file ${file}:`, err);
      }
    }
  }

  list(): Persona[] {
    return [...this.personas.values()];
  }

  get(id: string): Persona | undefined {
    return this.personas.get(id);
  }

  async create(input: PersonaInput): Promise<Persona> {
    const persona: Persona = { ...input, id: crypto.randomUUID() };
    await this.save(persona);
    return persona;
  }

  async update(id: string, input: PersonaInput): Promise<Persona> {
    const existing = this.personas.get(id);
    if (!existing) throw new Error(`Unknown persona ${id}`);
    // Keep the agent cache; agentService detects definition changes via hash.
    const persona: Persona = {
      ...input,
      id,
      azureAgentId: existing.azureAgentId,
      instructionsHash: existing.instructionsHash,
    };
    await this.save(persona);
    return persona;
  }

  async save(persona: Persona): Promise<void> {
    this.personas.set(persona.id, persona);
    await fs.writeFile(personaPath(persona.id), JSON.stringify(persona, null, 2), 'utf-8');
  }

  async remove(id: string): Promise<void> {
    this.personas.delete(id);
    await fs.rm(personaPath(id), { force: true });
  }
}
