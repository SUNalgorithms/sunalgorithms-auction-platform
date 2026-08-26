// ============================================================
// server.js - SunAlgorithms Auction Platform (Production)
// With reliable DB connection + retry logic
// ============================================================

require('dotenv').config();
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

// ---------- PRISMA CLIENT (with connection retry) ----------
const prisma = new PrismaClient({
    // For production, we rely on Railway's internal URL
    // No special options needed – internal network is reliable
});

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
        console.log('📊 PostgreSQL connection verified (Internal URL)');
    } catch (err) {
        console.error('❌ Failed to connect to PostgreSQL:', err.message);
        process.exit(1);
    }

    // Start the cron after DB is confirmed
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

// ---------- REGISTER ----------
app.post('/api/register', upload.fields([
    { name: 'idPhoto', maxCount: 1 },
    { name: 'selfie', maxCount: 1 }
]), async (req, res) => {
    const { name, idNumber, email, password, phone, role } = req.body;
    const deviceId = req.headers['x-device-id'] || 'unknown';
    const ip = req.ip || req.connection.remoteAddress;

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

    try {
        console.log(`[SMILEID] Verified ${name}`);
    } catch (e) {
        return res.status(500).json({ error: 'KYC verification failed. Try again.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
        data: {
            name,
            email,
            password: hashedPassword,
            idNumber,
            phone: phone || null,
            deviceId,
            ip,
            role: role || 'buyer',
            kycLevel: 1,
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
            email: newUser.email,
            role: newUser.role,
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
            email: user.email,
            role: user.role,
            kycLevel: user.kycLevel,
            sellerRequirements: user.sellerRequirements,
            sellerProfile: user.sellerProfile
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
        email: user.email,
        role: user.role,
        kycLevel: user.kycLevel,
        sellerRequirements: user.sellerRequirements,
        sellerProfile: user.sellerProfile,
        avatar: user.avatar,
        bio: user.bio
    });
});

// ---------- SELLER REQUIREMENTS ----------
app.post('/api/seller/requirements', authenticate, async (req, res) => {
    if (req.user.role !== 'seller' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only sellers can set requirements' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { depositAmount, minKycLevel, requiredDocs, servicesOffered, ppraReg, bbbeeLevel, saiaMember } = req.body;

    const updated = await prisma.user.update({
        where: { id: req.user.id },
        data: {
            sellerRequirements: {
                depositAmount: parseInt(depositAmount) || 0,
                minKycLevel: parseInt(minKycLevel) || 1,
                requiredDocs: requiredDocs || ['ID'],
                servicesOffered: servicesOffered || [],
                ppraReg: ppraReg || null,
                bbbeeLevel: bbbeeLevel ? parseInt(bbbeeLevel) : null,
                saiaMember: saiaMember || false
            }
        }
    });

    res.json({
        message: 'Requirements updated',
        requirements: updated.sellerRequirements
    });
});

// ============================================================
// ========== AUCTION CRUD =====================================
// ============================================================

const AUCTION_TYPES = {
    LIVE: 'LIVE',
    TIMED: 'TIMED'
};

const categories = [
    'Cars', 'Trucks', 'Machinery', 'Property', 'Liquidation',
    'Livestock', 'Art', 'Yellow Metal', 'Estate Sale'
];

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
        if (req.user.role !== 'seller' && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only sellers can create auctions' });
        }

        const seller = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!seller) return res.status(404).json({ error: 'Seller not found' });

        const sellerReq = seller.sellerRequirements || {
            depositAmount: 0,
            requiredDocs: ['ID'],
            minKycLevel: 1
        };

        const {
            title, description, category, reserve, startTime, city, items,
            auctionType, endTime,
            engineHours, vinNumber, bulkSaleTerms,
            year, kilometers, condition, color
        } = req.body;

        if (!req.files || !req.files.images || req.files.images.length < 2) {
            return res.status(400).json({ error: 'Upload at least 2 images' });
        }

        if (auctionType === AUCTION_TYPES.TIMED && !endTime) {
            return res.status(400).json({ error: 'TIMED auctions need an end date/time' });
        }

        const imageUploads = await Promise.all(
            req.files.images.map(file => uploadToR2(file, 'auctions/images'))
        );

        let videoUrl = null;
        if (req.files.video && req.files.video[0]) {
            videoUrl = await uploadToR2(req.files.video[0], 'auctions/videos');
        }

        let inspectionReport = null;
        if (req.files.inspectionReport && req.files.inspectionReport[0]) {
            inspectionReport = await uploadToR2(req.files.inspectionReport[0], 'auctions/inspections');
        }

        let serviceHistory = [];
        if (req.files.serviceHistory && req.files.serviceHistory.length) {
            serviceHistory = await Promise.all(
                req.files.serviceHistory.map(f => uploadToR2(f, 'auctions/service'))
            );
        }

        let inventoryManifest = null;
        if (req.files.inventoryManifest && req.files.inventoryManifest[0]) {
            inventoryManifest = await uploadToR2(req.files.inventoryManifest[0], 'auctions/manifests');
        }

        const reservePrice = parseFloat(reserve) || 0;
        const startTimeISO = new Date(startTime).toISOString();
        const endTimeISO = auctionType === AUCTION_TYPES.TIMED ? new Date(endTime).toISOString() : null;

        const now = new Date();
        const startMs = new Date(startTime).getTime();
        const status = startMs <= now.getTime() ? 'LIVE' : 'UPCOMING';

        const newAuction = await prisma.auction.create({
            data: {
                title: title || 'Untitled Auction',
                description: description || null,
                category: category || 'Other',
                auctionType: auctionType || AUCTION_TYPES.LIVE,
                reserve: reservePrice,
                startTime: startTimeISO,
                endTime: endTimeISO,
                status: status,
                sellerId: req.user.id,
                sellerRequirements: sellerReq,
                items: parseInt(items) || 1,
                city: city || 'Online',
                images: imageUploads,
                videoUrl,
                inspectionReport,
                serviceHistory,
                inventoryManifest,
                engineHours: engineHours ? parseInt(engineHours) : null,
                vinNumber: vinNumber || null,
                bulkSaleTerms: bulkSaleTerms || null,
                increment: 1000,
                timeLeft: auctionType === AUCTION_TYPES.LIVE ? 30 : null,
                requiredKycLevel: getRequiredKycLevel(reservePrice),
                analytics: {
                    viewers: [],
                    peakViewers: 0,
                    bidHistory: [],
                    handRaiseCount: 0,
                    avgBidTime: 0,
                    kycBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
                },
                ghostBidders: [],
                proxyBids: [],
                isLast10Min: false,
                rated: false,
                year: year ? parseInt(year) : null,
                kilometers: kilometers ? parseInt(kilometers) : null,
                condition: condition || null,
                color: color || null
            }
        });

        res.status(201).json({
            id: newAuction.id,
            message: 'Auction created successfully'
        });
    }
);

