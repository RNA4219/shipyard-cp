/**
 * Store backend interface for tracker-bridge
 */

import type {
  TrackerConnection,
  IssueCache,
  PRCache,
  ProjectItemCache,
  EntityLink,
  SyncEvent,
  CommentCache,
} from '../types.js';

/**
 * Store backend interface
 * Implementations: InMemoryBackend, RedisBackend
 */
export interface StoreBackend {
  // Connection operations
  getConnection(id: string): Promise<TrackerConnection | null>;
  setConnection(connection: TrackerConnection): Promise<void>;
  listConnections(): Promise<TrackerConnection[]>;

  // Issue cache operations
  getIssue(id: string): Promise<IssueCache | null>;
  getIssueByKey(key: string): Promise<IssueCache | null>;
  setIssue(issue: IssueCache): Promise<void>;
  deleteIssue(id: string): Promise<boolean>;

  // PR cache operations
  getPR(id: string): Promise<PRCache | null>;
  getPRByKey(key: string): Promise<PRCache | null>;
  setPR(pr: PRCache): Promise<void>;
  deletePR(id: string): Promise<boolean>;

  // Project item cache operations
  getProjectItem(id: string): Promise<ProjectItemCache | null>;
  setProjectItem(item: ProjectItemCache): Promise<void>;
  deleteProjectItem(id: string): Promise<boolean>;

  // Entity link operations
  getEntityLink(id: string): Promise<EntityLink | null>;
  getEntityLinksByLocalRef(localRef: string): Promise<EntityLink[]>;
  getEntityLinksByRemoteRef(remoteRef: string): Promise<EntityLink[]>;
  setEntityLink(link: EntityLink): Promise<void>;
  deleteEntityLink(id: string): Promise<boolean>;

  // Sync event operations
  getSyncEvent(id: string): Promise<SyncEvent | null>;
  getSyncEventsByEntity(entityType: string, entityId: string, limit?: number): Promise<SyncEvent[]>;
  setSyncEvent(event: SyncEvent): Promise<void>;

  // Comment operations
  getComments(entityType: string, entityId: string): Promise<CommentCache[]>;
  setComment(comment: CommentCache): Promise<void>;

  // Utility
  close?(): Promise<void>;
}