// Export types (interfaces) with 'export type' for verbatimModuleSyntax
export type {
  ContextBundle,
  ContextGenerator,
  TaskCore,
  RepositoryContext,
  WorkspaceContext,
  DocumentContext,
  TrackerContext,
  DiagnosticContext,
  HistoryContext,
  ContextBundleMetadata,
  Purpose,
  DecisionDigest,
  OpenQuestionDigest,
  StateSnapshot,
} from './context-bundle.js';

// Export classes with regular export
export { ContextBundleBuilder, ContextBundleService } from './context-bundle.js';