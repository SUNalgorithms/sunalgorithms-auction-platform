// ============================================================
// app.js - SunAlgorithms Auction Platform (Phase 1-8)
// Complete file with Auction Room, Bidding, Timer, Proxy, etc.
// ============================================================

// ---------- GLOBAL STATE ----------
const app = {
    user: null,
    token: null,
    socket: null,
    deviceId: null,
    currentAuctionId: null,
    auctions: [],
    selectedFiles: {
        images: [],
        video: null,
        inspectionReport: null,
        serviceHistory: [],
        inventoryManifest: null
    },
    isAuctioneer: false,
    videoStream: null,
    peer: null,
    timerInterval: null,
    bidHistory: [],
    viewers: 0
};

// ---------- API WRAPPER ----------
async function api(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${app.token}`
        }
    };

    if (body) {
        if (body instanceof FormData) {
            options.body = body;
        } else {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }
    }

    const res = await fetch(endpoint, options);
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.error || 'API request failed');
    }
    return data;
}

// ---------- TOAST NOTIFICATIONS ----------
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.display = 'block';
    toast.style.borderColor = type === 'error' ? '#ff4444' : '#00ff88';
    toast.style.background = type === 'error' ? 'rgba(255,0,0,0.2)' : 'rgba(0,255,136,0.1)';
    clearTimeout(toast._hide);
    toast._hide = setTimeout(() => {
        toast.style.display = 'none';
    }, 4000);
}

// ---------- MODAL HELPERS ----------
function openModal(content) {
    const modal = document.getElementById('modal');
    const contentEl = document.getElementById('modalContent');
    contentEl.innerHTML = content;
    modal.style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
}

// ---------- NAVIGATION ----------
function navigate(page) {
    const main = document.getElementById('mainContent');
    switch (page) {
        case 'landing':
            renderLanding();
            break;
        case 'profile':
            renderProfile();
            break;
        case 'sellerDashboard':
            renderSellerDashboard();
            break;
        case 'adminDashboard':
            renderAdminDashboard();
            break;
        case 'auctionRoom':
            // handled by viewAuction
            break;
        default:
            renderLanding();
    }
}

// ============================================================
// ========== AUTH ============================================
// ============================================================

function showLogin() {
    openModal(`
        <span class="close-modal" onclick="closeModal()">&times;</span>
        <h2>Login</h2>
        <div class="form-group">
            <label>Email</label>
            <input id="loginEmail" type="email" placeholder="you@example.com">
        </div>
        <div class="form-group">
            <label>Password</label>
            <input id="loginPassword" type="password" placeholder="••••••••">
        </div>
        <button class="btn btn-primary" style="width:100%" onclick="handleLogin()">Login</button>
        <p style="margin-top:1rem;text-align:center;color:var(--muted);">
            Don't have an account? <span style="color:var(--green);cursor:pointer;" onclick="closeModal();showRegister();">Register</span>
        </p>
    `);
}

async function handleLogin() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return showToast('Email and password required', 'error');

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        app.token = data.token;
        app.user = data.user;
        localStorage.setItem('token', app.token);
        localStorage.setItem('user', JSON.stringify(app.user));
        closeModal();
        initApp();
        showToast(`Welcome, ${app.user.name}!`);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function showRegister() {
    openModal(`
        <span class="close-modal" onclick="closeModal()">&times;</span>
        <h2>Register</h2>
        <div class="form-group">
            <label>Full Name</label>
            <input id="regName" placeholder="John Doe">
        </div>
        <div class="form-group">
            <label>ID Number</label>
            <input id="regIdNumber" placeholder="8001011234567">
        </div>
        <div class="form-group">
            <label>Email</label>
            <input id="regEmail" type="email" placeholder="you@example.com">
        </div>
        <div class="form-group">
            <label>Phone (SA)</label>
            <input id="regPhone" placeholder="0821234567">
        </div>
        <div class="form-group">
            <label>ID Photo (Upload your ID document)</label>
            <div class="drag-area" style="border:2px dashed rgba(255,255,255,0.2);border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;transition:0.3s;background:rgba(255,255,255,0.02);" id="registerIdDrop">
                <i class="fas fa-id-card" style="font-size:2rem;color:var(--green);"></i>
                <p style="margin:0.3rem 0;color:var(--muted);font-size:0.85rem;">Click to upload ID photo</p>
                <input type="file" id="regIdPhoto" accept="image/*" hidden>
            </div>
            <div id="regIdPreview" style="margin-top:0.3rem;font-size:0.8rem;color:var(--green);"></div>
        </div>
        <div class="form-group">
            <label>Selfie (Take a photo of yourself)</label>
            <div class="drag-area" style="border:2px dashed rgba(255,255,255,0.2);border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;transition:0.3s;background:rgba(255,255,255,0.02);" id="registerSelfieDrop">
                <i class="fas fa-user" style="font-size:2rem;color:var(--green);"></i>
                <p style="margin:0.3rem 0;color:var(--muted);font-size:0.85rem;">Click to upload a selfie</p>
                <input type="file" id="regSelfie" accept="image/*" hidden>
            </div>
            <div id="regSelfiePreview" style="margin-top:0.3rem;font-size:0.8rem;color:var(--green);"></div>
        </div>
        <div class="form-group">
            <label>Password</label>
            <input id="regPassword" type="password" placeholder="••••••••">
        </div>
        <div class="form-group">
            <label>Role</label>
            <select id="regRole">
                <option value="buyer">Buyer</option>
                <option value="seller">Seller (Auctioneer)</option>
            </select>
        </div>
        <button class="btn btn-primary" style="width:100%" onclick="handleRegister()">Register</button>
        <p style="margin-top:1rem;text-align:center;color:var(--muted);">
            Already have an account? <span style="color:var(--green);cursor:pointer;" onclick="closeModal();showLogin();">Login</span>
        </p>
    `);

    // Setup register drag-and-drop
    setupRegisterFileDrop('registerIdDrop', 'regIdPhoto', 'regIdPreview');
    setupRegisterFileDrop('registerSelfieDrop', 'regSelfie', 'regSelfiePreview');
}

function setupRegisterFileDrop(dropId, inputId, previewId) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = 'var(--green)'; });
    drop.addEventListener('dragleave', () => { drop.style.borderColor = 'rgba(255,255,255,0.2)'; });
    drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.style.borderColor = 'rgba(255,255,255,0.2)';
        const files = e.dataTransfer.files;
        if (files.length) {
            input.files = files;
            preview.innerHTML = `<span style="color:var(--green);">✅ ${files[0].name}</span>`;
        }
    });
    input.addEventListener('change', () => {
        if (input.files.length) {
            preview.innerHTML = `<span style="color:var(--green);">✅ ${input.files[0].name}</span>`;
        }
    });
}

async function handleRegister() {
    const name = document.getElementById('regName').value;
    const idNumber = document.getElementById('regIdNumber').value;
    const email = document.getElementById('regEmail').value;
    const phone = document.getElementById('regPhone').value;
    const password = document.getElementById('regPassword').value;
    const role = document.getElementById('regRole').value;

    const idPhotoFile = document.getElementById('regIdPhoto')?.files?.[0];
    const selfieFile = document.getElementById('regSelfie')?.files?.[0];

    if (!name || !idNumber || !email || !password) {
        return showToast('All fields required', 'error');
    }
    if (!idPhotoFile || !selfieFile) {
        return showToast('Please upload your ID photo and a selfie', 'error');
    }

    try {
        const formData = new FormData();
        formData.append('name', name);
        formData.append('idNumber', idNumber);
        formData.append('email', email);
        formData.append('phone', phone);
        formData.append('password', password);
        formData.append('role', role);
        formData.append('idPhoto', idPhotoFile);
        formData.append('selfie', selfieFile);

        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'x-device-id': app.deviceId || 'unknown' },
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        app.token = data.token;
        app.user = data.user;
        localStorage.setItem('token', app.token);
        localStorage.setItem('user', JSON.stringify(app.user));
        closeModal();
        initApp();
        showToast(`Registered successfully! Welcome, ${app.user.name}`);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function logout() {
    app.user = null;
    app.token = null;
    app.socket = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    document.getElementById('navbar').style.display = 'none';
    document.getElementById('mainContent').innerHTML = `
        <div class="landing-hero">
            <h1>SunAlgorithms</h1>
            <p>Trust But Verify, No Money Held. Floor Feel, Online Speed.</p>
            <div style="display:flex;gap:1rem;justify-content:center;margin-top:2rem;">
                <button class="btn btn-primary" onclick="showLogin()">Login</button>
                <button class="btn btn-outline" onclick="showRegister()">Register</button>
            </div>
        </div>
    `;
    showToast('Logged out');
}

// ---------- INIT APP ----------
async function initApp() {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');

    if (token && userData) {
        app.token = token;
        app.user = JSON.parse(userData);
        document.getElementById('navbar').style.display = 'flex';

        document.getElementById('createAuctionBtn').style.display = (app.user.role === 'seller' || app.user.role === 'admin') ? 'inline' : 'none';
        document.getElementById('sellerDashBtn').style.display = (app.user.role === 'seller' || app.user.role === 'admin') ? 'inline' : 'none';
        document.getElementById('adminDashBtn').style.display = (app.user.role === 'admin') ? 'inline' : 'none';
        document.getElementById('userDisplay').textContent = `👤 ${app.user.name}`;

        connectSocket();
        await fetchAuctions();
        navigate('landing');
    } else {
        document.getElementById('navbar').style.display = 'none';
        document.getElementById('mainContent').innerHTML = `
            <div class="landing-hero">
                <h1>SunAlgorithms</h1>
                <p>Trust But Verify, No Money Held. Floor Feel, Online Speed.</p>
                <div style="display:flex;gap:1rem;justify-content:center;margin-top:2rem;">
                    <button class="btn btn-primary" onclick="showLogin()">Login</button>
                    <button class="btn btn-outline" onclick="showRegister()">Register</button>
                </div>
            </div>
        `;
    }
}

// ---------- SOCKET.IO CONNECTION ----------
function connectSocket() {
    if (app.socket) return;
    app.socket = io({
        auth: { token: app.token }
    });

    app.socket.on('connect', () => {
        console.log('Socket connected');
    });

    app.socket.on('connect_error', (err) => {
        console.error('Socket connection error:', err.message);
    });

    app.socket.on('auctionListUpdated', () => {
        fetchAuctions();
    });

    app.socket.on('userBanned', (data) => {
        showToast(`⚠️ ${data.name} banned: ${data.reason}`, 'error');
    });

    app.socket.on('error', (data) => {
        showToast(data.message, 'error');
    });

    app.socket.on('switchedToLive', (data) => {
        showToast('🔴 ' + data.message, 'info');
        if (app.currentAuctionId) {
            renderAuctionRoom(app.currentAuctionId);
        }
    });

    app.socket.on('proxyBidUpdate', (data) => {
        showToast(`💰 New bid: R${data.currentBid.toLocaleString()}`, 'info');
        if (app.currentAuctionId) {
            renderAuctionRoom(app.currentAuctionId);
        }
    });

    app.socket.on('bidAccepted', (data) => {
        showToast(`Bid R${data.amount.toLocaleString()} ACCEPTED!`, 'info');
        if (app.currentAuctionId) {
            renderAuctionRoom(app.currentAuctionId);
        }
    });

    app.socket.on('bidRejected', (data) => {
        showToast(data.message, 'error');
        if (app.currentAuctionId) {
            renderAuctionRoom(app.currentAuctionId);
        }
    });

    app.socket.on('handRaiseQueued', (data) => {
        showToast(`New bid: ${data.bidderName} - R${data.amount.toLocaleString()}`, 'info');
        if (app.currentAuctionId && app.isAuctioneer) {
            renderAuctionRoom(app.currentAuctionId);
        }
    });

    app.socket.on('lotSold', (data) => {
        showToast(data.message, 'info');
        fetchAuctions();
        navigate('landing');
    });

    app.socket.on('auctionEndedAwaitingPayment', (data) => {
        showToast(`Auction ended! Winner ID: ${data.winnerId} - R${data.finalPrice.toLocaleString()}`, 'info');
        navigate('landing');
    });

    // ---------- VIDEO STREAMING EVENTS (Phase 9) ----------
    app.socket.on('video-offer', (data) => {
        // Buyer receives offer from auctioneer
        if (!app.isAuctioneer && app.currentAuctionId) {
            handleVideoOffer(data.offer, data.senderId);
        }
    });

    app.socket.on('video-answer', (data) => {
        // Auctioneer receives answer from buyer
        if (app.isAuctioneer && app.peer) {
            app.peer.signal(data.answer);
        }
    });

    app.socket.on('video-candidate', (data) => {
        // Both receive ICE candidates
        if (app.peer) {
            app.peer.signal(data.candidate);
        }
    });

    app.socket.on('video-ended', (data) => {
        showToast('📹 Auctioneer has ended the stream', 'info');
        stopVideoStream();
    });
}

// ============================================================
// ========== FETCH AUCTIONS ==================================
// ============================================================

async function fetchAuctions() {
    try {
        const data = await api('/api/auctions');
        app.auctions = data;

        if (data && data.length > 0) {
            app._sellerCache = app._sellerCache || {};
            const sellerIds = [...new Set(data.map(a => a.sellerId))];
            for (const sellerId of sellerIds) {
                if (!app._sellerCache[sellerId]) {
                    try {
                        const sellerData = await api(`/api/seller/ratings/${sellerId}`);
                        app._sellerCache[sellerId] = sellerData;
                    } catch (e) {
                        app._sellerCache[sellerId] = { trustScore: null, totalRatings: 0 };
                    }
                }
            }
        }

        if (app.user) {
            const wonAuctions = app.auctions.filter(a => a.winnerId === app.user.id && a.status === 'PAID' && !a.rated);
            if (wonAuctions.length > 0) {
                const auction = wonAuctions[0];
                const sellerData = app._sellerCache?.[auction.sellerId];
                if (sellerData) {
                    setTimeout(() => {
                        const seller = { id: auction.sellerId, name: auction.seller || 'Seller' };
                        showRatingPopup(auction, seller);
                    }, 1500);
                }
            }
        }

        return data;
    } catch (err) {
        console.error('Failed to fetch auctions:', err);
        return [];
    }
}

// ============================================================
// ========== RENDER LANDING (Auction List) ==================
// ============================================================

function renderLanding() {
    const main = document.getElementById('mainContent');
    if (!app.auctions || app.auctions.length === 0) {
        main.innerHTML = `
            <div class="landing-hero">
                <h1>Live & Timed Auctions</h1>
                <p>No auctions running right now. Check back soon!</p>
                ${(app.user?.role === 'seller' || app.user?.role === 'admin') ? `
                    <button class="btn btn-primary" onclick="openCreateAuction()">Create First Auction</button>
                ` : ''}
            </div>
        `;
        return;
    }

    let cards = '';
    app.auctions.forEach(auction => {
        const seller = app.user && app.user.email === auction.seller ? ' (You)' : '';
        const statusColor = auction.status === 'LIVE' ? 'var(--green)' : 'var(--orange)';
        const timeDisplay = auction.auctionType === 'LIVE' 
            ? `⏱ ${auction.timeLeft || 30}s` 
            : `📅 Ends: ${new Date(auction.endTime).toLocaleDateString()}`;

        cards += `
            <div class="auction-card" onclick="viewAuction('${auction.id}')">
                <div class="auction-image">
                    ${auction.images && auction.images.length > 0 
                        ? `<img src="${auction.images[0].dataUrl}" alt="${auction.title}">` 
                        : `<div class="no-image"><i class="fas fa-image"></i></div>`}
                    <span class="auction-status" style="background:${statusColor}">${auction.status}</span>
                </div>
                <div class="auction-info">
                    <h3>${auction.title}</h3>
                    <p class="auction-meta">
                        <span><i class="fas fa-user"></i> ${auction.seller}${seller}</span>
                        ${auction.sellerId ? `<span class="trust-score">⭐ ${getSellerTrustScore(auction.sellerId)}</span>` : ''}
                        <span><i class="fas fa-tag"></i> ${auction.category || 'General'}</span>
                    </p>
                    <p class="auction-meta">
                        <span><i class="fas fa-clock"></i> ${timeDisplay}</span>
                        <span><i class="fas fa-map-pin"></i> ${auction.city || 'Online'}</span>
                    </p>
                    <p class="auction-bid">
                        Current Bid: <strong>${auction.currentBid ? `R${auction.currentBid.toLocaleString()}` : 'No bids yet'}</strong>
                        ${auction.reserve ? `<span class="reserve">Reserve: R${auction.reserve.toLocaleString()}</span>` : ''}
                    </p>
                    ${auction.inspectionReport ? `<span class="kyc-badge">📄 Inspection Available</span>` : ''}
                    ${auction.auctionType === 'TIMED' ? `<span class="kyc-badge">⏳ Timed Auction</span>` : `<span class="kyc-badge">🔴 Live</span>`}
                </div>
            </div>
        `;
    });

    main.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem;flex-wrap:wrap;gap:1rem;">
            <h2 style="margin:0;">Active Auctions</h2>
            ${(app.user?.role === 'seller' || app.user?.role === 'admin') ? `
                <button class="btn btn-primary" onclick="openCreateAuction()"><i class="fas fa-plus"></i> Create Auction</button>
            ` : ''}
        </div>
        <div class="auction-grid">
            ${cards}
        </div>
    `;
}

