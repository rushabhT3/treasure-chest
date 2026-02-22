import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Zod validation errors
  if (err instanceof ZodError) {
    // We call .json() to send the response, but we don't 'return' its result.
    res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: err.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message
      }))
    });
    // This tells the function to stop executing and return 'void'
    return;
  }

  // Known operational errors
  const operationalErrors: Record<string, number> = {
    'INSUFFICIENT_BALANCE': 400,
    'USER_WALLET_NOT_FOUND': 404,
    'TREASURY_WALLET_NOT_FOUND': 500,
    'REVENUE_WALLET_NOT_FOUND': 500,
    'DESTINATION_WALLET_NOT_FOUND': 404,
    'SOURCE_WALLET_NOT_FOUND': 404,
    'IDEMPOTENCY_KEY_REQUIRED': 400,
    'REQUEST_ALREADY_PROCESSING': 409,
    'CONCURRENT_MODIFICATION_SOURCE': 409,
    'CONCURRENT_MODIFICATION_DESTINATION': 409,
  };

  const statusCode = operationalErrors[err.message] || err.statusCode || 500;
  
  res.status(statusCode).json({
    success: false,
    error: err.message || 'INTERNAL_SERVER_ERROR',
    message: getErrorMessage(err.message),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

function getErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    'INSUFFICIENT_BALANCE': 'Insufficient balance for this transaction',
    'USER_WALLET_NOT_FOUND': 'User wallet not found',
    'IDEMPOTENCY_KEY_REQUIRED': 'Idempotency-Key header is required',
    'REQUEST_ALREADY_PROCESSING': 'Request is already being processed',
    'CONCURRENT_MODIFICATION_SOURCE': 'Concurrent modification detected on source wallet',
    'CONCURRENT_MODIFICATION_DESTINATION': 'Concurrent modification detected on destination wallet',
  };
  
  return messages[code] || 'An unexpected error occurred';
}