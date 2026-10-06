CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Build" (
  "id" TEXT NOT NULL,
  "projectName" TEXT NOT NULL,
  "sourcePath" TEXT NOT NULL,
  "artifactPath" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "Build_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BuildLog" (
  "id" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'info',
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "buildId" TEXT NOT NULL,
  CONSTRAINT "BuildLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "Build_userId_createdAt_idx" ON "Build"("userId", "createdAt");
CREATE INDEX "Build_status_idx" ON "Build"("status");
CREATE INDEX "BuildLog_buildId_createdAt_idx" ON "BuildLog"("buildId", "createdAt");
ALTER TABLE "Build" ADD CONSTRAINT "Build_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuildLog" ADD CONSTRAINT "BuildLog_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "Build"("id") ON DELETE CASCADE ON UPDATE CASCADE;
