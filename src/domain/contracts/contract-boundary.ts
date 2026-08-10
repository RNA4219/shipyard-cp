import {
  createContractEvent,
  safeParseContract,
  validateContractGraph,
  validateTransition,
  type CloudEvent,
  type Contract,
} from '@rna4219/agent-protocols';

export function validateBeforeStore(
  contractInput: unknown,
  previousInput?: unknown,
  relatedContracts: Iterable<unknown> = [],
): Contract {
  const parsed = safeParseContract(contractInput);
  if (!parsed.success) throw new Error(parsed.errors.map((error) => error.code + ': ' + error.message).join('; '));
  if (previousInput !== undefined) {
    const transition = validateTransition(previousInput, parsed.data);
    if (!transition.valid) throw new Error(transition.errors.map((error) => error.code + ': ' + error.message).join('; '));
  }
  const graph = validateContractGraph([...relatedContracts, parsed.data]);
  if (!graph.valid) throw new Error(graph.errors.map((error) => error.code + ': ' + error.message).join('; '));
  return parsed.data;
}

export function createEventForDelivery(contract: Contract): CloudEvent {
  return createContractEvent(contract);
}
