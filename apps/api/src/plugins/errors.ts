import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors';
import type { ErrorCode } from '../lib/errors';

const body = (code: ErrorCode, message: string, requestId: string, details?: unknown) => ({
  error: { code, message, requestId, details },
});

export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send(body('not_found', 'Route not found', request.id)),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
      // Upstream details stay in the logs; clients only get the code and message.
      const details = error.statusCode >= 500 ? undefined : error.details;
      return reply
        .status(error.statusCode)
        .send(body(error.code, error.message, request.id, details));
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send(
        body(
          'validation_failed',
          'Some fields need attention',
          request.id,
          error.validation.map((issue) => ({
            path: issue.instancePath,
            message: issue.message,
          })),
        ),
      );
    }
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error, issues: error.cause.issues }, 'Response failed its contract');
      return reply.status(500).send(body('internal_error', 'Something went wrong', request.id));
    }
    if (error.statusCode === 429) {
      return reply.status(429).send(body('rate_limited', 'Too many requests', request.id));
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send(body('bad_request', error.message, request.id));
    }
    request.log.error({ err: error }, 'Unhandled error');
    return reply.status(500).send(body('internal_error', 'Something went wrong', request.id));
  });
});
