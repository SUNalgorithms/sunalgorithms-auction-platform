const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const JWT_SECRET = 'supersecretkey_change_in_production';
let users = [];
let auctions = [];
let bannedUsers = [];
let privateChats = {};
let persistentMessages = [];
let rooms = {};

// ---------- MULTER CONFIG ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  }
});

const auctionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'images') {
      if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files allowed'));
    } else if (file.fieldname === 'video') {
      if (!file.mimetype.startsWith('video/')) return cb(new Error('Only video files allowed'));
    }
    cb(null, true);
  }
});

// ---------- HELPERS ----------
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function getRequiredKycLevel(reservePrice) {
  if (reservePrice > 2000000) return 5;
  if (reservePrice > 100000) return 4;
  return 1;
}

function getBadge(kycLevel) {
  if (kycLevel >= 5) return 'Million-Rand Verified ✓✓';
  if (kycLevel >= 4) return 'Bank Verified ✓';
  return 'Small Scale';
}

// ---------- AUTH ----------
app.post('/api/register',
  upload.fields([
    { name: 'idPhoto', maxCount: 1 },
    { name: 'selfie', maxCount: 1 }
  ]),
  async (req, res) => {
    const { name, idNumber, email, password } = req.body;
    const idPhotoFile = req.files?.idPhoto?.[0];
    const selfieFile = req.files?.selfie?.[0];

    if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email exists' });
    if (bannedUsers.find(b => b.idNumber === idNumber)) return res.status(403).json({ error: 'This ID is permanently banned' });

    const idPhoto = idPhotoFile ? `data:${idPhotoFile.mimetype};base64,${idPhotoFile.buffer.toString('base64')}` : '';
    const selfie = selfieFile ? `data:${selfieFile.mimetype};base64,${selfieFile.buffer.toString('base64')}` : '';

    const faceMatch = selfie ? 0.99 : 0;
    if (faceMatch < 0.98) return res.status(400).json({ error: 'Face does not match ID photo' });

    const hashed = await bcrypt.hash(password, 10);
    const newUser = {
      id: Date.now().toString(),
      name,
      email,
      password: hashed,
      idNumber,
      role: req.body.role || 'buyer',
      kycLevel: 1,
      kycData: { idPhoto, selfie, verifiedAt: Date.now() },
      status: 'ACTIVE',
      favorites: [],
      soldItems: [],
      createdAt: Date.now()
    };
    users.push(newUser);

    const token = jwt.sign(
      { id: newUser.id, email, role: newUser.role, kycLevel: newUser.kycLevel },
      JWT_SECRET
    );
    res.json({
      token,
      user: { id: newUser.id, name, email, role: newUser.role, kycLevel: newUser.kycLevel },
      message: 'Registered! You can bid on lots under R100,000. Upgrade KYC to bid higher.'
    });
  });

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(400).json({ error: 'Invalid credentials' });
  if (user.status === 'BANNED_FRAUD') return res.status(403).json({ error: 'Account banned for non-payment' });

  const token = jwt.sign(
    { id: user.id, email, role: user.role, kycLevel: user.kycLevel },
    JWT_SECRET
  );
  res.json({
    token,
    user: { id: user.id, name: user.name, email, role: user.role, kycLevel: user.kycLevel }
  });
});

// ---------- KYC UPGRADE ----------
app.post('/api/kyc/upgrade', authenticate, async (req, res) => {
  const { targetLevel, bankStatement, titleDeed, proofOfAddress, taxNumber } = req.body;
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.status === 'BANNED_FRAUD') return res.status(403).json({ error: 'Banned users cannot upgrade' });

  if (targetLevel === 4) {
    if (!bankStatement || !proofOfAddress) return res.status(400).json({ error: 'Upload bank statement + proof of address' });
    user.kycLevel = 4;
    user.kycData = { ...user.kycData, bankStatement, proofOfAddress, taxNumber, upgradedAt: Date.now() };
  } else if (targetLevel === 5) {
    if (user.kycLevel < 4) return res.status(400).json({ error: 'Upgrade to Bank Verified first' });
    if (!titleDeed) return res.status(400).json({ error: 'Upload title deed or proof of assets' });
    user.kycLevel = 5;
    user.kycData = { ...user.kycData, titleDeed, upgradedAt: Date.now() };
  } else {
    return res.status(400).json({ error: 'Invalid KYC level' });
  }

  const token = jwt.sign(
    { id: user.id, email, role: user.role, kycLevel: user.kycLevel },
    JWT_SECRET
  );
  res.json({ token, kycLevel: user.kycLevel, badge: getBadge(user.kycLevel) });
});