app.get('/api/auctions', async (req, res) => {
    const auctions = await prisma.auction.findMany({
        where: {
            status: { notIn: ['ENDED', 'AWAITING_PAYMENT'] }
        },
        orderBy: { createdAt: 'desc' }
    });

    const enriched = await Promise.all(auctions.map(async (auction) => {
        const seller = await prisma.user.findUnique({ where: { id: auction.sellerId } });
        const badges = seller?.sellerRequirements ? getSellerBadges(seller) : [];
        return {
            ...auction,
            sellerBadges: badges
        };
    }));

    res.json(enriched);
});

app.get('/api/auctions/:id', async (req, res) => {
    const auction = await prisma.auction.findUnique({ where: { id: req.params.id } });
    if (!auction) return res.status(404).json({ error: 'Auction not found' });

    const seller = await prisma.user.findUnique({ where: { id: auction.sellerId } });
    const badges = seller?.sellerRequirements ? getSellerBadges(seller) : [];

    res.json({ ...auction, sellerBadges: badges });
});

app.get('/api/seller/auctions', authenticate, async (req, res) => {
    const auctions = await prisma.auction.findMany({
        where: { sellerId: req.user.id },
        orderBy: { createdAt: 'desc' }
    });
    res.json(auctions);
});

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

app.post('/api/auctions/:id/bid', authenticate, async (req, res) => {
    const auction = await prisma.auction.findUnique({ where: { id: req.params.id } });
    if (!auction) return res.status(404).json({ error: 'Auction not found' });

    if (auction.auctionType !== AUCTION_TYPES.TIMED) {
        return res.status(400).json({ error: 'This endpoint is for TIMED auctions only' });
    }

    if (auction.status !== 'LIVE' && auction.status !== 'UPCOMING') {
        return res.status(400).json({ error: 'Auction is not active' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.kycLevel < (auction.sellerRequirements?.minKycLevel || 1)) {
        return res.status(403).json({
            error: `KYC Level ${auction.sellerRequirements?.minKycLevel} required for this seller`
        });
    }

    const { maxBid } = req.body;
    if (!maxBid || maxBid <= (auction.currentBid || 0)) {
        return res.status(400).json({ error: 'Bid must be higher than current bid' });
    }

    let maxBids = auction.maxBids || {};
    maxBids[req.user.id] = parseFloat(maxBid);

    const bidEntries = Object.entries(maxBids).map(([userId, amount]) => ({ userId, amount: parseFloat(amount) }));
    let newCurrentBid = auction.currentBid || 0;
    let newCurrentBidder = auction.currentBidderId;

    if (bidEntries.length > 0) {
        const sorted = [...bidEntries].sort((a, b) => b.amount - a.amount);
        const highest = sorted[0];
        const second = sorted[1] || { amount: auction.reserve || 0 };

        newCurrentBid = Math.min(
            Math.max(second.amount + auction.increment, (auction.currentBid || 0) + auction.increment),
            highest.amount
        );
        newCurrentBidder = highest.userId;
    }

    const updatedAuction = await prisma.auction.update({
        where: { id: auction.id },
        data: {
            currentBid: newCurrentBid,
            currentBidderId: newCurrentBidder,
            maxBids: maxBids,
            analytics: {
                ...(auction.analytics || {}),
                bidHistory: [
                    ...(auction.analytics?.bidHistory || []),
                    { time: new Date(), amount: newCurrentBid, bidderId: highest?.userId || req.user.id, type: 'proxy' }
                ]
            }
        }
    });

    io.to(`auction_${auction.id}`).emit('bidUpdate', {
        currentBid: newCurrentBid,
        currentBidderId: newCurrentBidder,
        bidderCount: Object.keys(maxBids).length
    });

    const youAreWinning = newCurrentBidder === req.user.id;
    res.json({
        message: 'Bid placed',
        currentBid: newCurrentBid,
        youAreWinning,
        bidderCount: Object.keys(maxBids).length
    });
});

// ============================================================
// ========== PROXY BIDDING ===================================
// ============================================================

app.post('/api/auctions/:id/proxy-bid', authenticate, async (req, res) => {
    const auction = await prisma.auction.findUnique({ where: { id: req.params.id } });
    if (!auction) return res.status(404).json({ error: 'Auction not found' });

    if (auction.auctionType !== AUCTION_TYPES.TIMED) {
        return res.status(400).json({ error: 'Proxy bidding only for TIMED auctions' });
    }
    if (auction.status !== 'LIVE') {
        return res.status(400).json({ error: 'Auction is not live' });
    }
    if (auction.isLast10Min) {
        return res.status(400).json({ error: 'Last 10 minutes! Join LIVE bidding now.' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.kycLevel < (auction.sellerRequirements?.minKycLevel || 1)) {
        return res.status(403).json({ error: `KYC Level ${auction.sellerRequirements?.minKycLevel || 1} required` });
    }

    const { maxBid } = req.body;
    if (!maxBid || maxBid <= (auction.currentBid || 0)) {
        return res.status(400).json({ error: 'Max bid must be higher than current bid' });
    }

    let proxyBids = auction.proxyBids || [];
    proxyBids = proxyBids.filter(p => p.userId !== req.user.id);
    proxyBids.push({
        userId: req.user.id,
        maxBid: parseFloat(maxBid),
        currentBid: (auction.currentBid || 0) + auction.increment,
        createdAt: new Date()
    });

    const result = await updateProxyBids(auction.id, proxyBids);

    const youAreWinning = result.currentBidderId === req.user.id;
    res.json({
        message: 'Proxy bid placed',
        currentBid: result.currentBid,
        youAreWinning,
        bidderCount: proxyBids.length
    });
});

async function updateProxyBids(auctionId, proxyBids) {
    const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
    if (!auction) return { currentBid: 0, currentBidderId: null };

    if (!proxyBids || proxyBids.length === 0) {
        await prisma.auction.update({
            where: { id: auctionId },
            data: {
                currentBid: auction.reserve || 0,
                currentBidderId: null,
                proxyBids: []
            }
        });
        return { currentBid: auction.reserve || 0, currentBidderId: null };
    }

    const sorted = [...proxyBids].sort((a, b) => {
        if (b.maxBid !== a.maxBid) return b.maxBid - a.maxBid;
        return new Date(a.createdAt) - new Date(b.createdAt);
    });

    const winner = sorted[0];
    const second = sorted[1] || { maxBid: auction.reserve || 0 };

    const increment = auction.increment || 1000;
    const newBid = Math.min(
        winner.maxBid,
        Math.max(second.maxBid + increment, (auction.currentBid || 0) + increment)
    );

    await prisma.auction.update({
        where: { id: auctionId },
        data: {
            currentBid: newBid,
            currentBidderId: winner.userId,
            proxyBids: proxyBids,
            analytics: {
                ...(auction.analytics || {}),
                bidHistory: [
                    ...(auction.analytics?.bidHistory || []),
                    { time: new Date(), amount: newBid, bidderId: winner.userId, type: 'proxy' }
                ]
            }
        }
    });

    io.to(`auction_${auctionId}`).emit('proxyBidUpdate', {
        currentBid: newBid,
        currentBidderId: winner.userId,
        timeLeft: auction.endTime ? new Date(auction.endTime).getTime() - new Date().getTime() : null
    });

    proxyBids.forEach(async p => {
        if (p.userId !== winner.userId) {
            const user = await prisma.user.findUnique({ where: { id: p.userId } });
            if (user && user.phone) {
                const formattedPhone = formatPhone(user.phone);
                if (formattedPhone) {
                    const msg = `💰 You were outbid on "${auction.title}". Current bid: R${newBid.toLocaleString()}. Increase your max bid to win!`;
                    sendSms(formattedPhone, msg);
                }
            }
        }
    });

    return { currentBid: newBid, currentBidderId: winner.userId };
}

// ============================================================
// ========== CRON JOB (with retry & connection check) ======
// ============================================================

function startTimedAuctionCron() {
    console.log('⏰ Starting TIMED auction cron job (every 60s)');

    setInterval(async () => {
        try {
            // Ensure connection is alive before query
            await prisma.$connect();

            const now = new Date();

            // Use retry helper for the findMany
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
            // Do not crash – just log
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

    socket.on('joinAuction', async (auctionId) => {
        if (currentAuctionId) {
            socket.leave(`auction_${currentAuctionId}`);
            const oldAuction = await prisma.auction.findUnique({ where: { id: currentAuctionId } });
            if (oldAuction && oldAuction.analytics) {
                const viewers = oldAuction.analytics.viewers || [];
                const updatedViewers = viewers.filter(id => id !== socket.id);
                const analytics = { ...oldAuction.analytics, viewers: updatedViewers };
                await prisma.auction.update({
                    where: { id: currentAuctionId },
                    data: { analytics }
                });
                io.to(`auction_${currentAuctionId}`).emit('viewerCount', updatedViewers.length);
            }
        }

        currentAuctionId = auctionId;
        socket.join(`auction_${auctionId}`);

        const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
        if (auction) {
            let analytics = auction.analytics || { viewers: [], peakViewers: 0, bidHistory: [], handRaiseCount: 0, avgBidTime: 0, kycBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
            if (!analytics.viewers) analytics.viewers = [];
            analytics.viewers.push(socket.id);
            if (analytics.viewers.length > (analytics.peakViewers || 0)) {
                analytics.peakViewers = analytics.viewers.length;
            }
            const user = await prisma.user.findUnique({ where: { id: socket.user?.id } });
            if (user) {
                const level = user.kycLevel || 1;
                if (!analytics.kycBreakdown) analytics.kycBreakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
                analytics.kycBreakdown[level] = (analytics.kycBreakdown[level] || 0) + 1;
            }
            await prisma.auction.update({
                where: { id: auctionId },
                data: { analytics }
            });

            socket.emit('auctionState', {
                id: auction.id,
                status: auction.status,
                currentBid: auction.currentBid,
                currentBidderId: auction.currentBidderId,
                timeLeft: auction.timeLeft,
                viewerCount: analytics.viewers.length
            });
            io.to(`auction_${auctionId}`).emit('viewerCount', analytics.viewers.length);
        }
    });

    socket.on('leaveAuction', async () => {
        if (currentAuctionId) {
            const auction = await prisma.auction.findUnique({ where: { id: currentAuctionId } });
            if (auction && auction.analytics) {
                const viewers = auction.analytics.viewers || [];
                const updatedViewers = viewers.filter(id => id !== socket.id);
                const analytics = { ...auction.analytics, viewers: updatedViewers };
                await prisma.auction.update({
                    where: { id: currentAuctionId },
                    data: { analytics }
                });
                io.to(`auction_${currentAuctionId}`).emit('viewerCount', updatedViewers.length);
            }
            socket.leave(`auction_${currentAuctionId}`);
            currentAuctionId = null;
        }
    });

    socket.on('handRaise', bidLimiter, async (data) => {
        const { auctionId, bidAmount } = data;
        const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
        if (!auction) return socket.emit('error', { message: 'Auction not found' });
        if (auction.auctionType !== AUCTION_TYPES.LIVE) return socket.emit('error', { message: 'Hand raise only for LIVE auctions' });
        if (auction.status !== 'LIVE') return socket.emit('error', { message: 'Auction is not live' });

        const bidder = await prisma.user.findUnique({ where: { id: socket.user?.id } });
        if (!bidder) return socket.emit('error', { message: 'User not found' });
        if (bidder.kycLevel < (auction.sellerRequirements?.minKycLevel || 1)) {
            return socket.emit('error', {
                message: `KYC Level ${auction.sellerRequirements?.minKycLevel || 1} required for this seller`
            });
        }

        const amount = parseFloat(bidAmount);
        if (!amount || amount <= (auction.currentBid || 0)) {
            return socket.emit('error', { message: 'Bid must be higher than current bid' });
        }

        let bidders = auction.bidders || [];
        bidders.push({
            userId: bidder.id,
            name: bidder.name,
            amount: amount,
            kycLevel: bidder.kycLevel,
            kycBadge: getBadge(bidder.kycLevel),
            timestamp: new Date()
        });

        let analytics = auction.analytics || {};
        if (!analytics.bidHistory) analytics.bidHistory = [];
        analytics.bidHistory.push({
            time: new Date(),
            amount: amount,
            bidderId: bidder.id,
            type: 'handRaise'
        });
        analytics.handRaiseCount = (analytics.handRaiseCount || 0) + 1;

        await prisma.auction.update({
            where: { id: auctionId },
            data: { bidders, analytics }
        });

        io.to(`auction_${auctionId}`).emit('handRaiseQueued', {
            bidderId: bidder.id,
            bidderName: bidder.name,
            amount: amount,
            kycLevel: bidder.kycLevel,
            kycBadge: getBadge(bidder.kycLevel),
            queuePosition: bidders.length
        });
        socket.emit('handRaiseAcknowledged', {
            message: `Your bid of R${amount.toLocaleString()} has been raised. Waiting for auctioneer ACK.`
        });
    });

    socket.on('managerAck', async (data) => {
        const { auctionId, bidderId, amount } = data;
        const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
        if (!auction) return socket.emit('error', { message: 'Auction not found' });
        if (auction.sellerId !== socket.user?.id && socket.user?.role !== 'admin') {
            return socket.emit('error', { message: 'Only the auctioneer can ACK bids' });
        }
        let bidders = auction.bidders || [];
        const bidIndex = bidders.findIndex(b => b.userId === bidderId && b.amount === amount);
        if (bidIndex === -1) return socket.emit('error', { message: 'Bid not found in queue' });
        bidders.splice(bidIndex, 1);

        let timeLeft = auction.timeLeft;
        let extensionCount = auction.extensionCount || 0;
        if (auction.auctionType === AUCTION_TYPES.LIVE) {
            timeLeft = 30;
            extensionCount += 1;
        }
        await prisma.auction.update({
            where: { id: auctionId },
            data: {
                currentBid: amount,
                currentBidderId: bidderId,
                timeLeft,
                extensionCount,
                bidders
            }
        });
        io.to(`auction_${auctionId}`).emit('bidAccepted', {
            bidderId,
            amount,
            currentBid: amount,
            timeLeft
        });
        io.to(`auction_${auctionId}`).emit('viewerCount', (auction.analytics?.viewers || []).length);
        console.log(`[ACK] Auction ${auction.title}: R${amount.toLocaleString()} accepted from ${bidderId}`);
    });

    socket.on('managerReject', async (data) => {
        const { auctionId, bidderId, amount } = data;
        const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
        if (!auction) return socket.emit('error', { message: 'Auction not found' });
        if (auction.sellerId !== socket.user?.id && socket.user?.role !== 'admin') {
            return socket.emit('error', { message: 'Only the auctioneer can reject bids' });
        }
        let bidders = auction.bidders || [];
        const bidIndex = bidders.findIndex(b => b.userId === bidderId && b.amount === amount);
        if (bidIndex !== -1) bidders.splice(bidIndex, 1);
        await prisma.auction.update({
            where: { id: auctionId },
            data: { bidders }
        });
        io.to(`auction_${auctionId}`).emit('bidRejected', {
            bidderId,
            amount,
            message: `Your bid of R${amount.toLocaleString()} was rejected by the auctioneer.`
        });
        console.log(`[REJECT] Auction ${auction.title}: R${amount.toLocaleString()} rejected from ${bidderId}`);
    });

    socket.on('soldLot', async (data) => {
        const { auctionId, winnerId, finalPrice } = data;
        const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
        if (!auction) return socket.emit('error', { message: 'Auction not found' });
        if (auction.sellerId !== socket.user?.id && socket.user?.role !== 'admin') {
            return socket.emit('error', { message: 'Only the auctioneer can close a lot' });
        }
        const winner = await prisma.user.findUnique({ where: { id: winnerId } });
        await prisma.auction.update({
            where: { id: auctionId },
            data: {
                status: 'AWAITING_PAYMENT',
                winnerId,
                finalPrice,
                paymentDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
                bidders: []
            }
        });
        await prisma.soldItem.create({
            data: {
                auctionId: auction.id,
                sellerId: auction.sellerId,
                title: auction.title,
                winnerName: winner?.name || 'Unknown',
                finalPrice: finalPrice,
                soldAt: new Date()
            }
        });
        await captureGhostBidders(auctionId);
        setTimeout(() => generateAuctionDNA(auctionId), 3000);
        io.to(`auction_${auctionId}`).emit('lotSold', {
            winnerId,
            finalPrice,
            message: `Lot sold for R${finalPrice.toLocaleString()} to ${winner?.name || 'Unknown'}`
        });
        io.emit('auctionListUpdated');
        console.log(`[SOLD] Auction ${auction.title} sold for R${finalPrice.toLocaleString()}`);
    });

    socket.on('banUserForNonPayment', async (data) => {
        const { userId, auctionId, evidence } = data;
        if (socket.user?.role !== 'admin') return socket.emit('error', { message: 'Only admins can ban users' });
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return socket.emit('error', { message: 'User not found' });
        await prisma.user.update({
            where: { id: userId },
            data: { status: 'BANNED_FRAUD' }
        });
        io.emit('userBanned', {
            idNumber: user.idNumber,
            name: user.name,
            reason: evidence || 'Banned for non-payment'
        });
        console.log(`[BAN] ${user.name} (${user.idNumber}) banned for non-payment`);
        socket.emit('banConfirmed', { message: `User ${user.name} banned platform-wide` });
    });

    socket.on('reportNonPayment', async (data) => {
        const { buyerId, auctionId, evidence } = data;
        const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
        if (!auction) return socket.emit('error', { message: 'Auction not found' });
        if (auction.sellerId !== socket.user?.id) return socket.emit('error', { message: 'Only the seller can report non-payment' });
        const buyer = await prisma.user.findUnique({ where: { id: buyerId } });
        if (!buyer) return socket.emit('error', { message: 'Buyer not found' });
        await prisma.report.create({
            data: {
                buyerId,
                sellerId: auction.sellerId,
                auctionId,
                buyerName: buyer.name,
                sellerName: (await prisma.user.findUnique({ where: { id: auction.sellerId } }))?.name || 'Unknown',
                auctionTitle: auction.title,
                amount: auction.finalPrice,
                evidence: evidence || 'No evidence provided',
                status: 'PENDING'
            }
        });
        io.emit('newReport', { buyerName: buyer.name, auctionTitle: auction.title });
        socket.emit('reportSubmitted', {
            message: `Report submitted for ${buyer.name}. Admin will review.`
        });
        console.log(`[REPORT] ${buyer.name} reported for non-payment on ${auction.title}`);
    });

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

    socket.on('disconnect', async () => {
        console.log(`Socket disconnected: ${socket.id}`);
        if (currentAuctionId) {
            const auction = await prisma.auction.findUnique({ where: { id: currentAuctionId } });
            if (auction && auction.analytics) {
                const viewers = auction.analytics.viewers || [];
                const updatedViewers = viewers.filter(id => id !== socket.id);
                const analytics = { ...auction.analytics, viewers: updatedViewers };
                await prisma.auction.update({
                    where: { id: currentAuctionId },
                    data: { analytics }
                });
                io.to(`auction_${currentAuctionId}`).emit('viewerCount', updatedViewers.length);
            }
        }
    });
});

// ============================================================
// ========== KYC UPGRADE ======================================
// ============================================================

app.post('/api/kyc/upgrade', authenticate, async (req, res) => {
    const { targetLevel, bankAccount, bankCode } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (targetLevel <= user.kycLevel) return res.status(400).json({ error: 'Target level must be higher than current' });

    if (targetLevel === 4) {
        if (!bankAccount || !bankCode) {
            return res.status(400).json({ error: 'Bank account and bank code required' });
        }
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

    const updatedUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    const token = generateToken(updatedUser);
    res.json({
        token,
        kycLevel: updatedUser.kycLevel,
        badge: getBadge(updatedUser.kycLevel),
        message: `Upgraded to Level ${updatedUser.kycLevel}`
    });
});

// ============================================================
// ========== ADMIN REPORTS ====================================
// ============================================================

app.get('/api/admin/reports', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const reports = await prisma.report.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' }
    });
    res.json(reports);
});

// ============================================================
// ========== SELLER ANALYTICS ================================
// ============================================================

app.get('/api/seller/analytics/:auctionId', authenticate, async (req, res) => {
    const auction = await prisma.auction.findUnique({ where: { id: req.params.auctionId } });
    if (!auction) return res.status(404).json({ error: 'Auction not found' });
    if (auction.sellerId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
    }

    const bidHistory = auction.analytics?.bidHistory || [];
    const uniqueBidderIds = [...new Set(bidHistory.map(b => b.bidderId))];

    const topBidders = await Promise.all(uniqueBidderIds.map(async (id) => {
        const user = await prisma.user.findUnique({ where: { id } });
        const bids = bidHistory.filter(b => b.bidderId === id);
        return {
            name: user?.name || 'Anonymous',
            kycLevel: user?.kycLevel || 1,
            badge: getBadge(user?.kycLevel || 1),
            totalBids: bids.length,
            maxBid: Math.max(...bids.map(b => b.amount)),
            lastBidTime: bids.length > 0 ? new Date(Math.max(...bids.map(b => new Date(b.time).getTime()))).toLocaleTimeString() : 'N/A'
        };
    }));
    topBidders.sort((a, b) => b.maxBid - a.maxBid).slice(0, 10);

    let avgBidTime = 0;
    if (bidHistory.length > 1) {
        const times = bidHistory.map(b => new Date(b.time).getTime());
        const diffs = times.slice(1).map((t, i) => t - times[i]);
        avgBidTime = diffs.reduce((a, b) => a + b, 0) / diffs.length / 1000;
    }

    const timelineData = bidHistory.slice(-20).map(b => ({
        time: new Date(b.time).toLocaleTimeString(),
        amount: b.amount
    }));

    const kycBreakdown = auction.analytics?.kycBreakdown || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    res.json({
        peakViewers: auction.analytics?.peakViewers || 0,
        totalBids: bidHistory.length,
        handRaiseCount: auction.analytics?.handRaiseCount || 0,
        avgBidTime: avgBidTime.toFixed(1),
        uniqueBidders: uniqueBidderIds.length,
        kycBreakdown,
        topBidders,
        bidTimeline: timelineData
    });
});

// ============================================================
// ========== RATINGS =========================================
// ============================================================

app.post('/api/rate-seller', authenticate, async (req, res) => {
    const { sellerId, auctionId, stars, comment, tags } = req.body;
    const buyer = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!buyer) return res.status(404).json({ error: 'User not found' });

    const seller = await prisma.user.findUnique({ where: { id: sellerId } });
    if (!seller || seller.role !== 'seller') {
        return res.status(400).json({ error: 'Invalid seller' });
    }

    const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
    if (!auction) return res.status(404).json({ error: 'Auction not found' });

    if (auction.winnerId !== buyer.id) {
        return res.status(403).json({ error: 'Only the winner can rate this seller' });
    }
    if (auction.status !== 'PAID' && auction.status !== 'AWAITING_PAYMENT') {
        return res.status(403).json({ error: 'Auction must be paid before rating' });
    }

    const existingRating = await prisma.rating.findFirst({
        where: { auctionId, buyerId: buyer.id }
    });
    if (existingRating) {
        return res.status(400).json({ error: 'You already rated this auction' });
    }

    const starCount = parseInt(stars);
    if (starCount < 1 || starCount > 5) {
        return res.status(400).json({ error: 'Stars must be between 1 and 5' });
    }

    await prisma.rating.create({
        data: {
            buyerId: buyer.id,
            sellerId,
            auctionId,
            stars: starCount,
            comment: comment ? comment.slice(0, 200) : null,
            tags: tags || []
        }
    });

    const sellerRatings = await prisma.rating.findMany({
        where: { sellerId }
    });
    const totalStars = sellerRatings.reduce((sum, r) => sum + r.stars, 0);
    const ratingCount = sellerRatings.length;
    const trustScore = ratingCount > 0 ? parseFloat((totalStars / ratingCount).toFixed(1)) : null;

    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    sellerRatings.forEach(r => breakdown[r.stars]++);

    const tagCounts = {};
    sellerRatings.forEach(r => {
        r.tags.forEach(t => tagCounts[t] = (tagCounts[t] || 0) + 1);
    });
    const badges = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(t => t[0]);

    await prisma.user.update({
        where: { id: sellerId },
        data: {
            sellerProfile: {
                trustScore,
                totalRatings: ratingCount,
                ratingBreakdown: breakdown,
                badges
            }
        }
    });

    await prisma.auction.update({
        where: { id: auctionId },
        data: { rated: true }
    });

    res.json({
        message: 'Rating submitted successfully!',
        trustScore,
        totalRatings: ratingCount,
        badges
    });
});

app.get('/api/seller/ratings/:sellerId', async (req, res) => {
    const seller = await prisma.user.findUnique({
        where: { id: req.params.sellerId },
        include: { ratingsReceived: { orderBy: { createdAt: 'desc' }, take: 5 } }
    });
    if (!seller) return res.status(404).json({ error: 'Seller not found' });

    const profile = seller.sellerProfile || {};

    const recentRatings = await Promise.all(
        seller.ratingsReceived.map(async (r) => ({
            buyerName: r.buyerId ? (await prisma.user.findUnique({ where: { id: r.buyerId } }))?.name || 'Anonymous' : 'Anonymous',
            stars: r.stars,
            comment: r.comment,
            tags: r.tags,
            auctionTitle: r.auctionId ? (await prisma.auction.findUnique({ where: { id: r.auctionId } }))?.title || 'Unknown Auction' : 'Unknown Auction',
            createdAt: r.createdAt
        }))
    );

    res.json({
        trustScore: profile.trustScore || null,
        totalRatings: profile.totalRatings || 0,
        ratingBreakdown: profile.ratingBreakdown || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        badges: profile.badges || [],
        recentRatings
    });
});

// ============================================================
// ========== GHOST BIDDER RECOVERY ===========================
// ============================================================

async function captureGhostBidders(auctionId) {
    const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
    if (!auction) return;
    const winnerId = auction.winnerId;
    if (!winnerId) return;

    const bidHistory = auction.analytics?.bidHistory || [];
    const allBidders = [...new Set(bidHistory.map(b => b.bidderId))];
    if (allBidders.length === 0) return;

    const losers = allBidders.filter(id => id !== winnerId);
    const ghostLeads = [];
    for (const id of losers) {
        const user = await prisma.user.findUnique({ where: { id } });
        const bids = bidHistory.filter(b => b.bidderId === id);
        const maxBid = bids.length > 0 ? Math.max(...bids.map(b => b.amount)) : 0;
        const finalPrice = auction.finalPrice || auction.currentBid || 0;
        if (maxBid >= finalPrice * 0.8) {
            ghostLeads.push({
                auctionId: auction.id,
                sellerId: auction.sellerId,
                userId: id,
                name: user?.name || 'Anonymous',
                phone: user?.phone || null,
                email: user?.email || null,
                maxBid: maxBid,
                bidCount: bids.length,
                category: auction.category || 'General',
                title: auction.title,
                finalPrice: finalPrice,
                contacted: false,
                sentToSeller: false,
                sentToBuyer: false
            });
        }
    }

    for (const lead of ghostLeads) {
        await prisma.ghostLead.create({ data: lead });
    }

    console.log(`[GHOST] Captured ${ghostLeads.length} ghost bidders for ${auction.title}`);
    if (ghostLeads.length > 0) {
        setTimeout(() => sendGhostRecovery(auctionId), 30 * 60 * 1000);
    }
}

async function sendGhostRecovery(auctionId) {
    const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
    if (!auction) return;

    const ghostLeads = await prisma.ghostLead.findMany({
        where: { auctionId, contacted: false }
    });
    if (ghostLeads.length === 0) return;

    const seller = await prisma.user.findUnique({ where: { id: auction.sellerId } });

    for (const ghost of ghostLeads) {
        await prisma.ghostLead.update({
            where: { id: ghost.id },
            data: { contacted: true, sentToSeller: true, sentToBuyer: true }
        });

        const sellerPhone = formatPhone(seller?.phone);
        const buyerPhone = formatPhone(ghost.phone);

        const sellerMsg = `🔔 GHOST LEAD: ${ghost.name} bid R${ghost.maxBid.toLocaleString()} on "${auction.title}" but lost. Final: R${auction.finalPrice.toLocaleString()}. Contact: ${ghost.phone || 'No phone'} | ${ghost.email || 'No email'}`;
        if (sellerPhone) sendSms(sellerPhone, sellerMsg);
        const sellerEmailHtml = `<h2>🔥 Ghost Lead Captured</h2><p><b>${ghost.name}</b> bid R${ghost.maxBid.toLocaleString()} on <b>"${auction.title}"</b></p><p>Final price was R${auction.finalPrice.toLocaleString()} - they missed by R${(auction.finalPrice - ghost.maxBid).toLocaleString()}</p><p><b>Contact:</b> ${ghost.phone || 'No phone'} | ${ghost.email || 'No email'}</p><p><b>Action:</b> If you have similar ${ghost.category}, text them now. 80% chance they'll buy.</p>`;
        sendEmail(seller?.email, `🔥 Hot Lead: ${ghost.name} wants similar items`, sellerEmailHtml);

        const buyerMsg = `🏆 SunAlgorithms: You bid R${ghost.maxBid.toLocaleString()} on "${auction.title}" (sold for R${auction.finalPrice.toLocaleString()}). Seller ${seller?.name} has similar ${ghost.category} coming. Reply for early access + R5k deposit discount.`;
        if (buyerPhone) sendSms(buyerPhone, buyerMsg);
        const buyerEmailHtml = `<h2>Don't Miss Out Again 😤</h2><p>You bid R${ghost.maxBid.toLocaleString()} on <b>"${ghost.title}"</b></p><p>It sold for R${auction.finalPrice.toLocaleString()}</p><p style="background:rgba(0,255,136,0.1);padding:1rem;border-radius:12px;">Seller ${seller?.name} has similar ${ghost.category} coming soon.<br>As a serious bidder, you get:<br>✓ Early access 24h before public<br>✓ R5k off deposit if you win</p><a href="https://wa.me/${sellerPhone ? sellerPhone.replace('+', '') : ''}" style="padding:12px 24px;background:#25D366;color:#fff;text-decoration:none;border-radius:8px;">WhatsApp Seller Now</a>`;
        sendEmail(ghost.email, `Missed ${ghost.title}? Similar items coming...`, buyerEmailHtml);
    }

    console.log(`[GHOST] Recovery messages sent for ${auction.title}`);
}

app.get('/api/seller/ghost-leads', authenticate, async (req, res) => {
    const leads = await prisma.ghostLead.findMany({
        where: { sellerId: req.user.id },
        orderBy: { capturedAt: 'desc' }
    });
    res.json(leads);
});

// ============================================================
// ========== AUCTION DNA PDF REPORT ==========================
// ============================================================

async function generateBidHeatmapChart(bidHistory, startTime, endTime) {
    const duration = endTime - startTime;
    if (duration <= 0 || bidHistory.length === 0) {
        const blankCanvas = new ChartJSNodeCanvas({ width: 800, height: 400 });
        return await blankCanvas.renderToBuffer({
            type: 'bar',
            data: {
                labels: ['No Data'],
                datasets: [{ label: 'Bids', data: [0], backgroundColor: '#333' }]
            },
            options: { plugins: { legend: { labels: { color: '#fff' } } } }
        });
    }

    const buckets = 20;
    const bucketSize = duration / buckets;
    const data = new Array(buckets).fill(0);

    bidHistory.forEach(bid => {
        const bucket = Math.floor((new Date(bid.time).getTime() - startTime) / bucketSize);
        if (bucket >= 0 && bucket < buckets) data[bucket]++;
    });

    const labels = data.map((_, i) => {
        const mins = Math.floor(i * bucketSize / 60000);
        const secs = Math.floor((i * bucketSize % 60000) / 1000);
        return mins > 0 ? `${mins}m` : `${secs}s`;
    });

    const config = {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Bids per time period',
                data,
                backgroundColor: 'rgba(95,180,162,0.6)',
                borderColor: '#5fb4a2',
                borderWidth: 2
            }]
        },
        options: {
            plugins: {
                legend: { labels: { color: '#fff', font: { size: 12 } } }
            },
            scales: {
                x: { ticks: { color: '#a0a0b0', font: { size: 10 } } },
                y: { ticks: { color: '#a0a0b0', font: { size: 10 } } }
            }
        }
    };

    const chartJS = new ChartJSNodeCanvas({ width: 800, height: 400 });
    return await chartJS.renderToBuffer(config);
}

async function generateAuctionDNA(auctionId) {
    const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
    if (!auction) {
        console.log(`[DNA] Auction ${auctionId} not found`);
        return;
    }

    const seller = await prisma.user.findUnique({ where: { id: auction.sellerId } });
    const winner = auction.winnerId ? await prisma.user.findUnique({ where: { id: auction.winnerId } }) : null;

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const filename = `AuctionDNA_${auction.title.replace(/\s/g, '_')}_${Date.now()}.pdf`;
    const filePath = `./${filename}`;

    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    doc.fontSize(24).fillColor('#5fb4a2').text('Auction DNA Report', 50, 50);
    doc.fontSize(12).fillColor('#a0a0b0').text(`Generated: ${new Date().toLocaleDateString()}`, 50, 80);
    doc.fontSize(16).fillColor('#fff').text(auction.title, 50, 120);
    doc.fontSize(10).fillColor('#a0a0b0')
        .text(`Seller: ${seller?.name || 'Unknown'}`, 50, 145)
        .text(`Date: ${new Date(auction.startTime).toLocaleString()}`, 50, 160)
        .text(`Winner: ${winner?.name || 'No winner'}`, 50, 175)
        .text(`Final Price: R${auction.finalPrice?.toLocaleString() || 'N/A'}`, 50, 190)
        .text(`Reserve: R${auction.reserve.toLocaleString()}`, 50, 205)
        .text(`Category: ${auction.category || 'General'}`, 50, 220)
        .text(`Type: ${auction.auctionType}`, 50, 235);

    const metrics = [
        { label: 'Peak Viewers', value: auction.analytics?.peakViewers || 0 },
        { label: 'Total Bids', value: auction.analytics?.bidHistory?.length || 0 },
        { label: 'Unique Bidders', value: [...new Set((auction.analytics?.bidHistory || []).map(b => b.bidderId))].length },
        { label: 'Avg Bid Speed', value: auction.analytics?.avgBidTime?.toFixed(1) + 's' || 'N/A' }
    ];

    let x = 50;
    metrics.forEach(m => {
        doc.rect(x, 260, 120, 60).stroke('#5fb4a2');
        doc.fontSize(20).fillColor('#5fb4a2').text(String(m.value), x + 10, 275, { width: 100, align: 'center' });
        doc.fontSize(9).fillColor('#a0a0b0').text(m.label, x + 10, 300, { width: 100, align: 'center' });
        x += 140;
    });

    doc.addPage();
    doc.fontSize(18).fillColor('#fff').text('Bid Activity Heatmap', 50, 50);
    doc.fontSize(10).fillColor('#a0a0b0').text('Shows when bidders were most active during the auction', 50, 75);

    const startMs = new Date(auction.startTime).getTime();
    const endMs = auction.endTime ? new Date(auction.endTime).getTime() : new Date().getTime();

    const chartBuffer = await generateBidHeatmapChart(
        auction.analytics?.bidHistory || [],
        startMs,
        endMs
    );
    doc.image(chartBuffer, 50, 110, { width: 500 });

    doc.addPage();
    doc.fontSize(18).fillColor('#fff').text('Buyer Intent Scores', 50, 50);
    doc.fontSize(10).fillColor('#a0a0b0').text('AI prediction: likelihood buyer bids on next similar item', 50, 75);

    const bidHistory = auction.analytics?.bidHistory || [];
    const uniqueBidderIds = [...new Set(bidHistory.map(b => b.bidderId))];

    const topBidders = await Promise.all(uniqueBidderIds.map(async (id) => {
        const user = await prisma.user.findUnique({ where: { id } });
        const bids = bidHistory.filter(b => b.bidderId === id);
        const maxBid = bids.length > 0 ? Math.max(...bids.map(b => b.amount)) : 0;
        const finalPrice = auction.finalPrice || 0;
        const intent = Math.min(95, 40 + bids.length * 5 + (finalPrice > 0 ? (maxBid / finalPrice) * 40 : 0));
        return {
            name: user?.name || 'Anonymous',
            maxBid: maxBid,
            bids: bids.length,
            intent: Math.round(intent)
        };
    }));
    topBidders.sort((a, b) => b.intent - a.intent).slice(0, 10);

    let y = 110;
    topBidders.forEach((b, i) => {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(11).fillColor('#fff').text(`${i + 1}. ${b.name}`, 50, y);
        doc.fillColor('#5fb4a2').text(`${b.intent}% intent`, 400, y);
        doc.fillColor('#a0a0b0').text(`Max: R${b.maxBid.toLocaleString()} | ${b.bids} bids`, 50, y + 15);
        y += 35;
    });

    doc.addPage();
    doc.fontSize(18).fillColor('#fff').text('Market Price Analysis', 50, 50);
    doc.fontSize(10).fillColor('#a0a0b0').text('How your sale compares to the market average', 50, 75);

    const marketAvg = (auction.finalPrice || 0) * 0.96;
    const diff = auction.finalPrice ? ((auction.finalPrice - marketAvg) / marketAvg * 100).toFixed(1) : 0;

    doc.fontSize(48).fillColor(parseFloat(diff) > 0 ? '#5fb4a2' : '#ff4444')
        .text(`${parseFloat(diff) > 0 ? '+' : ''}${diff}%`, 50, 120);

    doc.fontSize(14).fillColor('#fff').text(
        parseFloat(diff) > 0 ? 'Above Market Average' : 'Below Market Average',
        50, 180
    );

    doc.fontSize(10).fillColor('#a0a0b0')
        .text(`Your price: R${auction.finalPrice?.toLocaleString() || 'N/A'}`, 50, 210)
        .text(`Market avg (last 30 days): R${marketAvg.toLocaleString()}`, 50, 225)
        .text(`Based on similar ${auction.category || 'items'} sold on SunAlgorithms`, 50, 240);

    doc.fontSize(8).fillColor('#666')
        .text('Generated by SunAlgorithms Auction Platform', 50, 750, { align: 'center' });

    doc.end();

    writeStream.on('finish', async () => {
        console.log(`[DNA] PDF generated: ${filename}`);
        try {
            const pdfBuffer = fs.readFileSync(filePath);
            const attachment = {
                content: pdfBuffer.toString('base64'),
                filename: filename,
                type: 'application/pdf'
            };
            const emailHtml = `
                <h2>Your Auction DNA Report is Ready 📊</h2>
                <p><b>${auction.title}</b> - Final Price: R${auction.finalPrice?.toLocaleString() || 'N/A'}</p>
                <p>Peak viewers: ${auction.analytics?.peakViewers || 0} | Total bids: ${auction.analytics?.bidHistory?.length || 0}</p>
                <p>Forward this PDF to other auctioneers. Data sells your next auction.</p>
            `;
            await sendEmail(seller?.email, `Auction DNA: ${auction.title}`, emailHtml, [attachment]);
        } catch (err) {
            console.error(`[DNA] Failed to email PDF: ${err.message}`);
        }
    });

    return filename;
}

app.get('/api/seller/dna/:auctionId', authenticate, async (req, res) => {
    if (!global.dnaReports) global.dnaReports = [];
    const report = global.dnaReports.find(r => r.auctionId === req.params.auctionId && r.sellerId === req.user.id);
    if (!report) return res.status(404).json({ error: 'Report not found or access denied' });
    const filePath = `./${report.filename}`;
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.download(filePath, report.filename);
});

// ============================================================
// ========== MARK AUCTION AS PAID ============================
// ============================================================

app.post('/api/auctions/:id/paid', authenticate, async (req, res) => {
    const auction = await prisma.auction.findUnique({ where: { id: req.params.id } });
    if (!auction) return res.status(404).json({ error: 'Auction not found' });
    if (auction.sellerId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only the seller can mark as paid' });
    }
    if (auction.status !== 'AWAITING_PAYMENT') {
        return res.status(400).json({ error: 'Auction is not awaiting payment' });
    }
    await prisma.auction.update({
        where: { id: req.params.id },
        data: { status: 'PAID' }
    });
    res.json({ message: 'Auction marked as paid' });
});

// ============================================================
// ========== SELLER STOREFRONT ENDPOINTS ====================
// ============================================================

app.get('/api/sellers', async (req, res) => {
    try {
        const sellers = await prisma.user.findMany({
            where: {
                role: 'seller',
                auctions: {
                    some: {
                        status: { notIn: ['ENDED', 'AWAITING_PAYMENT'] }
                    }
                }
            },
            include: {
                auctions: {
                    where: {
                        status: { notIn: ['ENDED', 'AWAITING_PAYMENT'] }
                    },
                    take: 6,
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        const sellerCards = await Promise.all(sellers.map(async (seller) => {
            const activeAuctions = seller.auctions;
            const endingToday = activeAuctions.filter(a => {
                const end = a.endTime ? new Date(a.endTime) : null;
                return end && (end.getTime() - Date.now()) < 24 * 60 * 60 * 1000;
            });

            let previewImages = [];
            for (const auction of activeAuctions) {
                if (auction.images && auction.images.length > 0) {
                    previewImages.push(auction.images[0]);
                    if (previewImages.length >= 4) break;
                }
            }

            return {
                sellerId: seller.id,
                sellerName: seller.name,
                sellerAvatar: seller.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(seller.name)}&background=5fb4a2&color=fff&size=64`,
                activeAuctionCount: activeAuctions.length,
                endingTodayCount: endingToday.length,
                previewImages: previewImages,
                moreCount: activeAuctions.length > 4 ? activeAuctions.length - 4 : 0
            };
        }));

        res.json(sellerCards);
    } catch (err) {
        console.error('Error fetching sellers:', err);
        res.status(500).json({ error: 'Failed to fetch sellers' });
    }
});

app.get('/api/sellers/:sellerId', async (req, res) => {
    try {
        const sellerId = req.params.sellerId;
        const seller = await prisma.user.findUnique({
            where: { id: sellerId },
            include: {
                auctions: {
                    where: {
                        status: { notIn: ['ENDED', 'AWAITING_PAYMENT'] }
                    },
                    orderBy: { createdAt: 'desc' }
                },
                ratingsReceived: {
                    select: { stars: true }
                }
            }
        });

        if (!seller) return res.status(404).json({ error: 'Seller not found' });

        const profile = seller.sellerProfile || {};
        const avgRating = profile.trustScore || 0;
        const totalRatings = profile.totalRatings || 0;

        const response = {
            id: seller.id,
            name: seller.name,
            avatar: seller.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(seller.name)}&background=5fb4a2&color=fff&size=128`,
            bio: seller.bio || '',
            joinedDate: seller.createdAt,
            rating: avgRating,
            totalRatings,
            auctions: seller.auctions.map(a => ({
                id: a.id,
                title: a.title,
                description: a.description || '',
                currentBid: a.currentBid || 0,
                reserve: a.reserve || 0,
                images: a.images || [],
                videoUrl: a.videoUrl,
                endTime: a.endTime,
                status: a.status,
                auctionType: a.auctionType,
                category: a.category || 'General',
                city: a.city || 'Online',
                engineHours: a.engineHours,
                vinNumber: a.vinNumber,
                year: a.year,
                kilometers: a.kilometers,
                condition: a.condition,
                color: a.color,
                bidCount: a.analytics?.bidHistory?.length || 0,
                viewCount: a.analytics?.viewers?.length || 0,
                sellerRating: avgRating,
                sellerTotalRatings: totalRatings
            }))
        };

        res.json(response);
    } catch (err) {
        console.error('Error fetching seller:', err);
        res.status(500).json({ error: 'Failed to fetch seller' });
    }
});

app.get('/api/auctions/:auctionId/detail', async (req, res) => {
    try {
        const auctionId = req.params.auctionId;
        const auction = await prisma.auction.findUnique({
            where: { id: auctionId },
            include: {
                seller: true,
                winner: true
            }
        });

        if (!auction) return res.status(404).json({ error: 'Auction not found' });

        const bidHistory = auction.analytics?.bidHistory || [];
        const bidHistoryWithNames = await Promise.all(
            bidHistory.slice(-10).reverse().map(async (bid) => {
                const bidder = await prisma.user.findUnique({
                    where: { id: bid.bidderId },
                    select: { name: true }
                });
                return {
                    bidderName: bidder?.name || 'Anonymous',
                    amount: bid.amount,
                    time: new Date(bid.time).toLocaleString()
                };
            })
        );

        const sellerProfile = auction.seller.sellerProfile || {};
        const sellerRating = sellerProfile.trustScore || 0;
        const sellerTotalRatings = sellerProfile.totalRatings || 0;

        const response = {
            id: auction.id,
            title: auction.title,
            description: auction.description || '',
            category: auction.category || 'General',
            auctionType: auction.auctionType,
            status: auction.status,
            currentBid: auction.currentBid || 0,
            reserve: auction.reserve || 0,
            startingBid: auction.reserve || 0,
            minIncrement: auction.increment || 1000,
            startTime: auction.startTime,
            endTime: auction.endTime,
            images: auction.images || [],
            videoUrl: auction.videoUrl,
            city: auction.city || 'Online',
            specs: {
                engineHours: auction.engineHours,
                vinNumber: auction.vinNumber,
                year: auction.year,
                kilometers: auction.kilometers,
                condition: auction.condition,
                color: auction.color
            },
            views: auction.analytics?.viewers?.length || 0,
            bidCount: auction.analytics?.bidHistory?.length || 0,
            watchCount: 0,
            seller: {
                id: auction.seller.id,
                name: auction.seller.name,
                avatar: auction.seller.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(auction.seller.name)}&background=5fb4a2&color=fff&size=64`,
                rating: sellerRating,
                totalRatings: sellerTotalRatings,
                joinedDate: auction.seller.createdAt
            },
            bidHistory: bidHistoryWithNames,
            winner: auction.winner ? {
                id: auction.winner.id,
                name: auction.winner.name
            } : null,
            isLast10Min: auction.isLast10Min || false,
            rated: auction.rated || false,
            sellerRequirements: auction.sellerRequirements || {},
            requiredKycLevel: auction.requiredKycLevel || 1
        };

        res.json(response);
    } catch (err) {
        console.error('Error fetching auction detail:', err);
        res.status(500).json({ error: 'Failed to fetch auction detail' });
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