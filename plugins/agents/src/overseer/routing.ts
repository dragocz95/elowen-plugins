import type { AgentSpec } from '../spawn/commandBuilder.js';
import { PROGRAM_PREFIXES, execSpecProgram } from '../lib/execs.js';

export function resolveExecutor(labels: string[], fallback: AgentSpec): AgentSpec {
  const label = labels.find(l => l.startsWith('exec:'));
  if (!label) return fallback;
  const spec = label.slice('exec:'.length);
  const program = execSpecProgram(spec);
  const prefix = Object.keys(PROGRAM_PREFIXES).find(p => spec.startsWith(p));
  return { program, model: prefix ? spec.slice(prefix.length) : spec };
}
