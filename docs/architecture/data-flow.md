# جریان داده — ESKAN Backend

## 1. جریان احراز هویت و نشست

```mermaid
sequenceDiagram
  participant C as Client
  participant A as Auth Service
  participant D as PostgreSQL
  C->>A: POST /auth/login (email+password)
  A->>D: verify user + Argon2id
  A->>D: create refresh session (hash) + family
  A-->>C: access (JWT) + refresh (opaque)
  C->>A: POST /auth/refresh (refresh token)
  A->>D: rotate: revoke old, issue new
  A-->>C: new access + new refresh
```

## 2. جریان مالی (payment + allocation)

```mermaid
sequenceDiagram
  participant C as Client
  participant P as Payments Service
  participant D as PostgreSQL
  C->>P: POST /payments {amount, allocations[], Idempotency-Key}
  P->>D: begin tx
  P->>D: lock idempotency key; insert payment; insert allocations
  P->>D: sync change + audit
  P->>D: commit
  P-->>C: payment + version
```

مانده هر ساکن = Σ charges − Σ allocations (معتبر) − تعدیلات رسمی.

## 3. جریان همگام‌سازی (pull)

```mermaid
sequenceDiagram
  participant C as Mobile (offline-first)
  participant S as Sync Service
  participant D as PostgreSQL
  C->>S: GET /sync/changes?afterSequence=N&limit=100
  S->>D: select sync_changes where seq > N order by seq
  S-->>C: {changes[], nextCursor, hasMore}
  C->>C: persist atomically in SQLite; advance cursor
```

تغییر هر entity (UPSERT/TOMBSTONE) در همان transaction نوشتن entity ثبت می‌شود.

## 4. جریان tenant scoping

هر request سازمان فعال را از membership معتبر می‌گیرد؛ همهٔ queryها با
`organization_id` از context فیلتر می‌شوند (نه از body).