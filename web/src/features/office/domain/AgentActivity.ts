import type { Task } from "../../../shared/types.ts";
export function activeAgentTask(
  tasks: readonly Task[],
  agentId: string,
): Task | undefined {
  const priority = ["running", "waiting_quota", "waiting_auth", "review"];
  return tasks
    .filter((t) => t.agent_id === agentId && priority.includes(t.status))
    .sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status))[0];
}
