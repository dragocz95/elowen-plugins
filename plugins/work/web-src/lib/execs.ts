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

function parseEncodedExecRef(input: string): ExecRef | null {
  if (!input.startsWith('elowen|')) return null;
  const parts = input.split('|');
  if (parts.length !== 3) return null;
  try {
    const provider = decodeURIComponent(parts[1] ?? '');
    const model = decodeURIComponent(parts[2] ?? '');
    return provider && model ? { program: 'elowen', provider, model } : null;
  } catch {
    return null;
  }
}

function execSpecProgram(spec: string): Program {
  const encoded = parseEncodedExecRef(spec);
  if (encoded) return encoded.program;
  for (const [prefix, program] of Object.entries(PROGRAM_PREFIXES)) {
    if (spec.startsWith(prefix)) return program;
  }
  return spec.includes('/') ? 'elowen' : 'claude-code';
}

function parseElowenExec(spec: string): { provider: string; model: string } | null {
  const encoded = parseEncodedExecRef(spec);
  if (encoded?.program === 'elowen') return { provider: encoded.provider, model: encoded.model };
  const rest = spec.startsWith('elowen:') ? spec.slice('elowen:'.length) : spec;
  if (rest === spec && Object.keys(PROGRAM_PREFIXES).some((prefix) => spec.startsWith(prefix))) return null;
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { provider: rest.slice(0, slash), model: rest.slice(slash + 1) };
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
  const encoded = parseEncodedExecRef(input);
  if (encoded) return encoded;
  const program = execSpecProgram(input);
  if (program === 'elowen') {
    const parsed = parseElowenExec(input);
    return parsed ? { program: 'elowen', ...parsed } : null;
  }
  const prefix = Object.keys(PROGRAM_PREFIXES).find((candidate) => input.startsWith(candidate));
  const model = prefix ? input.slice(prefix.length) : input;
  return model ? { program, model } : null;
}
