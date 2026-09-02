// ============================================================
// server.js - SunAlgorithms Auction Platform (Phase 12)
// Features: 3 Roles (BUYER, INDIVIDUAL_SELLER, AUCTIONEER),
// Hybrid Marketplace (Auctions + Fixed Price), KYC, Public Seller Profiles
// ============================================================

require('dotenv').config();
// ============================================================
// AUTO-MIGRATION: Run Prisma migrations on startup
// ============================================================
const { execSync } = require('child_process');

try {
    console.log('📦 Running database migrations...');
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('✅ Database migrations completed.');
} catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
}
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const twilio = require('twilio');
const sgMail = require('@sendgrid/mail');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ---------- PRISMA CLIENT ----------
const prisma = new PrismaClient();

// ---------- RETRY HELPER ----------
async function queryWithRetry(fn, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === retries - 1) throw err;
            console.log(`[RETRY] Attempt ${i + 1} failed, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
        }
    }
}

// ---------- VERIFY DB CONNECTION ON STARTUP ----------
(async function init() {
    try {
        await prisma.$connect();
        console.log('📊 PostgreSQL connection verified');
    } catch (err) {
        console.error('❌ Failed to connect to PostgreSQL:', err.message);
        process.exit(1);
    }
    startTimedAuctionCron();
})();

// ---------- CLOUDFLARE R2 CONFIG ----------
const s3Client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || process.env.R2_ENDPOINT;

// ---------- TWILIO & SENDGRID ----------
const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@sunalgorithms.co.za';

// ---------- HELPERS ----------
async function sendSms(to, message) {
    if (!to) return;
    try {
        await twilioClient.messages.create({
            body: message,
            from: TWILIO_PHONE_NUMBER,
            to: to
        });
        console.log(`[SMS] Sent to ${to}`);
    } catch (err) {
        console.error(`[SMS] Failed: ${err.message}`);
    }
}

async function sendEmail(to, subject, html, attachments = []) {
    if (!to) return;
    try {
        await sgMail.send({
            to,
            from: FROM_EMAIL,
            subject,
            html,
            attachments
        });
        console.log(`[EMAIL] Sent to ${to}`);
    } catch (err) {
        console.error(`[EMAIL] Failed: ${err.message}`);
    }
}

function getBadge(kycLevel) {
    const badges = {
        1: 'ID Verified ✓',
        2: 'ID + Selfie ✓',
        3: 'Address Verified ✓',
        4: 'Bank Verified ✓✓',
        5: 'Million-Rand ✓✓'
    };
    return badges[kycLevel] || 'Unverified';
}

function formatPhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '27' + cleaned.slice(1);
    if (!cleaned.startsWith('27')) cleaned = '27' + cleaned;
    return cleaned;
}

function generateToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role, kycLevel: user.kycLevel },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
}

// ---------- R2 UPLOAD HELPER ----------
async function uploadToR2(file, folder = 'auctions') {
    const key = `${folder}/${Date.now()}-${file.originalname}`;
    const command = new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
    });
    await s3Client.send(command);
    return `${R2_PUBLIC_URL}/${key}`;
}

async function deleteFromR2(key) {
    const command = new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
    });
    await s3Client.send(command);
}

// ---------- MIDDLEWARE ----------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const bidLimiter = rateLimit({
    windowMs: 1000,
    max: 5,
    message: 'Too many bids, slow down'
});

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }
});

// ---------- AUTH MIDDLEWARE ----------
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// ============================================================
// ========== AUTH ============================================
// ============================================================

// ---------- REGISTER (with 3 roles) ----------
app.post('/api/register', upload.fields([
    { name: 'idPhoto', maxCount: 1 },
    { name: 'selfie', maxCount: 1 }
]), async (req, res) => {
    const { name, displayName, idNumber, email, password, phone, role } = req.body;
    const deviceId = req.headers['x-device-id'] || 'unknown';
    const ip = req.ip || req.connection.remoteAddress;

    // Validate role
    const allowedRoles = ['BUYER', 'INDIVIDUAL_SELLER', 'AUCTIONEER'];
    if (!allowedRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role. Choose BUYER, INDIVIDUAL_SELLER, or AUCTIONEER' });
    }

    const existingUser = await prisma.user.findFirst({
        where: { OR: [{ email }, { idNumber }] }
    });
    if (existingUser) {
        if (existingUser.status === 'BANNED_FRAUD') {
            return res.status(403).json({ error: 'Device/ID permanently banned' });
        }
        return res.status(400).json({ error: 'Email or ID already registered' });
    }

    if (!name || !idNumber || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }

    const idPhotoFile = req.files?.idPhoto?.[0];
    const selfieFile = req.files?.selfie?.[0];
    if (!idPhotoFile || !selfieFile) {
        return res.status(400).json({ error: 'ID photo and selfie required' });
    }

    // Simulate SmileID (for demo)
    try {
        console.log(`[SMILEID] Verified ${name}`);
    } catch (e) {
        return res.status(500).json({ error: 'KYC verification failed. Try again.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Determine canSell based on role
    const canSell = (role === 'INDIVIDUAL_SELLER' || role === 'AUCTIONEER') ? false : false; // Initially false until KYC verified

    const newUser = await prisma.user.create({
        data: {
            name,
            displayName: displayName || name,
            email,
            password: hashedPassword,
            idNumber,
            phone: phone || null,
            deviceId,
            ip,
            role,
            kycLevel: 1,
            kycStatus: 'NONE',
            canSell: false,
            kycData: { verifiedAt: new Date(), smileJobId: 'test' },
            status: 'ACTIVE',
            sellerRequirements: {
                depositAmount: 0,
                minKycLevel: 1,
                requiredDocs: ['ID'],
                servicesOffered: [],
                ppraReg: null,
                bbbeeLevel: null,
                saiaMember: false
            },
            sellerProfile: {
                trustScore: null,
                totalRatings: 0,
                ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
                badges: []
            }
        }
    });

    const token = generateToken(newUser);
    res.status(201).json({
        token,
        user: {
            id: newUser.id,
            name: newUser.name,
            displayName: newUser.displayName,
            email: newUser.email,
            role: newUser.role,
            kycStatus: newUser.kycStatus,
            canSell: newUser.canSell,
            kycLevel: newUser.kycLevel,
            sellerRequirements: newUser.sellerRequirements
        }
    });
});

// ---------- LOGIN ----------
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status === 'BANNED_FRAUD') {
        return res.status(403).json({ error: 'Account banned for non-payment' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);
    res.json({
        token,
        user: {
            id: user.id,
            name: user.name,
            displayName: user.displayName,
            email: user.email,
            role: user.role,
            kycStatus: user.kycStatus,
            canSell: user.canSell,
            kycLevel: user.kycLevel,
            sellerRequirements: user.sellerRequirements,
            sellerProfile: user.sellerProfile,
            avatar: user.avatar,
            bio: user.bio
        }
    });
});

// ---------- GET CURRENT USER ----------
app.get('/api/me', authenticate, async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
        id: user.id,
        name: user.name,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        kycStatus: user.kycStatus,
        canSell: user.canSell,
        kycLevel: user.kycLevel,
        sellerRequirements: user.sellerRequirements,
        sellerProfile: user.sellerProfile,
        avatar: user.avatar,
        bio: user.bio
    });
});

// ---------- UPDATE USER PROFILE (avatar, displayName, bio) ----------
app.put('/api/users/me', authenticate, async (req, res) => {
    const { displayName, avatar, bio } = req.body;
    const user = await prisma.user.update({
        where: { id: req.user.id },
        data: { displayName, avatar, bio }
    });
    res.json({ message: 'Profile updated', user });
});

// ============================================================
// ========== KYC UPGRADE ======================================
// ============================================================

app.post('/api/kyc/upgrade', authenticate, async (req, res) => {
    const { targetLevel, bankAccount, bankCode } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Existing KYC level upgrade
    if (targetLevel <= user.kycLevel) {
        return res.status(400).json({ error: 'Target level must be higher than current' });
    }

    if (targetLevel === 4) {
        // Bank verification (simulate)
        if (!bankAccount || !bankCode) {
            return res.status(400).json({ error: 'Bank account and bank code required' });
        }
        // In production, call Ozow API
        await prisma.user.update({
            where: { id: req.user.id },
            data: {
                kycLevel: 4,
                kycData: {
                    ...(user.kycData || {}),
                    bankVerified: true,
                    bankAccountLast4: bankAccount.slice(-4)
                }
            }
        });
    }

    if (targetLevel === 5) {
        if (user.kycLevel < 4) return res.status(400).json({ error: 'Must be Bank Verified (Level 4) first' });
        await prisma.user.update({
            where: { id: req.user.id },
            data: {
                kycLevel: 5,
                kycData: {
                    ...(user.kycData || {}),
                    millionRandVerified: true
                }
            }
        });
    }

    // NEW: KYC for Individual Sellers (become verified to sell)
    // This is separate from KYC level – it's an approval step.
    // You could add fields like ID upload, proof of address, etc.
    // For now, we'll just set kycStatus to 'VERIFIED' if they have Level 4+ and role is seller type.
    if (targetLevel === 4 && (user.role === 'INDIVIDUAL_SELLER' || user.role === 'AUCTIONEER')) {
        await prisma.user.update({
            where: { id: req.user.id },
            data: {
                kycStatus: 'VERIFIED',
                canSell: true
            }
        });
    }

    const updatedUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    const token = generateToken(updatedUser);
    res.json({
        token,
        kycLevel: updatedUser.kycLevel,
        kycStatus: updatedUser.kycStatus,
        canSell: updatedUser.canSell,
        badge: getBadge(updatedUser.kycLevel),
        message: `Upgraded to Level ${updatedUser.kycLevel}`
    });
});

// ============================================================
// ========== SELLER REQUIREMENTS (unchanged) ==================
// ============================================================
app.post('/api/seller/requirements', authenticate, async (req, res) => {
    // ... existing code (keep as is) ...
});

// ============================================================
// ========== AUCTION CRUD (existing, with minor updates) =====
// ============================================================
// ... (keep existing auction routes for compatibility) ...

// ============================================================
// ========== LISTINGS (NEW: Hybrid Marketplace) ===============
// ============================================================

// ---------- CREATE LISTING (AUCTION or FIXED_PRICE) ----------
app.post('/api/listings',
    authenticate,
    upload.fields([
        { name: 'images', maxCount: 10 }
    ]),
    async (req, res) => {
        // Check if user can sell (must be verified)
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!user.canSell) {
            return res.status(403).json({ error: 'You must be KYC verified to sell. Go to Profile to upgrade.' });
        }

        const {
            title, description, category, condition,
            listingType, // 'AUCTION' or 'FIXED_PRICE'
            startingPrice, reservePrice, duration,
            price, stock, isNegotiable,
            // NEW: Vehicle Specs for the cards
            year, kilometers, color, engineSize, transmission, fuelType
        } = req.body;

        // Validation
        if (!title || !category || !listingType) {
            return res.status(400).json({ error: 'Title, category, and listing type required' });
        }

        if (listingType === 'AUCTION') {
            if (!startingPrice) return res.status(400).json({ error: 'Starting price required for auction' });
        } else if (listingType === 'FIXED_PRICE') {
            if (!price) return res.status(400).json({ error: 'Price required for fixed price listing' });
        }

        // Process images
        const imageUrls = req.files?.images?.length ? await Promise.all(
            req.files.images.map(file => uploadToR2(file, 'listings'))
        ) : [];

        // Calculate end time for auction
        let endTime = null;
        if (listingType === 'AUCTION' && duration) {
            const days = parseInt(duration.replace('d', ''));
            endTime = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        }

        // Create listing (WITH NEW SPEC FIELDS)
        const newListing = await prisma.listing.create({
            data: {
                sellerId: user.id,
                title,
                description: description || null,
                category,
                condition: condition || 'USED',
                images: imageUrls,
                listingType,
                startingPrice: listingType === 'AUCTION' ? parseFloat(startingPrice) : null,
                reservePrice: reservePrice ? parseFloat(reservePrice) : null,
                endTime: endTime,
                duration: listingType === 'AUCTION' ? duration : null,
                price: listingType === 'FIXED_PRICE' ? parseFloat(price) : null,
                stock: parseInt(stock) || 1,
                isNegotiable: isNegotiable === 'true' || isNegotiable === true,
                status: 'ACTIVE',
                // Save NEW SPEC FIELDS
                year: year ? parseInt(year) : null,
                kilometers: kilometers ? parseInt(kilometers) : null,
                color: color || null,
                engineSize: engineSize || null,
                transmission: transmission || null,
                fuelType: fuelType || null,
            }
        });

        res.status(201).json({
            id: newListing.id,
            message: `${listingType === 'AUCTION' ? 'Auction' : 'Listing'} created successfully`
        });
    }
);

// ---------- GET MARKETPLACE (Filtered) ----------
app.get('/api/marketplace', async (req, res) => {
    const { filter, category, search, verifiedOnly } = req.query;

    // Build where clause
    const where = {
        status: 'ACTIVE',
        ...(category && category !== 'ALL' ? { category } : {}),
    };

    if (filter === 'AUCTION') {
        where.listingType = 'AUCTION';
        // Only show auctions that haven't ended
        if (where.endTime) { // add endTime filter? we'll handle in logic
        }
    } else if (filter === 'FIXED_PRICE') {
        where.listingType = 'FIXED_PRICE';
    }

    // Search by title
    if (search) {
        where.title = { contains: search, mode: 'insensitive' };
    }

    // Verified only (sellers must be verified)
    if (verifiedOnly === 'true') {
        where.seller = { canSell: true };
    }

    // Get listings
    const listings = await prisma.listing.findMany({
        where,
        include: {
            seller: {
                select: {
                    id: true,
                    name: true,
                    displayName: true,
                    avatar: true,
                    role: true,
                    canSell: true,
                    kycStatus: true
                }
            },
            bids: {
                orderBy: { createdAt: 'desc' },
                take: 1 // latest bid
            }
        },
        orderBy: { createdAt: 'desc' }
    });

    // Format response (INCLUDING NEW SPEC FIELDS FOR CARDS)
    const formatted = listings.map(l => ({
        id: l.id,
        title: l.title,
        description: l.description,
        category: l.category,
        condition: l.condition,
        listingType: l.listingType,
        images: l.images,
        currentBid: l.currentBid || l.startingPrice || 0,
        price: l.price,
        stock: l.stock,
        isNegotiable: l.isNegotiable,
        endTime: l.endTime,
        status: l.status,
        seller: l.seller,
        bidCount: l.bids ? l.bids.length : 0,
        createdAt: l.createdAt,
        // Include specs for the card
        year: l.year,
        kilometers: l.kilometers,
        color: l.color,
        engineSize: l.engineSize,
        transmission: l.transmission,
        fuelType: l.fuelType
    }));

    res.json(formatted);
});

// ---------- GET SINGLE LISTING ----------
app.get('/api/listings/:id', async (req, res) => {
    const listing = await prisma.listing.findUnique({
        where: { id: req.params.id },
        include: {
            seller: true,
            bids: {
                orderBy: { createdAt: 'desc' },
                take: 10,
                include: { bidder: { select: { name: true, id: true } } }
            }
        }
    });
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    res.json(listing);
});

// ---------- PLACE BID ON LISTING (AUCTION) ----------
app.post('/api/listings/:id/bid', authenticate, async (req, res) => {
    const { amount } = req.body;
    const listing = await prisma.listing.findUnique({
        where: { id: req.params.id, listingType: 'AUCTION', status: 'ACTIVE' }
    });
    if (!listing) return res.status(404).json({ error: 'Auction not found or inactive' });

    if (listing.endTime && new Date(listing.endTime) < new Date()) {
        return res.status(400).json({ error: 'Auction has ended' });
    }

    const bidder = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!bidder) return res.status(404).json({ error: 'User not found' });

    if (!parseFloat(amount) || parseFloat(amount) <= (listing.currentBid || listing.startingPrice || 0)) {
        return res.status(400).json({ error: 'Bid must be higher than current bid' });
    }

    // Create bid
    const bid = await prisma.bid.create({
        data: {
            listingId: listing.id,
            bidderId: req.user.id,
            amount: parseFloat(amount)
        }
    });

    // Update listing current bid
    await prisma.listing.update({
        where: { id: listing.id },
        data: { currentBid: parseFloat(amount), currentBidderId: req.user.id }
    });

    // Update analytics if exists (not required for new listing)
    res.json({ message: 'Bid placed', currentBid: parseFloat(amount) });
});

// ============================================================
// ========== SELLER PUBLIC PROFILE ============================
// ============================================================

app.get('/api/sellers/:sellerId', async (req, res) => {
    const seller = await prisma.user.findUnique({
        where: { id: req.params.sellerId },
        include: {
            listings: {
                where: { status: 'ACTIVE' },
                orderBy: { createdAt: 'desc' }
            },
            ratingsReceived: {
                select: { stars: true }
            }
        }
    });
    if (!seller) return res.status(404).json({ error: 'Seller not found' });

    // Calculate rating
    const totalRatings = seller.ratingsReceived.length;
    const avgRating = totalRatings > 0 ? seller.ratingsReceived.reduce((a,b) => a + b.stars, 0) / totalRatings : 0;

    res.json({
        id: seller.id,
        name: seller.name,
        displayName: seller.displayName,
        avatar: seller.avatar,
        bio: seller.bio,
        role: seller.role,
        kycStatus: seller.kycStatus,
        canSell: seller.canSell,
        joinedDate: seller.createdAt,
        rating: avgRating,
        totalRatings,
        listings: seller.listings.map(l => ({
            id: l.id,
            title: l.title,
            images: l.images,
            listingType: l.listingType,
            currentBid: l.currentBid,
            price: l.price,
            endTime: l.endTime,
            status: l.status,
            createdAt: l.createdAt,
            // Include specs for the seller's public profile
            year: l.year,
            kilometers: l.kilometers,
            condition: l.condition
        }))
    });
});

// ---------- GET SELLER'S DASHBOARD STATS ----------
app.get('/api/seller/dashboard', authenticate, async (req, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: {
            listings: {
                where: { status: 'ACTIVE' }
            }
        }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Count sold items from soldItems relation
    const soldCount = user.soldItems ? user.soldItems.length : 0;

    res.json({
        totalStock: user.listings.length,
        activeSales: user.listings.filter(l => l.status === 'ACTIVE').length,
        sold: soldCount,
        earnings: 0 // placeholder
    });
});

// ============================================================
// ========== END OF PART 1 ====================================
// ============================================================
// PASTE PART 2 BELOW THIS LINE
// ============================================================
// ============================================================
// ========== PART 2: EXISTING AUCTION CRUD (Keep for legacy) =
// ============================================================

const AUCTION_TYPES = {
    LIVE: 'LIVE',
    TIMED: 'TIMED'
};

const categories = [
    'Cars', 'Trucks', 'Machinery', 'Property', 'Liquidation',
    'Livestock', 'Art', 'Yellow Metal', 'Estate Sale'
];

// ---------- CREATE AUCTION (original, with R2) ----------
app.post('/api/auctions',
    authenticate,
    upload.fields([
        { name: 'images', maxCount: 8 },
        { name: 'video', maxCount: 1 },
        { name: 'inspectionReport', maxCount: 1 },
        { name: 'serviceHistory', maxCount: 5 },
        { name: 'inventoryManifest', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const { title, description, category, auctionType, reserve, startTime, endTime, items, city, requiredKycLevel } = req.body;
            if (!title || !auctionType || !reserve) return res.status(400).json({ error: 'Title, auction type, and reserve are required' });

            const imageUrls = req.files?.images?.length ? await Promise.all(req.files.images.map(file => uploadToR2(file, 'auctions'))) : [];
            const videoUrl = req.files?.video?.[0] ? await uploadToR2(req.files.video[0], 'videos') : null;
            const inspectionReport = req.files?.inspectionReport?.[0] ? await uploadToR2(req.files.inspectionReport[0], 'reports') : null;
            const serviceHistory = req.files?.serviceHistory?.length ? await Promise.all(req.files.serviceHistory.map(file => uploadToR2(file, 'history'))) : [];
            const inventoryManifest = req.files?.inventoryManifest?.[0] ? await uploadToR2(req.files.inventoryManifest[0], 'inventory') : null;

            const newAuction = await prisma.auction.create({
                data: {
                    title,
                    description,
                    category,
                    auctionType,
                    reserve: parseFloat(reserve),
                    startTime: startTime ? new Date(startTime) : new Date(),
                    endTime: endTime ? new Date(endTime) : null,
                    sellerId: req.user.id,
                    images: imageUrls,
                    videoUrl,
                    inspectionReport,
                    serviceHistory,
                    inventoryManifest,
                    items: parseInt(items) || 1,
                    city: city || 'Online',
                    requiredKycLevel: parseInt(requiredKycLevel) || 1,
                    status: auctionType === 'LIVE' ? 'LIVE' : 'UPCOMING'
                }
            });

            res.status(201).json({ id: newAuction.id, message: 'Auction created successfully' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
);

// ---------- GET ALL AUCTIONS ----------
app.get('/api/auctions', async (req, res) => {
    try {
        const auctions = await prisma.auction.findMany({
            orderBy: { startTime: 'desc' },
            include: { seller: { select: { id: true, name: true, displayName: true } } }
        });
        res.json(auctions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- GET SINGLE AUCTION ----------
app.get('/api/auctions/:id', async (req, res) => {
    try {
        const auction = await prisma.auction.findUnique({
            where: { id: req.params.id },
            include: { seller: true, ratings: true }
        });
        if (!auction) return res.status(404).json({ error: 'Auction not found' });
        res.json(auction);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- GET SELLER'S AUCTIONS ----------
app.get('/api/seller/auctions', authenticate, async (req, res) => {
    try {
        const auctions = await prisma.auction.findMany({
            where: { sellerId: req.user.id },
            orderBy: { startTime: 'desc' }
        });
        res.json(auctions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- TIMED AUCTION BIDDING (legacy) ----------
app.post('/api/auctions/:id/bid', authenticate, async (req, res) => {
    const { amount } = req.body;
    try {
        const auction = await prisma.auction.findUnique({ where: { id: req.params.id } });
        if (!auction) return res.status(404).json({ error: 'Auction not found' });
        if (auction.status !== 'LIVE' && auction.status !== 'LIVE_LAST_10MIN') return res.status(400).json({ error: 'Auction is not live' });
        if (!parseFloat(amount) || parseFloat(amount) <= (auction.currentBid || 0)) {
            return res.status(400).json({ error: 'Bid must be higher than current bid' });
        }

        const bidder = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!bidder) return res.status(404).json({ error: 'User not found' });

        // Update the auction
        await prisma.auction.update({
            where: { id: auction.id },
            data: {
                currentBid: parseFloat(amount),
                currentBidderId: req.user.id,
                bidders: {
                    push: {
                        userId: req.user.id,
                        name: bidder.displayName || bidder.name,
                        amount: parseFloat(amount),
                        kycBadge: getBadge(bidder.kycLevel)
                    }
                }
            }
        });

        res.json({ message: 'Bid placed', currentBid: parseFloat(amount) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- HELPER FUNCTIONS ----------
function getRequiredKycLevel(reservePrice) {
    if (reservePrice >= 2000000) return 5;
    if (reservePrice >= 1000000) return 4;
    if (reservePrice >= 100000) return 3;
    if (reservePrice >= 10000) return 2;
    return 1;
}

function getSellerBadges(seller) {
    const req = seller.sellerRequirements || {};
    const badges = [];
    if (req.ppraReg) badges.push({ type: 'ppra', label: `PPRA ${req.ppraReg} ✓` });
    if (req.bbbeeLevel === 1) badges.push({ type: 'bbbee', label: 'BBBEE Level 1 ✓✓' });
    if (req.bbbeeLevel === 2) badges.push({ type: 'bbbee', label: 'BBBEE Level 2 ✓' });
    if (req.saiaMember) badges.push({ type: 'saia', label: 'SAIA Member ✓' });
    if (req.servicesOffered?.includes('inspection')) badges.push({ type: 'service', label: 'Inspection ✓' });
    if (req.servicesOffered?.includes('natis')) badges.push({ type: 'service', label: 'Natis ✓' });
    if (req.servicesOffered?.includes('transport')) badges.push({ type: 'service', label: 'Transport ✓' });
    return badges;
}

// ============================================================
// ========== PROXY BIDDING (legacy) ==========================
// ============================================================

app.post('/api/auctions/:id/proxy-bid', authenticate, async (req, res) => {
    const { maxBid } = req.body;
    try {
        const auction = await prisma.auction.findUnique({ where: { id: req.params.id } });
        if (!auction) return res.status(404).json({ error: 'Auction not found' });
        if (!auction.proxyBids) auction.proxyBids = [];

        // Check if user already has a proxy bid
        const existing = auction.proxyBids.find(p => p.userId === req.user.id);
        if (existing) {
            existing.maxBid = parseFloat(maxBid);
        } else {
            auction.proxyBids.push({
                userId: req.user.id,
                maxBid: parseFloat(maxBid),
                name: req.user.name
            });
        }

        // Recalculate current bid based on proxy bids
        await updateProxyBids(auction.id, auction.proxyBids);

        const updated = await prisma.auction.findUnique({ where: { id: auction.id } });
        res.json({ message: 'Proxy bid updated', currentBid: updated.currentBid, youAreWinning: updated.currentBidderId === req.user.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function updateProxyBids(auctionId, proxyBids) {
    if (!proxyBids || proxyBids.length === 0) return;
    // Sort by maxBid descending
    const sorted = proxyBids.sort((a, b) => b.maxBid - a.maxBid);
    const topBidder = sorted[0];
    const secondBidder = sorted[1];

    const currentBid = secondBidder ? secondBidder.maxBid + 1000 : topBidder.maxBid;
    await prisma.auction.update({
        where: { id: auctionId },
        data: {
            currentBid,
            currentBidderId: topBidder.userId,
            maxBids: proxyBids // store updated proxy
        }
    });
}

// ============================================================
// ========== TIMED AUCTION CRON (with retry) =================
// ============================================================

function startTimedAuctionCron() {
    console.log('⏰ Starting TIMED auction cron job (every 60s)');

    setInterval(async () => {
        try {
            await prisma.$connect();

            const now = new Date();
            const auctions = await queryWithRetry(async () => {
                return prisma.auction.findMany({
                    where: {
                        auctionType: 'TIMED',
                        status: 'LIVE',
                        endTime: { not: null }
                    }
                });
            }, 2, 2000);

            for (const auction of auctions) {
                const endMs = new Date(auction.endTime).getTime();
                const timeLeft = endMs - now.getTime();

                if (timeLeft <= 10 * 60 * 1000 && timeLeft > 0 && !auction.isLast10Min) {
                    await prisma.auction.update({
                        where: { id: auction.id },
                        data: { isLast10Min: true, status: 'LIVE_LAST_10MIN' }
                    });
                    io.to(`auction_${auction.id}`).emit('switchedToLive', {
                        message: '🔴 Last 10 minutes! Auctioneer control is now active.'
                    });

                    const proxyBids = auction.proxyBids || [];
                    for (const p of proxyBids) {
                        const user = await prisma.user.findUnique({ where: { id: p.userId } });
                        if (user && user.phone) {
                            const formattedPhone = formatPhone(user.phone);
                            if (formattedPhone) {
                                const msg = `🔴 SunAlgorithms: "${auction.title}" is LIVE NOW for the last 10 minutes! Join at http://localhost:3000 (or your domain)`;
                                sendSms(formattedPhone, msg);
                            }
                        }
                    }
                    console.log(`[PROXY] ${auction.title} is in last 10 minutes!`);
                }

                if (now.getTime() >= endMs) {
                    const bids = auction.maxBids ? Object.entries(auction.maxBids) : [];
                    if (bids.length > 0) {
                        const sorted = bids.sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
                        const [winnerId, maxAmount] = sorted[0];
                        const finalPrice = auction.currentBid || auction.reserve || 0;
                        await prisma.auction.update({
                            where: { id: auction.id },
                            data: {
                                status: 'AWAITING_PAYMENT',
                                winnerId: winnerId,
                                finalPrice: finalPrice,
                                paymentDeadline: new Date(now.getTime() + 24 * 60 * 60 * 1000)
                            }
                        });
                        const winnerUser = await prisma.user.findUnique({ where: { id: winnerId } });
                        await prisma.soldItem.create({
                            data: {
                                auctionId: auction.id,
                                sellerId: auction.sellerId,
                                title: auction.title,
                                winnerName: winnerUser?.name || 'Unknown',
                                finalPrice: finalPrice,
                                soldAt: new Date()
                            }
                        });
                        await captureGhostBidders(auction.id);
                        setTimeout(() => generateAuctionDNA(auction.id), 3000);
                        io.to(`auction_${auction.id}`).emit('auctionEndedAwaitingPayment', {
                            winnerId,
                            finalPrice,
                            deadline: new Date(now.getTime() + 24 * 60 * 60 * 1000)
                        });
                        console.log(`[TIMED] Auction ${auction.title} closed. Winner: ${winnerUser?.name || 'Unknown'}`);
                    } else {
                        await prisma.auction.update({
                            where: { id: auction.id },
                            data: { status: 'ENDED' }
                        });
                        io.to(`auction_${auction.id}`).emit('auctionEnded', {
                            message: 'No bids placed, auction ended'
                        });
                        console.log(`[TIMED] Auction ${auction.title} closed with no bids`);
                    }
                    io.emit('auctionListUpdated');
                }
            }
        } catch (err) {
            console.error('[CRON] Error in TIMED auction cron job:', err.message);
        }
    }, 60000);
}

