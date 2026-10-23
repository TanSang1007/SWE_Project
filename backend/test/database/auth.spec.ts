import { utcConnectionString } from "../../src/database/pg-connection";
import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { compare, getRounds } from "bcrypt";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/database/prisma.service";
import { PrismaClient } from "../../src/generated/prisma/client";
import { configureApp } from "../../src/common/configure-app";
import { JwtAuthGuard } from "../../src/auth/guards/jwt-auth.guard";

@Controller("test-auth-protected")
class GuardHarness {
  @Get()
  @UseGuards(JwtAuthGuard)
  get(@Req() req: Request) {
    return req.user;
  }
}

config({ path: resolve(__dirname, "../../../.env"), quiet: true });
const connectionString =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("Local development/test database required");
const url = new URL(connectionString);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  !/_(dev|test)$/.test(url.pathname)
)
  throw new Error("Local _dev/_test database required");
const schema = `brewlite_b07_test_${randomUUID().replaceAll("-", "")}`;
const client = new Client({ connectionString });
const prisma = new PrismaClient({
  adapter: new PrismaPg(
    { connectionString: utcConnectionString(connectionString) },
    { schema },
  ),
});
let app: NestExpressApplication;
const email = `${randomUUID()}@example.invalid`;
const password = ` ${randomBytes(20).toString("hex")} `;
let userId: string;

beforeAll(async () => {
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, "../../prisma/migrations");
  for (const name of readdirSync(dir)
    .filter((n) => /^\d+_/.test(n))
    .sort())
    await client.query(
      readFileSync(resolve(dir, name, "migration.sql"), "utf8"),
    );
  const module = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [GuardHarness],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();
  app = module.createNestApplication<NestExpressApplication>({
    bodyParser: false,
  });
  configureApp(app);
  await app.init();
});

afterAll(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
});

test("register normalizes email, returns public fields, stores bcrypt10 not plaintext and no auto-login", async () => {
  const response = await request(app.getHttpServer())
    .post("/auth/register")
    .send({ email: ` ${email.toUpperCase()} `, password })
    .expect(201);
  expect(response.body).toEqual({
    user: {
      id: expect.any(String) as unknown,
      email,
      loyaltyPoints: 0,
      role: "CUSTOMER",
    },
  });
  const row = await prisma.user.findUniqueOrThrow({ where: { email } });
  userId = row.id;
  expect(row.passwordHash !== password).toBe(true);
  expect(getRounds(row.passwordHash)).toBe(10);
  expect(await compare(password, row.passwordHash)).toBe(true);
  expect(await compare(password.trim(), row.passwordHash)).toBe(false);
  expect(response.text).not.toMatch(/password|hash|accessToken/);
});