// ---------- AUCTIONS ----------
app.get('/api/auctions', (req, res) => {
  let sorted = [...auctions];
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = users.find(u => u.id === decoded.id);
      if (user && user.favorites && user.favorites.length) {
        sorted.sort((a, b) => {
          const aFav = user.favorites.includes(a.seller) ? 1 : 0;
          const bFav = user.favorites.includes(b.seller) ? 1 : 0;
          if (aFav !== bFav) return bFav - aFav;
          return new Date(a.startTime) - new Date(b.startTime);
        });
      }
    }
  } catch (e) { /* ignore */ }

  const safe = sorted.map(a => ({
    id: a.id,
    title: a.title,
    category: a.category,
    reserve: a.reserve,
    currentBid: a.currentBid,
    startTime: a.startTime,
    status: a.status,
    seller: a.seller,
    items: a.items,
    city: a.city,
    viewerCount: a.viewerCount,
    requiredKycLevel: a.requiredKycLevel,
    timeLeft: a.timeLeft,
    winnerId: a.winnerId,
    finalPrice: a.finalPrice,
    images: a.images?.map(img => img.dataUrl) || [],
    videoUrl: a.videoUrl,
    reservedBidders: a.reservedBidders || [],
    paymentDeadline: a.paymentDeadline
  }));
  res.json(safe);
});

// Seller's own auctions (for dashboard)
app.get('/api/seller/auctions', authenticate, (req, res) => {
  if (req.user.role !== 'seller') return res.status(403).json({ error: 'Only sellers can view their auctions' });
  const sellerAuctions = auctions.filter(a => a.seller === req.user.email).map(a => ({
    id: a.id,
    title: a.title,
    category: a.category,
    reserve: a.reserve,
    currentBid: a.currentBid,
    startTime: a.startTime,
    status: a.status,
    items: a.items,
    city: a.city,
    requiredKycLevel: a.requiredKycLevel,
    images: a.images?.map(img => img.dataUrl) || [],
    videoUrl: a.videoUrl,
    winnerId: a.winnerId,
    finalPrice: a.finalPrice
  }));
  res.json(sellerAuctions);
});

app.post('/api/auctions',
  authenticate,
  auctionUpload.fields([
    { name: 'images', maxCount: 8 },
    { name: 'video', maxCount: 1 }
  ]),
  (req, res) => {
    if (req.user.role !== 'seller') return res.status(403).json({ error: 'Only sellers can create auctions' });

    const { title, category, reserve, startTime, city, items } = req.body;

    if (!req.files || !req.files.images || req.files.images.length < 2) {
      return res.status(400).json({ error: 'You must upload at least 2 images' });
    }
    if (!req.files.video || req.files.video.length === 0) {
      return res.status(400).json({ error: 'You must upload a video' });
    }

    const images = req.files.images.map(file => ({
      dataUrl: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
      name: file.originalname
    }));
    const videoFile = req.files.video[0];
    const videoUrl = `data:${videoFile.mimetype};base64,${videoFile.buffer.toString('base64')}`;

    const newAuction = {
      id: Date.now().toString(),
      title,
      category,
      reserve: reserve || 0,
      currentBid: null,
      startTime: new Date(startTime).toISOString(),
      status: 'UPCOMING',
      seller: req.user.email,
      items: items || 1,
      city: city || 'Online',
      viewerCount: 0,
      bidders: [],
      winnerId: null,
      finalPrice: null,
      timeLeft: 30,
      extensionCount: 0,
      maxExtensions: 3,
      requiredKycLevel: getRequiredKycLevel(reserve || 0),
      paymentDeadline: null,
      currentLot: 1,
      images: images,
      videoUrl: videoUrl,
      reservedBidders: []
    };
    auctions.push(newAuction);
    res.json({ id: newAuction.id, message: 'Auction created' });
  });

// ---------- RESERVE SPACE ----------
app.post('/api/auctions/:id/reserve', authenticate, (req, res) => {
  const auction = auctions.find(a => a.id === req.params.id);
  if (!auction) return res.status(404).json({ error: 'Auction not found' });
  if (req.user.role !== 'buyer') return res.status(403).json({ error: 'Only buyers can reserve' });
  if (auction.status !== 'UPCOMING') return res.status(400).json({ error: 'Auction is not upcoming' });

  if (auction.reservedBidders.includes(req.user.id)) {
    return res.status(400).json({ error: 'Already reserved' });
  }

  auction.reservedBidders.push(req.user.id);
  res.json({ message: 'Space reserved. You can join even after the auction starts.' });
});

// ---------- JOIN AUCTION ----------
app.post('/api/auctions/:id/join', authenticate, (req, res) => {
  const auction = auctions.find(a => a.id === req.params.id);
  if (!auction) return res.status(404).json({ error: 'Auction not found' });

  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.status === 'BANNED_FRAUD') return res.status(403).json({ error: 'You are permanently banned' });

  const now = Date.now();
  const startTime = new Date(auction.startTime).getTime();

  // Sellers can always join
  if (user.email === auction.seller) {
    if (!auction.bidders.find(b => b.userId === user.id)) {
      auction.bidders.push({ userId: user.id, name: user.name, status: 'idle', kycLevel: user.kycLevel });
    }
    return res.json({ message: 'Seller joined', auction });
  }

  // Buyer logic
  if (auction.status === 'UPCOMING') {
    if (!auction.reservedBidders.includes(user.id)) {
      const secondsUntilStart = Math.floor((startTime - now) / 1000);
      if (secondsUntilStart > 60) {
        return res.status(400).json({
          error: `Auction hasn't started yet. Starts in ${Math.ceil(secondsUntilStart / 60)} minutes. Reserve a spot to join early.`
        });
      }
    }
  } else if (auction.status === 'LIVE') {
    if (!auction.reservedBidders.includes(user.id)) {
      const elapsed = Math.floor((now - startTime) / 1000);
      if (elapsed > 60) {
        return res.status(400).json({ error: 'Entry closed – auction already started. Only reserved bidders can join now.' });
      }
    }
  } else if (['ENDED', 'SOLD', 'AWAITING_PAYMENT'].includes(auction.status)) {
    return res.status(400).json({ error: 'This auction has ended' });
  }

  if (user.kycLevel < auction.requiredKycLevel) {
    return res.status(403).json({
      error: `KYC Level ${auction.requiredKycLevel} required`,
      requiredLevel: auction.requiredKycLevel,
      yourLevel: user.kycLevel,
      upgradeUrl: '/profile/kyc-upgrade'
    });
  }

  if (!auction.bidders.find(b => b.userId === user.id)) {
    auction.bidders.push({ userId: user.id, name: user.name, status: 'idle', kycLevel: user.kycLevel });
  }

  res.json({ message: 'Joined successfully', auction });
});

// ---------- DELETE AUCTION ----------
app.delete('/api/auctions/:id', authenticate, (req, res) => {
  const auction = auctions.find(a => a.id === req.params.id);
  if (!auction) return res.status(404).json({ error: 'Auction not found' });
  if (req.user.email !== auction.seller) return res.status(403).json({ error: 'Only the seller can delete' });
  if (auction.status === 'LIVE') return res.status(400).json({ error: 'Cannot delete a live auction' });

  auctions = auctions.filter(a => a.id !== req.params.id);
  res.json({ message: 'Auction deleted' });
});

