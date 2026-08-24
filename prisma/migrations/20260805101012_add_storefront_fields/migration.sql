-- AlterTable
ALTER TABLE "Auction" ADD COLUMN     "color" TEXT,
ADD COLUMN     "condition" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "kilometers" INTEGER,
ADD COLUMN     "year" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatar" TEXT,
ADD COLUMN     "bio" TEXT;
