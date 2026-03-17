export {
  ManualChecklistService,
  defaultManualChecklistService,
} from './manual-checklist-service.js';
export type { ChecklistTemplate } from './manual-checklist-service.js';

// Export templates array
import { DEFAULT_CHECKLIST_TEMPLATES as templates } from './manual-checklist-service.js';
export const DEFAULT_CHECKLIST_TEMPLATES = templates;