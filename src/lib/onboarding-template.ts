import templateJson from "./onboarding-template.json";
import type { Role } from "./types";

export interface TemplateStep {
  no: string;
  title: string;
  description: string;
  type: string;
  role: Role;
  ai: boolean;
  approval: boolean;
}
export interface TemplateStage {
  no: number;
  name: string;
  steps: TemplateStep[];
}
export interface OnboardingTemplate {
  key: string;
  name: string;
  stages: TemplateStage[];
}

export const ONBOARDING_TEMPLATE = templateJson as unknown as OnboardingTemplate;

export const STAGE_META = ONBOARDING_TEMPLATE.stages.map((s) => ({
  no: s.no,
  name: s.name,
  count: s.steps.length,
}));
