import type { Agent } from "../../shared/types";
export type Skill = {
  id: string;
  skill_id?: string;
  version: number;
  title: string;
  description: string;
  instructions: string;
  input_contract: string;
  output_contract: string;
  acceptance_criteria: string;
  deleted_at?: string | null;
};
export type Step = {
  title: string;
  description: string;
  agent_id: string;
  depends_on: number[];
  input_contract?: string;
  output_contract?: string;
  acceptance_criteria?: string;
  required_files?: string[];
  skill_ids?: string[];
  reviewer_id?: string | null;
};
export type Workflow = {
  id: string;
  version: number;
  title: string;
  description: string;
  steps: Step[];
  deleted_at?: string | null;
};
export type Binding = {
  agent_id: string;
  skill_id: string;
  pinned_version: number | null;
  title: string;
  current_version: number;
  deleted: boolean;
};
export type Organization = { agents: Agent[]; bindings: Binding[] };
export type Reviewer = { id: string; name: string };
export const emptyStep = (): Step => ({
  title: "",
  description: "",
  agent_id: "",
  depends_on: [],
  skill_ids: [],
  required_files: [],
  reviewer_id: null,
  input_contract: "",
  output_contract: "",
  acceptance_criteria: "",
});
