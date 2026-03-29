import { Sequelize } from 'sequelize';
import { SqlService } from '../core/services/db-service/providers/sql.provider';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables from .env.local
const envPath = path.join(__dirname, '../../.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn('⚠️  .env.local not found, using process.env');
}

const POSTGRES_CONNECTION_STRING =
  process.env.POSTGRES_CONNECTION_STRING ||
  'postgresql://dev_campus_gpt:dev_campuspass@3.7.255.54:5432/campus_gpt_db';

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://vyirgrhdmjpirqjqfahk.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5aXJncmhkbWpwaXJxanFmYWhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM4MDY2OTYsImV4cCI6MjA2OTM4MjY5Nn0.w9Zh3ATW6SN8GFRcdRVU0GobqS5tqzZywWs17vb5aH8';

// User credentials from env (you can add these to .env.local)
const DEVELOPER_EMAIL =
  process.env.DEVELOPER_EMAIL || 'developer@campus-gpt.com';
const DEVELOPER_PASSWORD = process.env.DEVELOPER_PASSWORD || 'developer123';
const PROJECT_MANAGER_EMAIL =
  process.env.PROJECT_MANAGER_EMAIL || 'pm@campus-gpt.com';
const PROJECT_MANAGER_PASSWORD =
  process.env.PROJECT_MANAGER_PASSWORD || 'pm123';

async function resetDatabase() {
  console.log('🔄 Resetting PostgreSQL database...');

  const sequelize = new Sequelize(POSTGRES_CONNECTION_STRING, {
    dialect: 'postgres',
    logging: false,
  });

  try {
    await sequelize.authenticate();
    console.log('✅ Connected to PostgreSQL');

    // Drop all tables
    console.log('🗑️  Dropping all tables...');
    await sequelize.drop({ cascade: true });
    console.log('✅ All tables dropped');

    // Close connection
    await sequelize.close();

    // Recreate schema by initializing SqlService
    console.log('🔨 Recreating database schema...');
    const sqlService = new SqlService(POSTGRES_CONNECTION_STRING);
    await sqlService.init();
    await sqlService.sync({ force: false });
    console.log('✅ Database schema recreated');

    await sqlService.getSequelizeInstance().close();
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    throw error;
  }
}

async function seedSupabaseUsers() {
  console.log('👤 Seeding Supabase users...');

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!serviceRoleKey) {
    console.log('⚠️  SUPABASE_SERVICE_ROLE_KEY not found in .env.local');
    console.log('💡 Skipping Supabase user creation.');
    console.log('💡 To seed users, add SUPABASE_SERVICE_ROLE_KEY to backend/.env.local');
    console.log('💡 You can find it in your Supabase dashboard: Settings > API > service_role key');
    return;
  }

  const adminClient = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const users = [
    {
      email: DEVELOPER_EMAIL,
      password: DEVELOPER_PASSWORD,
      role: 'DEVELOPER',
      name: 'Developer User',
    },
    {
      email: PROJECT_MANAGER_EMAIL,
      password: PROJECT_MANAGER_PASSWORD,
      role: 'PROJECT_MANAGER',
      name: 'Project Manager User',
    },
  ];

  for (const user of users) {
    try {
      // Check if user already exists
      const { data: existingUsers, error: listError } = 
        await adminClient.auth.admin.listUsers();
      
      if (listError) {
        console.error(`❌ Error listing users:`, listError.message);
        continue;
      }

      const userExists = existingUsers?.users?.some(
        (u) => u.email === user.email,
      );

      if (userExists) {
        console.log(`⚠️  User ${user.email} already exists, deleting and recreating...`);
        const existingUser = existingUsers.users.find((u) => u.email === user.email);
        if (existingUser) {
          await adminClient.auth.admin.deleteUser(existingUser.id);
        }
      }

      // Create user using admin API
      const { data: adminData, error: adminError } =
        await adminClient.auth.admin.createUser({
          email: user.email,
          password: user.password,
          email_confirm: true,
          user_metadata: {
            name: user.name,
            role: user.role,
          },
        });

      if (adminError) {
        console.error(
          `❌ Failed to create user ${user.email}:`,
          adminError.message,
        );
      } else {
        console.log(`✅ Created user: ${user.email} (${user.role})`);
      }
    } catch (error: any) {
      console.error(`❌ Error creating user ${user.email}:`, error.message);
    }
  }
}

async function main() {
  try {
    console.log('🚀 Starting database reset and seed...\n');

    // Reset PostgreSQL database
    await resetDatabase();

    console.log('\n');

    // Seed Supabase users
    await seedSupabaseUsers();

    console.log('\n✅ Seed completed successfully!');
    console.log('\n📋 User Credentials:');
    console.log(`   DEVELOPER:`);
    console.log(`     Email: ${DEVELOPER_EMAIL}`);
    console.log(`     Password: ${DEVELOPER_PASSWORD}`);
    console.log(`   PROJECT_MANAGER:`);
    console.log(`     Email: ${PROJECT_MANAGER_EMAIL}`);
    console.log(`     Password: ${PROJECT_MANAGER_PASSWORD}`);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
}

// Run the seed script
main();
