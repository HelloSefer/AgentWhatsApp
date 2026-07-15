export function isContextualOrderUnderstandingEvaluationEnabled(
  nodeEnv: string,
): boolean {
  return nodeEnv !== "production";
}
