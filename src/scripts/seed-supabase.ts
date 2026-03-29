import { createClient } from '@supabase/supabase-js';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || process.env.DEVELOPER_EMAIL || 'admin@gmail.com';
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || process.env.DEVELOPER_PASSWORD || '1234567890';

const USER_EMAIL =
  process.env.USER_EMAIL || process.env.PROJECT_MANAGER_EMAIL || 'user@gmail.com';
const USER_PASSWORD =
  process.env.USER_PASSWORD || process.env.PROJECT_MANAGER_PASSWORD || '1234567890';

async function listAllUsersByEmail(
  adminClient: any,
): Promise<Map<string, string>> {
  const emailToId = new Map<string, string>();

  // Supabase Admin API is paginated. We loop a reasonable number of pages.
  // Typical dev projects will be well under this.
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { data, error } = await (adminClient as any).auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) throw new Error(error.message);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const users = (data?.users ?? []) as Array<{ id: string; email?: string }>;
    for (const u of users) {
      if (u.email) emailToId.set(u.email.toLowerCase(), u.id);
    }

    if (users.length < perPage) break;
  }

  return emailToId;
}

async function recreateUser(
  adminClient: any,
  existingEmailToId: Map<string, string>,
  user: { email: string; password: string; role: 'ADMIN' | 'USER'; name: string },
) {
  const existingId = existingEmailToId.get(user.email.toLowerCase());
  if (existingId) {
    await (adminClient as any).auth.admin.deleteUser(existingId);
  }

  const { error } = await (adminClient as any).auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: {
      name: user.name,
      role: user.role,
    },
  });

  if (error) throw new Error(error.message);
}

async function seedViaAdmin(users: Array<{ email: string; password: string; role: 'ADMIN' | 'USER'; name: string }>) {
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL');

  const adminClient: any = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const existing = await listAllUsersByEmail(adminClient);

  for (const u of users) {
    await recreateUser(adminClient, existing, u);
    // eslint-disable-next-line no-console
    console.log(`✅ Seeded Supabase user (admin): ${u.email} (${u.role})`);
  }
}

async function seedViaPublicSignup(
  users: Array<{ email: string; password: string; role: 'ADMIN' | 'USER'; name: string }>,
) {
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL');
  if (!SUPABASE_ANON_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY');
  }

  const client: any = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const u of users) {
    const { error } = await client.auth.signUp({
      email: u.email,
      password: u.password,
      options: {
        data: {
          name: u.name,
          role: u.role,
        },
      },
    });

    if (error) {
      // Common when user already exists
      // eslint-disable-next-line no-console
      console.warn(`⚠️  Public signup seed failed for ${u.email}: ${error.message}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`✅ Seeded Supabase user (public signup): ${u.email} (${u.role})`);
    }
  }
}

async function main() {
  const users = [
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: 'ADMIN' as const, name: 'Admin' },
    { email: USER_EMAIL, password: USER_PASSWORD, role: 'USER' as const, name: 'User' },
  ];

  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await seedViaAdmin(users);
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      '⚠️  SUPABASE_SERVICE_ROLE_KEY not set. Falling back to public signup seeding.\n' +
        '    If Supabase email confirmation is enabled, users may be created as unconfirmed.\n' +
        '    Best practice: set SUPABASE_SERVICE_ROLE_KEY to seed users reliably.',
    );
    await seedViaPublicSignup(users);
  }

  // eslint-disable-next-line no-console
  console.log('\n📋 Seeded credentials:');
  // eslint-disable-next-line no-console
  console.log(`ADMIN_EMAIL=${ADMIN_EMAIL}`);
  // eslint-disable-next-line no-console
  console.log(`ADMIN_PASSWORD=${ADMIN_PASSWORD}`);
  // eslint-disable-next-line no-console
  console.log(`USER_EMAIL=${USER_EMAIL}`);
  // eslint-disable-next-line no-console
  console.log(`USER_PASSWORD=${USER_PASSWORD}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('❌ Supabase seed failed:', e?.message ?? e);
  process.exit(1);
});

