export type Personality = {
  birth_date: string;
  master_version: number;
  engine_version: number;
  zodiac_id: string;
  zodiac_name: string;
  basis: string;
  traits: { id: string; name: string; instructions: string; caution: string }[];
};
export type Furniture = {
  id: string;
  kind: string;
  x: number;
  y: number;
  rotation: number;
};
export type Agent = {
  birth_date?: string | null;
  personality?: Personality | null;
  selection_passed?: boolean | null;
  selection_reason?: string;
  character_id?: number;
  manager_id?: string | null;
  department?: string;
  responsibilities?: string;
  decision_scope?: string;
  id: string;
  name: string;
  role: string;
  instructions: string;
  provider: string;
  x: number;
  y: number;
  enabled: boolean;
  version: number;
};
export type Task = {
  quota_auto_resume?: boolean;
  quota_reset_at?: string | null;
  next_quota_check_at?: string | null;
  quota_check_minutes?: number;
  quota_retries?: number;
  execution_context?: {
    agent: Agent | null;
    skills: {
      title: string;
      version: number;
      instructions: string;
      input_contract: string;
      output_contract: string;
      acceptance_criteria: string;
    }[];
    workflow: import("../features/organization/types").Step | null;
  } | null;
  reviewer_id?: string | null;
  workflow_step?: import("../features/organization/types").Step | null;
  project_id?: string | null;
  priority?: string;
  acceptance_criteria?: string;
  plan_id?: string | null;
  id: string;
  title: string;
  description: string;
  provider: string;
  agent_id: string | null;
  status: string;
  version: number;
  attempts: number;
  execution_requested: boolean;
  cancel_requested: boolean;
  created_by: string;
  result: string;
  error: string;
  review_feedback: string;
  created_at: string;
};
export type Note = {
  id: string;
  title: string;
  content: string;
  source: string;
  verified: boolean;
  version: number;
};
export type Workspace = {
  id: string;
  name: string;
  role: string;
  version: number;
};
export type Snapshot = {
  id: string;
  name: string;
  version: number;
  layout: { items: Furniture[] };
  layout_version: number;
  tasks: Task[];
  knowledge: Note[];
  agents: Agent[];
};
export type User = {
  intelligence_access?: boolean;
  id: string;
  name: string;
  email: string;
  is_super_admin: boolean;
  deleted_at?: string | null;
};
export type Detail = {
  task: Task;
  events: { id: number; message: string; created_at: string }[];
  runs: {
    usage_metrics?: Record<string, number | string | null>;
    id: string;
    status: string;
    result: string;
    error: string;
    started_at: string;
  }[];
  artifacts: { id: string; run_id: string; name: string; size: number }[];
};
export type ProviderLogin = {
  id: string;
  provider: string;
  status: string;
  login_url: string;
  device_code: string;
  message: string;
  expires_at: string;
};
export type Connections = {
  logins: ProviderLogin[];
  settings: {
    provider: string;
    enabled: boolean;
    billing_acknowledged: boolean;
  }[];
  workers: {
    id: string;
    mode: string;
    online: boolean;
    heartbeat_at: string;
    providers: Record<string, { authenticated: boolean; method: string }>;
  }[];
  billing_notice: string;
};
export type Modal = { kind: string; value?: any };
