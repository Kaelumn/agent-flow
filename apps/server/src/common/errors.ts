import { OpError } from '@agent-flow/core';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'conflict', message, details);
export const invalid = (message: string, details?: unknown) => new AppError(422, 'invalid', message, details);

const OP_STATUS = { not_found: 404, conflict: 409, invalid: 422 } as const;

export function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof OpError) return new AppError(OP_STATUS[err.code], err.code, err.message);
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return invalid(issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('; '), issues);
  }
  return null;
}
