-- CreateEnum
CREATE TYPE "ContractSource" AS ENUM ('REGISTER', 'PDF', 'MANUAL');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Item" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "standardPrice" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "categories" TEXT[],
    "status" TEXT NOT NULL,
    "onTimePct" DOUBLE PRECISION NOT NULL,
    "qualityRating" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plant" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "PoHistory" (
    "poNumber" TEXT NOT NULL,
    "poDate" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "uom" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "plant" TEXT NOT NULL,
    "deliveredOnTime" BOOLEAN NOT NULL,

    CONSTRAINT "PoHistory_pkey" PRIMARY KEY ("poNumber")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "valueCap" DOUBLE PRECISION NOT NULL,
    "consumedValue" DOUBLE PRECISION NOT NULL,
    "source" "ContractSource" NOT NULL,
    "fileName" TEXT,
    "extractedText" TEXT,
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractLine" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ContractLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "status" "PolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "changeSummary" JSONB,
    "sourceType" TEXT NOT NULL,
    "sourceName" TEXT,
    "sourceText" TEXT,
    "aiNotes" JSONB,
    "parentId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "reviewComment" TEXT,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrBatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "prNo" TEXT NOT NULL,
    "prLine" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "requester" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "plant" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "estimatedUnitPrice" TEXT NOT NULL,
    "needByDate" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "insertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionRun" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "policyMode" TEXT NOT NULL,
    "forcedVersionId" TEXT,
    "versionsUsed" TEXT[],
    "summary" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerAction" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "comment" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT,
    "groupIds" TEXT[],
    "lineKeys" TEXT[],
    "totalValue" DOUBLE PRECISION,
    "payload" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "PoHistory_itemCode_poDate_idx" ON "PoHistory"("itemCode", "poDate");

-- CreateIndex
CREATE INDEX "ContractLine_itemCode_idx" ON "ContractLine"("itemCode");

-- CreateIndex
CREATE INDEX "PolicyVersion_status_effectiveFrom_idx" ON "PolicyVersion"("status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PrLine_batchId_prNo_prLine_key" ON "PrLine"("batchId", "prNo", "prLine");

-- CreateIndex
CREATE INDEX "BuyerAction_runId_groupId_idx" ON "BuyerAction"("runId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_number_key" ON "Document"("number");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- AddForeignKey
ALTER TABLE "ContractLine" ADD CONSTRAINT "ContractLine_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrLine" ADD CONSTRAINT "PrLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PrBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionRun" ADD CONSTRAINT "DecisionRun_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PrBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerAction" ADD CONSTRAINT "BuyerAction_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DecisionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DecisionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