// ---------- SELLER PROFILES ----------
app.get('/api/sellers/:id', (req, res) => {
  const seller = users.find(u => u.id === req.params.id && u.role === 'seller');
  if (!seller) return res.status(404).json({ error: 'Seller not found' });
  const sellerAuctions = auctions.filter(a => a.seller === seller.email);
  const soldItems = seller.soldItems || [];
  res.json({
    id: seller.id,
    name: seller.name,
    kycLevel: seller.kycLevel,
    badge: getBadge(seller.kycLevel),
    auctionsCount: sellerAuctions.length,
    soldCount: soldItems.length,
    upcoming: sellerAuctions.filter(a => a.status === 'UPCOMING').map(a => ({ id: a.id, title: a.title, startTime: a.startTime })),
    sold: soldItems
  });
});

// ---------- FAVORITE SELLERS ----------
app.post('/api/favorites/:sellerId', authenticate, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.favorites) user.favorites = [];
  if (user.favorites.includes(req.params.sellerId)) return res.status(400).json({ error: 'Already favorited' });
  user.favorites.push(req.params.sellerId);
  res.json({ message: 'Seller added to favorites' });
});

app.delete('/api/favorites/:sellerId', authenticate, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.favorites = (user.favorites || []).filter(id => id !== req.params.sellerId);
  res.json({ message: 'Seller removed from favorites' });
});

app.get('/api/favorites', authenticate, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user.favorites || []);
});

// ---------- SEARCH SELLERS ----------
app.get('/api/sellers', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const results = users
    .filter(u => u.role === 'seller' && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)))
    .map(u => ({ id: u.id, name: u.name, badge: getBadge(u.kycLevel) }));
  res.json(results);
});

// ---------- PERSISTENT INBOX ----------
app.get('/api/messages', authenticate, (req, res) => {
  const userId = req.user.id;
  const conversations = persistentMessages
    .filter(m => m.from === userId || m.to === userId)
    .reduce((acc, msg) => {
      const partnerId = msg.from === userId ? msg.to : msg.from;
      if (!acc[partnerId] || acc[partnerId].ts < msg.ts) {
        acc[partnerId] = { partnerId, lastMsg: msg };
      }
      return acc;
    }, {});
  res.json(Object.values(conversations));
});

app.get('/api/messages/:partnerId', authenticate, (req, res) => {
  const userId = req.user.id;
  const partnerId = req.params.partnerId;
  const msgs = persistentMessages.filter(
    m => (m.from === userId && m.to === partnerId) || (m.from === partnerId && m.to === userId)
  ).sort((a, b) => a.ts - b.ts);
  res.json(msgs);
});

app.post('/api/messages', authenticate, (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) return res.status(400).json({ error: 'Missing fields' });
  const msg = { from: req.user.id, to, text, ts: Date.now() };
  persistentMessages.push(msg);
  io.to(to).emit('newPersistentMessage', msg);
  res.json(msg);
});

// ---------- SOLD ITEMS TRACKING ----------
function addSoldItem(sellerEmail, product, winner, price) {
  const seller = users.find(u => u.email === sellerEmail);
  if (seller) {
    if (!seller.soldItems) seller.soldItems = [];
    seller.soldItems.push({ product, winner, price, date: new Date().toISOString() });
  }
}

// ---------- AUTO-CLEANUP ----------
setInterval(() => {
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  auctions = auctions.filter(a => {
    if (['ENDED', 'SOLD', 'AWAITING_PAYMENT'].includes(a.status)) {
      const closedAt = new Date(a.paymentDeadline || a.startTime).getTime();
      return (now - closedAt) < sevenDays;
    }
    return true;
  });
}, 24 * 60 * 60 * 1000);

