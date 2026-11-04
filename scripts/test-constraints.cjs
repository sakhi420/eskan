// Phase 5 constraint smoke test (direct PostgreSQL via pg). Runs in one tx and ROLLBACKs.
const { Client } = require('pg');
const crypto = require('crypto');
const conn = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/eskan_dev';
const uuid = () => crypto.randomUUID();

async function main() {
  const c = new Client({ connectionString: conn });
  await c.connect();
  const out = [];
  const check = (n, ok, x = '') => out.push(`${ok ? 'PASS' : 'FAIL'} - ${n}${x ? ' - ' + x : ''}`);
  const expectErr = async (fn) => {
    const sp = 'sp' + crypto.randomBytes(3).toString('hex');
    await c.query(`SAVEPOINT ${sp}`);
    let code = null;
    try { await fn(); } catch (e) { code = e.code; }
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await c.query(`RELEASE SAVEPOINT ${sp}`);
    return code;
  };

  try {
    await c.query('BEGIN');

    const ext = await c.query("SELECT 1 FROM pg_extension WHERE extname='btree_gist'");
    check('btree_gist extension present', ext.rowCount === 1);
    const exc = await c.query("SELECT 1 FROM pg_constraint WHERE conname='bed_assignments_no_overlap'");
    check('bed_assignments_no_overlap constraint present', exc.rowCount === 1);
    const tc = await c.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
    check('>= 20 base tables', tc.rows[0].n >= 20, `count=${tc.rows[0].n}`);
    const uid = await c.query("SELECT data_type FROM information_schema.columns WHERE table_name='organizations' AND column_name='id'");
    check('organizations.id is uuid', uid.rows[0] && uid.rows[0].data_type === 'uuid', uid.rows[0].data_type);

    const [org, user, hostel, room, bed, resident, contract, resident2, contract2] = Array.from({ length: 9 }, uuid);
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'T-Org',now())`, [org]);
    await c.query(`INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,'t@example.com','h','T User',now())`, [user]);
    await c.query(`INSERT INTO organization_memberships (id, organization_id, user_id, role, updated_at) VALUES ($1,$2,$3,'OWNER',now())`, [uuid(), org, user]);
    await c.query(`INSERT INTO hostels (id, organization_id, name, updated_at) VALUES ($1,$2,'T-Hostel',now())`, [hostel, org]);
    await c.query(`INSERT INTO rooms (id, organization_id, hostel_id, code, floor, updated_at) VALUES ($1,$2,$3,'A1',1,now())`, [room, org, hostel]);
    await c.query(`INSERT INTO beds (id, organization_id, room_id, code, updated_at) VALUES ($1,$2,$3,'B1',now())`, [bed, org, room]);
    await c.query(`INSERT INTO residents (id, organization_id, full_name, type, updated_at) VALUES ($1,$2,'R1','STUDENT',now())`, [resident, org]);
    await c.query(`INSERT INTO residents (id, organization_id, full_name, type, updated_at) VALUES ($1,$2,'R2','STUDENT',now())`, [resident2, org]);
    await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'C-1','2026-01-01',5000,now())`, [contract, org, hostel, resident]);
    await c.query(`INSERT INTO stay_contracts (id, organization_id, hostel_id, resident_id, contract_number, start_date, rent_amount, updated_at) VALUES ($1,$2,$3,$4,'C-2','2026-01-01',5000,now())`, [contract2, org, hostel, resident2]);

    check('rooms unique (hostel_id, code)', (await expectErr(() => c.query(`INSERT INTO rooms (id, organization_id, hostel_id, code, floor, updated_at) VALUES ($1,$2,$3,'A1',2,now())`, [uuid(), org, hostel]))) === '23505');
    await c.query(`INSERT INTO payments (id, organization_id, resident_id, method, received_at, receipt_number, amount, updated_at) VALUES ($1,$2,$3,'CASH','2026-01-02','RCP-1',5000,now())`, [uuid(), org, resident]);
    check('payments unique (organization_id, receipt_number)', (await expectErr(() => c.query(`INSERT INTO payments (id, organization_id, resident_id, method, received_at, receipt_number, amount, updated_at) VALUES ($1,$2,$3,'CASH','2026-01-02','RCP-1',1,now())`, [uuid(), org, resident]))) === '23505');
    await c.query(`INSERT INTO bed_assignments (id, organization_id, bed_id, resident_id, contract_id, start_date, end_date, updated_at) VALUES ($1,$2,$3,$4,$5,'2026-01-01','2026-01-31',now())`, [uuid(), org, bed, resident, contract]);
    check('bed_assignments overlap exclusion (23P01)', (await expectErr(() => c.query(`INSERT INTO bed_assignments (id, organization_id, bed_id, resident_id, contract_id, start_date, end_date, updated_at) VALUES ($1,$2,$3,$4,$5,'2026-01-15','2026-02-15',now())`, [uuid(), org, bed, resident2, contract2]))) === '23P01');
    check('rooms.hostel_id FK enforced (23503)', (await expectErr(() => c.query(`INSERT INTO rooms (id, organization_id, hostel_id, code, floor, updated_at) VALUES ($1,$2,$3,'B1',1,now())`, [uuid(), org, uuid()]))) === '23503');
  } finally {
    await c.query('ROLLBACK');
    await c.end();
  }

  console.log(out.join('\n'));
  const fail = out.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${out.length - fail}/${out.length} checks passed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });