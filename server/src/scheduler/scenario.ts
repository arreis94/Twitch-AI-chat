import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { SCENARIOS_DIR } from '../config';

export const scenarioSchema = z
  .object({
    name: z.string().min(1),
    mode: z.enum(['ai', 'pool']),
    accountIds: z.array(z.string()).min(1),
    streamContext: z.string().default(''),
    // AI mode: scales every persona's chattiness
    rateMultiplier: z.number().positive().max(10).default(1),
    // AI mode: probability (0..1) that a participant spontaneously reacts to a
    // chat message that doesn't mention them. Mentions always trigger a reply
    // attempt (subject to the engine's anti-loop guards).
    reactivity: z.number().min(0).max(1).default(0.3),
    // Pool mode
    messagesPerMinute: z.number().positive().max(200).default(10),
    jitter: z.number().min(0).max(1).default(0.3),
    accountSelection: z.enum(['roundRobin', 'random']).default('roundRobin'),
    messagePool: z.array(z.string()).default([]),
    durationSec: z.number().positive().optional(),
  })
  .refine((s) => s.mode !== 'pool' || s.messagePool.length > 0, {
    message: 'Pool mode requires a non-empty messagePool',
  });

export type Scenario = z.infer<typeof scenarioSchema>;

function fileNameFor(name: string): string {
  return `${name.replace(/[^a-zA-Z0-9-_ ]/g, '_')}.json`;
}

export async function listScenarios(): Promise<Scenario[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(SCENARIOS_DIR);
  } catch {
    return [];
  }
  const scenarios: Scenario[] = [];
  for (const file of files.filter((f) => f.endsWith('.json'))) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(SCENARIOS_DIR, file), 'utf-8'));
      scenarios.push(scenarioSchema.parse(raw));
    } catch (err) {
      console.warn(`Skipping invalid scenario file ${file}:`, err);
    }
  }
  return scenarios;
}

export async function saveScenario(scenario: Scenario): Promise<void> {
  await fs.writeFile(path.join(SCENARIOS_DIR, fileNameFor(scenario.name)), JSON.stringify(scenario, null, 2), 'utf-8');
}

export async function deleteScenario(name: string): Promise<void> {
  await fs.rm(path.join(SCENARIOS_DIR, fileNameFor(name)), { force: true });
}