// ---------- SOCKET.IO ----------
io.on('connection', (socket) => {
  socket.on('register', (userId) => {
    socket.userId = userId;
    socket.join(userId);
  });

  socket.on('joinAuctionRoom', (auctionId) => socket.join(auctionId));

  // Bidding
  socket.on('handRaise', (data) => {
    const { auctionId, userId, amount } = data;
    const auction = auctions.find(a => a.id === auctionId);
    if (!auction || auction.status !== 'LIVE') return;

    const user = users.find(u => u.id === userId);
    if (!user || user.status === 'BANNED_FRAUD') return;

    const bidder = auction.bidders.find(b => b.userId === userId);
    if (bidder) bidder.status = 'raised';

    io.to(auctionId).emit('handRaised', {
      bidderId: userId,
      bidderName: user.name,
      amount,
      kycLevel: user.kycLevel
    });

    setTimeout(() => {
      if (bidder && bidder.status === 'raised') {
        bidder.status = 'rejected';
        io.to(auctionId).emit('handRejected', { bidderId: userId, reason: 'Timeout' });
      }
    }, 5000);
  });

  socket.on('managerAck', (data) => {
    const { auctionId, bidderId, amount } = data;
    const auction = auctions.find(a => a.id === auctionId);
    if (!auction) return;
    const bidder = auction.bidders.find(b => b.userId === bidderId);
    if (bidder && bidder.status === 'raised') {
      bidder.status = 'accepted';
      auction.currentBid = amount;
      if (auction.timeLeft < 30 && auction.extensionCount < auction.maxExtensions) {
        auction.timeLeft += 30;
        auction.extensionCount++;
      }
      io.to(auctionId).emit('bidAccepted', { amount: auction.currentBid, bidderId });
    }
  });

  socket.on('managerReject', (data) => {
    const { auctionId, bidderId } = data;
    const auction = auctions.find(a => a.id === auctionId);
    if (!auction) return;
    const bidder = auction.bidders.find(b => b.userId === bidderId);
    if (bidder && bidder.status === 'raised') {
      bidder.status = 'rejected';
      io.to(auctionId).emit('handRejected', { bidderId, reason: 'Manager rejected' });
    }
  });

  // Timer & start
  socket.on('startAuction', (auctionId) => {
    const auction = auctions.find(a => a.id === auctionId);
    if (!auction || auction.status !== 'UPCOMING') return;
    auction.status = 'LIVE';
    auction.timeLeft = 30;
    auction.extensionCount = 0;
    io.to(auctionId).emit('auctionStarted', auction);

    const interval = setInterval(() => {
      auction.timeLeft--;
      io.to(auctionId).emit('timerUpdate', auction.timeLeft);
      if (auction.timeLeft <= 0) {
        clearInterval(interval);
        io.to(auctionId).emit('auctionEnded', auction);
        auction.status = 'ENDED';
      }
    }, 1000);
  });

  socket.on('extendTime', (auctionId) => {
    const auction = auctions.find(a => a.id === auctionId);
    if (!auction || auction.status !== 'LIVE') return;
    auction.timeLeft += 30;
    io.to(auctionId).emit('timerUpdate', auction.timeLeft);
  });

  // Winner & Ban
  socket.on('markWinner', (data) => {
    const { auctionId, winnerId, finalPrice } = data;
    const auction = auctions.find(a => a.id === auctionId);
    if (!auction) return;
    auction.status = 'AWAITING_PAYMENT';
    auction.winnerId = winnerId;
    auction.finalPrice = finalPrice;
    auction.paymentDeadline = Date.now() + 24 * 60 * 60 * 1000;

    const winnerName = users.find(u => u.id === winnerId)?.name || 'Unknown';
    addSoldItem(auction.seller, auction.title, winnerName, finalPrice);

    io.to(auctionId).emit('auctionEndedAwaitingPayment', {
      winnerId,
      finalPrice,
      deadline: auction.paymentDeadline
    });
  });

  socket.on('banUserForNonPayment', (data) => {
    const { userId, auctionId, evidence } = data;
    const user = users.find(u => u.id === userId);
    if (!user) return;
    user.status = 'BANNED_FRAUD';
    bannedUsers.push({
      idNumber: user.idNumber,
      name: user.name,
      reason: 'Non-payment after winning auction',
      auctionId,
      evidence,
      bannedAt: Date.now()
    });
    io.emit('userBanned', { idNumber: user.idNumber, name: user.name });
  });

  // Host Controls
  socket.on('hostMediaToggle', (data) => {
    const { auctionId, micActive, cameraActive } = data;
    socket.to(auctionId).emit('hostMediaUpdate', { micActive, cameraActive });
  });

  socket.on('switchLot', (data) => {
    const { auctionId, lotId } = data;
    const auction = auctions.find(a => a.id === auctionId);
    if (!auction) return;
    auction.currentLot = lotId;
    auction.timeLeft = 30;
    auction.extensionCount = 0;
    io.to(auctionId).emit('lotSwitched', { lotId, timeLeft: 30 });
  });

  socket.on('muteAllBidders', (auctionId) => {
    io.to(auctionId).emit('biddersMuted', true);
  });

  // WebRTC Signaling
  socket.on('hostStartStream', (auctionId) => {
    if (!rooms[auctionId]) rooms[auctionId] = { hostId: socket.id, viewers: [] };
    socket.join(auctionId);
    io.to(auctionId).emit('hostOnline', true);
  });

  socket.on('hostStopStream', (auctionId) => {
    io.to(auctionId).emit('hostOffline', true);
    delete rooms[auctionId];
  });

  socket.on('viewerJoin', (auctionId) => {
    if (rooms[auctionId]) {
      rooms[auctionId].viewers.push(socket.id);
      socket.join(auctionId);
      io.to(rooms[auctionId].hostId).emit('newViewer', socket.id);
    }
  });

  socket.on('webrtcSignal', (data) => {
    const { to, signal } = data;
    io.to(to).emit('webrtcSignal', { from: socket.id, signal });
  });

  socket.on('disconnect', () => {
    for (let auctionId in rooms) {
      if (rooms[auctionId].hostId === socket.id) {
        io.to(auctionId).emit('hostOffline', true);
        delete rooms[auctionId];
      }
    }
  });

  // Private Chat (ephemeral)
  socket.on('requestPrivateChat', (data) => {
    const { auctionId, bidderId, hostId } = data;
    const channelId = `private_${auctionId}_${bidderId}_${hostId}`;
    if (!privateChats[channelId]) {
      privateChats[channelId] = { messages: [], auctionId, hostId, bidderId, active: false };
    }
    io.to(bidderId).emit('privateChatRequest', {
      channelId,
      auctionId,
      hostName: users.find(u => u.id === hostId)?.name
    });
  });

  socket.on('acceptPrivateChat', (channelId) => {
    if (privateChats[channelId]) {
      privateChats[channelId].active = true;
      socket.join(channelId);
      io.to(channelId).emit('chatStarted', { notice: 'This chat is recorded for dispute protection' });
    }
  });

  socket.on('privateChatMessage', (data) => {
    const { channelId, senderId, text } = data;
    const chat = privateChats[channelId];
    if (!chat || !chat.active) return;
    const auction = auctions.find(a => a.id === chat.auctionId);
    const blocked = /(0[6-8][0-9]\s*\d{3}\s*\d{4}|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i;
    let cleanText = text;
    if (auction?.status !== 'SOLD') {
      cleanText = text.replace(blocked, '[REDACTED]');
    }
    const msg = { senderId, text: cleanText, ts: Date.now(), originalBlocked: text !== cleanText };
    chat.messages.push(msg);
    io.to(channelId).emit('newPrivateMessage', msg);
  });

  socket.on('endPrivateChat', (channelId) => {
    if (privateChats[channelId]) {
      privateChats[channelId].active = false;
      io.to(channelId).emit('chatEnded', 'Host ended chat');
      socket.leave(channelId);
    }
  });

  // Persistent Chat (buyer-seller inbox)
  socket.on('sendChatMessage', (data) => {
    const { to, text } = data;
    const from = socket.userId;
    if (!from) return;
    const msg = { from, to, text, ts: Date.now() };
    persistentMessages.push(msg);
    io.to(to).emit('chatMessage', msg);
    socket.emit('chatMessage', msg);
  });
});

// ---------- ERROR HANDLING ----------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large. Maximum size is 20MB.' });
    return res.status(400).json({ error: err.message });
  }
  if (err.message === 'Only image files are allowed' || err.message === 'Only video files allowed') {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

server.listen(3000, () => console.log('Server running on port 3000'));