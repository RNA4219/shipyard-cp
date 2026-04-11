/**
 * Markdown chunker for document segmentation
 */

import type { DocumentChunk, Importance } from '../types.js';

/**
 * Chunking options
 */
export interface ChunkingOptions {
  mode: 'heading' | 'fixed';
  maxChars?: number;
}

/**
 * Generate a chunk ID
 */
export function generateChunkId(docId: string, ordinal: number): string {
  return `chunk:${docId}:${String(ordinal).padStart(3, '0')}`;
}

/**
 * Estimate token count from text
 * Rough approximation: ~4 characters per token
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split markdown by headings
 */
export function chunkByHeadings(
  docId: string,
  body: string,
  maxChars: number = 4000
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const lines = body.split('\n');

  let currentChunk: string[] = [];
  let currentHeadingPath: string[] = [];
  let ordinal = 1;

  for (const line of lines) {
    // Match markdown headings: 1-6 # characters followed by space and text
    // Using non-greedy pattern to avoid polynomial regex complexity
    const headingMatch = line.match(/^(#{1,6})[ \t]+(.+?)$/);

    if (headingMatch) {
      // Save current chunk if not empty
      if (currentChunk.length > 0) {
        const chunkBody = currentChunk.join('\n').trim();
        if (chunkBody) {
          // Check if we need to split large chunks
          if (chunkBody.length > maxChars) {
            const subChunks = splitLargeChunk(chunkBody, maxChars);
            for (const subChunk of subChunks) {
              chunks.push(createChunk(docId, ordinal++, currentHeadingPath, subChunk));
            }
          } else {
            chunks.push(createChunk(docId, ordinal++, currentHeadingPath, chunkBody));
          }
        }
        currentChunk = [];
      }

      // Update heading path
      const level = headingMatch[1].length;
      const heading = headingMatch[2].trim();
      currentHeadingPath = currentHeadingPath.slice(0, level - 1);
      currentHeadingPath.push(heading);
    } else {
      currentChunk.push(line);
    }
  }

  // Save remaining chunk
  if (currentChunk.length > 0) {
    const chunkBody = currentChunk.join('\n').trim();
    if (chunkBody) {
      if (chunkBody.length > maxChars) {
        const subChunks = splitLargeChunk(chunkBody, maxChars);
        for (const subChunk of subChunks) {
          chunks.push(createChunk(docId, ordinal++, currentHeadingPath, subChunk));
        }
      } else {
        chunks.push(createChunk(docId, ordinal, currentHeadingPath, chunkBody));
      }
    }
  }

  return chunks;
}

/**
 * Split a large chunk into smaller pieces
 */
function splitLargeChunk(body: string, maxChars: number): string[] {
  const chunks: string[] = [];
  const lines = body.split('\n');
  let current: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    if (currentLength + line.length + 1 > maxChars && current.length > 0) {
      chunks.push(current.join('\n'));
      current = [];
      currentLength = 0;
    }
    current.push(line);
    currentLength += line.length + 1;
  }

  if (current.length > 0) {
    chunks.push(current.join('\n'));
  }

  return chunks;
}

/**
 * Create a chunk object
 */
function createChunk(
  docId: string,
  ordinal: number,
  headingPath: string[],
  body: string
): DocumentChunk {
  // Determine importance from heading or content
  const importance = determineImportance(headingPath, body);

  return {
    chunk_id: generateChunkId(docId, ordinal),
    doc_id: docId,
    heading_path: headingPath.length > 0 ? headingPath : undefined,
    ordinal,
    body,
    token_estimate: estimateTokens(body),
    importance,
  };
}

/**
 * Determine chunk importance based on heading and content
 */
function determineImportance(headingPath: string[], body: string): Importance {
  const lowerPath = headingPath.map(h => h.toLowerCase());
  const lowerBody = body.toLowerCase();

  // Required: acceptance criteria, requirements, specifications
  if (lowerPath.some(h =>
    h.includes('acceptance') ||
    h.includes('requirement') ||
    h.includes('specification') ||
    h.includes('must')
  )) {
    return 'required';
  }

  if (lowerBody.includes('must:') ||
      lowerBody.includes('required:') ||
      lowerBody.includes('acceptance criteria')) {
    return 'required';
  }

  // Reference: references, see also, links
  if (lowerPath.some(h =>
    h.includes('reference') ||
    h.includes('see also') ||
    h.includes('links') ||
    h.includes('appendix')
  )) {
    return 'reference';
  }

  // Default: recommended
  return 'recommended';
}

/**
 * Chunk markdown document
 */
export function chunkMarkdown(
  docId: string,
  body: string,
  options: ChunkingOptions = { mode: 'heading' }
): DocumentChunk[] {
  const maxChars = options.maxChars ?? 4000;

  if (options.mode === 'fixed') {
    return chunkByFixedSize(docId, body, maxChars);
  }

  return chunkByHeadings(docId, body, maxChars);
}

/**
 * Chunk by fixed size
 */
function chunkByFixedSize(docId: string, body: string, maxChars: number): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const lines = body.split('\n');
  let current: string[] = [];
  let currentLength = 0;
  let ordinal = 1;

  for (const line of lines) {
    if (currentLength + line.length + 1 > maxChars && current.length > 0) {
      const chunkBody = current.join('\n');
      chunks.push({
        chunk_id: generateChunkId(docId, ordinal),
        doc_id: docId,
        ordinal,
        body: chunkBody,
        token_estimate: estimateTokens(chunkBody),
        importance: 'recommended',
      });
      ordinal++;
      current = [];
      currentLength = 0;
    }
    current.push(line);
    currentLength += line.length + 1;
  }

  if (current.length > 0) {
    const chunkBody = current.join('\n');
    chunks.push({
      chunk_id: generateChunkId(docId, ordinal),
      doc_id: docId,
      ordinal,
      body: chunkBody,
      token_estimate: estimateTokens(chunkBody),
      importance: 'recommended',
    });
  }

  return chunks;
}