// ============================================================
// ========== SOCKET.IO HANDLERS ==============================
// ============================================================

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = decoded;
        next();
    } catch (err) {
        return next(new Error('Invalid token'));
    }
});

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (User: ${socket.user?.email || 'Unknown'})`);
    let currentAuctionId = null;

    // ---------- JOIN AUCTION ----------
    socket.on('joinAuction', async (auctionId) => {
        currentAuctionId = auctionId;
        socket.join(`auction_${auctionId}`);
        // Update viewer count
        const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
        if (auction) {
            await prisma.auction.update({
                where: { id: auctionId },
                data: { viewerCount: auction.viewerCount + 1 }
            });
            io.to(`auction_${auctionId}`).emit('viewerCount', { count: auction.viewerCount + 1 });
        }
    });

    // ---------- LEAVE AUCTION ----------
    socket.on('leaveAuction', async () => {
        if (currentAuctionId) {
            socket.leave(`auction_${currentAuctionId}`);
            const auction = await prisma.auction.findUnique({ where: { id: currentAuctionId } });
            if (auction && auction.viewerCount > 0) {
                await prisma.auction.update({
                    where: { id: currentAuctionId },
                    data: { viewerCount: auction.viewerCount - 1 }
                });
                io.to(`auction_${currentAuctionId}`).emit('viewerCount', { count: auction.viewerCount - 1 });
            }
            currentAuctionId = null;
        }
    });

    // ---------- HAND RAISE ----------
    socket.on('handRaise', bidLimiter, async (data) => {
        const { auctionId, amount } = data;
        if (!auctionId || !amount) return;
        const user = await prisma.user.findUnique({ where: { id: socket.user.id } });
        if (!user) return;

        const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
        if (!auction) return;

        // Update auction currentBid and bidder queue
        await prisma.auction.update({
            where: { id: auctionId },
            data: {
                currentBid: parseFloat(amount),
                currentBidderId: socket.user.id,
                bidders: {
                    push: {
                        userId: socket.user.id,
                        name: user.displayName || user.name,
                        amount: parseFloat(amount),
                        kycBadge: getBadge(user.kycLevel)
                    }
                }
            }
        });

        io.to(`auction_${auctionId}`).emit('newBid', {
            bidderName: user.displayName || user.name,
            amount: parseFloat(amount),
            bidderId: socket.user.id,
            kycBadge: getBadge(user.kycLevel)
        });
    });

    // ---------- MANAGER ACK ----------
    socket.on('managerAck', async (data) => {
        const { auctionId, bidderId, amount } = data;
        io.to(`auction_${auctionId}`).emit('bidAccepted', {
            bidderId,
            amount,
            message: 'Bid accepted'
        });
    });

    // ---------- MANAGER REJECT ----------
    socket.on('managerReject', async (data) => {
        const { auctionId, bidderId, amount } = data;
        io.to(`auction_${auctionId}`).emit('bidRejected', {
            bidderId,
            amount,
            message: 'Bid rejected'
        });
    });

    // ---------- SOLD ----------
    socket.on('soldLot', async (data) => {
        const { auctionId, winnerId, finalPrice } = data;
        try {
            await prisma.auction.update({
                where: { id: auctionId },
                data: {
                    status: 'PAID',
                    winnerId,
                    finalPrice: parseFloat(finalPrice),
                    paymentDeadline: new Date()
                }
            });
            await prisma.soldItem.create({
                data: {
                    auctionId,
                    sellerId: socket.user.id, // assume socket user is seller
                    title: 'Lot sold',
                    winnerName: winnerId,
                    finalPrice: parseFloat(finalPrice),
                    soldAt: new Date()
                }
            });
            io.to(`auction_${auctionId}`).emit('lotSold', { winnerId, finalPrice });
        } catch (err) {
            console.error(err);
        }
    });

    // ---------- BAN, REPORT ----------
    socket.on('banUserForNonPayment', async (data) => {
        const { userId, auctionId, evidence } = data;
        await prisma.user.update({
            where: { id: userId },
            data: { status: 'BANNED_FRAUD' }
        });
        io.emit('userBanned', { userId, name: 'User', reason: 'Non-payment' });
    });

    // ---------- WEBRTC SIGNALING ----------
    socket.on('video-offer', (data) => {
        socket.to(`auction_${data.auctionId}`).emit('video-offer', data);
    });
    socket.on('video-answer', (data) => {
        socket.to(`auction_${data.auctionId}`).emit('video-answer', data);
    });
    socket.on('video-candidate', (data) => {
        socket.to(`auction_${data.auctionId}`).emit('video-candidate', data);
    });
    socket.on('streamStarted', (data) => {
        socket.to(`auction_${data.auctionId}`).emit('streamStarted', data);
    });
    socket.on('video-ended', (data) => {
        socket.to(`auction_${data.auctionId}`).emit('video-ended', data);
    });

    // ---------- DISCONNECT ----------
    socket.on('disconnect', async () => {
        console.log(`Socket disconnected: ${socket.id}`);
        if (currentAuctionId) {
            socket.leave(`auction_${currentAuctionId}`);
            const auction = await prisma.auction.findUnique({ where: { id: currentAuctionId } });
            if (auction && auction.viewerCount > 0) {
                await prisma.auction.update({
                    where: { id: currentAuctionId },
                    data: { viewerCount: auction.viewerCount - 1 }
                });
                io.to(`auction_${currentAuctionId}`).emit('viewerCount', { count: auction.viewerCount - 1 });
            }
            currentAuctionId = null;
        }
    });
});

// ============================================================
// ========== ADMIN REPORTS ====================================
// ============================================================

app.get('/api/admin/reports', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    try {
        const reports = await prisma.report.findMany({
            where: { status: 'PENDING' },
            include: { reporter: true, auction: true }
        });
        res.json(reports);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ========== SELLER ANALYTICS ================================
// ============================================================

app.get('/api/seller/analytics/:auctionId', authenticate, async (req, res) => {
    try {
        const auction = await prisma.auction.findUnique({ where: { id: req.params.auctionId } });
        if (!auction || auction.sellerId !== req.user.id) return res.status(404).json({ error: 'Auction not found' });
        // Basic analytics
        res.json({
            auctionId: auction.id,
            title: auction.title,
            views: auction.viewerCount,
            bids: auction.bidders?.length || 0,
            currentBid: auction.currentBid,
            status: auction.status
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ========== RATINGS =========================================
// ============================================================

app.post('/api/rate-seller', authenticate, async (req, res) => {
    const { sellerId, auctionId, stars, comment, tags } = req.body;
    try {
        const rating = await prisma.rating.create({
            data: {
                buyerId: req.user.id,
                sellerId,
                auctionId,
                stars: parseInt(stars) || 5,
                comment: comment || null,
                tags: tags || []
            }
        });
        // Update seller rating aggregate (optional)
        res.json({ message: 'Rating submitted', rating });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/seller/ratings/:sellerId', async (req, res) => {
    try {
        const ratings = await prisma.rating.findMany({
            where: { sellerId: req.params.sellerId },
            include: { buyer: { select: { name: true, displayName: true } } }
        });
        res.json(ratings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ========== GHOST BIDDER RECOVERY ===========================
// ============================================================

async function captureGhostBidders(auctionId) {
    const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
    if (!auction || !auction.bidders) return;
    const finalPrice = auction.finalPrice || auction.currentBid || 0;

    for (const bidder of auction.bidders) {
        // If bidder was within 20% of final price
        if (bidder.amount >= finalPrice * 0.8 && bidder.userId !== auction.winnerId) {
            const user = await prisma.user.findUnique({ where: { id: bidder.userId } });
            if (user) {
                await prisma.ghostLead.create({
                    data: {
                        auctionId,
                        sellerId: auction.sellerId,
                        userId: user.id,
                        name: user.displayName || user.name,
                        phone: user.phone,
                        email: user.email,
                        maxBid: bidder.amount,
                        bidCount: auction.bidders.filter(b => b.userId === user.id).length,
                        category: auction.category,
                        title: auction.title,
                        finalPrice
                    }
                });
            }
        }
    }

    // Trigger email/SMS to seller and ghost bidders
    await sendGhostRecovery(auctionId);
}

async function sendGhostRecovery(auctionId) {
    const auction = await prisma.auction.findUnique({ where: { id: auctionId }, include: { seller: true } });
    if (!auction) return;
    const ghosts = await prisma.ghostLead.findMany({ where: { auctionId } });
    if (!ghosts.length) return;

    // Send email to seller with ghost list
    const seller = auction.seller;
    if (seller?.email) {
        const ghostListHtml = ghosts.map(g => `<li>${g.name} - Max Bid R${g.maxBid.toLocaleString()}</li>`).join('');
        await sendEmail(seller.email, `Ghost Leads for ${auction.title}`, `<p>Here are the bidders who didn't win:</p><ul>${ghostListHtml}</ul>`);
    }

    // Send SMS/email to each ghost
    for (const g of ghosts) {
        if (g.phone) {
            const msg = `You missed out on ${auction.title} (final R${auction.finalPrice?.toLocaleString()}). The seller may have similar items. Contact us!`;
            await sendSms(formatPhone(g.phone), msg);
        }
        if (g.email) {
            await sendEmail(g.email, `Another chance: ${auction.title}`, `Hi ${g.name}, you were a top bidder. The seller might have other deals. Check them out!`);
        }
    }
}

