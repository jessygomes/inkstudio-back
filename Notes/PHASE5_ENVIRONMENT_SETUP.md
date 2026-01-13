# Phase 5 Environment Configuration Guide

## Redis Configuration

Redis is now used for:
- Socket.IO adapter (horizontal scaling)
- Online/offline status caching
- Email rate limiting (atomic counters)

### Required Environment Variables

```env
# Redis Connection (localhost by default for development)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=          # Leave empty for no password
REDIS_DB=0               # Database number (0-15)
```

### Docker Quick Start (Local Development)

```bash
# Start Redis in Docker
docker run -d \
  --name tattoo-studio-redis \
  -p 6379:6379 \
  redis:7-alpine

# Or with password
docker run -d \
  --name tattoo-studio-redis \
  -p 6379:6379 \
  redis:7-alpine \
  redis-server --requirepass yourpassword
```

---

## PostgreSQL Connection Pooling

Prisma now supports connection pooling for better performance under load.

### Datasource Configuration Options

Three connection strings are used:

1. **DATABASE_URL** (required)
   - Connection to pooler (e.g., PgBouncer)
   - Used for normal app queries
   - Should support many concurrent connections
   - Example: `postgresql://user:pass@pooler:6432/db`

2. **DATABASE_DIRECT_URL** (optional but recommended)
   - Direct connection to PostgreSQL
   - Used for migrations and admin operations
   - Can have connection limit restrictions
   - Example: `postgresql://user:pass@localhost:5432/db`

3. **SHADOW_DATABASE_URL** (optional)
   - Used only during migrations for schema validation
   - Helps detect schema drift
   - Can be same as DATABASE_DIRECT_URL

### Example Environment Setup

```env
# Pooled connection (via PgBouncer or similar)
DATABASE_URL="postgresql://user:password@pgbouncer.example.com:6432/tattoo_studio?schema=public"

# Direct connection (for migrations and admin)
DATABASE_DIRECT_URL="postgresql://user:password@postgres.example.com:5432/tattoo_studio?schema=public"

# Shadow database (optional, for safe migrations)
SHADOW_DATABASE_URL="postgresql://user:password@postgres.example.com:5433/tattoo_studio_shadow?schema=public"
```

### Local Development Setup

For development without a connection pooler:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/tattoo_studio?schema=public"
# No need for DIRECT_URL or SHADOW_URL in local dev
```

### Performance Tuning Parameters

Connection pooling tuning is typically done at the pooler level (PgBouncer):

**Recommended PgBouncer Configuration**:
```ini
[databases]
tattoo_studio = host=localhost port=5432 user=postgres password=password dbname=tattoo_studio

[pgbouncer]
pool_mode = transaction       # Transaction pooling (more fine-grained)
max_client_conn = 1000        # Max client connections
default_pool_size = 25        # Connections per database
min_pool_size = 10            # Minimum idle connections
reserve_pool_size = 5         # Reserved for scaling
reserve_pool_timeout = 3      # Seconds before using reserve
max_db_connections = 100      # Max DB-side connections
```

---

## Prisma Client Configuration

In NestJS (e.g., `src/database/prisma.service.ts`):

```typescript
export class PrismaService extends PrismaClient {
  constructor() {
    super({
      log: [
        {
          emit: 'event',
          level: 'query',
        },
        {
          emit: 'event',
          level: 'error',
        },
        {
          emit: 'stdout',
          level: 'warn',
        },
      ],
    });
  }

  // ... rest of service
}
```

---

## Monitoring & Health Checks

### Redis Health Check

```bash
redis-cli ping
# Response: PONG
```

### PostgreSQL Pool Health

Monitor active connections:

```sql
SELECT count(*) as active_connections 
FROM pg_stat_activity 
WHERE datname = 'tattoo_studio';
```

Monitor query performance:

```sql
SELECT query, calls, mean_time, max_time 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;
```

---

## Troubleshooting

### Redis Connection Refused

```
Error: Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Solution**:
- Check Redis is running: `redis-cli ping`
- Verify REDIS_HOST, REDIS_PORT in .env
- Check firewall rules

### Too Many Connections PostgreSQL

```
Error: remaining connection slots are reserved for non-replication superuser connections
```

**Solution**:
- Enable connection pooling (PgBouncer)
- Reduce `default_pool_size` if needed
- Check for connection leaks in application

### Prisma Can't Find Database

```
Error: connect ECONNREFUSED
```

**Solution**:
- Verify DATABASE_URL format
- Ensure pooler is running (if using pooler)
- Check PostgreSQL credentials

---

## Phase 5 Performance Gains

With these optimizations, you should see:

- ✅ **Redis Adapter**: Enables multi-server Socket.IO scaling
- ✅ **Connection Pooling**: Reduces connection overhead (10-100ms per query → 1-5ms)
- ✅ **Message Compression**: 40-60% payload reduction
- ✅ **Redis Cache**: Sub-millisecond online status checks
- ✅ **Optimized Queries**: Reduced database load via field selection

**Expected Results**: 3-5x throughput improvement, 50% latency reduction

---

## Phase 6 - Message Archival Settings

Add these variables to control the archival pipeline:

```env
# Soft delete after N days (default 90)
MESSAGE_RETENTION_DAYS=90

# Hard delete archived messages after N days (0 = disabled)
MESSAGE_HARD_DELETE_AFTER_DAYS=0
```

Operational notes:
- Soft delete sets `archivedAt` on messages older than `MESSAGE_RETENTION_DAYS`.
- If `MESSAGE_HARD_DELETE_AFTER_DAYS` > 0, messages with `archivedAt` older than that threshold are permanently removed.
- Archival job runs daily at 03:00 via Bull queue `message-archival` (job name `run-archival`).
