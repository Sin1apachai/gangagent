import type { Step } from "../organization/types.ts";
export function planReadiness(
  steps: Step[],
  enabledIds: string[],
  dirty: boolean,
) {
  const hasSteps = steps.length > 0;
  const assigned =
    hasSteps &&
    steps.every((s) => s.title.trim() && enabledIds.includes(s.agent_id));
  return {
    hasSteps,
    assigned,
    saved: !dirty,
    ready: hasSteps && assigned && !dirty,
  };
}
