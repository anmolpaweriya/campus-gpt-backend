import { Sequelize } from 'sequelize';
import { SqlService } from '../core/services/db-service/providers/sql.provider';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main() {
  const POSTGRES_CONNECTION_STRING = requireEnv('POSTGRES_CONNECTION_STRING');

  // eslint-disable-next-line no-console
  console.log('🔄 Resetting PostgreSQL database...');

  const sequelize = new Sequelize(POSTGRES_CONNECTION_STRING, {
    dialect: 'postgres',
    logging: false,
  });

  await sequelize.authenticate();
  // eslint-disable-next-line no-console
  console.log('✅ Connected to PostgreSQL');

  // Drop all tables managed by Sequelize
  // eslint-disable-next-line no-console
  console.log('🗑️  Dropping all tables...');
  await sequelize.drop({ cascade: true });
  // eslint-disable-next-line no-console
  console.log('✅ All tables dropped');

  await sequelize.close();

  // Recreate schema by initializing SqlService (loads all models + associations)
  // eslint-disable-next-line no-console
  console.log('🔨 Recreating database schema...');
  const sqlService = new SqlService(POSTGRES_CONNECTION_STRING);
  await sqlService.init();
  await sqlService.sync({ force: false });
  await sqlService.getSequelizeInstance().close();
  // eslint-disable-next-line no-console
  console.log('✅ Database schema recreated');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('❌ DB seed failed:', e?.message ?? e);
  process.exit(1);
});

