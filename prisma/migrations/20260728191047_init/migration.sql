-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "idNumber" TEXT NOT NULL,
    "phone" TEXT,
    "deviceId" TEXT,
    "ip" TEXT,
    "role" TEXT NOT NULL DEFAULT 'buyer',
    "kycLevel" INTEGER NOT NULL DEFAULT 1,
    "kycData" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sellerRequirements" JSONB,
    "sellerProfile" JSONB,
    "favorites" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auction" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "auctionType" TEXT NOT NULL,
    "reserve" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentBid" DOUBLE PRECISION,
    "currentBidderId" TEXT,
    "maxBid" DOUBLE PRECISION,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'UPCOMING',
    "sellerId" TEXT NOT NULL,
    "sellerRequirements" JSONB,
    "items" INTEGER NOT NULL DEFAULT 1,
    "city" TEXT NOT NULL DEFAULT 'Online',
    "viewerCount" INTEGER NOT NULL DEFAULT 0,
    "bidders" JSONB,
    "maxBids" JSONB,
    "winnerId" TEXT,
    "finalPrice" DOUBLE PRECISION,
    "timeLeft" INTEGER,
    "extensionCount" INTEGER NOT NULL DEFAULT 0,
    "maxExtensions" INTEGER NOT NULL DEFAULT 3,
    "requiredKycLevel" INTEGER NOT NULL DEFAULT 1,
    "paymentDeadline" TIMESTAMP(3),
    "currentLot" INTEGER NOT NULL DEFAULT 1,
    "images" JSONB,
    "videoUrl" TEXT,
    "inspectionReport" TEXT,
    "serviceHistory" JSONB,
    "inventoryManifest" TEXT,
    "engineHours" INTEGER,
    "vinNumber" TEXT,
    "bulkSaleTerms" TEXT,
    "reservedBidders" JSONB,
    "increment" INTEGER NOT NULL DEFAULT 1000,
    "analytics" JSONB,
    "ghostBidders" JSONB,
    "proxyBids" JSONB,
    "isLast10Min" BOOLEAN NOT NULL DEFAULT false,
    "rated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL DEFAULT 5,
    "comment" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "sellerName" TEXT NOT NULL,
    "auctionTitle" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "evidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GhostLead" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "maxBid" DOUBLE PRECISION NOT NULL,
    "bidCount" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "finalPrice" DOUBLE PRECISION NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contacted" BOOLEAN NOT NULL DEFAULT false,
    "sentToSeller" BOOLEAN NOT NULL DEFAULT false,
    "sentToBuyer" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GhostLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoldItem" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "winnerName" TEXT NOT NULL,
    "finalPrice" DOUBLE PRECISION NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoldItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_idNumber_key" ON "User"("idNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SoldItem_auctionId_key" ON "SoldItem"("auctionId");

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GhostLead" ADD CONSTRAINT "GhostLead_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GhostLead" ADD CONSTRAINT "GhostLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GhostLead" ADD CONSTRAINT "GhostLead_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoldItem" ADD CONSTRAINT "SoldItem_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