// ============================================================
// ========== VIEW AUCTION (Enter Room) ======================
// ============================================================

async function viewAuction(auctionId) {
    // If already in a room, leave first
    if (app.currentAuctionId && app.currentAuctionId !== auctionId) {
        leaveAuctionRoom();
    }
    app.currentAuctionId = auctionId;
    await renderAuctionRoom(auctionId);
    document.getElementById('mainContent').scrollIntoView({ behavior: 'smooth' });
}

function leaveAuctionRoom() {
    if (app.socket && app.currentAuctionId) {
        app.socket.emit('leaveAuction');
    }
    app.currentAuctionId = null;
    app.isAuctioneer = false;
    if (app.timerInterval) {
        clearInterval(app.timerInterval);
        app.timerInterval = null;
    }
    stopVideoStream();
}

// ============================================================
// ========== RENDER AUCTION ROOM ============================
// ============================================================

async function renderAuctionRoom(auctionId) {
    try {
        const auction = await api(`/api/auctions/${auctionId}`);
        const main = document.getElementById('mainContent');
        app.isAuctioneer = (app.user && auction.sellerId === app.user.id);

        // Build room HTML
        const roomHTML = `
            <div class="auction-room">
                <!-- Left Column: Main Content -->
                <div class="auction-room-main">
                    <!-- Header -->
                    <div>
                        <div class="room-header">
                            <h2>${auction.title}</h2>
                            <button class="back-btn" onclick="navigate('landing')"><i class="fas fa-arrow-left"></i> Back</button>
                        </div>
                        <div class="room-meta">
                            <span><i class="fas fa-user"></i> ${auction.seller} ${app.isAuctioneer ? '(You)' : ''}</span>
                            <span><i class="fas fa-tag"></i> ${auction.category || 'General'}</span>
                            <span><i class="fas fa-map-pin"></i> ${auction.city || 'Online'}</span>
                            <span class="viewer-count"><i class="fas fa-eye"></i> <span id="viewerCount">0</span> watching</span>
                        </div>
                    </div>

                    <!-- Images -->
                    <div>
                        ${auction.images && auction.images.length > 0 ? `
                            <img src="${auction.images[0].dataUrl}" class="main-image" alt="${auction.title}">
                            <div class="room-images">
                                ${auction.images.slice(1).map(img => `
                                    <img src="${img.dataUrl}" alt="${auction.title}" onclick="this.parentElement.previousElementSibling.src='${img.dataUrl}'">
                                `).join('')}
                            </div>
                        ` : '<div class="card" style="text-align:center;padding:3rem;color:var(--muted);">No images available</div>'}
                    </div>

                    <!-- Video Container -->
                    <div class="video-container">
                        <div id="videoContainer">
                            ${app.isAuctioneer ? `
                                <div class="video-placeholder">📹 Click "Start Stream" to broadcast live video</div>
                                <div class="video-controls">
                                    <button class="btn btn-primary" onclick="startVideoStream()"><i class="fas fa-video"></i> Start Stream</button>
                                    <button class="btn btn-danger" onclick="stopVideoStream()" style="display:none;" id="stopStreamBtn"><i class="fas fa-stop"></i> Stop Stream</button>
                                </div>
                            ` : `
                                <div class="video-placeholder">📹 Waiting for auctioneer to start stream...</div>
                                <video id="remoteVideo" autoplay playsinline style="width:100%;max-height:400px;background:#000;border-radius:8px;display:none;"></video>
                            `}
                        </div>
                    </div>

                    <!-- Current Bid & Timer -->
                    <div class="current-bid-section">
                        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
                            <div>
                                <div class="bid-amount" id="currentBidDisplay">${auction.currentBid ? `R${auction.currentBid.toLocaleString()}` : 'No bids yet'}</div>
                                <div class="bidder-name" id="currentBidderDisplay">${auction.currentBidder ? `Bidder: ${auction.currentBidder}` : 'Place first bid'}</div>
                            </div>
                            <div>
                                <div class="timer" id="timerDisplay">${auction.timeLeft || 30}s</div>
                                <div style="font-size:0.8rem;color:var(--muted);">${auction.auctionType === 'LIVE' ? '⏱ Time remaining' : '⏳ Auction ends soon'}</div>
                            </div>
                        </div>
                    </div>

                    <!-- Bid History -->
                    <div class="bid-history" id="bidHistory">
                        <div style="display:flex;justify-content:space-between;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border);padding-bottom:0.3rem;">
                            <span>Bid History</span>
                            <span>Amount</span>
                        </div>
                        <div id="bidHistoryList">
                            ${(auction.analytics?.bidHistory || []).slice(-10).reverse().map(b => `
                                <div class="history-item">
                                    <span class="bidder">${b.bidderId || 'Bidder'}</span>
                                    <span class="amount">R${b.amount.toLocaleString()}</span>
                                </div>
                            `).join('')}
                            ${(!auction.analytics?.bidHistory || auction.analytics.bidHistory.length === 0) ? '<div style="color:var(--muted);text-align:center;padding:0.5rem;">No bids yet</div>' : ''}
                        </div>
                    </div>
                </div>

                <!-- Right Column: Sidebar -->
                <div class="auction-room-sidebar">
                    <!-- Bid Controls -->
                    <div class="card">
                        ${app.user ? `
                            ${auction.auctionType === 'LIVE' && auction.status === 'LIVE' ? `
                                <h3>Place Bid</h3>
                                <div class="form-group">
                                    <label>Your Bid (R)</label>
                                    <input type="number" id="bidInput" placeholder="Enter amount" step="1000" min="${(auction.currentBid || 0) + 1000}">
                                </div>
                                <button class="btn btn-primary btn-block" onclick="placeHandRaise('${auction.id}')">
                                    <i class="fas fa-hand-paper"></i> Raise Hand
                                </button>
                                <small style="color:var(--muted);font-size:0.75rem;">Auctioneer must ACK your bid</small>
                            ` : ''}
                            ${auction.auctionType === 'TIMED' && auction.status === 'LIVE' && !auction.isLast10Min ? `
                                <h3>Proxy Bidding</h3>
                                <p style="font-size:0.85rem;color:var(--muted);">Set max bid. System auto-bids in R${auction.increment || 1000} increments.</p>
                                <div class="form-group">
                                    <label>Your Maximum Bid (R)</label>
                                    <input type="number" id="proxyMaxInput" placeholder="Max bid" step="${auction.increment || 1000}" min="${(auction.currentBid || 0) + 1000}">
                                </div>
                                <button class="btn btn-primary btn-block" onclick="placeProxyBidRoom('${auction.id}')">
                                    <i class="fas fa-robot"></i> Set Max Bid
                                </button>
                                <div id="proxyStatusRoom" style="margin-top:0.5rem;font-size:0.85rem;color:var(--muted);"></div>
                            ` : ''}
                            ${auction.isLast10Min ? `
                                <div style="background:rgba(255,149,0,0.15);padding:0.8rem;border-radius:8px;border:1px solid var(--orange);text-align:center;">
                                    <span style="color:var(--orange);font-weight:600;">🔴 LIVE NOW!</span>
                                    <span style="color:var(--muted);font-size:0.85rem;display:block;">Auctioneer is controlling bids. Join live!</span>
                                </div>
                            ` : ''}
                            ${!app.user ? `<p style="color:var(--muted);">Login to bid</p>` : ''}
                        ` : ''}
                    </div>

                    <!-- Bid Queue (Auctioneer Only) -->
                    ${app.isAuctioneer ? `
                        <div class="card">
                            <h3>Bid Queue <span style="font-size:0.8rem;color:var(--muted);">(${(auction.bidders || []).length})</span></h3>
                            <div class="bid-queue" id="bidQueue">
                                ${(auction.bidders || []).length > 0 ? (auction.bidders || []).map(b => `
                                    <div class="bid-item">
                                        <div class="bid-info">
                                            <span class="bidder-name">${b.name} <span class="kyc-badge">${b.kycBadge || 'KYC'}</span></span>
                                            <span class="bid-amount">R${b.amount.toLocaleString()}</span>
                                        </div>
                                        <div class="bid-actions">
                                            <button class="ack-btn" onclick="handleAckBid('${auction.id}','${b.userId}',${b.amount})">ACK</button>
                                            <button class="reject-btn" onclick="handleRejectBid('${auction.id}','${b.userId}',${b.amount})">✕</button>
                                        </div>
                                    </div>
                                `).join('') : '<div class="empty-queue">No pending bids</div>'}
                            </div>
                            ${auction.status === 'LIVE' || auction.status === 'LIVE_LAST_10MIN' ? `
                                <button class="btn btn-warning btn-block" style="margin-top:0.5rem;" onclick="handleSoldLot('${auction.id}')">
                                    <i class="fas fa-gavel"></i> SOLD
                                </button>
                            ` : ''}
                        </div>
                    ` : ''}

                    <!-- Extra Info -->
                    <div class="card">
                        <h3>Auction Details</h3>
                        <p style="font-size:0.85rem;color:var(--muted);">
                            <strong>Type:</strong> ${auction.auctionType}<br>
                            <strong>Status:</strong> ${auction.status}<br>
                            <strong>Reserve:</strong> R${auction.reserve ? auction.reserve.toLocaleString() : 'No reserve'}<br>
                            <strong>Started:</strong> ${new Date(auction.startTime).toLocaleString()}
                        </p>
                    </div>
                </div>
            </div>
        `;

        main.innerHTML = roomHTML;

        // Join auction room via socket
        if (app.socket) {
            app.socket.emit('joinAuction', auctionId);
        }

        // Start timer if LIVE
        if (auction.auctionType === 'LIVE' && (auction.status === 'LIVE' || auction.status === 'LIVE_LAST_10MIN')) {
            startTimer(auction.timeLeft || 30, auction.id);
        }

        // Update viewer count via socket event
        app.socket?.on('viewerCount', (count) => {
            const el = document.getElementById('viewerCount');
            if (el) el.textContent = count;
        });

        // Update current bid via socket event
        app.socket?.on('bidAccepted', (data) => {
            const bidDisplay = document.getElementById('currentBidDisplay');
            const bidderDisplay = document.getElementById('currentBidderDisplay');
            if (bidDisplay) bidDisplay.textContent = `R${data.amount.toLocaleString()}`;
            if (bidderDisplay) bidderDisplay.textContent = `Bidder: ${data.bidderId || 'Someone'}`;
            renderAuctionRoom(auctionId);
        });

        // Update timer via socket event
        app.socket?.on('timerUpdate', (data) => {
            const timerEl = document.getElementById('timerDisplay');
            if (timerEl) timerEl.textContent = data.timeLeft + 's';
        });

        // Update bid queue via socket event
        app.socket?.on('handRaiseQueued', () => {
            if (app.isAuctioneer) renderAuctionRoom(auctionId);
        });

    } catch (err) {
        showToast('Error loading auction: ' + err.message, 'error');
        navigate('landing');
    }
}