test("duplicate and simultaneous normalized registration return contract409, unique DB wins", async () => {
  const duplicate = await request(app.getHttpServer())
    .post("/auth/register")
    .send({ email, password })
    .expect(409);
  expect(duplicate.body).toMatchObject({
    error: { code: "EMAIL_ALREADY_EXISTS", details: [] },
  });
  const concurrentEmail = `${randomUUID()}@example.invalid`;
  const responses = await Promise.all(
    [1, 2].map(() =>
      request(app.getHttpServer())
        .post("/auth/register")
        .send({ email: concurrentEmail, password }),
    ),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(await prisma.user.count({ where: { email: concurrentEmail } })).toBe(
    1,
  );
});

// BỔ SUNG: Test case chuỗi rỗng và khoảng trắng cho CredentialsDto
test.each([
  { email: "invalid", password },
  { email, password: "x".repeat(7) },
  { email, password: "x".repeat(73) },
  { email, password: "é".repeat(37) },
  { email, password: 123 },
  { email, password, role: "ADMIN" },
  { email, password, loyaltyPoints: 100 },
  { email, password, userId: randomUUID() },
  { email: "", password },
  { email, password: "" },
  { email: "   ", password },
  { email, password: "   " },
])("rejects invalid DTO case %# without echoes of values", async (data) => {
  const response = await request(app.getHttpServer())
    .post("/auth/register")
    .send(data)
    .expect(400);

  expect(response.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  expect(response.text).not.toContain(password);
});

test("UTF-8 72-byte boundary is accepted without bcrypt truncation", async () => {
  const boundaryEmail = `${randomUUID()}@example.invalid`;
  const boundaryPassword = randomBytes(12).toString("hex") + "é".repeat(24);
  await request(app.getHttpServer())
    .post("/auth/register")
    .send({ email: boundaryEmail, password: boundaryPassword })
    .expect(201);
  await request(app.getHttpServer())
    .post("/auth/login")
    .send({ email: boundaryEmail, password: boundaryPassword })
    .expect(200);
});

async function loginToken(): Promise<string> {
  const response = await request(app.getHttpServer())
    .post("/auth/login")
    .send({ email, password })
    .expect(200);
  const body = response.body as { accessToken: string };
  expect(response.body).toEqual({
    accessToken: expect.any(String) as unknown,
    tokenType: "Bearer",
    expiresIn: 3600,
    user: { id: userId, email, loyaltyPoints: 0, role: "CUSTOMER" },
  });
  expect(response.text).not.toMatch(/passwordHash|password_hash/);
  return body.accessToken;
}

test("login creates HS256 sub/iat/exp JWT with exact lifetime and no credential payload", async () => {
  const token = await loginToken();
  const secret = app.get(ConfigService).getOrThrow<string>("JWT_SECRET");
  const payload = await new JwtService().verifyAsync<{
    sub: string;
    iat: number;
    exp: number;
  }>(token, { secret, algorithms: ["HS256"] });
  expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "sub"]);
  expect(payload.sub).toBe(userId);
  expect(payload.exp - payload.iat).toBe(3600);
});

test("unknown email and wrong password share identical 401 code/message", async () => {
  const results = await Promise.all(
    [
      { email, password: randomBytes(20).toString("hex") },
      { email: `${randomUUID()}@example.invalid`, password },
    ].map((body) =>
      request(app.getHttpServer()).post("/auth/login").send(body).expect(401),
    ),
  );
  for (const result of results)
    expect(result.body).toMatchObject({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
        details: [],
      },
    });
});

test("guard allows valid Bearer token and exposes only public user", async () => {
  const token = await loginToken();
  const response = await request(app.getHttpServer())
    .get("/test-auth-protected")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
  expect(response.body).toEqual({
    id: userId,
    email,
    loyaltyPoints: 0,
    role: "CUSTOMER",
  });
});

test("guard rejects missing, invalid, expired, wrong algorithm/signature and absent users", async () => {
  const jwt = new JwtService();
  const secret = app.get(ConfigService).getOrThrow<string>("JWT_SECRET");
  const tokens = [
    undefined,
    "invalid",
    await jwt.signAsync({ sub: userId }, { secret, expiresIn: -1 }),
    await jwt.signAsync(
      { sub: userId },
      { secret: randomBytes(32).toString("hex"), expiresIn: 3600 },
    ),
    await jwt.signAsync(
      { sub: userId },
      { secret, algorithm: "HS384", expiresIn: 3600 },
    ),
    await jwt.signAsync({ sub: randomUUID() }, { secret, expiresIn: 3600 }),
    await jwt.signAsync({ sub: userId }, { secret, noTimestamp: true }),
    await jwt.signAsync({ sub: "invalid" }, { secret, expiresIn: 3600 }),
  ];
  for (const token of tokens) {
    const call = request(app.getHttpServer()).get("/test-auth-protected");
    if (token) call.set("Authorization", `Bearer ${token}`);
    const response = await call.expect(401);
    expect(response.body).toMatchObject({
      error: { code: "UNAUTHORIZED", details: [] },
    });
    expect(response.text).not.toMatch(/jwt|signature|expired|Prisma|SELECT/i);
  }
});

test("production contract has no me/logout/role endpoints; catalog and health remain public", async () => {
  for (const path of ["/auth/me", "/auth/logout", "/users", "/orders"])
    await request(app.getHttpServer()).get(path).expect(404);
  await request(app.getHttpServer()).get("/products").expect(200);
  await request(app.getHttpServer()).get("/health").expect(200);
});
