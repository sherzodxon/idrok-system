-- Restore drill: run against the restored copy and against production, compare the two outputs. Counts only — no
-- personal data is printed. The ledger sums must match to the last unit.
SELECT 'migrations'      AS item, count(*)::text AS value FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
UNION ALL SELECT 'tenants',          count(*)::text FROM "Tenant"
UNION ALL SELECT 'students',         count(*)::text FROM "Student"
UNION ALL SELECT 'employees',        count(*)::text FROM "Employee"
UNION ALL SELECT 'score entries',    count(*)::text FROM "ScoreEntry"
UNION ALL SELECT 'score sum',        coalesce(sum(points), 0)::text FROM "ScoreEntry"
UNION ALL SELECT 'coin transactions', count(*)::text FROM "CoinTransaction"
UNION ALL SELECT 'coin sum',         coalesce(sum(amount), 0)::text FROM "CoinTransaction"
UNION ALL SELECT 'access events',    count(*)::text FROM "AccessEvent"
UNION ALL SELECT 'test attempts',    count(*)::text FROM "TestAttempt"
UNION ALL SELECT 'audit rows',       count(*)::text FROM "AuditLog"
UNION ALL SELECT 'latest audit',     coalesce(max("createdAt")::text, '-') FROM "AuditLog";
