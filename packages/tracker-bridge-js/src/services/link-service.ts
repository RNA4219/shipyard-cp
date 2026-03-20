/**
 * Link service for entity link operations
 */

import type { StoreBackend } from '../store/store-backend.js';
import type {
  EntityLink,
  LinkEntityRequest,
  LinkEntityResponse,
  UnlinkEntityRequest,
  UnlinkEntityResponse,
} from '../types.js';
import { randomUUID } from 'crypto';

/**
 * Link service configuration
 */
export interface LinkServiceConfig {
  backend: StoreBackend;
}

/**
 * Link service for managing entity links
 */
export class LinkService {
  private backend: StoreBackend;

  constructor(config: LinkServiceConfig) {
    this.backend = config.backend;
  }

  /**
   * Link an entity to a task
   */
  async link(request: LinkEntityRequest): Promise<LinkEntityResponse> {
    const now = new Date().toISOString();
    const linkId = randomUUID();
    const syncId = randomUUID();

    // Parse entity_ref to extract kind (format: "kind:value")
    const entityRefParts = request.entity_ref.split(':');
    const entityKind = entityRefParts[0] ?? 'entity_link';
    const entityValue = entityRefParts.slice(1).join(':') || request.entity_ref;

    const link: EntityLink = {
      id: linkId,
      local_ref: request.typed_ref,
      remote_ref: request.entity_ref,
      link_role: request.link_role ?? 'primary',
      created_at: now,
      updated_at: now,
      metadata_json: request.metadata_json,
    };

    await this.backend.setEntityLink(link);

    return {
      success: true,
      sync_event_ref: `sync:${syncId}`,
      external_refs: [
        {
          kind: entityKind,
          value: entityValue,
          connection_ref: request.connection_ref,
        },
        {
          kind: 'sync_event',
          value: syncId,
          connection_ref: request.connection_ref,
        },
      ],
      linked_at: now,
    };
  }

  /**
   * Unlink an entity from a task
   */
  async unlink(request: UnlinkEntityRequest): Promise<UnlinkEntityResponse> {
    const linksByLocal = await this.backend.getEntityLinksByLocalRef(request.typed_ref);

    for (const link of linksByLocal) {
      if (link.remote_ref === request.entity_ref) {
        await this.backend.deleteEntityLink(link.id);
      }
    }

    const syncId = randomUUID();

    return {
      success: true,
      sync_event_ref: `sync:${syncId}`,
    };
  }

  /**
   * Get entity link by ID
   */
  async getLink(id: string): Promise<EntityLink | null> {
    return this.backend.getEntityLink(id);
  }

  /**
   * Get all links for a local ref
   */
  async getLinksByLocalRef(localRef: string): Promise<EntityLink[]> {
    return this.backend.getEntityLinksByLocalRef(localRef);
  }

  /**
   * Get all links for a remote ref
   */
  async getLinksByRemoteRef(remoteRef: string): Promise<EntityLink[]> {
    return this.backend.getEntityLinksByRemoteRef(remoteRef);
  }

  /**
   * Check if entity is linked
   */
  async isLinked(typedRef: string, entityRef: string): Promise<boolean> {
    const links = await this.backend.getEntityLinksByLocalRef(typedRef);
    return links.some(l => l.remote_ref === entityRef);
  }
}