// ============================================================
// ========== TIMER LOGIC ====================================
// ============================================================

function startTimer(initialSeconds, auctionId) {
    if (app.timerInterval) clearInterval(app.timerInterval);
    let seconds = initialSeconds || 30;

    app.timerInterval = setInterval(() => {
        seconds--;
        const timerEl = document.getElementById('timerDisplay');
        if (timerEl) {
            timerEl.textContent = seconds + 's';
            if (seconds <= 5) timerEl.classList.add('warning');
            else timerEl.classList.remove('warning');
        }
        if (seconds <= 0) {
            clearInterval(app.timerInterval);
            app.timerInterval = null;
            showToast('⏰ Time is up! Auctioneer must decide.', 'info');
            // Auto-close? We'll let auctioneer handle it.
        }
    }, 1000);
}

// ============================================================
// ========== BIDDING FUNCTIONS ==============================
// ============================================================

function placeHandRaise(auctionId) {
    const input = document.getElementById('bidInput');
    const amount = parseFloat(input?.value);
    if (!amount || amount <= 0) return showToast('Enter a valid bid amount', 'error');
    if (!app.socket) return showToast('Not connected', 'error');
    app.socket.emit('handRaise', { auctionId, bidAmount: amount });
    showToast(`Bid of R${amount.toLocaleString()} raised! Waiting for ACK.`, 'info');
}

function placeProxyBidRoom(auctionId) {
    const input = document.getElementById('proxyMaxInput');
    const maxBid = parseFloat(input?.value);
    if (!maxBid || maxBid <= 0) return showToast('Enter a valid maximum bid', 'error');
    placeProxyBid(auctionId);
}

function handleAckBid(auctionId, bidderId, amount) {
    if (!app.socket) return showToast('Not connected', 'error');
    app.socket.emit('managerAck', { auctionId, bidderId, amount });
    showToast(`Bid R${amount.toLocaleString()} ACCEPTED`, 'success');
}

function handleRejectBid(auctionId, bidderId, amount) {
    if (!app.socket) return showToast('Not connected', 'error');
    app.socket.emit('managerReject', { auctionId, bidderId, amount });
    showToast(`Bid R${amount.toLocaleString()} REJECTED`, 'error');
}

function handleSoldLot(auctionId) {
    const winnerId = prompt('Enter winner user ID:');
    if (!winnerId) return;
    const finalPrice = prompt('Enter final sale price (R):');
    if (!finalPrice) return;
    if (!app.socket) return showToast('Not connected', 'error');
    app.socket.emit('soldLot', {
        auctionId,
        winnerId,
        finalPrice: parseFloat(finalPrice)
    });
    showToast(`Lot sold for R${parseFloat(finalPrice).toLocaleString()}`);
}

// ============================================================
// ========== VIDEO STREAMING (Phase 9) =====================
// ============================================================

function startVideoStream() {
    if (!app.user || !app.isAuctioneer) return showToast('Only the auctioneer can start the stream', 'error');
    if (app.videoStream) return showToast('Stream already active', 'info');

    navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            sampleRate: 48000
        }
    }).then(stream => {
        app.videoStream = stream;
        document.querySelector('.video-placeholder')?.remove();
        document.getElementById('stopStreamBtn').style.display = 'inline-block';
        // Show local video
        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        video.style.width = '100%';
        video.style.maxHeight = '400px';
        video.style.background = '#000';
        video.style.borderRadius = '8px';
        const container = document.getElementById('videoContainer');
        container.prepend(video);

        // Create peer connection for each viewer? We'll use SimplePeer.
        // For simplicity, we'll use a basic approach: send offer to all viewers via socket.
        // We'll implement full WebRTC in Phase 9.2.
        showToast('📹 Stream started!', 'info');
    }).catch(err => {
        showToast('Could not access camera: ' + err.message, 'error');
    });
}

function stopVideoStream() {
    if (app.videoStream) {
        app.videoStream.getTracks().forEach(t => t.stop());
        app.videoStream = null;
        document.getElementById('stopStreamBtn').style.display = 'none';
        // Remove video element
        const videos = document.querySelectorAll('#videoContainer video');
        videos.forEach(v => v.remove());
        const placeholder = document.createElement('div');
        placeholder.className = 'video-placeholder';
        placeholder.textContent = '📹 Stream ended';
        document.getElementById('videoContainer').prepend(placeholder);
        // Notify viewers
        if (app.socket) app.socket.emit('video-ended');
        showToast('📹 Stream stopped', 'info');
    }
}

// ---------- WebRTC Signaling (Simplified) ----------
// We'll expand this in Phase 9.2 for full peer-to-peer with TURN.

// ============================================================
// ========== PROXY BID (Existing) ==========================
// ============================================================

