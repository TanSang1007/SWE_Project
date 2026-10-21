const {resolve}=require('node:path');const {PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=require('../dist/generated/prisma/client');
const {reconcileAccount}=require('../dist/loyalty/loyalty-accounting');
const {utcConnectionString}=require('../dist/database/pg-connection');
require('dotenv').config({path:resolve(__dirname,'../../.env'),quiet:true});
(async()=>{
 const url=new URL(process.env.DATABASE_URL);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!/_(dev|test)$/.test(url.pathname))throw Error('Local demo/test DB required');
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:utcConnectionString(url.toString())})});
 try{const report=await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const users=await tx.user.findMany({select:{id:true}});let mismatch=0;
  for(const u of users){try{await reconcileAccount(tx,u.id);}catch{mismatch++;}}
  return {readOnly:true,checkedUsers:users.length,mismatches:mismatch,repairs:0};
 },{isolationLevel:'RepeatableRead',timeout:30000});console.log(JSON.stringify(report));if(report.mismatches)process.exitCode=1;
 }finally{await db.$disconnect();}
})().catch(()=>{console.error('Read-only loyalty reconciliation unavailable; sensitive details suppressed');process.exitCode=1;});
