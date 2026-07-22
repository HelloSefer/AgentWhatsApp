export type Cce2EvalCase = Readonly<{
  name: string;
  passed: boolean;
  details?: string;
}>;

export type Cce2EvalReport = Readonly<{
  suite: string;
  summary: Readonly<{ total: number; passed: number; failed: number }>;
  strictAcceptance: boolean;
  cases: readonly Cce2EvalCase[];
}>;

export function cce2Report(suite: string, cases: Cce2EvalCase[]): Cce2EvalReport {
  const passed = cases.filter((entry) => entry.passed).length;
  return {
    suite,
    summary: { total: cases.length, passed, failed: cases.length - passed },
    strictAcceptance: passed === cases.length,
    cases,
  };
}

export function check(cases: Cce2EvalCase[], name: string, passed: boolean, details?: unknown): void {
  cases.push({
    name,
    passed,
    ...(details === undefined ? {} : { details: typeof details === "string" ? details : JSON.stringify(details) }),
  });
}
