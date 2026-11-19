import type { ERROR_CODES } from '@reomi/shared';

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (code: ErrorCode, message: string) => new AppError(409, code, message);
export const forbidden = (code: ErrorCode, message: string) => new AppError(403, code, message);

/** Drizzle wraps driver errors, so the Postgres code can sit on the cause. */
const hasPgCode = (error: unknown, expected: string): boolean => {
  const code = (e: unknown) => (e as { code?: string } | undefined)?.code;
  return code(error) === expected || code((error as { cause?: unknown })?.cause) === expected;
};

export const isUniqueViolation = (error: unknown): boolean => hasPgCode(error, '23505');
export const isForeignKeyViolation = (error: unknown): boolean => hasPgCode(error, '23503');
