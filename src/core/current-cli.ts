export interface CurrentCliInvocation {
  command: string;
  args: string[];
}

export function buildCurrentCliInvocation(options: {
  execPath?: string;
  execArgv?: readonly string[];
  argv?: readonly string[];
} = {}): CurrentCliInvocation {
  const execPath = options.execPath ?? process.execPath;
  const execArgv = options.execArgv ?? process.execArgv;
  const argv = options.argv ?? process.argv;
  const entryPoint = argv[1];

  if (!entryPoint) {
    throw new Error('Cannot determine the current CLI entry point for background sync.');
  }

  return {
    command: execPath,
    args: [...filterExecArgv(execArgv), entryPoint],
  };
}

function filterExecArgv(execArgv: readonly string[]): string[] {
  return execArgv.filter((arg) => !isDebugFlag(arg));
}

function isDebugFlag(arg: string): boolean {
  return /^--(?:inspect|inspect-brk|debug|debug-brk)(?:=.*)?$/.test(arg);
}
