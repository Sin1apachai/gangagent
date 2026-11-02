import type { Step } from "./types.ts";
export function nextStep(steps: Step[]): Step {
  return {
    title: "",
    description: "",
    agent_id: "",
    depends_on: steps.length ? [steps.length - 1] : [],
    skill_ids: [],
    required_files: [],
    reviewer_id: null,
    input_contract: "",
    output_contract: "",
    acceptance_criteria: "",
  };
}
export function suggestedTitle(role: string): string {
  const r = role.toLowerCase();
  if (r.includes("product") || r.includes("manager"))
    return "วิเคราะห์ความต้องการ";
  if (r.includes("lead") || r.includes("architect")) return "วางแผนเทคนิค";
  if (r.includes("design")) return "ออกแบบหน้าจอ";
  if (r.includes("qa") || r.includes("test")) return "ตรวจสอบผลงาน";
  if (r.includes("engineer") || r.includes("developer")) return "พัฒนาโปรแกรม";
  return "";
}
export function removeStep(steps: Step[], index: number): Step[] {
  if (index < 0 || index >= steps.length) return steps;
  const parents = steps[index].depends_on;
  return steps
    .filter((_, i) => i !== index)
    .map((s) => ({
      ...s,
      depends_on: [
        ...new Set(s.depends_on.flatMap((d) => (d === index ? parents : [d]))),
      ]
        .map((d) => (d > index ? d - 1 : d))
        .sort((a, b) => a - b),
    }));
}
