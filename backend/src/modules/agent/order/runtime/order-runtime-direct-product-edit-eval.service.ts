import { evaluateOrderRuntimeFinalReviewReceipt } from "./order-runtime-final-review-receipt-eval.service";

type Assertion = { name: string; passed: boolean; detail?: string };

export type DirectProductEditEvaluationReport = {
  phase: "6.3H2-R5-R3";
  total: number;
  passed: number;
  failed: number;
  strictAcceptance: boolean;
  noLiveSend: true;
  assertions: Assertion[];
};

/**
 * Focused view of the canonical final-review regression. The underlying
 * evaluator drives the guarded runtime and dry transport, so this adds no
 * alternate cart-edit implementation or provider side effect.
 */
export async function evaluateDirectProductEditing(): Promise<DirectProductEditEvaluationReport> {
  const runtime = await evaluateOrderRuntimeFinalReviewReceipt();
  const required = [
    "cart edit action does not confirm",
    "cart edit opens the canonical item selector directly",
    "cart edit does not require a second generic review click",
    "item edit updates authoritative cart",
    "cart edit preserves delivery fields",
    "cart edit returns directly to FINAL_ORDER_REVIEW",
    "pricing is refreshed after cart edit",
    "CTA includes stable confirm action",
  ];
  const assertions = required.map((name) => {
    const source = runtime.assertions.find((assertion) => assertion.name === name);
    return {
      name,
      passed: source?.passed === true,
      ...(source?.passed === true ? {} : { detail: source?.detail || "Missing runtime regression assertion." }),
    };
  });
  assertions.push({ name: "underlying final-review regression remains passing", passed: runtime.strictAcceptance });
  const passed = assertions.filter((assertion) => assertion.passed).length;
  return {
    phase: "6.3H2-R5-R3",
    total: assertions.length,
    passed,
    failed: assertions.length - passed,
    strictAcceptance: passed === assertions.length,
    noLiveSend: true,
    assertions,
  };
}
