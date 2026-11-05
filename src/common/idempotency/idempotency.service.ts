import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import { isUniqueViolation } from '../prisma/unique-violation';

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

/**
 * Retention window for non-financial idempotency records. Chosen to match the
 * offline mutation-queue window: a device may stay offline and replay a queued
 * mutation up to this many days after first attempt. Financial idempotency
 * (Phase 9) will use an explicit, audit-aware policy rather than a simple
 * time-to-expiry.
 */
const IDEMPOTENCY_RETENTION_DAYS = 30;

interface ClaimArgs {
  organizationId: string;
  key: string;
  endpoint: string;
  userId: string;
  requestHash: string;
}

interface RunAtomicArgs extends ClaimArgs {
  statusCode: number;
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

    // Enforce the retention policy lazily: a record past its expiry is treated
    // as absent (the key can be safely reused) and is removed now so it no
    // longer occupies storage or participates in the unique index.
    if (existing.expiresAt != null && existing.expiresAt.getTime() <= Date.now()) {
      await this.prisma.idempotencyRecord.deleteMany({ where: { id: existing.id } });
      return null;
    }

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

  expiresAt(): Date {
    return new Date(Date.now() + IDEMPOTENCY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  }

  /**
   * Atomically claims an idempotency key inside an existing transaction by
   * inserting a placeholder record *before* the domain mutation. A concurrent
   * request with the same key blocks on the unique index and then fails with
   * P2002 once the winner commits; `runAtomic` turns that into a stored replay.
   */
  async claim(tx: Prisma.TransactionClient, args: ClaimArgs): Promise<void> {
    await tx.idempotencyRecord.create({
      data: {
        organizationId: args.organizationId,
        idempotencyKey: args.key,
        endpoint: args.endpoint,
        userId: args.userId,
        requestHash: args.requestHash,
        expiresAt: this.expiresAt(),
      },
    });
  }

  /** Stores the produced response on an already-claimed key, within the same transaction. */
  async complete(
    tx: Prisma.TransactionClient,
    args: ClaimArgs & { statusCode: number; responseBody: unknown },
  ): Promise<void> {
    await tx.idempotencyRecord.update({
      where: {
        organizationId_idempotencyKey_endpoint: {
          organizationId: args.organizationId,
          idempotencyKey: args.key,
          endpoint: args.endpoint,
        },
      },
      data: {
        statusCode: args.statusCode,
        responseBody: args.responseBody as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Runs `mutate` and records its result atomically so that two concurrent
   * requests with the same key cannot both create a domain resource.
   *
   * `mutate` must perform the *entire* domain mutation using the supplied
   * transaction client. Any domain-level unique-violation (e.g. duplicate code)
   * must be translated inside `mutate` into a typed `AppError` so it is not
   * mistaken for a concurrent idempotency duplicate.
   */
  async runAtomic<T>(
    args: RunAtomicArgs,
    mutate: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const replay = await this.getReplay<T>(
      args.organizationId,
      args.key,
      args.endpoint,
      args.requestHash,
    );
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.claim(tx, args);
        const result = await mutate(tx);
        await this.complete(tx, { ...args, responseBody: result });
        return result;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Lost the claim to a concurrent request that has now committed.
        const stored = await this.getReplay<T>(
          args.organizationId,
          args.key,
          args.endpoint,
          args.requestHash,
        );
        if (stored) return stored;
        throw AppError.conflict(
          'Idempotency-Key is being processed concurrently; retry with the same key',
          ErrorCode.IDEMPOTENCY_KEY_REUSED,
        );
      }
      throw err;
    }
  }
}