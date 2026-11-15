-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dativeName" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "spreadsheetId" TEXT NOT NULL DEFAULT '',
    "folderId" TEXT NOT NULL DEFAULT '',
    "contractNumber" TEXT NOT NULL DEFAULT '',
    "contractDate" TEXT NOT NULL DEFAULT '',
    "assignmentNumber" TEXT NOT NULL DEFAULT '',
    "assignmentDate" TEXT NOT NULL DEFAULT '',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "requisites" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "protectedFields" JSONB NOT NULL DEFAULT '[]',
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "rules" JSONB NOT NULL DEFAULT '{}',
    "sourceSnapshot" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rate" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT,
    "service" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT '',
    "amount" TEXT NOT NULL,
    "unitMinutes" INTEGER NOT NULL DEFAULT 60,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Calculation" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "source" JSONB NOT NULL,
    "raw" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Calculation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adjustment" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actNumber" TEXT NOT NULL,
    "actDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "confirmations" JSONB NOT NULL,
    "templateHash" TEXT NOT NULL,
    "pdfPath" TEXT NOT NULL DEFAULT '',
    "docxPath" TEXT NOT NULL DEFAULT '',
    "driveId" TEXT NOT NULL DEFAULT '',
    "uploadError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleAccount" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "encryptedTokens" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_name_key" ON "Teacher"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Calculation_teacherId_year_month_version_key" ON "Calculation"("teacherId", "year", "month", "version");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleAccount_email_key" ON "GoogleAccount"("email");

-- AddForeignKey
ALTER TABLE "Rate" ADD CONSTRAINT "Rate_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calculation" ADD CONSTRAINT "Calculation_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "Calculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
