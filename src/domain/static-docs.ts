import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface StaticDocs {
  openapi: string;
  schemas: Record<string, string>;
}

function readUtf8(path: string): string {
  return readFileSync(path, 'utf8');
}

export function loadStaticDocs(rootDir: string): StaticDocs {
  const docsDir = resolve(rootDir, 'docs');
  const schemasDir = resolve(docsDir, 'schemas');
  return {
    openapi: readUtf8(resolve(docsDir, 'openapi.yaml')),
    schemas: {
      task: readUtf8(resolve(schemasDir, 'task.schema.json')),
      workerJob: readUtf8(resolve(schemasDir, 'worker-job.schema.json')),
      workerResult: readUtf8(resolve(schemasDir, 'worker-result.schema.json')),
      stateTransitionEvent: readUtf8(resolve(schemasDir, 'state-transition-event.schema.json')),
    },
  };
}
