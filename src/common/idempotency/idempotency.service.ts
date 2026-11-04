import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',') +
    '}'
  );
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Stable hash of the canonical request payload, used to detect key reuse with a different body. */
  hash(payload: unknown): string {
    return createHash('sha256').update(stableStringify(payload)).digest('hex');
  }

  /** Returns the previously stored response body, or null when the key is unseen. Throws on payload mismatch. */
  async getReplay<T>(
    organizationId: string,
    key: string,
    endpoint: string,
    requestHash: string,
  ): Promise<T | null> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        organizationId_idempotencyKey_endpoint: { organizationId, idempotencyKey: key, endpoint },
      },
    });

    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw AppError.conflict(
        'Idempotency-Key was reused with a different request body',
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
      );
    }
    if (existing.responseBody == null) {
      throw AppError.internal('Idempotency record is missing its stored response');
    }
    return existing.responseBody as unknown as T;
  }

  async save(
    organizationId: string,
    key: string,
    endpoint: string,
    userId: string,
    requestHash: string,
    statusCode: number,
    responseBody: unknown,
  ): Promise<void> {
    await this.prisma.idempotencyRecord.create({
      data: {
        organizationId,
        idempotencyKey: key,
        endpoint,
        userId,
        requestHash,
        statusCode,
        responseBody: responseBody as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }
}