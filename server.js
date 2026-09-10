// ============================================================
// server.js - CM Central Market - FINAL LAUNCH VERSION
// SAFE INIT: Twilio, SendGrid, R2 (no crash if env vars missing)
// Middleware order fixed, cron includes bids, private uploads
// ============================================================

require('dotenv').config();
const { execSync } = require('child_process');

// ------------------------------------------------------------------
// MIGRATION – safely attempt, but do NOT exit on failure
// ------------------------------------------------------------------
try {
    console.log('📦 Running database migrations...');
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('✅ Database migrations completed.');
} catch (err) {
    console.error('❌ Migration failed (continuing anyway):', err.message);
    // Do NOT process.exit(1) – let the app start
}

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const PDFDocument = require('pdfkit');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const twilio = require('twilio');
const sgMail = require('@sendgrid/mail');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const prisma = new PrismaClient();

// ---------- CONFIG ----------
const PORT = process.env.PORT || 3000;

// CRITICAL: No fallback for JWT_SECRET
if (!process.env.JWT_SECRET) {
    console.error('❌ JWT_SECRET is not set in environment. Exiting.');
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

const HQ_WHATSAPP = process.env.HQ_WHATSAPP || null;
if (!HQ_WHATSAPP) {
    console.warn('⚠️ HQ_WHATSAPP not set – WhatsApp links will use placeholder.');
}

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

// ============================================================
// SAFE INIT: R2 (S3 Client) – never crash if env vars missing
// ============================================================
let s3Client = null;
let R2_BUCKET = null;
let R2_PUBLIC_URL = null;

try {
    if (
        process.env.R2_ENDPOINT &&
        process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY &&
        process.env.R2_BUCKET_NAME
    ) {
        const { S3Client } = require('@aws-sdk/client-s3');
        s3Client = new S3Client({
            region: 'auto',
            endpoint: process.env.R2_ENDPOINT,
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID,
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
            },
        });
        R2_BUCKET = process.env.R2_BUCKET_NAME;
        R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || process.env.R2_ENDPOINT;
        console.log('✅ R2 storage initialised.');
    } else {
        console.warn('⚠️ R2 not configured – image uploads will fail gracefully.');
    }
} catch (e) {
    console.warn('⚠️ R2 init failed (continuing):', e.message);
}

async function uploadToR2(file, folder = 'listings') {
    if (!s3Client) {
        throw new Error('R2 storage not configured');
    }
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
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
    if (!s3Client) return;
    try {
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        await s3Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    } catch (e) {
        console.warn('R2 delete failed:', e.message);
    }
}

// ============================================================
// SAFE INIT: TWILIO – never crash if env vars missing
// ============================================================
let twilioClient = null;
let TWILIO_PHONE_NUMBER = null;

try {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || null;
        console.log('✅ Twilio initialised.');
    } else {
        console.warn('⚠️ Twilio not configured – SMS disabled.');
    }
} catch (e) {
    console.warn('⚠️ Twilio init failed (continuing):', e.message);
}

// ============================================================
// SAFE INIT: SENDGRID – never crash if env vars missing
// ============================================================
let SENDGRID_ENABLED = false;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@cmcentralmarket.co.za';

try {
    if (process.env.SENDGRID_API_KEY) {
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        SENDGRID_ENABLED = true;
        console.log('✅ SendGrid initialised.');
    } else {
        console.warn('⚠️ SendGrid not configured – Email disabled.');
    }
} catch (e) {
    console.warn('⚠️ SendGrid init failed (continuing):', e.message);
}

// ---------- HELPERS ----------
async function sendSms(to, message) {
    if (!twilioClient || !TWILIO_PHONE_NUMBER || !to) {
        console.warn('[SMS] Skipped – Twilio not configured or missing recipient.');
        return;
    }
    try {
        await twilioClient.messages.create({ body: message, from: TWILIO_PHONE_NUMBER, to });
        console.log(`[SMS] Sent to ${to}`);
    } catch (err) {
        console.error(`[SMS] Failed: ${err.message}`);
    }
}

async function sendEmail(to, subject, html, attachments = []) {
    if (!SENDGRID_ENABLED || !to) {
        console.warn('[EMAIL] Skipped – SendGrid not configured or missing recipient.');
        return;
    }
    try {
        await sgMail.send({ to, from: FROM_EMAIL, subject, html, attachments });
        console.log(`[EMAIL] Sent to ${to}`);
    } catch (err) {
        console.error(`[EMAIL] Failed: ${err.message}`);
    }
}

function getBadge(kycLevel) {
    const badges = { 1: 'ID Verified ✓', 2: 'ID + Selfie ✓', 3: 'Address Verified ✓', 4: 'Bank Verified ✓✓', 5: 'Million-Rand ✓✓' };
    return badges[kycLevel] || 'Unverified';
}

function formatPhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('27')) return cleaned; // already correct
    if (cleaned.startsWith('0')) cleaned = '27' + cleaned.slice(1);
    else cleaned = '27' + cleaned;
    return cleaned;
}

function generateToken(user) {
    return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

// ---------- MIDDLEWARE ----------
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const bidLimiter = rateLimit({ windowMs: 1000, max: 5, message: 'Too many bids, slow down' });

// ------------------------------------------------------------------
// PRIVATE UPLOADS – stored outside public
// ------------------------------------------------------------------
const PRIVATE_UPLOAD_DIR = path.join(__dirname, 'uploads-private');
if (!fs.existsSync(PRIVATE_UPLOAD_DIR)) {
    fs.mkdirSync(PRIVATE_UPLOAD_DIR, { recursive: true });
}

const diskUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, PRIVATE_UPLOAD_DIR);
        },
        filename: (req, file, cb) => {
            cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-'));
        }
    }),
    limits: { fileSize: 15 * 1024 * 1024 }
});

const memoryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }
});

function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: 'No token' });
    const token = header.split(' ')[1];
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

function adminOnly(req, res, next) {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
    next();
}

// ============================================================
// ========== API ROUTES – MUST COME BEFORE STATIC ============
// ============================================================

// ---------- AUTH ----------
app.post('/api/register', memoryUpload.fields([{ name: 'idPhoto', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]), async (req, res) => {
    try {
        const { name, displayName, idNumber, email, password, phone, role } = req.body;
        const deviceId = req.headers['x-device-id'] || 'unknown';
        const ip = req.ip || req.connection.remoteAddress;

        if (!['BUYER', 'INDIVIDUAL_SELLER', 'AUCTIONEER'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { idNumber }] } });
        if (existing) return res.status(400).json({ error: 'Email or ID already registered' });

        if (!name || !idNumber || !email || !password) {
            return res.status(400).json({ error: 'All fields required' });
        }
        if (!req.files?.idPhoto?.[0] || !req.files?.selfie?.[0]) {
            return res.status(400).json({ error: 'ID photo and selfie required' });
        }

        let idPhotoUrl, selfieUrl;
        try {
            idPhotoUrl = await uploadToR2(req.files.idPhoto[0], 'kyc');
            selfieUrl = await uploadToR2(req.files.selfie[0], 'kyc');
        } catch (uploadErr) {
            return res.status(500).json({ error: 'Image upload failed. Please try again.' });
        }

        const hashed = await bcrypt.hash(password, 10);
        const newUser = await prisma.user.create({
            data: {
                name,
                displayName: displayName || name,
                email,
                password: hashed,
                idNumber,
                phone: phone || null,
                deviceId,
                ip,
                role,
                kycLevel: 1,
                kycStatus: 'NONE',
                canSell: false,
                idPhotoUrl,
                selfieUrl,
                kycData: { verifiedAt: new Date() },
                status: 'ACTIVE',
                sellerRequirements: { depositAmount: 0, minKycLevel: 1 },
                sellerProfile: { trustScore: null, totalRatings: 0 }
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
                canSell: newUser.canSell
            }
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(400).json({ error: 'Invalid credentials' });
        if (user.status === 'BANNED_FRAUD') return res.status(403).json({ error: 'Account banned' });
        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
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
                isAuctioneerApproved: user.isAuctioneerApproved
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

app.get('/api/me', authenticate, async (req, res) => {
    try {
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
            isAuctioneerApproved: user.isAuctioneerApproved,
            avatar: user.avatar,
            bio: user.bio,
            idPhotoUrl: user.idPhotoUrl,
            selfieUrl: user.selfieUrl,
            status: user.status
        });
    } catch (err) {
        console.error('/api/me error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/users/me', authenticate, async (req, res) => {
    try {
        const { displayName, avatar, bio } = req.body;
        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: { displayName, avatar, bio }
        });
        res.json({ message: 'Profile updated', user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- KYC ----------
app.post('/api/kyc/upgrade', authenticate, async (req, res) => {
    try {
        const { targetLevel, bankAccount, bankCode } = req.body;
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (targetLevel <= user.kycLevel) return res.status(400).json({ error: 'Target level must be higher' });

        if (targetLevel === 4) {
            if (!bankAccount || !bankCode) return res.status(400).json({ error: 'Bank details required' });
            await prisma.user.update({
                where: { id: req.user.id },
                data: {
                    kycLevel: 4,
                    kycData: { ...(user.kycData || {}), bankAccount, bankCode, bankVerified: false }
                }
            });
        }
        if (targetLevel === 5) {
            if (user.kycLevel < 4) return res.status(400).json({ error: 'Must be Level 4 first' });
            await prisma.user.update({
                where: { id: req.user.id },
                data: {
                    kycLevel: 5,
                    kycData: { ...(user.kycData || {}), millionRandVerified: false }
                }
            });
        }

        if (targetLevel >= 4 && (user.role === 'INDIVIDUAL_SELLER' || user.role === 'AUCTIONEER')) {
            await prisma.user.update({
                where: { id: req.user.id },
                data: { kycStatus: 'VERIFIED', canSell: true }
            });
        }

        const updated = await prisma.user.findUnique({ where: { id: req.user.id } });
        const token = generateToken(updated);
        res.json({
            token,
            kycLevel: updated.kycLevel,
            kycStatus: updated.kycStatus,
            canSell: updated.canSell,
            badge: getBadge(updated.kycLevel)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- MARKETPLACE ----------
app.get('/api/marketplace', async (req, res) => {
    try {
        const { filter, category, search, verifiedOnly } = req.query;
        const where = { status: 'ACTIVE' };
        if (category && category !== 'ALL') where.category = category;
        if (filter === 'AUCTION') where.listingType = 'AUCTION';
        if (filter === 'FIXED_PRICE') where.listingType = 'FIXED_PRICE';
        if (search) where.title = { contains: search, mode: 'insensitive' };
        if (verifiedOnly === 'true') where.isVerified = true;

        const listings = await prisma.listing.findMany({
            where,
            include: { bids: true, seller: { select: { id: true, name: true, displayName: true } } },
            orderBy: { createdAt: 'desc' }
        });
        const safe = listings.map(l => ({
            id: l.id,
            title: l.title,
            price: l.price || l.currentBid || l.startingPrice,
            mainImageUrl: l.mainImageUrl,
            imageUrls: l.imageUrls || [],
            images: l.images || [],
            category: l.category,
            condition: l.condition,
            listingType: l.listingType,
            year: l.year,
            kilometers: l.kilometers,
            transmission: l.transmission,
            fuelType: l.fuelType,
            currentBid: l.currentBid,
            bidCount: l.bids.length,
            isVerified: l.isVerified,
            endsIn: l.endTime || null,
            views: l.views,
            seller: l.seller ? { id: l.seller.id, name: l.seller.displayName || l.seller.name } : null
        }));
        res.json(safe);
    } catch (err) {
        console.error('Marketplace error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/listings/:id', async (req, res) => {
    try {
        const l = await prisma.listing.findUnique({
            where: { id: req.params.id },
            include: { bids: true, seller: { select: { id: true, name: true, displayName: true } } }
        });
        if (!l) return res.status(404).json({ error: 'Listing not found' });
        const cleanDesc = (l.description || '').replace(/(\d[\s-]?){10,}/g, '[contact hidden]');
        res.json({
            id: l.id,
            title: l.title,
            description: cleanDesc,
            mainImageUrl: l.mainImageUrl,
            imageUrls: l.imageUrls || [],
            odometerVideoUrl: l.odometerVideoUrl,
            images: l.images || [],
            price: l.price || l.currentBid || l.startingPrice,
            category: l.category,
            condition: l.condition,
            listingType: l.listingType,
            year: l.year,
            kilometers: l.kilometers,
            transmission: l.transmission,
            fuelType: l.fuelType,
            currentBid: l.currentBid,
            bidCount: l.bids.length,
            isVerified: l.isVerified,
            location: 'Tokoza',
            seller: { id: l.seller.id, name: l.seller.displayName || l.seller.name || 'CM Agent' },
            hqWhatsapp: HQ_WHATSAPP || '27600000000',
            waMessage: `Hi CM Agent, I'm interested in ${l.title} (ID: ${l.id}). Is viewing available?`
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- CREATE LISTING ----------
app.post('/api/listings', authenticate, memoryUpload.fields([
    { name: 'mainImage', maxCount: 1 },
    { name: 'compartmentImages', maxCount: 5 },
    { name: 'odometerVideo', maxCount: 1 }
]), async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user || (!user.canSell && user.role !== 'ADMIN')) {
            return res.status(403).json({ error: 'You must be KYC verified to sell' });
        }

        const data = req.body;
        const files = req.files;

        const phoneRegex = /(\d[\s-]?){10,}/;
        if (phoneRegex.test(data.title + (data.description || ''))) {
            return res.status(400).json({ error: 'Remove phone number. Buyers contact via CM Agent only.' });
        }

        if (!files.mainImage || !files.mainImage[0]) {
            return res.status(400).json({ error: 'Main product image is required.' });
        }

        let mainImageUrl;
        try {
            mainImageUrl = await uploadToR2(files.mainImage[0], 'listings/main');
        } catch (uploadErr) {
            return res.status(500).json({ error: 'Main image upload failed. Check R2 config.' });
        }

        const imageUrls = [];
        if (files.compartmentImages) {
            for (const file of files.compartmentImages.slice(0, 5)) {
                try {
                    const url = await uploadToR2(file, 'listings/compartments');
                    imageUrls.push(url);
                } catch (e) {
                    console.warn('Compartment image failed:', e.message);
                }
            }
        }

        let odometerVideoUrl = null;
        if (files.odometerVideo && files.odometerVideo[0]) {
            try {
                odometerVideoUrl = await uploadToR2(files.odometerVideo[0], 'listings/videos');
            } catch (e) {
                console.warn('Odometer video failed:', e.message);
            }
        }

        let endTime = null;
        if (data.listingType === 'AUCTION') {
            const days = parseInt(data.duration) || 7;
            endTime = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        }

        const listingData = {
            sellerId: req.user.id,
            sellerRole: user.role || 'SELLER',
            title: data.title,
            description: data.description || '',
            category: data.category || 'Other',
            condition: data.condition || 'USED',
            listingType: data.listingType || 'FIXED_PRICE',
            startingPrice: data.startingPrice ? parseFloat(data.startingPrice) : null,
            reservePrice: data.reservePrice ? parseFloat(data.reservePrice) : null,
            price: data.price ? parseFloat(data.price) : null,
            stock: parseInt(data.stock) || 1,
            isNegotiable: data.isNegotiable === 'true',
            endTime,
            duration: data.duration || null,
            year: data.year ? parseInt(data.year) : null,
            kilometers: data.kilometers ? parseInt(data.kilometers) : null,
            color: data.color || null,
            engineSize: data.engineSize || null,
            transmission: data.transmission || null,
            fuelType: data.fuelType || null,
            vinNumber: data.vinNumber || null,
            engineNumber: data.engineNumber || null,
            mainImageUrl,
            imageUrls,
            odometerVideoUrl,
            images: [mainImageUrl, ...imageUrls].filter(Boolean),
            status: 'ACTIVE'
        };

        const newListing = await prisma.listing.create({ data: listingData });
        res.status(201).json({ id: newListing.id, message: 'Listing created successfully' });
    } catch (err) {
        console.error('Create listing error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ---------- BID (with rate limiter) ----------
app.post('/api/listings/:id/bid', authenticate, bidLimiter, async (req, res) => {
    try {
        const { amount } = req.body;
        const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
        if (!listing || listing.listingType !== 'AUCTION' || listing.status !== 'ACTIVE') {
            return res.status(400).json({ error: 'Auction not active' });
        }

        if (listing.sellerId === req.user.id) {
            return res.status(403).json({ error: 'You cannot bid on your own listing' });
        }

        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user || user.kycLevel < 1) {
            return res.status(403).json({ error: 'You must complete KYC Level 1 to bid' });
        }

        const minBid = listing.currentBid ? listing.currentBid + 1 : (listing.startingPrice || 0);
        if (amount < minBid) return res.status(400).json({ error: `Bid must be at least R${minBid}` });

        const bid = await prisma.bid.create({
            data: { listingId: listing.id, bidderId: req.user.id, amount: parseFloat(amount) }
        });
        await prisma.listing.update({
            where: { id: listing.id },
            data: { currentBid: parseFloat(amount), currentBidderId: req.user.id }
        });

        io.emit('bidUpdate', {
            listingId: listing.id,
            currentBid: parseFloat(amount),
            bidCount: await prisma.bid.count({ where: { listingId: listing.id } })
        });
        res.json({ bid, currentBid: parseFloat(amount) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- VIEW COUNTER ----------
const viewCounts = {};
app.post('/api/listings/:id/view', async (req, res) => {
    try {
        const ip = req.ip || req.connection.remoteAddress;
        const key = `${req.params.id}:${ip}`;
        if (viewCounts[key] && viewCounts[key] > Date.now() - 60000) {
            return res.json({ ok: true, cached: true });
        }
        viewCounts[key] = Date.now();
        await prisma.listing.update({ where: { id: req.params.id }, data: { views: { increment: 1 } } });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- SELLER PROFILE ----------
app.get('/api/sellers/:sellerId', async (req, res) => {
    try {
        const seller = await prisma.user.findUnique({
            where: { id: req.params.sellerId },
            include: {
                listings: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } },
                ratingsReceived: true
            }
        });
        if (!seller) return res.status(404).json({ error: 'Seller not found' });

        const totalRatings = seller.ratingsReceived.length;
        const avgRating = totalRatings > 0
            ? seller.ratingsReceived.reduce((a, b) => a + b.stars, 0) / totalRatings
            : 0;

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
                mainImageUrl: l.mainImageUrl,
                imageUrls: l.imageUrls || [],
                images: l.images || [],
                listingType: l.listingType,
                currentBid: l.currentBid,
                price: l.price,
                endTime: l.endTime,
                status: l.status,
                year: l.year,
                kilometers: l.kilometers,
                isVerified: l.isVerified
            }))
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/seller/dashboard', authenticate, async (req, res) => {
    try {
        const listings = await prisma.listing.findMany({ where: { sellerId: req.user.id } });
        const earnings = listings.filter(l => l.status === 'SOLD').reduce((sum, l) => sum + (l.finalPrice || 0), 0);
        res.json({
            totalStock: listings.length,
            activeSales: listings.filter(l => l.status === 'ACTIVE').length,
            sold: listings.filter(l => l.status === 'SOLD').length,
            pendingPayment: listings.filter(l => l.status === 'AWAITING_PAYMENT').length,
            earnings: earnings
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/my-listings', authenticate, async (req, res) => {
    try {
        const listings = await prisma.listing.findMany({
            where: { sellerId: req.user.id },
            include: { bids: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(listings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- GHOST LEADS ----------
app.get('/api/seller/ghost-leads', authenticate, async (req, res) => {
    try {
        const ghosts = await prisma.ghostLead.findMany({ where: { sellerId: req.user.id }, orderBy: { capturedAt: 'desc' } });
        res.json(ghosts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- DNA ----------
app.get('/api/seller/dna/:listingId', authenticate, async (req, res) => {
    try {
        const listing = await prisma.listing.findUnique({ where: { id: req.params.listingId } });
        if (!listing || listing.sellerId !== req.user.id) return res.status(404).json({ error: 'Not found' });
        const filePath = path.join(PRIVATE_UPLOAD_DIR, `listing-dna-${listing.id}.pdf`);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'DNA report not generated yet' });
        res.download(filePath);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- RATINGS ----------
app.post('/api/rate-seller', authenticate, async (req, res) => {
    try {
        const { sellerId, listingId, stars, comment, tags } = req.body;
        const rating = await prisma.rating.create({
            data: {
                buyerId: req.user.id,
                sellerId,
                listingId,
                stars: parseInt(stars) || 5,
                comment: comment || null,
                tags: tags || []
            }
        });
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

// ---------- ADMIN ----------
app.get('/api/admin/overview', authenticate, adminOnly, async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true, email: true, role: true, kycStatus: true, canSell: true,
                status: true, idPhotoUrl: true, selfieUrl: true, createdAt: true
            }
        });
        const listings = await prisma.listing.findMany({ orderBy: { createdAt: 'desc' } });
        const bids = await prisma.bid.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
        const totalBids = await prisma.bid.count();
        res.json({ users, listings, bids, totalBids, hqWhatsapp: HQ_WHATSAPP || '27600000000' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/make-auctioneer', authenticate, adminOnly, async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await prisma.user.update({
            where: { id: userId },
            data: { role: 'AUCTIONEER', isAuctioneerApproved: true }
        });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/approve-kyc/:id', authenticate, adminOnly, async (req, res) => {
    try {
        const user = await prisma.user.update({
            where: { id: req.params.id },
            data: { kycStatus: 'VERIFIED', canSell: true }
        });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/reject-kyc/:id', authenticate, adminOnly, async (req, res) => {
    try {
        const user = await prisma.user.update({
            where: { id: req.params.id },
            data: { kycStatus: 'REJECTED', canSell: false }
        });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/block-user/:id', authenticate, adminOnly, async (req, res) => {
    try {
        const user = await prisma.user.update({
            where: { id: req.params.id },
            data: { status: 'BANNED_FRAUD' }
        });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/unblock-user/:id', authenticate, adminOnly, async (req, res) => {
    try {
        const user = await prisma.user.update({
            where: { id: req.params.id },
            data: { status: 'ACTIVE' }
        });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/verify-listing/:id', authenticate, adminOnly, async (req, res) => {
    try {
        const listing = await prisma.listing.update({
            where: { id: req.params.id },
            data: { isVerified: true, verificationStatus: 'VERIFIED' }
        });
        res.json(listing);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/end-listing/:id', authenticate, adminOnly, async (req, res) => {
    try {
        const listing = await prisma.listing.update({
            where: { id: req.params.id },
            data: { status: 'ENDED' }
        });
        res.json(listing);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/reports', authenticate, adminOnly, async (req, res) => {
    try {
        const reports = await prisma.report.findMany({
            where: { status: 'PENDING' },
            include: { reporter: true, listing: true }
        });
        res.json(reports);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/report/:id/resolve', authenticate, adminOnly, async (req, res) => {
    try {
        const report = await prisma.report.update({
            where: { id: req.params.id },
            data: { status: 'RESOLVED' }
        });
        res.json({ message: 'Report resolved', report });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/report/:id/dismiss', authenticate, adminOnly, async (req, res) => {
    try {
        const report = await prisma.report.update({
            where: { id: req.params.id },
            data: { status: 'DISMISSED' }
        });
        res.json({ message: 'Report dismissed', report });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/ban-user', authenticate, adminOnly, async (req, res) => {
    try {
        const { userId, reason } = req.body;
        await prisma.user.update({ where: { id: userId }, data: { status: 'BANNED_FRAUD' } });
        await prisma.report.updateMany({
            where: { buyerId: userId, status: 'PENDING' },
            data: { status: 'RESOLVED' }
        });
        res.json({ message: 'User banned', reason });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- UPLOAD VERIFICATION ----------
app.post('/api/upload/verification', authenticate, diskUpload.fields([
    { name: 'idDocument', maxCount: 1 },
    { name: 'licenseDisk', maxCount: 1 },
    { name: 'odometerVideo', maxCount: 1 },
    { name: 'carImages', maxCount: 20 }
]), async (req, res) => {
    try {
        const files = req.files || {};
        const result = {};
        if (files.idDocument) result.idDocumentUrl = `/private-uploads/${files.idDocument[0].filename}`;
        if (files.licenseDisk) result.licenseDiskUrl = `/private-uploads/${files.licenseDisk[0].filename}`;
        if (files.odometerVideo) result.odometerVideoUrl = `/private-uploads/${files.odometerVideo[0].filename}`;
        if (files.carImages) result.images = files.carImages.map(f => `/private-uploads/${f.filename}`);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/private-uploads/:filename', authenticate, async (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(PRIVATE_UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(filePath);
});

// ---------- SELLER REQUIREMENTS ----------
app.post('/api/seller/requirements', authenticate, async (req, res) => {
    try {
        const { depositAmount, minKycLevel, requiredDocs, servicesOffered, ppraReg, bbbeeLevel, saiaMember } = req.body;
        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: {
                sellerRequirements: {
                    depositAmount: depositAmount || 0,
                    minKycLevel: minKycLevel || 1,
                    requiredDocs: requiredDocs || ['ID'],
                    servicesOffered: servicesOffered || [],
                    ppraReg: ppraReg || null,
                    bbbeeLevel: bbbeeLevel || null,
                    saiaMember: saiaMember || false
                }
            }
        });
        res.json({ message: 'Requirements updated', user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- MARK PAID ----------
app.post('/api/listings/:id/paid', authenticate, async (req, res) => {
    try {
        const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
        if (!listing) return res.status(404).json({ error: 'Listing not found' });
        if (listing.winnerId !== req.user.id) return res.status(403).json({ error: 'Only winner can mark as paid' });
        await prisma.listing.update({ where: { id: listing.id }, data: { status: 'PAID' } });
        res.json({ message: 'Listing marked as paid' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- SELLER ANALYTICS ----------
app.get('/api/seller/analytics/:listingId', authenticate, async (req, res) => {
    try {
        const listing = await prisma.listing.findUnique({ where: { id: req.params.listingId } });
        if (!listing || listing.sellerId !== req.user.id) return res.status(404).json({ error: 'Listing not found' });
        res.json({
            listingId: listing.id,
            title: listing.title,
            views: listing.views,
            bids: await prisma.bid.count({ where: { listingId: listing.id } }),
            currentBid: listing.currentBid,
            status: listing.status
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ========== STATIC FILES – AFTER API ROUTES =================
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// ========== CATCH-ALL FALLBACK – SPA ROUTING ================
// ============================================================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// ========== GHOST BIDDER RECOVERY ===========================
// ============================================================

async function captureGhostBidders(listingId) {
    try {
        const listing = await prisma.listing.findUnique({ where: { id: listingId }, include: { bids: true } });
        if (!listing || !listing.bids) return;
        const finalPrice = listing.finalPrice || listing.currentBid || 0;

        for (const bid of listing.bids) {
            if (bid.amount >= finalPrice * 0.8 && bid.bidderId !== listing.winnerId) {
                const user = await prisma.user.findUnique({ where: { id: bid.bidderId } });
                if (user) {
                    await prisma.ghostLead.create({
                        data: {
                            listingId,
                            sellerId: listing.sellerId,
                            userId: user.id,
                            name: user.displayName || user.name,
                            phone: user.phone,
                            email: user.email,
                            maxBid: bid.amount,
                            bidCount: listing.bids.filter(b => b.bidderId === user.id).length,
                            category: listing.category,
                            title: listing.title,
                            finalPrice
                        }
                    });
                }
            }
        }
        await sendGhostRecovery(listingId);
    } catch (e) {
        console.error('Ghost capture error:', e.message);
    }
}

async function sendGhostRecovery(listingId) {
    try {
        const listing = await prisma.listing.findUnique({ where: { id: listingId }, include: { seller: true } });
        if (!listing) return;
        const ghosts = await prisma.ghostLead.findMany({ where: { listingId } });
        if (!ghosts.length) return;

        if (listing.seller.email) {
            const ghostListHtml = ghosts.map(g => `<li>${g.name} - Max Bid R${g.maxBid.toLocaleString()}</li>`).join('');
            await sendEmail(
                listing.seller.email,
                `Ghost Leads for ${listing.title}`,
                `<p>Here are the bidders who didn't win:</p><ul>${ghostListHtml}</ul>`
            );
        }
        for (const g of ghosts) {
            if (g.phone) {
                const msg = `You missed out on ${listing.title} (final R${listing.finalPrice?.toLocaleString() || listing.currentBid?.toLocaleString()}). The seller may have similar items. Contact CM HQ!`;
                await sendSms(formatPhone(g.phone), msg);
            }
            if (g.email) {
                await sendEmail(
                    g.email,
                    `Another chance: ${listing.title}`,
                    `Hi ${g.name}, you were a top bidder. The seller might have other deals. Check them out!`
                );
            }
        }
    } catch (e) {
        console.error('Ghost recovery error:', e.message);
    }
}

// ============================================================
// ========== DNA REPORT GENERATOR ============================
// ============================================================

async function generateAuctionDNA(listingId) {
    try {
        const listing = await prisma.listing.findUnique({
            where: { id: listingId },
            include: { seller: true, bids: true }
        });
        if (!listing) return;

        const doc = new PDFDocument({ margin: 50 });
        const filePath = path.join(PRIVATE_UPLOAD_DIR, `listing-dna-${listingId}.pdf`);
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        doc.fontSize(20).text(`Listing DNA Report: ${listing.title}`, { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Seller: ${listing.seller?.displayName || listing.seller?.name}`);
        doc.text(`Final Price: R${listing.finalPrice?.toLocaleString() || listing.currentBid?.toLocaleString() || 'N/A'}`);
        doc.text(`Total Bids: ${listing.bids?.length || 0}`);
        doc.moveDown();

        if (listing.bids.length > 0) {
            const chartRenderer = new ChartJSNodeCanvas({ width: 800, height: 300 });
            const config = {
                type: 'bar',
                data: {
                    labels: listing.bids.map(b => new Date(b.createdAt).toLocaleTimeString()),
                    datasets: [{
                        label: 'Bid Amount',
                        data: listing.bids.map(b => b.amount),
                        backgroundColor: 'rgba(227,6,19,0.6)'
                    }]
                },
                options: { scales: { y: { beginAtZero: true } } }
            };
            const buffer = await chartRenderer.renderToBuffer(config);
            doc.image(buffer, { fit: [700, 300], align: 'center' });
        }
        doc.end();

        stream.on('finish', async () => {
            if (listing.seller.email) {
                const fileBuffer = fs.readFileSync(filePath);
                const attachment = {
                    content: fileBuffer.toString('base64'),
                    filename: `listing-dna-${listingId}.pdf`,
                    type: 'application/pdf'
                };
                await sendEmail(
                    listing.seller.email,
                    `Listing DNA Report: ${listing.title}`,
                    'Your report is attached.',
                    [attachment]
                );
            }
        });
    } catch (e) {
        console.error('DNA generation error:', e.message);
    }
}

// ============================================================
// ========== TIMED LISTING CRON ==============================
// ============================================================

function startTimedListingCron() {
    console.log('⏰ Starting TIMED listing cron job (every 60s)');
    setInterval(async () => {
        try {
            const now = new Date();
            const listings = await prisma.listing.findMany({
                where: { listingType: 'AUCTION', status: 'ACTIVE', endTime: { not: null } },
                include: { bids: true, seller: true }
            });
            for (const listing of listings) {
                const endMs = new Date(listing.endTime).getTime();
                const timeLeft = endMs - now.getTime();

                if (timeLeft <= 10 * 60 * 1000 && timeLeft > 0 && !listing.isLast10Min) {
                    await prisma.listing.update({ where: { id: listing.id }, data: { isLast10Min: true } });
                    const proxyBids = listing.proxyBids || [];
                    for (const p of proxyBids) {
                        const user = await prisma.user.findUnique({ where: { id: p.userId } });
                        if (user?.phone) {
                            await sendSms(formatPhone(user.phone), `🔴 CM: "${listing.title}" ends in 10 minutes! Bid now.`);
                        }
                    }
                }

                if (now.getTime() >= endMs) {
                    const bids = listing.bids || [];
                    if (bids.length > 0) {
                        const topBid = bids.sort((a, b) => b.amount - a.amount)[0];
                        await prisma.listing.update({
                            where: { id: listing.id },
                            data: {
                                status: 'AWAITING_PAYMENT',
                                winnerId: topBid.bidderId,
                                finalPrice: topBid.amount,
                                paymentDeadline: new Date(now.getTime() + 24 * 60 * 60 * 1000)
                            }
                        });
                        const winnerUser = await prisma.user.findUnique({ where: { id: topBid.bidderId } });
                        await prisma.soldItem.create({
                            data: {
                                listingId: listing.id,
                                sellerId: listing.sellerId,
                                title: listing.title,
                                winnerName: winnerUser?.name || 'Unknown',
                                finalPrice: topBid.amount,
                                soldAt: new Date()
                            }
                        });
                        await captureGhostBidders(listing.id);
                        setTimeout(() => generateAuctionDNA(listing.id), 3000);
                        io.emit('listingEndedAwaitingPayment', { listingId: listing.id, finalPrice: topBid.amount });
                    } else {
                        await prisma.listing.update({ where: { id: listing.id }, data: { status: 'ENDED' } });
                        io.emit('listingEnded', { listingId: listing.id });
                    }
                    io.emit('marketplaceUpdated');
                }
            }
        } catch (err) {
            console.error('[CRON] Error:', err.message);
        }
    }, 60000);
}

// ============================================================
// ========== SOCKET.IO =======================================
// ============================================================

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    try {
        socket.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return next(new Error('Invalid token'));
    }
});

const socketBidLimits = {};

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    socket.on('joinListing', (listingId) => { socket.join(`listing_${listingId}`); });
    socket.on('leaveListing', () => { socket.rooms.clear(); });

    socket.on('handRaise', async (data) => {
        try {
            const now = Date.now();
            if (!socketBidLimits[socket.id]) socketBidLimits[socket.id] = [];
            const timestamps = socketBidLimits[socket.id].filter(t => t > now - 10000);
            if (timestamps.length >= 5) {
                socket.emit('error', { message: 'Too many bids, slow down' });
                return;
            }
            timestamps.push(now);
            socketBidLimits[socket.id] = timestamps;

            const { listingId, amount } = data;
            const user = await prisma.user.findUnique({ where: { id: socket.user.id } });
            if (!user || !listingId || !amount) return;

            const listing = await prisma.listing.findUnique({ where: { id: listingId } });
            if (listing && listing.sellerId === socket.user.id) {
                socket.emit('error', { message: 'You cannot bid on your own listing' });
                return;
            }

            await prisma.listing.update({
                where: { id: listingId },
                data: { currentBid: parseFloat(amount), currentBidderId: socket.user.id }
            });
            await prisma.bid.create({
                data: { listingId, bidderId: socket.user.id, amount: parseFloat(amount) }
            });
            io.to(`listing_${listingId}`).emit('newBid', {
                bidderName: user.displayName || user.name,
                amount: parseFloat(amount),
                bidderId: socket.user.id
            });
        } catch (e) {
            console.error('handRaise error:', e.message);
        }
    });

    socket.on('managerAck', (data) => { io.to(`listing_${data.listingId}`).emit('bidAccepted', data); });
    socket.on('managerReject', (data) => { io.to(`listing_${data.listingId}`).emit('bidRejected', data); });

    // Admin-only for soldLot
    socket.on('soldLot', async (data) => {
        if (socket.user.role !== 'ADMIN') {
            socket.emit('error', { message: 'Admin only' });
            return;
        }
        try {
            const { listingId, winnerId, finalPrice } = data;
            await prisma.listing.update({
                where: { id: listingId },
                data: { status: 'PAID', winnerId, finalPrice: parseFloat(finalPrice) }
            });
            await prisma.soldItem.create({
                data: {
                    listingId,
                    sellerId: socket.user.id,
                    title: 'Lot sold',
                    winnerName: winnerId,
                    finalPrice: parseFloat(finalPrice),
                    soldAt: new Date()
                }
            });
            io.to(`listing_${listingId}`).emit('lotSold', { winnerId, finalPrice });
        } catch (e) {
            console.error('soldLot error:', e.message);
        }
    });

    socket.on('video-offer', (data) => socket.to(`listing_${data.listingId}`).emit('video-offer', data));
    socket.on('video-answer', (data) => socket.to(`listing_${data.listingId}`).emit('video-answer', data));
    socket.on('video-candidate', (data) => socket.to(`listing_${data.listingId}`).emit('video-candidate', data));
    socket.on('streamStarted', (data) => socket.to(`listing_${data.listingId}`).emit('streamStarted', data));
    socket.on('video-ended', (data) => socket.to(`listing_${data.listingId}`).emit('video-ended', data));
    socket.on('disconnect', () => {
        delete socketBidLimits[socket.id];
        console.log('Socket disconnected');
    });
});

// ============================================================
// ========== SERVER START ====================================
// ============================================================

server.listen(PORT, () => {
    console.log(`✅ CM Central Market running on port ${PORT}`);
});
startTimedListingCron();

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));