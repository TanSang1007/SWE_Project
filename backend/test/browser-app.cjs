// Test harness factory only. Production AppModule/main never imports this file.
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { Test } = require('@nestjs/testing');
const { Client } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/generated/prisma/client');
const { utcConnectionString } = require('../dist/database/pg-connection');
const { PrismaService } = require('../dist/database/prisma.service');
async function createBrowserApp(module) {
  const schema = process.env.BROWSER_TEST_SCHEMA;
  if (!schema) return NestFactory.create(module, { bodyParser:false,logger:false,abortOnError:false });
  if (!/^brewlite_(?:a0[34]|l01)_browser_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid isolated browser schema');
  const effective = new Client({ connectionString:process.env.DATABASE_URL });
  if (!['localhost','127.0.0.1','::1'].includes(effective.host) || !/_(dev|test)$/.test(effective.database)) throw new Error('Local test database required');
  const prisma = new PrismaClient({ adapter:new PrismaPg({connectionString:utcConnectionString(process.env.DATABASE_URL)},{schema}) });
  prisma.onModuleDestroy = () => prisma.$disconnect();
  const m = await Test.createTestingModule({imports:[module]}).overrideProvider(PrismaService).useValue(prisma).compile();
  return m.createNestApplication({bodyParser:false,logger:false});
}
module.exports={createBrowserApp};
