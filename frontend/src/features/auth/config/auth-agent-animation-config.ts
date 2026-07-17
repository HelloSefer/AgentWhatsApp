export const authAgentAnimationConfig = {
  duration: 9.8,
  repeatDelay: 0.55,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
  timeline: {
    customerMessage: [0, 0.06, 0.12, 0.88, 0.94, 1],
    typing: [0, 0.17, 0.22, 0.34, 0.39, 0.88, 0.94, 1],
    orderCard: [0, 0.32, 0.38, 0.92, 0.97, 1],
    customerRow: [0, 0.39, 0.44, 0.92, 0.97, 1],
    productRow: [0, 0.46, 0.51, 0.92, 0.97, 1],
    deliveryRow: [0, 0.53, 0.58, 0.92, 0.97, 1],
    customerCheck: [0, 0.58, 0.63, 0.92, 0.97, 1],
    productCheck: [0, 0.65, 0.7, 0.92, 0.97, 1],
    deliveryCheck: [0, 0.72, 0.77, 0.92, 0.97, 1],
    confirmation: [0, 0.78, 0.83, 0.92, 0.97, 1],
    confirmationPulse: [0, 0.81, 0.84, 0.88, 0.92, 0.97, 1],
    robotFocus: [0, 0.17, 0.22, 0.38, 0.43, 0.78, 0.84, 0.94, 1],
    robotGesture: [0, 0.55, 0.61, 0.86, 0.92, 0.97, 1],
  },
} as const;

export function createAuthAgentTransition(times: readonly number[]) {
  return {
    duration: authAgentAnimationConfig.duration,
    ease: authAgentAnimationConfig.ease,
    repeat: Number.POSITIVE_INFINITY,
    repeatDelay: authAgentAnimationConfig.repeatDelay,
    times: [...times],
  };
}