async function placeProxyBid(auctionId) {
    const input = document.getElementById(`proxyMax_${auctionId}`) || document.getElementById('proxyMaxInput');
    const maxBid = parseFloat(input?.value);
    if (!maxBid || maxBid <= 0) return showToast('Enter a valid maximum bid', 'error');

    try {
        const data = await api(`/api/auctions/${auctionId}/proxy-bid`, 'POST', { maxBid });
        const statusEl = document.getElementById(`proxyStatus_${auctionId}`) || document.getElementById('proxyStatusRoom');
        if (data.youAreWinning) {
            statusEl.innerHTML = `✅ You are winning at R${data.currentBid.toLocaleString()} (max: R${maxBid.toLocaleString()})`;
            statusEl.style.color = 'var(--green)';
        } else {
            statusEl.innerHTML = `⚠️ You were outbid. Current: R${data.currentBid.toLocaleString()}`;
            statusEl.style.color = 'var(--orange)';
        }
        showToast(`Proxy bid placed! Current bid: R${data.currentBid.toLocaleString()}`, 'info');
        fetchAuctions();
        if (app.currentAuctionId) renderAuctionRoom(app.currentAuctionId);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================
// ========== PROFILE, KYC, RATINGS (Existing) ==============
// ============================================================

function renderProfile() {
    const main = document.getElementById('mainContent');
    const user = app.user;

    main.innerHTML = `
        <div style="max-width:800px;margin:0 auto;">
            <h2>Your Profile</h2>
            <div class="card" style="margin-bottom:2rem;">
                <p><strong>Name:</strong> ${user.name}</p>
                <p><strong>Email:</strong> ${user.email}</p>
                <p><strong>Role:</strong> ${user.role}</p>
                <p><strong>KYC Level:</strong> ${user.kycLevel} - ${getBadgeText(user.kycLevel)}</p>
                <p><strong>Status:</strong> ${user.status || 'ACTIVE'}</p>
                <button class="btn btn-primary" onclick="showKYCUpgrade()">Upgrade KYC</button>
            </div>

            ${user.role === 'seller' || user.role === 'admin' ? `
                <div class="card">
                    <h3>Seller Requirements - Set Your Rules</h3>
                    <p style="color:var(--muted);font-size:0.9rem;">These rules apply to ALL your auctions. Buyers must meet these to bid.</p>
                    <div class="form-group">
                        <label>Deposit Required to Join Your Auctions (R)</label>
                        <input type="number" id="sellerDeposit" value="${user.sellerRequirements?.depositAmount || 0}" placeholder="7000" style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;">
                    </div>
                    <div class="form-group">
                        <label>Minimum KYC Level Required</label>
                        <select id="sellerKycLevel" style="color:#fff;background:rgba(255,255,255,0.05);padding:0.6rem;border-radius:8px;width:100%;border:1px solid rgba(255,255,255,0.1);">
                            <option value="1" ${user.sellerRequirements?.minKycLevel === 1 ? 'selected' : ''}>Level 1 - ID Verified</option>
                            <option value="2" ${user.sellerRequirements?.minKycLevel === 2 ? 'selected' : ''}>Level 2 - ID + Selfie</option>
                            <option value="3" ${user.sellerRequirements?.minKycLevel === 3 ? 'selected' : ''}>Level 3 - Address Verified</option>
                            <option value="4" ${user.sellerRequirements?.minKycLevel === 4 ? 'selected' : ''}>Level 4 - Bank Verified</option>
                            <option value="5" ${user.sellerRequirements?.minKycLevel === 5 ? 'selected' : ''}>Level 5 - Million-Rand</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Services You Offer (like Auction Operation)</label>
                        <div style="display:flex;flex-wrap:wrap;gap:1rem;margin-top:0.5rem;">
                            <label><input type="checkbox" id="svcInspection" ${user.sellerRequirements?.servicesOffered?.includes('inspection') ? 'checked' : ''}> Inspection</label>
                            <label><input type="checkbox" id="svcNatis" ${user.sellerRequirements?.servicesOffered?.includes('natis') ? 'checked' : ''}> Natis Dept</label>
                            <label><input type="checkbox" id="svcTransport" ${user.sellerRequirements?.servicesOffered?.includes('transport') ? 'checked' : ''}> Transport</label>
                            <label><input type="checkbox" id="svcStorage" ${user.sellerRequirements?.servicesOffered?.includes('storage') ? 'checked' : ''}> Storage</label>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>PPRA Registration Number</label>
                        <input id="ppraReg" value="${user.sellerRequirements?.ppraReg || ''}" placeholder="12345" style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;">
                    </div>
                    <div class="form-group">
                        <label>BBBEE Level</label>
                        <select id="bbbeeLevel" style="color:#fff;background:rgba(255,255,255,0.05);padding:0.6rem;border-radius:8px;width:100%;border:1px solid rgba(255,255,255,0.1);">
                            <option value="">None</option>
                            <option value="1" ${user.sellerRequirements?.bbbeeLevel === 1 ? 'selected' : ''}>Level 1</option>
                            <option value="2" ${user.sellerRequirements?.bbbeeLevel === 2 ? 'selected' : ''}>Level 2</option>
                            <option value="3" ${user.sellerRequirements?.bbbeeLevel === 3 ? 'selected' : ''}>Level 3</option>
                        </select>
                    </div>
                    <button class="btn btn-primary" onclick="saveSellerRequirements()">Save Requirements</button>
                </div>
            ` : ''}
            ${user.role === 'buyer' ? `
                <div class="card">
                    <h3>Your Bidding History</h3>
                    <p style="color:var(--muted);">You haven't won any auctions yet.</p>
                </div>
            ` : ''}
        </div>
    `;
}

async function saveSellerRequirements() {
    const services = [];
    if (document.getElementById('svcInspection')?.checked) services.push('inspection');
    if (document.getElementById('svcNatis')?.checked) services.push('natis');
    if (document.getElementById('svcTransport')?.checked) services.push('transport');
    if (document.getElementById('svcStorage')?.checked) services.push('storage');

    const data = {
        depositAmount: parseInt(document.getElementById('sellerDeposit').value) || 0,
        minKycLevel: parseInt(document.getElementById('sellerKycLevel').value) || 1,
        servicesOffered: services,
        ppraReg: document.getElementById('ppraReg').value || null,
        bbbeeLevel: document.getElementById('bbbeeLevel').value ? parseInt(document.getElementById('bbbeeLevel').value) : null,
        saiaMember: false
    };

    try {
        const res = await api('/api/seller/requirements', 'POST', data);
        app.user.sellerRequirements = res.requirements;
        localStorage.setItem('user', JSON.stringify(app.user));
        showToast('Requirements saved successfully!');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function showKYCUpgrade() {
    openModal(`
        <span class="close-modal" onclick="closeModal()">&times;</span>
        <h3>Upgrade KYC Level</h3>
        <p style="color:var(--muted);">Current Level: ${app.user.kycLevel}</p>
        <div class="form-group">
            <label>Target Level</label>
            <select id="kycTarget" style="color:#fff;background:rgba(255,255,255,0.05);padding:0.6rem;border-radius:8px;width:100%;border:1px solid rgba(255,255,255,0.1);">
                <option value="2">Level 2 - ID + Selfie</option>
                <option value="3">Level 3 - Address Verified</option>
                <option value="4">Level 4 - Bank Verified (Ozow)</option>
                <option value="5">Level 5 - Million-Rand</option>
            </select>
        </div>
        <div class="form-group" id="bankFields" style="display:none;">
            <label>Bank Account Number</label>
            <input id="bankAccount" placeholder="1234567890" style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;">
            <label style="margin-top:0.5rem;">Bank</label>
            <select id="bankCode" style="color:#fff;background:rgba(255,255,255,0.05);padding:0.6rem;border-radius:8px;width:100%;border:1px solid rgba(255,255,255,0.1);">
                <option value="FNB">FNB</option>
                <option value="ABSA">ABSA</option>
                <option value="STD">Standard Bank</option>
                <option value="NED">Nedbank</option>
                <option value="CAP">Capitec</option>
            </select>
        </div>
        <button class="btn btn-primary" style="width:100%;" onclick="submitKYCUpgrade()">Upgrade</button>
    `);
    document.getElementById('kycTarget').addEventListener('change', function() {
        document.getElementById('bankFields').style.display = this.value === '4' ? 'block' : 'none';
    });
}

async function submitKYCUpgrade() {
    const targetLevel = parseInt(document.getElementById('kycTarget').value);
    const bankAccount = document.getElementById('bankAccount')?.value || '';
    const bankCode = document.getElementById('bankCode')?.value || '';
    if (targetLevel === 4 && (!bankAccount || bankAccount.length < 6)) {
        return showToast('Please enter a valid bank account number', 'error');
    }
    try {
        const data = await api('/api/kyc/upgrade', 'POST', { targetLevel, bankAccount, bankCode });
        app.token = data.token;
        app.user.kycLevel = data.kycLevel;
        localStorage.setItem('token', app.token);
        localStorage.setItem('user', JSON.stringify(app.user));
        closeModal();
        showToast(`✅ Upgraded to KYC Level ${data.kycLevel} - ${data.badge}`);
        navigate('profile');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function getBadgeText(level) {
    const badges = { 1: 'ID Verified ✓', 2: 'ID + Selfie ✓', 3: 'Address Verified ✓', 4: 'Bank Verified ✓✓', 5: 'Million-Rand ✓✓' };
    return badges[level] || 'Unverified';
}

function getSellerTrustScore(sellerId) {
    if (app._sellerCache && app._sellerCache[sellerId]) {
        const data = app._sellerCache[sellerId];
        if (data.trustScore) {
            return `${data.trustScore} (${data.totalRatings} reviews)`;
        }
        return 'New';
    }
    return 'New';
}

// ============================================================
// ========== SELLER DASHBOARD (with Analytics) ===============
// ============================================================

async function renderSellerDashboard() {
    const main = document.getElementById('mainContent');
    try {
        const auctions = await api('/api/seller/auctions');
        if (!auctions || auctions.length === 0) {
            main.innerHTML = `
                <div style="max-width:1000px;margin:0 auto;">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:2rem;">
                        <h2 style="margin:0;">Seller Dashboard</h2>
                        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                            <button class="btn btn-primary" onclick="openCreateAuction()"><i class="fas fa-plus"></i> New Auction</button>
                            <button class="btn btn-outline" onclick="loadGhostLeads()"><i class="fas fa-ghost"></i> Ghost Leads</button>
                        </div>
                    </div>
                    <div class="card">
                        <p style="color:var(--muted);">You haven't created any auctions yet.</p>
                    </div>
                    <div id="analyticsContainer"></div>
                    <div id="ghostLeadsContainer" style="margin-top:2rem;"></div>
                </div>
            `;
            return;
        }

        let auctionCards = '';
        auctions.forEach(a => {
            const statusColor = a.status === 'LIVE' ? 'var(--green)' : a.status === 'UPCOMING' ? 'var(--orange)' : '#666';
            const hasAnalytics = a.analytics && a.analytics.bidHistory && a.analytics.bidHistory.length > 0;
            auctionCards += `
                <div class="card" style="margin-bottom:1rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
                        <h3 style="margin:0;">${a.title}</h3>
                        <span style="background:${statusColor};padding:0.2rem 0.8rem;border-radius:20px;font-size:0.8rem;">${a.status}</span>
                    </div>
                    <p style="color:var(--muted);font-size:0.9rem;">Type: ${a.auctionType} | Category: ${a.category || 'General'}</p>
                    <p>Current Bid: ${a.currentBid ? `R${a.currentBid.toLocaleString()}` : 'No bids'}</p>
                    ${a.winnerId ? `<p style="color:var(--green);">Winner: ${a.winnerId} | Final: R${a.finalPrice?.toLocaleString() || 'N/A'}</p>` : ''}
                    ${a.bidders && a.bidders.length > 0 ? `
                        <div style="margin-top:0.5rem;background:rgba(255,255,255,0.05);padding:0.5rem;border-radius:8px;">
                            <strong>Bid Queue (${a.bidders.length}):</strong>
                            ${a.bidders.slice(0,3).map(b => `
                                <span style="display:inline-block;margin:0.2rem 0.4rem;background:rgba(0,255,136,0.1);padding:0.2rem 0.6rem;border-radius:12px;font-size:0.8rem;">
                                    ${b.name} - R${b.amount.toLocaleString()} (${b.kycBadge})
                                    <button onclick="ackBid('${a.id}','${b.userId}',${b.amount})" style="background:var(--green);color:#000;border:none;border-radius:4px;padding:0.1rem 0.5rem;cursor:pointer;margin-left:0.3rem;">ACK</button>
                                    <button onclick="rejectBid('${a.id}','${b.userId}',${b.amount})" style="background:#ff4444;color:#fff;border:none;border-radius:4px;padding:0.1rem 0.5rem;cursor:pointer;margin-left:0.2rem;">✕</button>
                                </span>
                            `).join('')}
                            ${a.bidders.length > 3 ? `<span style="color:var(--muted);font-size:0.8rem;">+${a.bidders.length - 3} more</span>` : ''}
                        </div>
                    ` : ''}
                    ${a.status === 'LIVE' ? `
                        <button class="btn btn-primary" style="margin-top:0.5rem;" onclick="soldLot('${a.id}')">
                            <i class="fas fa-gavel"></i> SOLD
                        </button>
                    ` : ''}
                    ${a.status === 'AWAITING_PAYMENT' && a.winnerId ? `
                        <button class="btn btn-primary" style="margin-top:0.5rem;background:#ffd700;color:#000;border-color:#ffd700;" onclick="markAsPaid('${a.id}')">
                            <i class="fas fa-check-circle"></i> Mark as Paid
                        </button>
                    ` : ''}
                    ${hasAnalytics ? `
                        <button class="btn btn-outline" style="margin-top:0.5rem;" onclick="loadAnalytics('${a.id}')">
                            <i class="fas fa-chart-line"></i> View Analytics
                        </button>
                    ` : ''}
                    ${hasAnalytics ? `
                        <button class="btn btn-outline" style="margin-top:0.5rem;" onclick="downloadDNA('${a.id}')">
                            <i class="fas fa-file-pdf"></i> Download DNA Report
                        </button>
                    ` : ''}
                </div>
            `;
        });

        main.innerHTML = `
            <div style="max-width:1000px;margin:0 auto;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:2rem;">
                    <h2 style="margin:0;">Seller Dashboard</h2>
                    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                        <button class="btn btn-primary" onclick="openCreateAuction()"><i class="fas fa-plus"></i> New Auction</button>
                        <button class="btn btn-outline" onclick="loadGhostLeads()"><i class="fas fa-ghost"></i> Ghost Leads</button>
                    </div>
                </div>
                ${auctionCards}
                <div id="analyticsContainer"></div>
                <div id="ghostLeadsContainer" style="margin-top:2rem;"></div>
            </div>
        `;
    } catch (err) {
        main.innerHTML = `<p style="color:var(--muted);">Error loading dashboard: ${err.message}</p>`;
    }
}

// ---------- LOAD ANALYTICS ----------
async function loadAnalytics(auctionId) {
    try {
        const data = await api(`/api/seller/analytics/${auctionId}`);
        const container = document.getElementById('analyticsContainer');
        if (!container) return;

        container.innerHTML = `
            <div class="card" style="margin-top:2rem;border-color:var(--green);">
                <h3><i class="fas fa-chart-line" style="color:var(--green);"></i> Auction Analytics</h3>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin:1rem 0;">
                    <div style="text-align:center;background:rgba(0,255,136,0.05);padding:1rem;border-radius:12px;">
                        <h1 style="color:var(--green);font-size:2rem;margin:0;">${data.peakViewers}</h1>
                        <p style="color:var(--muted);font-size:0.8rem;">Peak Viewers</p>
                    </div>
                    <div style="text-align:center;background:rgba(255,149,0,0.05);padding:1rem;border-radius:12px;">
                        <h1 style="color:var(--orange);font-size:2rem;margin:0;">${data.totalBids}</h1>
                        <p style="color:var(--muted);font-size:0.8rem;">Total Bids</p>
                    </div>
                    <div style="text-align:center;background:rgba(77,171,247,0.05);padding:1rem;border-radius:12px;">
                        <h1 style="color:#4dabf7;font-size:2rem;margin:0;">${data.avgBidTime}s</h1>
                        <p style="color:var(--muted);font-size:0.8rem;">Avg Bid Speed</p>
                    </div>
                    <div style="text-align:center;background:rgba(255,215,0,0.05);padding:1rem;border-radius:12px;">
                        <h1 style="color:#ffd700;font-size:2rem;margin:0;">${data.uniqueBidders}</h1>
                        <p style="color:var(--muted);font-size:0.8rem;">Unique Bidders</p>
                    </div>
                </div>
                <h4 style="margin-top:1.5rem;">KYC Breakdown of Viewers</h4>
                <div style="display:flex;gap:0.5rem;margin:0.5rem 0 1.5rem;">
                    ${Object.entries(data.kycBreakdown).map(([level, count]) => {
                        const colors = { 1: '#666', 2: '#4dabf7', 3: '#ff9500', 4: '#00ff88', 5: '#ffd700' };
                        const height = Math.max(20, count * 10 + 20);
                        return `
                            <div style="flex:1;text-align:center;">
                                <div style="height:${height}px;background:${colors[level] || '#666'};border-radius:8px;transition:0.3s;"></div>
                                <p style="font-size:0.7rem;margin-top:0.3rem;color:var(--muted);">L${level}<br>${count}</p>
                            </div>
                        `;
                    }).join('')}
                </div>
                <h4 style="margin-top:1.5rem;">Top 10 Bidders</h4>
                <div style="overflow-x:auto;">
                    <table style="width:100%;font-size:0.9rem;border-collapse:collapse;">
                        <thead>
                            <tr style="opacity:0.6;border-bottom:1px solid var(--border);">
                                <th style="padding:0.5rem;text-align:left;">Name</th>
                                <th style="padding:0.5rem;text-align:left;">KYC</th>
                                <th style="padding:0.5rem;text-align:center;">Bids</th>
                                <th style="padding:0.5rem;text-align:right;">Max Bid</th>
                                <th style="padding:0.5rem;text-align:right;">Last Bid</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.topBidders.map(b => `
                                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                    <td style="padding:0.5rem;">${b.name}</td>
                                    <td style="padding:0.5rem;"><span class="kyc-badge">${b.badge}</span></td>
                                    <td style="padding:0.5rem;text-align:center;">${b.totalBids}</td>
                                    <td style="padding:0.5rem;text-align:right;">R${b.maxBid.toLocaleString()}</td>
                                    <td style="padding:0.5rem;text-align:right;color:var(--muted);font-size:0.8rem;">${b.lastBidTime}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <h4 style="margin-top:1.5rem;">Bid Timeline</h4>
                <canvas id="bidChart" height="120" style="width:100%;"></canvas>
                <button class="btn btn-outline" style="margin-top:1rem;" onclick="document.getElementById('analyticsContainer').innerHTML=''">
                    Close Analytics
                </button>
            </div>
        `;

        const ctx = document.getElementById('bidChart');
        if (ctx && data.bidTimeline && data.bidTimeline.length > 0) {
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: data.bidTimeline.map(b => b.time),
                    datasets: [{
                        label: 'Bid Amount (R)',
                        data: data.bidTimeline.map(b => b.amount),
                        borderColor: '#5fb4a2',
                        backgroundColor: 'rgba(95,180,162,0.1)',
                        fill: true,
                        tension: 0.3,
                        pointBackgroundColor: '#5fb4a2',
                        pointRadius: 3
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { labels: { color: '#a0a0b0', font: { size: 10 } } }
                    },
                    scales: {
                        x: { ticks: { color: '#a0a0b0', font: { size: 8 }, maxRotation: 45 } },
                        y: { ticks: { color: '#a0a0b0', font: { size: 8 } } }
                    }
                }
            });
        } else {
            document.getElementById('bidChart').innerHTML = '<p style="color:var(--muted);font-size:0.9rem;padding:1rem;text-align:center;">No bid data available yet.</p>';
        }
        container.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================
// ========== GHOST LEADS ====================================
// ============================================================

async function loadGhostLeads() {
    try {
        const leads = await api('/api/seller/ghost-leads');
        const container = document.getElementById('ghostLeadsContainer');
        if (!container) return;

        if (leads.length === 0) {
            container.innerHTML = `
                <div class="card">
                    <h3><i class="fas fa-ghost" style="color:var(--muted);"></i> Ghost Leads</h3>
                    <p style="color:var(--muted);">No ghost leads yet. Run more auctions to capture serious bidders who didn't win.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="card" style="border-color:var(--orange);">
                <h3><i class="fas fa-ghost" style="color:var(--orange);"></i> Ghost Leads (${leads.length})</h3>
                <p style="color:var(--muted);font-size:0.9rem;">Buyers who bid 80%+ of final price but lost. Contact them for similar stock.</p>
                <div style="margin-top:1rem;">
                    ${leads.map(l => `
                        <div class="chat-message" style="background:rgba(255,149,0,0.08);margin:0.5rem 0;border-left-color:var(--orange);">
                            <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
                                <div>
                                    <strong>${l.name}</strong>
                                    <span style="color:var(--muted);font-size:0.8rem;">(ID: ${l.userId})</span>
                                    <br>
                                    <span style="font-size:0.85rem;">Bid R${l.maxBid.toLocaleString()} on "${l.auctionTitle}"</span>
                                    <br>
                                    <span style="font-size:0.8rem;color:var(--muted);">Final: R${l.finalPrice.toLocaleString()} | ${l.bidCount} bids</span>
                                    <br>
                                    <span style="font-size:0.8rem;color:var(--muted);">Phone: ${l.phone || 'No phone'}</span>
                                    <br>
                                    <span style="font-size:0.8rem;color:var(--muted);">Email: ${l.email || 'No email'}</span>
                                </div>
                                <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:flex-start;">
                                    ${l.phone ? `<a href="tel:${l.phone}" class="btn btn-primary" style="padding:0.3rem 0.8rem;font-size:0.8rem;"><i class="fas fa-phone"></i> Call</a>` : ''}
                                    ${l.phone ? `<a href="https://wa.me/${formatPhoneForWhatsApp(l.phone)}" class="btn" style="padding:0.3rem 0.8rem;font-size:0.8rem;background:#25D366;color:#fff;border-color:#25D366;" target="_blank"><i class="fab fa-whatsapp"></i> WhatsApp</a>` : ''}
                                    <button class="btn btn-outline" style="padding:0.3rem 0.8rem;font-size:0.8rem;" onclick="markLeadContacted('${l.userId}','${l.auctionId}')"><i class="fas fa-check"></i> Contacted</button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        container.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function formatPhoneForWhatsApp(phone) {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '27' + cleaned.slice(1);
    if (!cleaned.startsWith('27')) cleaned = '27' + cleaned;
    return cleaned;
}

function markLeadContacted(userId, auctionId) {
    const auction = app.auctions.find(a => a.id === auctionId);
    if (!auction) return showToast('Auction not found', 'error');
    if (!auction.ghostBidders) return showToast('No ghost bidders found', 'error');
    const ghost = auction.ghostBidders.find(g => g.userId === userId);
    if (ghost) {
        ghost.contacted = true;
        showToast('Marked as contacted!', 'info');
        loadGhostLeads();
    }
}

// ============================================================
// ========== DOWNLOAD DNA REPORT ============================
// ============================================================

async function downloadDNA(auctionId) {
    try {
        const res = await fetch(`/api/seller/dna/${auctionId}`, {
            headers: { 'Authorization': `Bearer ${app.token}` }
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to download');
        }
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `AuctionDNA_${auctionId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        showToast('DNA Report downloaded!', 'info');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================
// ========== ACK / REJECT (from Dashboard) ==================
// ============================================================

function ackBid(auctionId, bidderId, amount) {
    if (!app.socket) return showToast('Not connected', 'error');
    app.socket.emit('managerAck', { auctionId, bidderId, amount });
    showToast(`Bid R${amount.toLocaleString()} ACCEPTED`);
}

function rejectBid(auctionId, bidderId, amount) {
    if (!app.socket) return showToast('Not connected', 'error');
    app.socket.emit('managerReject', { auctionId, bidderId, amount });
    showToast(`Bid R${amount.toLocaleString()} REJECTED`);
}

function soldLot(auctionId) {
    const winnerId = prompt('Enter winner user ID:');
    if (!winnerId) return;
    const finalPrice = prompt('Enter final sale price (R):');
    if (!finalPrice) return;
    if (!app.socket) return showToast('Not connected', 'error');
    app.socket.emit('soldLot', {
        auctionId,
        winnerId,
        finalPrice: parseFloat(finalPrice)
    });
    showToast(`Lot sold for R${parseFloat(finalPrice).toLocaleString()}`);
}

// ============================================================
// ========== MARK AS PAID ===================================
// ============================================================

async function markAsPaid(auctionId) {
    const auction = app.auctions.find(a => a.id === auctionId);
    if (!auction) return showToast('Auction not found', 'error');
    if (auction.sellerId !== app.user.id && app.user.role !== 'admin') {
        return showToast('Only the seller can mark as paid', 'error');
    }
    try {
        await api(`/api/auctions/${auctionId}/paid`, 'POST');
        auction.status = 'PAID';
        showToast('✅ Auction marked as paid! Buyer can now rate you.', 'info');
        renderSellerDashboard();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================
// ========== RATING POPUP ===================================
// ============================================================

function showRatingPopup(auction, seller) {
    if (auction.rated) return;
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
    modal.innerHTML = `
        <div class="card" style="max-width:450px;width:100%;max-height:90vh;overflow-y:auto;">
            <h3>Rate ${seller.name} ⭐</h3>
            <p style="color:var(--muted);font-size:0.9rem;">How was your experience? This helps other buyers trust this seller.</p>
            <div style="font-size:2.5rem;text-align:center;margin:1rem 0;" id="starsContainer">
                ${[1,2,3,4,5].map(s => `
                    <span onclick="setStars(${s})" style="cursor:pointer;transition:0.2s;color:#666;font-size:2.8rem;" id="star_${s}">☆</span>
                `).join('')}
            </div>
            <div class="form-group">
                <label>What went well? Select tags:</label>
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.3rem;">
                    ${['Fast Payment','Accurate Description','Good Communication','Item As Described','Professional','Fair Price'].map(tag => `
                        <button type="button" class="tag-btn" onclick="toggleRatingTag(this,'${tag}')" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:0.3rem 0.8rem;cursor:pointer;color:var(--text);transition:0.2s;font-size:0.8rem;">
                            ${tag}
                        </button>
                    `).join('')}
                </div>
            </div>
            <div class="form-group">
                <label>Comment (optional)</label>
                <textarea id="ratingComment" placeholder="Seller was great, item exactly as described..." maxlength="200" style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;resize:vertical;min-height:60px;"></textarea>
            </div>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                <button class="btn btn-primary" style="flex:1;" onclick="submitRating('${seller.id}','${auction.id}')">Submit Rating</button>
                <button class="btn btn-outline" onclick="this.closest('[style*=\"fixed\"]').remove()">Skip</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    window._ratingState = { stars: 0, tags: [] };

    window.setStars = (s) => {
        window._ratingState.stars = s;
        for (let i = 1; i <= 5; i++) {
            const el = document.getElementById(`star_${i}`);
            if (el) {
                el.textContent = i <= s ? '★' : '☆';
                el.style.color = i <= s ? '#ffd700' : '#666';
            }
        }
    };

    window.toggleRatingTag = (btn, tag) => {
        const idx = window._ratingState.tags.indexOf(tag);
        if (idx > -1) {
            window._ratingState.tags.splice(idx, 1);
            btn.style.background = 'rgba(255,255,255,0.05)';
            btn.style.borderColor = 'rgba(255,255,255,0.1)';
        } else {
            window._ratingState.tags.push(tag);
            btn.style.background = 'rgba(95,180,162,0.2)';
            btn.style.borderColor = '#5fb4a2';
        }
    };

    window.submitRating = async (sellerId, auctionId) => {
        if (window._ratingState.stars === 0) {
            return showToast('Please select a star rating', 'error');
        }
        const comment = document.getElementById('ratingComment')?.value || '';
        try {
            const data = await api('/api/rate-seller', 'POST', {
                sellerId,
                auctionId,
                stars: window._ratingState.stars,
                comment: comment,
                tags: window._ratingState.tags
            });
            modal.remove();
            showToast(`✅ Rating submitted! ⭐ ${data.trustScore}/5`, 'info');
            fetchAuctions();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };
}

// ============================================================
// ========== ADMIN DASHBOARD ================================
// ============================================================

async function renderAdminDashboard() {
    if (app.user?.role !== 'admin') {
        return showToast('Admin access required', 'error');
    }
    const main = document.getElementById('mainContent');
    try {
        const reports = await api('/api/admin/reports').catch(() => []);
        const bannedList = [];
        const allUsers = [];
        const kycQueue = allUsers.filter(u => u.kycLevel < 4 && u.kycLevel > 0);

        main.innerHTML = `
            <div style="max-width:1200px;margin:0 auto;">
                <h2>Admin Dashboard</h2>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-bottom:2rem;">
                    <div class="card" style="text-align:center;">
                        <h1 style="color:var(--green);font-size:2.5rem;margin:0;">${allUsers.length}</h1>
                        <p style="color:var(--muted);">Total Users</p>
                    </div>
                    <div class="card" style="text-align:center;">
                        <h1 style="color:var(--orange);font-size:2.5rem;margin:0;">${app.auctions.length}</h1>
                        <p style="color:var(--muted);">Total Auctions</p>
                    </div>
                    <div class="card" style="text-align:center;">
                        <h1 style="color:#ff4444;font-size:2.5rem;margin:0;">${bannedList.length}</h1>
                        <p style="color:var(--muted);">Banned Users</p>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">
                    <div class="card">
                        <h3>📋 Reports Queue</h3>
                        ${reports.length === 0 
                            ? '<p style="color:var(--muted);">No pending reports.</p>' 
                            : reports.map(r => `
                                <div class="chat-message" style="background:rgba(255,0,0,0.05);margin:0.5rem 0;">
                                    <p><strong>${r.buyerName}</strong> reported by ${r.sellerName}</p>
                                    <p style="font-size:0.8rem;color:var(--muted);">Auction: ${r.auctionTitle} | Amount: R${r.amount?.toLocaleString() || 'N/A'}</p>
                                    <p style="font-size:0.8rem;">Evidence: ${r.evidence || 'None'}</p>
                                    <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
                                        <button class="btn btn-danger" onclick="adminBanUser('${r.buyerId}','${r.auctionId}')">Ban User</button>
                                        <button class="btn" onclick="adminDismissReport('${r.id}')">Dismiss</button>
                                    </div>
                                </div>
                            `).join('')}
                    </div>
                    <div class="card">
                        <h3>🚫 Banned Users</h3>
                        ${bannedList.length === 0 
                            ? '<p style="color:var(--muted);">No banned users.</p>' 
                            : bannedList.slice(0, 10).map(b => `
                                <div style="display:flex;justify-content:space-between;padding:0.3rem 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
                                    <span><strong>${b.name}</strong> (${b.idNumber})</span>
                                    <span style="color:var(--muted);">${new Date(b.bannedAt).toLocaleDateString()}</span>
                                </div>
                            `).join('')}
                        ${bannedList.length > 10 ? `<p style="color:var(--muted);font-size:0.8rem;">+${bannedList.length - 10} more</p>` : ''}
                    </div>
                    <div class="card">
                        <h3>🔑 KYC Upgrade Queue</h3>
                        ${kycQueue.length === 0 
                            ? '<p style="color:var(--muted);">No pending KYC requests.</p>' 
                            : kycQueue.map(u => `
                                <div class="chat-message" style="margin:0.3rem 0;">
                                    <p><strong>${u.name}</strong> (${u.email})</p>
                                    <p style="font-size:0.8rem;color:var(--muted);">Current Level: ${u.kycLevel}</p>
                                    <button class="btn btn-primary" onclick="adminApproveKYC('${u.id}')">Approve</button>
                                </div>
                            `).join('')}
                    </div>
                    <div class="card">
                        <h3>⚡ Admin Actions</h3>
                        <button class="btn" onclick="adminCreateTestUser()" style="width:100%;margin-bottom:0.5rem;">
                            <i class="fas fa-user-plus"></i> Create Test Seller
                        </button>
                        <button class="btn" onclick="adminClearAllAuctions()" style="width:100%;background:#ff4444;color:#fff;">
                            <i class="fas fa-trash"></i> Clear All Auctions
                        </button>
                    </div>
                </div>
            </div>
        `;
    } catch (err) {
        main.innerHTML = `<p style="color:var(--muted);">Error loading admin dashboard: ${err.message}</p>`;
    }
}

window.adminBanUser = async (userId, auctionId) => {
    if (!confirm('Ban this user permanently?')) return;
    if (!app.socket) return showToast('Not connected', 'error');
    app.socket.emit('banUserForNonPayment', {
        userId,
        auctionId,
        evidence: 'Admin action'
    });
    showToast('User banned successfully');
    setTimeout(() => renderAdminDashboard(), 1000);
};

window.adminDismissReport = async (reportId) => {
    if (!confirm('Dismiss this report?')) return;
    showToast('Report dismissed', 'info');
};

window.adminApproveKYC = async (userId) => {
    if (!confirm('Approve KYC upgrade for this user?')) return;
    showToast('KYC approved', 'info');
};

window.adminCreateTestUser = async () => {
    showToast('Test user creation coming soon', 'info');
};

window.adminClearAllAuctions = async () => {
    if (!confirm('⚠️ Delete ALL auctions? This cannot be undone!')) return;
    auctions = [];
    showToast('All auctions cleared', 'error');
    renderAdminDashboard();
};

// ============================================================
// ========== CREATE AUCTION =================================
// ============================================================

function openCreateAuction() {
    app.selectedFiles = {
        images: [],
        video: null,
        inspectionReport: null,
        serviceHistory: [],
        inventoryManifest: null
    };

    const categories = ['Cars', 'Trucks', 'Machinery', 'Property', 'Liquidation', 'Livestock', 'Art', 'Yellow Metal', 'Estate Sale'];
    const provinces = ['Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape'];

    openModal(`
        <span class="close-modal" onclick="closeModal()">&times;</span>
        <h3>Create New Auction</h3>
        <div class="form-group">
            <label>Auction Type</label>
            <select id="auctionType" onchange="toggleAuctionType()" style="color:#fff;background:rgba(255,255,255,0.05);padding:0.6rem;border-radius:8px;width:100%;border:1px solid rgba(255,255,255,0.1);">
                <option value="LIVE">Live Stage Auction - 30s timer</option>
                <option value="TIMED">Timed Auction - 3-7 days</option>
            </select>
        </div>
        <div class="form-group">
            <label>Title</label>
            <input id="itemTitle" placeholder="e.g. CAT 320 Excavator" style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;">
        </div>
        <div class="form-group">
            <label>Category</label>
            <select id="itemCat" onchange="toggleCategoryFields()" style="color:#fff;background:rgba(255,255,255,0.05);padding:0.6rem;border-radius:8px;width:100%;border:1px solid rgba(255,255,255,0.1);">
                ${categories.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
            <div class="form-group">
                <label>Reserve Price (R)</label>
                <input type="number" id="itemReserve" placeholder="50000" style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;">
            </div>
            <div class="form-group">
                <label>Start Time</label>
                <input type="datetime-local" id="itemStartTime" style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;">
            </div>
        </div>
        <div class="form-group" id="endTimeGroup" style="display:none;">
            <label>End Time - TIMED Auction</label>
            <input type="datetime-local" id="itemEndTime" style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
            <div class="form-group">
                <label>Province</label>
                <select id="itemProvince" style="color:#fff;background:rgba(255,255,255,0.05);padding:0.6rem;border-radius:8px;width:100%;border:1px solid rgba(255,255,255,0.1);">
                    ${provinces.map(p => `<option value="${p}">${p}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Town</label>
                <input id="itemTown" placeholder="Town name" style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;">
            </div>
        </div>
        <div class="form-group">
            <label>Number of Lots/Items</label>
            <input type="number" id="itemCount" value="1" style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;">
        </div>
        <div id="yellowMetalFields" style="display:none;">
            <div class="form-group">
                <label>Engine Hours</label>
                <input type="number" id="engineHours" placeholder="5400" style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;">
            </div>
            <div class="form-group">
                <label>VIN/Serial Number</label>
                <input id="vinNumber" placeholder="CAT0123..." style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;">
            </div>
        </div>
        <div id="estateFields" style="display:none;">
            <div class="form-group">
                <label>Bulk Sale Terms</label>
                <textarea id="bulkSaleTerms" placeholder="Sold as single lot, buyer takes all" style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;min-height:60px;"></textarea>
            </div>
        </div>
        <div class="form-group">
            <label>Images - Min 2 required</label>
            <div class="drag-area" id="imageDropArea" style="border:2px dashed rgba(255,255,255,0.2);border-radius:12px;padding:2rem;text-align:center;cursor:pointer;transition:0.3s;">
                <i class="fas fa-images" style="font-size:2rem;color:var(--green);"></i>
                <p style="margin:0.5rem 0;color:var(--muted);">Drag & drop images or click to browse</p>
                <input type="file" id="itemImages" accept="image/*" multiple hidden>
            </div>
            <div id="imagePreview" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;"></div>
        </div>
        <div class="form-group">
            <label>Video (Optional)</label>
            <div class="drag-area" id="videoDropArea" style="border:2px dashed rgba(255,255,255,0.2);border-radius:12px;padding:2rem;text-align:center;cursor:pointer;transition:0.3s;">
                <i class="fas fa-video" style="font-size:2rem;color:var(--green);"></i>
                <p style="margin:0.5rem 0;color:var(--muted);">Drag & drop video or click to browse</p>
                <input type="file" id="itemVideo" accept="video/*" hidden>
            </div>
            <div id="videoPreview" style="margin-top:0.5rem;"></div>
        </div>
        <div class="form-group">
            <label>Inspection Report PDF (Optional - for Yellow Metal)</label>
            <div class="drag-area" id="inspectionDrop" style="border:2px dashed rgba(255,255,255,0.2);border-radius:12px;padding:2rem;text-align:center;cursor:pointer;transition:0.3s;">
                <i class="fas fa-file-pdf" style="font-size:2rem;color:var(--green);"></i>
                <p style="margin:0.5rem 0;color:var(--muted);">Upload inspection report PDF</p>
                <input type="file" id="inspectionReport" accept=".pdf" hidden>
            </div>
            <div id="inspectionPreview" style="margin-top:0.5rem;"></div>
        </div>
        <div class="form-group">
            <label>Service History Photos (Optional)</label>
            <div class="drag-area" id="serviceDrop" style="border:2px dashed rgba(255,255,255,0.2);border-radius:12px;padding:2rem;text-align:center;cursor:pointer;transition:0.3s;">
                <i class="fas fa-wrench" style="font-size:2rem;color:var(--green);"></i>
                <p style="margin:0.5rem 0;color:var(--muted);">Upload service records (images)</p>
                <input type="file" id="serviceHistory" accept="image/*" multiple hidden>
            </div>
            <div id="servicePreview" style="margin-top:0.5rem;"></div>
        </div>
        <div class="form-group">
            <label>Inventory Manifest (Optional - for Estate Sales)</label>
            <div class="drag-area" id="manifestDrop" style="border:2px dashed rgba(255,255,255,0.2);border-radius:12px;padding:2rem;text-align:center;cursor:pointer;transition:0.3s;">
                <i class="fas fa-file-excel" style="font-size:2rem;color:var(--green);"></i>
                <p style="margin:0.5rem 0;color:var(--muted);">Upload Excel/PDF inventory list</p>
                <input type="file" id="inventoryManifest" accept=".xlsx,.xls,.pdf" hidden>
            </div>
            <div id="manifestPreview" style="margin-top:0.5rem;"></div>
        </div>
        <button class="btn btn-primary" style="width:100%;margin-top:1rem;" onclick="saveNewAuction()">
            <i class="fas fa-plus-circle"></i> Create Auction
        </button>
    `);

    setupFileDrop('imageDropArea', 'itemImages', (files) => {
        app.selectedFiles.images = Array.from(files);
        updatePreview('imagePreview', app.selectedFiles.images, 'image');
    });
    setupFileDrop('videoDropArea', 'itemVideo', (files) => {
        app.selectedFiles.video = files[0];
        updatePreview('videoPreview', [files[0]], 'video');
    });
    setupFileDrop('inspectionDrop', 'inspectionReport', (files) => {
        app.selectedFiles.inspectionReport = files[0];
        document.getElementById('inspectionPreview').innerHTML = `<p style="color:var(--green);">✅ ${files[0].name}</p>`;
    });
    setupFileDrop('serviceDrop', 'serviceHistory', (files) => {
        app.selectedFiles.serviceHistory = Array.from(files);
        document.getElementById('servicePreview').innerHTML = `<p style="color:var(--green);">✅ ${files.length} files added</p>`;
    });
    setupFileDrop('manifestDrop', 'inventoryManifest', (files) => {
        app.selectedFiles.inventoryManifest = files[0];
        document.getElementById('manifestPreview').innerHTML = `<p style="color:var(--green);">✅ ${files[0].name}</p>`;
    });

    const now = new Date();
    now.setHours(now.getHours() + 1);
    document.getElementById('itemStartTime').value = now.toISOString().slice(0, 16);
    const end = new Date();
    end.setDate(end.getDate() + 3);
    document.getElementById('itemEndTime').value = end.toISOString().slice(0, 16);
}

function toggleAuctionType() {
    const type = document.getElementById('auctionType').value;
    document.getElementById('endTimeGroup').style.display = type === 'TIMED' ? 'block' : 'none';
}

function toggleCategoryFields() {
    const cat = document.getElementById('itemCat').value;
    document.getElementById('yellowMetalFields').style.display = cat === 'Yellow Metal' ? 'block' : 'none';
    document.getElementById('estateFields').style.display = cat === 'Estate Sale' ? 'block' : 'none';
}

function setupFileDrop(dropAreaId, inputId, callback) {
    const dropArea = document.getElementById(dropAreaId);
    const input = document.getElementById(inputId);
    dropArea.addEventListener('click', () => input.click());
    dropArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropArea.style.borderColor = 'var(--green)';
        dropArea.style.background = 'rgba(0,255,136,0.05)';
    });
    dropArea.addEventListener('dragleave', () => {
        dropArea.style.borderColor = 'rgba(255,255,255,0.2)';
        dropArea.style.background = 'transparent';
    });
    dropArea.addEventListener('drop', (e) => {
        e.preventDefault();
        dropArea.style.borderColor = 'rgba(255,255,255,0.2)';
        dropArea.style.background = 'transparent';
        const files = e.dataTransfer.files;
        input.files = files;
        callback(files);
    });
    input.addEventListener('change', () => {
        callback(input.files);
    });
}

function updatePreview(containerId, files, type) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            if (type === 'image') {
                container.innerHTML += `<img src="${e.target.result}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,0.1);">`;
            } else if (type === 'video') {
                container.innerHTML += `<video src="${e.target.result}" style="width:120px;height:80px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,0.1);" controls></video>`;
            }
        };
        reader.readAsDataURL(file);
    });
}

async function saveNewAuction() {
    const formData = new FormData();
    formData.append('title', document.getElementById('itemTitle').value);
    formData.append('category', document.getElementById('itemCat').value);
    formData.append('auctionType', document.getElementById('auctionType').value);
    formData.append('reserve', document.getElementById('itemReserve').value || 0);
    formData.append('startTime', document.getElementById('itemStartTime').value);
    formData.append('endTime', document.getElementById('itemEndTime')?.value || '');
    formData.append('city', `${document.getElementById('itemProvince').value}, ${document.getElementById('itemTown').value}`);
    formData.append('items', document.getElementById('itemCount').value || 1);

    const engineHours = document.getElementById('engineHours')?.value;
    const vinNumber = document.getElementById('vinNumber')?.value;
    const bulkSaleTerms = document.getElementById('bulkSaleTerms')?.value;
    if (engineHours) formData.append('engineHours', engineHours);
    if (vinNumber) formData.append('vinNumber', vinNumber);
    if (bulkSaleTerms) formData.append('bulkSaleTerms', bulkSaleTerms);

    app.selectedFiles.images.forEach(img => formData.append('images', img));
    if (app.selectedFiles.video) formData.append('video', app.selectedFiles.video);
    if (app.selectedFiles.inspectionReport) formData.append('inspectionReport', app.selectedFiles.inspectionReport);
    app.selectedFiles.serviceHistory.forEach(f => formData.append('serviceHistory', f));
    if (app.selectedFiles.inventoryManifest) formData.append('inventoryManifest', app.selectedFiles.inventoryManifest);

    if (!formData.get('title')) return showToast('Title is required', 'error');
    if (app.selectedFiles.images.length < 2) return showToast('Upload at least 2 images', 'error');

    try {
        const res = await api('/api/auctions', 'POST', formData);
        closeModal();
        showToast('Auction created successfully!');
        await fetchAuctions();
        navigate('landing');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================
// ========== DEVICE FINGERPRINT ==============================
// ============================================================

if (typeof Fingerprint2 !== 'undefined') {
    Fingerprint2.get(function(components) {
        const values = components.map(component => component.value);
        const deviceId = Fingerprint2.x64hash128(values.join(''), 31);
        localStorage.setItem('deviceId', deviceId);
        app.deviceId = deviceId;
        console.log('Device fingerprint:', deviceId);
    });
} else {
    console.warn('FingerprintJS2 not loaded');
    app.deviceId = localStorage.getItem('deviceId') || 'unknown';
}
// ============================================================
// PHASE 9: WEBRTC & TURN SERVER (Live Video Streaming)
// ============================================================

// ---------- VIDEO STREAMING ----------
function startVideoStream() {
    if (!app.user || !app.isAuctioneer) {
        return showToast('Only the auctioneer can start the stream', 'error');
    }
    if (app.videoStream) {
        return showToast('Stream already active', 'info');
    }

    // Get camera and microphone
    navigator.mediaDevices.getUserMedia({
        video: { 
            width: { ideal: 1280 }, 
            height: { ideal: 720 },
            facingMode: 'user'
        },
        audio: {
            echoCancellation: false,  // Don't kill auctioneer voice
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 48000,
            channelCount: 1
        }
    }).then(stream => {
        app.videoStream = stream;
        
        // Show local video for auctioneer
        const container = document.getElementById('videoContainer');
        const localVideo = document.createElement('video');
        localVideo.id = 'localVideo';
        localVideo.srcObject = stream;
        localVideo.autoplay = true;
        localVideo.playsInline = true;
        localVideo.muted = true; // Prevent echo
        localVideo.style.width = '100%';
        localVideo.style.maxHeight = '400px';
        localVideo.style.background = '#000';
        localVideo.style.borderRadius = '8px';
        localVideo.style.border = '2px solid var(--green)';
        
        // Remove placeholder
        const placeholder = container.querySelector('.video-placeholder');
        if (placeholder) placeholder.remove();
        
        // Remove any existing local video
        const existing = document.getElementById('localVideo');
        if (existing) existing.remove();
        
        container.prepend(localVideo);
        
        // Show stop button
        const stopBtn = document.getElementById('stopStreamBtn');
        if (stopBtn) stopBtn.style.display = 'inline-block';
        
        // Update stream indicator
        updateStreamIndicator(true);
        
        // Create peer connection and broadcast offer
        initPeer(app.currentAuctionId, true);
        
        showToast('📹 Stream started! Buyers can now watch.', 'info');
        
        // Broadcast to all viewers that stream is live
        if (app.socket) {
            app.socket.emit('streamStarted', { auctionId: app.currentAuctionId });
        }
        
    }).catch(err => {
        showToast('Could not access camera: ' + err.message, 'error');
        console.error('getUserMedia error:', err);
    });
}

function stopVideoStream() {
    if (app.videoStream) {
        app.videoStream.getTracks().forEach(track => track.stop());
        app.videoStream = null;
    }
    
    // Remove local video
    const localVideo = document.getElementById('localVideo');
    if (localVideo) localVideo.remove();
    
    // Hide stop button
    const stopBtn = document.getElementById('stopStreamBtn');
    if (stopBtn) stopBtn.style.display = 'none';
    
    // Update stream indicator
    updateStreamIndicator(false);
    
    // Close peer connection
    if (app.peer) {
        app.peer.destroy();
        app.peer = null;
    }
    
    // Show placeholder
    const container = document.getElementById('videoContainer');
    const placeholder = container.querySelector('.video-placeholder');
    if (!placeholder) {
        const newPlaceholder = document.createElement('div');
        newPlaceholder.className = 'video-placeholder';
        newPlaceholder.textContent = '📹 Stream ended';
        container.prepend(newPlaceholder);
    }
    
    // Notify viewers
    if (app.socket) {
        app.socket.emit('video-ended', { auctionId: app.currentAuctionId });
    }
    
    showToast('📹 Stream stopped', 'info');
}

function updateStreamIndicator(isLive) {
    const container = document.getElementById('videoContainer');
    let indicator = container.querySelector('.stream-indicator');
    
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'stream-indicator';
        container.prepend(indicator);
    }
    
    if (isLive) {
        indicator.innerHTML = '<span style="display:inline-block;width:10px;height:10px;background:#ff4444;border-radius:50%;animation:pulse 1s infinite;margin-right:8px;"></span>🔴 LIVE';
        indicator.style.cssText = 'position:absolute;top:10px;left:10px;background:rgba(0,0,0,0.8);padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;color:#fff;z-index:10;';
        indicator.style.position = 'absolute';
        indicator.style.top = '10px';
        indicator.style.left = '10px';
        indicator.style.background = 'rgba(0,0,0,0.8)';
        indicator.style.padding = '4px 12px';
        indicator.style.borderRadius = '20px';
        indicator.style.fontSize = '12px';
        indicator.style.fontWeight = '700';
        indicator.style.color = '#fff';
        indicator.style.zIndex = '10';
        container.style.position = 'relative';
    } else {
        indicator.remove();
    }
}

// ---------- PEER CONNECTION (SimplePeer) ----------
function initPeer(auctionId, isInitiator) {
    if (app.peer) {
        app.peer.destroy();
        app.peer = null;
    }
    
    // TURN server config (replace with your domain after deployment)
    const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
        // TURN server will be added in Phase 9.2 after deployment
    ];
    
    // Add TURN if configured in environment (will be added later)
    if (window.TURN_CONFIG) {
        iceServers.push(window.TURN_CONFIG);
    }
    
    const peer = new SimplePeer({
        initiator: isInitiator,
        trickle: true,
        config: { iceServers },
        stream: isInitiator ? app.videoStream : undefined
    });
    
    app.peer = peer;
    
    peer.on('signal', (data) => {
        // Send signaling data through socket
        if (app.socket) {
            const event = isInitiator ? 'video-offer' : 'video-answer';
            app.socket.emit(event, {
                auctionId: auctionId,
                signal: data,
                senderId: app.user.id
            });
        }
    });
    
    peer.on('stream', (stream) => {
        // Received remote stream (for buyers)
        handleStream(stream);
    });
    
    peer.on('connect', () => {
        console.log('Peer connection established');
        if (!isInitiator) {
            showToast('📹 Connected to auctioneer stream!', 'info');
        }
    });
    
    peer.on('close', () => {
        console.log('Peer connection closed');
        if (!isInitiator) {
            const remoteVideo = document.getElementById('remoteVideo');
            if (remoteVideo) {
                remoteVideo.srcObject = null;
                remoteVideo.style.display = 'none';
            }
            const placeholder = document.querySelector('.video-placeholder');
            if (!placeholder) {
                const container = document.getElementById('videoContainer');
                const newPlaceholder = document.createElement('div');
                newPlaceholder.className = 'video-placeholder';
                newPlaceholder.textContent = '📹 Stream ended by auctioneer';
                container.prepend(newPlaceholder);
            }
        }
        app.peer = null;
    });
    
    peer.on('error', (err) => {
        console.error('Peer error:', err);
        showToast('Video stream error: ' + err.message, 'error');
    });
}

function handleStream(stream) {
    const remoteVideo = document.getElementById('remoteVideo');
    if (remoteVideo) {
        remoteVideo.srcObject = stream;
        remoteVideo.style.display = 'block';
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.volume = 1.0;
        remoteVideo.muted = false;
        
        // Remove placeholder
        const placeholder = document.querySelector('.video-placeholder');
        if (placeholder) placeholder.remove();
        
        // Update stream indicator for buyers (show "LIVE" badge)
        updateStreamIndicatorForBuyer(true);
        
        showToast('📹 Auctioneer stream is live!', 'info');
    }
}

function updateStreamIndicatorForBuyer(isLive) {
    const container = document.getElementById('videoContainer');
    let indicator = container.querySelector('.stream-indicator');
    
    if (!indicator && isLive) {
        indicator = document.createElement('div');
        indicator.className = 'stream-indicator';
        indicator.innerHTML = '<span style="display:inline-block;width:10px;height:10px;background:#ff4444;border-radius:50%;animation:pulse 1s infinite;margin-right:8px;"></span>🔴 LIVE';
        indicator.style.cssText = 'position:absolute;top:10px;left:10px;background:rgba(0,0,0,0.8);padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;color:#fff;z-index:10;';
        container.style.position = 'relative';
        container.prepend(indicator);
    } else if (indicator && !isLive) {
        indicator.remove();
    }
}

// ---------- HANDLE VIDEO OFFER (Buyer receives) ----------
function handleVideoOffer(signal, senderId) {
    if (app.isAuctioneer) return; // Auctioneer doesn't receive offers
    
    if (!app.peer) {
        initPeer(app.currentAuctionId, false);
    }
    
    if (app.peer) {
        app.peer.signal(signal);
    }
}

// ---------- SOCKET EVENT LISTENERS FOR WEBRTC ----------
// Add these inside connectSocket() after the other listeners:

// Auctioneer broadcasts offer
app.socket.on('video-offer', (data) => {
    if (!app.isAuctioneer && app.currentAuctionId === data.auctionId) {
        handleVideoOffer(data.signal, data.senderId);
    }
});

// Buyer sends answer
app.socket.on('video-answer', (data) => {
    if (app.isAuctioneer && app.currentAuctionId === data.auctionId) {
        if (app.peer) {
            app.peer.signal(data.signal);
        }
    }
});

// ICE candidate exchange
app.socket.on('video-candidate', (data) => {
    if (app.peer && app.currentAuctionId === data.auctionId) {
        app.peer.signal(data.candidate);
    }
});

// Stream started notification
app.socket.on('streamStarted', (data) => {
    if (!app.isAuctioneer && app.currentAuctionId === data.auctionId) {
        showToast('📹 Auctioneer is starting the stream!', 'info');
        // Prepare to receive stream
        if (!app.peer) {
            initPeer(app.currentAuctionId, false);
        }
    }
});

// Video ended notification
app.socket.on('video-ended', (data) => {
    if (app.currentAuctionId === data.auctionId) {
        if (app.peer) {
            app.peer.destroy();
            app.peer = null;
        }
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo) {
            remoteVideo.srcObject = null;
            remoteVideo.style.display = 'none';
        }
        updateStreamIndicatorForBuyer(false);
        const container = document.getElementById('videoContainer');
        const placeholder = container.querySelector('.video-placeholder');
        if (!placeholder) {
            const newPlaceholder = document.createElement('div');
            newPlaceholder.className = 'video-placeholder';
            newPlaceholder.textContent = '📹 Auctioneer has ended the stream';
            container.prepend(newPlaceholder);
        }
        showToast('📹 Stream ended by auctioneer', 'info');
    }
});

// ---------- HELPER: EMIT VIDEO OFFER FROM AUCTIONEER ----------
// When auctioneer starts stream, they emit offer to all viewers
// This is handled inside initPeer with 'video-offer' event

// ============================================================
// END OF PHASE 9.1 – PASTE PHASE 9.2 BELOW
// ============================================================
// ---------- START APP ----------
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    if (token) {
        app.token = token;
        const userData = localStorage.getItem('user');
        if (userData) {
            app.user = JSON.parse(userData);
        }
    }
    initApp();
});

console.log('✅ SunAlgorithms app.js loaded (Phase 8 Complete)');