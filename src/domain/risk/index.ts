export { RiskAssessor } from './risk-assessor.js';
export {
  RiskIntegrationService,
  defaultRiskIntegrationService,
  extractRiskFactorsFromResult,
  detectCoreAreaModification,
  analyzeSideEffects,
} from './risk-integration-service.js';
export type {
  RiskFactor,
  RiskAssessment,
  RiskLevel as RiskAssessmentLevel,
  ForcedHighFactor,
  MediumRiskReason,
  HighRiskReason,
  EscalationKind,
} from './risk-assessor.js';
export type { RiskIntegrationResult } from './risk-integration-service.js';