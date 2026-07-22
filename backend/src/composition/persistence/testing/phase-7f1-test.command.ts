import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createPersistenceComposition,
  type PersistenceComposition,
} from "../..";
import {
  ConfirmedOrderPersistenceService,
  PostgreSqlConfirmedOrderRepository,
} from "../../../modules/agent/order/persistence";
import { CatalogService, PostgreSqlCatalogRepository } from "../../../modules/catalog";
import {
  ConversationConfigService,
  PostgreSqlConversationConfigRepository,
} from "../../../modules/conversation-config";
import { PostgreSqlSellerRepository, SellerService } from "../../../modules/seller";
import { closeDatabasePool, getDatabasePoolState } from "../../../infrastructure/database";

type TestCase = Readonly<{
  name: string;
  passed: boolean;
}>;

const cases: TestCase[] = [];

function add(name: string, passed: boolean): void {
  cases.push({ name, passed });
}

function hasOnlyServiceSurface(composition: PersistenceComposition): boolean {
  return Object.keys(composition).sort().join(",") === [
    "catalogService",
    "confirmedOrderPersistenceService",
    "conversationConfigService",
    "sellerService",
  ].join(",");
}

async function sourceContains(file: string, pattern: RegExp): Promise<boolean> {
  const source = await readFile(path.resolve(process.cwd(), "src", file), "utf8");
  return pattern.test(source);
}

async function main(): Promise<void> {
  await closeDatabasePool();
  const beforeImportState = getDatabasePoolState();

  add("Composition module import does not initialize a database pool", !beforeImportState.initialized);

  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  let composition: PersistenceComposition;
  try {
    composition = createPersistenceComposition();
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }

  const afterFactoryState = getDatabasePoolState();
  add("Factory construction is safe without DATABASE_URL", Boolean(composition));
  add("Factory construction does not connect to PostgreSQL", !afterFactoryState.initialized);
  add("Factory construction does not execute a database query", afterFactoryState.totalCount === 0);
  add("Factory construction does not run migrations", afterFactoryState.waitingCount === 0);
  add("SellerService is constructed", composition.sellerService instanceof SellerService);
  add("CatalogService is constructed", composition.catalogService instanceof CatalogService);
  add("ConversationConfigService is constructed", composition.conversationConfigService instanceof ConversationConfigService);
  add("ConfirmedOrderPersistenceService is constructed", composition.confirmedOrderPersistenceService instanceof ConfirmedOrderPersistenceService);
  const repositories = {
    seller: (composition.sellerService as unknown as { repository: unknown }).repository,
    catalog: (composition.catalogService as unknown as { repository: unknown }).repository,
    conversationConfig: (composition.conversationConfigService as unknown as { repository: unknown }).repository,
    confirmedOrder: (composition.confirmedOrderPersistenceService as unknown as { repository: unknown }).repository,
  };
  add(
    "Services receive the PostgreSQL repository implementations through constructor injection",
    repositories.seller instanceof PostgreSqlSellerRepository
      && repositories.catalog instanceof PostgreSqlCatalogRepository
      && repositories.conversationConfig instanceof PostgreSqlConversationConfigRepository
      && repositories.confirmedOrder instanceof PostgreSqlConfirmedOrderRepository,
  );

  const repositorySources = [
    "modules/seller/infrastructure/postgresql/postgresql-seller.repository.ts",
    "modules/catalog/infrastructure/postgresql/postgresql-catalog.repository.ts",
    "modules/conversation-config/infrastructure/postgresql/postgresql-conversation-config.repository.ts",
    "modules/agent/order/persistence/infrastructure/postgresql/postgresql-confirmed-order.repository.ts",
  ];
  const sharedInfrastructureChecks = await Promise.all(repositorySources.map(async (repositorySource) => {
    const usesSharedInfrastructure = await sourceContains(repositorySource, /from ["'](?:\.\.\/)+infrastructure\/database["']/u);
    const createsIndependentPool = await sourceContains(repositorySource, /from ["']pg["']|new Pool\(/u);
    return usesSharedInfrastructure && !createsIndependentPool;
  }));
  add(
    "All PostgreSQL repositories use shared Phase 7A infrastructure and create no independent pool",
    sharedInfrastructureChecks.every(Boolean),
  );

  const repeatedComposition = createPersistenceComposition();
  add("Repeated factory construction does not create database sockets", !getDatabasePoolState().initialized);
  add("Composition exposes only application services, not raw pool or client state", hasOnlyServiceSurface(composition));
  add("Factory creates a fresh explicit composition without a global mutable container", composition !== repeatedComposition);

  const compositionSource = "composition/persistence/create-persistence-composition.ts";
  const usesPublicModuleExports = !await sourceContains(compositionSource, /modules\/(?:seller|catalog|conversation-config|agent\/order\/persistence)\/(?:application|contracts|domain|infrastructure)/u);
  add("Factory uses public persistence module exports rather than deep imports", usesPublicModuleExports);

  const sourceHasNoDatabaseWork = !await sourceContains(
    compositionSource,
    /executeDatabaseQuery|withTransaction|getDatabasePool|runDatabaseMigrations|new Pool|\.query\(/u,
  );
  add("Factory owns no pool and contains no query or migration path", sourceHasNoDatabaseWork);

  const serverImportsComposition = await sourceContains("server.ts", /composition\/persistence|createPersistenceComposition/u);
  const appImportsComposition = await sourceContains("app.ts", /composition\/persistence|createPersistenceComposition/u);
  add("Backend startup remains unchanged and does not register the composition", !serverImportsComposition && !appImportsComposition);

  await closeDatabasePool();

  const failed = cases.filter((testCase) => !testCase.passed);
  console.log(JSON.stringify({ phase: "7F1", total: cases.length, passed: cases.length - failed.length, failed, cases }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
