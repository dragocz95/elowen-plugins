type Program = 'claude-code' | 'opencode' | 'codex' | 'kilo' | 'pi' | 'omp' | 'elowen';

export type ExecInput = string | { program: string; provider?: string; model: string };

export type ExecRef =
  | { program: 'elowen'; provider: string; model: string }
  | { program: Exclude<Program, 'elowen'>; model: string };

const PROGRAM_PREFIXES: Readonly<Record<string, Program>> = {
  'codex:': 'codex',
  'opencode:': 'opencode',
  'claude:': 'claude-code',
  'kilo:': 'kilo',
  'pi:': 'pi',
  'omp:': 'omp',
  'elowen:': 'elowen',
};

const PROGRAMS: readonly Program[] = ['claude-code', 'opencode', 'codex', 'kilo', 'pi', 'omp', 'elowen'];

function isProgram(value: unknown): value is Program {
  return typeof value === 'string' && (PROGRAMS as readonly string[]).includes(value);
}

function execSpecProgram(spec: string): Program {
  for (const [prefix, program] of Object.entries(PROGRAM_PREFIXES)) {
    if (spec.startsWith(prefix)) return program;
  }
  return spec.includes('/') ? 'opencode' : 'claude-code';
}

/** Parse an exec identity without inferring a structured value's program from its model shape. */
export function parseExecRef(input: ExecInput): ExecRef | null {
  if (typeof input !== 'string') {
    if (!isProgram(input.program) || !input.model) return null;
    if (input.program === 'elowen') {
      return input.provider ? { program: 'elowen', provider: input.provider, model: input.model } : null;
    }
    return { program: input.program, model: input.model };
  }
  const program = execSpecProgram(input);
  const prefix = Object.keys(PROGRAM_PREFIXES).find((candidate) => input.startsWith(candidate));
  const model = prefix ? input.slice(prefix.length) : input;
  if (!model) return null;
  if (program !== 'elowen') return { program, model };
  const slash = model.indexOf('/');
  if (slash <= 0 || slash === model.length - 1) return null;
  return { program: 'elowen', provider: model.slice(0, slash), model: model.slice(slash + 1) };
}
