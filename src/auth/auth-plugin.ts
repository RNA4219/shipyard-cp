/**
 * Authentication Plugin for Fastify
 *
 * Provides API Key authentication with role-based access control.
 * Supports two roles:
 * - admin: Full access to all endpoints
 * - operator: Read access + task management (no admin endpoints)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { getLogger } from '../monitoring/index.js';

const logger = getLogger();

export type AuthRole = 'admin' | 'operator';

export interface AuthUser {
  id: string;
  role: AuthRole;
}

export interface AuthConfig {
  /** Enable authentication (default: false for development) */
  enabled: boolean;
  /** API key for operator role */
  apiKey?: string;
  /** API key for admin role */
  adminApiKey?: string;
  /** Header name for API key (default: 'x-api-key') */
  headerName?: string;
  /** Public paths that don't require authentication */
  publicPaths?: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

const DEFAULT_PUBLIC_PATHS = [
  '/healthz',
  '/metrics',
  '/openapi.yaml',
  '/schemas',
];

/**
 * Authentication error response
 */
class AuthError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'AuthError';
  }
}

/**
 * Create authentication hook for Fastify
 */
export function createAuthHook(config: AuthConfig): (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void {
  const {
    enabled = false,
    apiKey,
    adminApiKey,
    headerName = 'x-api-key',
    publicPaths = DEFAULT_PUBLIC_PATHS,
  } = config;

  // If auth is disabled, return a hook that sets a default admin user
  // This allows role-based routes to work without authentication
  if (!enabled) {
    return (request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction) => {
      // Set a default admin user so role checks pass
      request.user = { id: 'system', role: 'admin' };
      done();
    };
  }

  // Validate that at least one key is configured
  if (!apiKey && !adminApiKey) {
    logger.warn('Authentication enabled but no API keys configured. All requests will be rejected.');
  }

  // Build a set of public path prefixes for fast lookup
  const publicPathSet = new Set(publicPaths);

  return (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
    const path = request.url.split('?')[0];

    // Check if path is public
    if (isPublicPath(path, publicPathSet)) {
      done();
      return;
    }

    // Get API key from header
    const providedKey = extractApiKey(request, headerName);

    if (!providedKey) {
      done(new AuthError(401, 'MISSING_API_KEY', 'API key is required. Provide it in the X-API-Key header.'));
      return;
    }

    // Validate API key and determine role
    const user = validateApiKey(providedKey, apiKey, adminApiKey);

    if (!user) {
      done(new AuthError(401, 'INVALID_API_KEY', 'Invalid API key.'));
      return;
    }

    // Attach user to request
    request.user = user;
    done();
  };
}

/**
 * Create role-based authorization hook
 * Note: This hook checks request.user which is set by the auth hook.
 * When auth is disabled, this hook will reject requests because request.user is undefined.
 * Use createConditionalRoleHook() if you need role checks that respect auth enabled/disabled state.
 */
export function requireRole(...allowedRoles: AuthRole[]): (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void {
  return (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
    if (!request.user) {
      done(new AuthError(401, 'UNAUTHORIZED', 'Authentication required.'));
      return;
    }

    if (!allowedRoles.includes(request.user.role)) {
      done(new AuthError(403, 'FORBIDDEN', `This action requires ${allowedRoles.join(' or ')} role.`));
      return;
    }

    done();
  };
}

/**
 * Create a conditional role check that can be disabled.
 * Use this when you want role checks to be skipped when auth is disabled.
 */
export function createConditionalRoleHook(authEnabled: boolean, ...allowedRoles: AuthRole[]): (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void {
  return (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
    // If auth is disabled, skip role check
    if (!authEnabled) {
      done();
      return;
    }

    if (!request.user) {
      done(new AuthError(401, 'UNAUTHORIZED', 'Authentication required.'));
      return;
    }

    if (!allowedRoles.includes(request.user.role)) {
      done(new AuthError(403, 'FORBIDDEN', `This action requires ${allowedRoles.join(' or ')} role.`));
      return;
    }

    done();
  };
}

/**
 * Check if a path is public
 */
function isPublicPath(path: string, publicPaths: Set<string>): boolean {
  // Exact match
  if (publicPaths.has(path)) {
    return true;
  }

  // Prefix match for paths ending with wildcard or directory-like paths
  for (const publicPath of publicPaths) {
    if (path.startsWith(publicPath + '/') || path.startsWith(publicPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Extract API key from request
 */
function extractApiKey(request: FastifyRequest, headerName: string): string | undefined {
  // Try custom header first
  const headerKey = request.headers[headerName];
  if (typeof headerKey === 'string') {
    return headerKey;
  }

  // Try Authorization header with Bearer scheme
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return undefined;
}

/**
 * Validate API key and return user with role
 */
function validateApiKey(
  providedKey: string,
  apiKey?: string,
  adminApiKey?: string
): AuthUser | null {
  // Check admin key first (admin has full access)
  if (adminApiKey && providedKey === adminApiKey) {
    return { id: 'admin', role: 'admin' };
  }

  // Check operator key
  if (apiKey && providedKey === apiKey) {
    return { id: 'operator', role: 'operator' };
  }

  return null;
}

/**
 * Authentication plugin for Fastify
 * Note: This plugin uses encapsulated context. Routes should be registered
 * within the same context or the plugin should be registered before routes.
 */
export async function authPlugin(app: FastifyInstance, config: AuthConfig): Promise<void> {
  const authHook = createAuthHook(config);

  // Register as an onRequest hook
  // This hook will apply to all routes registered in this plugin context
  app.addHook('onRequest', authHook);
}