app.get('/api/seller/ghost-leads', authenticate, async (req, res) => {
    try {
        const ghosts = await prisma.ghostLead.findMany({
            where: { sellerId: req.user.id },
            orderBy: { capturedAt: 'desc' }
        });
        res.json(ghosts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ========== AUCTION DNA PDF REPORT ==========================
// ============================================================

async function generateBidHeatmapChart(bidHistory, startTime, endTime) {
    const canvasRenderer = new ChartJSNodeCanvas({ width: 800, height: 300 });
    const config = {
        type: 'bar',
        data: {
            labels: bidHistory.map(b => new Date(b.time).toLocaleTimeString()),
            datasets: [{
                label: 'Bid Amount',
                data: bidHistory.map(b => b.amount),
                backgroundColor: 'rgba(227,6,19,0.6)'
            }]
        },
        options: { scales: { y: { beginAtZero: true } } }
    };
    return await canvasRenderer.renderToBuffer(config);
}

async function generateAuctionDNA(auctionId) {
    try {
        const auction = await prisma.auction.findUnique({ where: { id: auctionId }, include: { seller: true, bids: true } });
        if (!auction) return;

        const doc = new PDFDocument({ margin: 50 });
        const filePath = `./public/auction-dna-${auctionId}.pdf`;
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        doc.fontSize(20).text(`Auction DNA Report: ${auction.title}`, { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Seller: ${auction.seller?.displayName || auction.seller?.name}`);
        doc.text(`Final Price: R${auction.finalPrice?.toLocaleString() || 'N/A'}`);
        doc.text(`Total Bids: ${auction.bids?.length || 0}`);
        doc.moveDown();

        // Add chart
        const bidHistory = (auction.bids || []).map(b => ({ time: b.createdAt, amount: b.amount }));
        const chartBuffer = await generateBidHeatmapChart(bidHistory, auction.startTime, auction.endTime);
        doc.image(chartBuffer, { fit: [700, 300], align: 'center' });

        doc.moveDown();
        doc.text('Top Bidders:');
        const topBidders = [...(auction.bidders || [])].sort((a,b) => b.amount - a.amount).slice(0,5);
        topBidders.forEach((b, i) => doc.text(`${i+1}. ${b.name} - R${b.amount.toLocaleString()}`));

        doc.end();

        stream.on('finish', async () => {
            // Send email to seller with PDF attachment
            if (auction.seller?.email) {
                const attachment = {
                    content: fs.readFileSync(filePath).toString('base64'),
                    filename: `auction-dna-${auctionId}.pdf`,
                    type: 'application/pdf'
                };
                await sendEmail(auction.seller.email, `Auction DNA Report: ${auction.title}`, 'Your report is attached.', [attachment]);
            }
        });
    } catch (err) {
        console.error('Error generating DNA report:', err);
    }
}

app.get('/api/seller/dna/:auctionId', authenticate, async (req, res) => {
    try {
        const auction = await prisma.auction.findUnique({ where: { id: req.params.auctionId } });
        if (!auction || auction.sellerId !== req.user.id) return res.status(404).json({ error: 'Auction not found' });
        const filePath = `./public/auction-dna-${auction.id}.pdf`;
        res.download(filePath, `auction-dna-${auction.id}.pdf`);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ========== MARK AUCTION AS PAID ============================
// ============================================================

app.post('/api/auctions/:id/paid', authenticate, async (req, res) => {
    try {
        const auction = await prisma.auction.findUnique({ where: { id: req.params.id } });
        if (!auction) return res.status(404).json({ error: 'Auction not found' });
        if (auction.winnerId !== req.user.id) return res.status(403).json({ error: 'Only winner can mark as paid' });

        await prisma.auction.update({
            where: { id: auction.id },
            data: { status: 'PAID' }
        });
        res.json({ message: 'Auction marked as paid' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ========== START SERVER ====================================
// ============================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 SunAlgorithms Auction Server running on port ${PORT}`);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});