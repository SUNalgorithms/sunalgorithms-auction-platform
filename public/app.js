// ============================================================
// app.js - SunAlgorithms Auction Platform (Phases 1-12)
// Complete frontend with Seller Storefront (Level 1 & 2)
// PART 1: Setup, Auth, Navigation, Seller Feed, Seller Garage
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
        case 'sellerFeed':
            renderSellerFeed();
            break;
        case 'sellerGarage':
            // handled by viewSeller
            break;
        case 'auctionDetail':
            // handled by viewAuction
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
        default:
            renderSellerFeed();
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
        navigate('sellerFeed');
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
        if (document.getElementById('mainContent').innerHTML.includes('Seller Feed') || document.getElementById('mainContent').innerHTML.includes('seller-card')) {
            renderSellerFeed();
        }
    });

    app.socket.on('userBanned', (data) => {
        showToast(`⚠️ ${data.name} banned: ${data.reason}`, 'error');
    });

    app.socket.on('error', (data) => {
        showToast(data.message, 'error');
    });

    app.socket.on('switchedToLive', (data) => {
        showToast('🔴 ' + data.message, 'info');
        if (window._currentAuctionDetail) {
            viewAuction(window._currentAuctionDetail.id);
        }
    });

    app.socket.on('proxyBidUpdate', (data) => {
        showToast(`💰 New bid: R${data.currentBid.toLocaleString()}`, 'info');
        if (window._currentAuctionDetail) {
            viewAuction(window._currentAuctionDetail.id);
        }
    });

    app.socket.on('bidAccepted', (data) => {
        showToast(`Bid R${data.amount.toLocaleString()} ACCEPTED!`, 'info');
        if (window._currentAuctionDetail && window._currentAuctionDetail.id === data.auctionId) {
            viewAuction(window._currentAuctionDetail.id);
        }
        fetchAuctions();
    });

    app.socket.on('bidRejected', (data) => {
        showToast(data.message, 'error');
    });

    app.socket.on('handRaiseQueued', (data) => {
        showToast(`New bid: ${data.bidderName} - R${data.amount.toLocaleString()}`, 'info');
        if (document.getElementById('mainContent').innerHTML.includes('Seller Dashboard')) {
            renderSellerDashboard();
        }
    });

    app.socket.on('lotSold', (data) => {
        showToast(data.message, 'info');
        fetchAuctions();
        navigate('sellerFeed');
    });

    app.socket.on('auctionEndedAwaitingPayment', (data) => {
        showToast(`Auction ended! Winner ID: ${data.winnerId} - R${data.finalPrice.toLocaleString()}`, 'info');
        navigate('sellerFeed');
    });
}

// ---------- FETCH AUCTIONS ----------
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
// ========== RENDER SELLER FEED (Level 1) ===================
// ============================================================

async function renderSellerFeed() {
    const main = document.getElementById('mainContent');
    try {
        const sellers = await api('/api/sellers');
        if (!sellers || sellers.length === 0) {
            main.innerHTML = `
                <div class="landing-hero">
                    <h1>No Sellers Active</h1>
                    <p>No sellers have active auctions right now. Check back soon!</p>
                    ${(app.user?.role === 'seller' || app.user?.role === 'admin') ? `
                        <button class="btn btn-primary" onclick="openCreateAuction()">Create Your First Auction</button>
                    ` : ''}
                </div>
            `;
            return;
        }

        let html = `<div style="max-width:1200px;margin:0 auto;">`;
        html += `<h2 style="margin-bottom:1.5rem;">Auction Sellers</h2>`;
        for (const seller of sellers) {
            const avatar = seller.sellerAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(seller.sellerName)}&background=5fb4a2&color=fff&size=64`;
            const previewImages = seller.previewImages || [];
            const moreCount = seller.moreCount || 0;

            html += `
                <div class="seller-card" onclick="viewSeller('${seller.sellerId}')">
                    <div class="seller-header">
                        <img src="${avatar}" class="avatar" style="width:48px;height:48px;border-radius:50%;object-fit:cover;background:var(--green);">
                        <div class="seller-info">
                            <div class="name">${seller.sellerName}</div>
                            <div class="meta">${seller.activeAuctionCount} Cars Listed • ${seller.endingTodayCount} Ending Today</div>
                        </div>
                    </div>
                    <div class="seller-preview">
                        ${previewImages.length > 0 ? previewImages.map((img, idx) => `
                            <div class="preview-img" style="background-image:url('${img}');background-size:cover;background-position:center;">
                                ${idx === 3 && moreCount > 0 ? `<div class="more-badge">+${moreCount}</div>` : ''}
                            </div>
                        `).join('') : Array.from({length: 4}, () => `
                            <div class="preview-img" style="display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:0.7rem;background:var(--bg-input);">No images</div>
                        `).join('')}
                    </div>
                    <div class="seller-footer">
                        <span>${seller.activeAuctionCount} active auctions</span>
                        ${seller.endingTodayCount > 0 ? `<span class="ending-badge">${seller.endingTodayCount} ending today</span>` : ''}
                        <span class="view-btn">View Garage →</span>
                    </div>
                </div>
            `;
        }
        html += `</div>`;
        main.innerHTML = html;
    } catch (err) {
        showToast('Error loading sellers: ' + err.message, 'error');
        main.innerHTML = `<p style="color:var(--muted);text-align:center;padding:2rem;">Could not load sellers. Please refresh.</p>`;
    }
}

// ============================================================
// ========== VIEW SELLER (Level 2: Seller Garage) ===========
// ============================================================

async function viewSeller(sellerId) {
    try {
        const seller = await api(`/api/sellers/${sellerId}`);
        const main = document.getElementById('mainContent');
        if (!seller) return showToast('Seller not found', 'error');

        const avatar = seller.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(seller.name)}&background=5fb4a2&color=fff&size=128`;

        let html = `
            <div style="max-width:1200px;margin:0 auto;">
                <button class="back-btn" onclick="history.back()">
                    ← Back to Sellers
                </button>
                <div class="seller-garage-header">
                    <img src="${avatar}" class="big-avatar" style="width:80px;height:80px;border-radius:50%;object-fit:cover;background:var(--green);">
                    <div class="info">
                        <div class="name">${seller.name}</div>
                        <div class="bio">${seller.bio || 'Auctioneer'}</div>
                        <div class="rating">
                            <span>⭐ ${seller.rating || 'New'}</span>
                            <span style="color:var(--muted);font-size:0.9rem;">(${seller.totalRatings || 0} reviews)</span>
                            <span style="color:var(--muted);margin-left:0.5rem;">Joined ${new Date(seller.joinedDate).toLocaleDateString()}</span>
                        </div>
                    </div>
                </div>
                <div class="auction-card-grid">
        `;

        if (seller.auctions.length === 0) {
            html += `<p style="color:var(--muted);">No active auctions from this seller.</p>`;
        } else {
            for (const auction of seller.auctions) {
                html += renderAuctionCard(auction);
            }
        }

        html += `
                </div>
            </div>
        `;
        main.innerHTML = html;

        // Attach thumbnail click events for image switching in each card
        document.querySelectorAll('.auction-card-item').forEach((card) => {
            const thumbnails = card.querySelectorAll('.thumbnails img');
            const mainImg = card.querySelector('.main-img');
            if (thumbnails.length && mainImg) {
                thumbnails.forEach(th => {
                    th.addEventListener('click', (e) => {
                        e.stopPropagation();
                        mainImg.src = th.src;
                        // Remove active class from all thumbnails
                        thumbnails.forEach(t => t.classList.remove('active'));
                        th.classList.add('active');
                    });
                });
                // Set first thumbnail as active
                if (thumbnails.length > 0) {
                    thumbnails[0].classList.add('active');
                }
            }
            // Click on card to go to detail
            card.addEventListener('click', () => {
                const auctionId = card.dataset.auctionId;
                if (auctionId) viewAuction(auctionId);
            });
        });
    } catch (err) {
        showToast('Error loading seller: ' + err.message, 'error');
    }
}

// ============================================================
// ========== RENDER AUCTION CARD (Inside Garage) ============
// ============================================================

function renderAuctionCard(auction) {
    const ratingDisplay = auction.sellerRating ? `⭐ ${auction.sellerRating.toFixed(1)}` : 'New';
    const timerHtml = auction.endTime ? getTimerHtml(auction.endTime) : '';
    const currentBid = auction.currentBid || 0;
    const images = auction.images || [];
    const mainImg = images.length > 0 ? images[0] : 'https://via.placeholder.com/400x225?text=No+Image';
    const thumbnails = images.slice(1, 5);

    // Build specs HTML
    const specs = [];
    if (auction.engineHours) specs.push(`<span><i class="fas fa-clock"></i> ${auction.engineHours}h</span>`);
    if (auction.vinNumber) specs.push(`<span><i class="fas fa-barcode"></i> ${auction.vinNumber.slice(-6)}</span>`);
    if (auction.year) specs.push(`<span><i class="fas fa-calendar"></i> ${auction.year}</span>`);
    if (auction.kilometers) specs.push(`<span><i class="fas fa-tachometer-alt"></i> ${(auction.kilometers / 1000).toFixed(0)}k km</span>`);
    if (auction.city) specs.push(`<span><i class="fas fa-map-pin"></i> ${auction.city}</span>`);
    if (specs.length === 0) specs.push(`<span><i class="fas fa-tag"></i> ${auction.category || 'General'}</span>`);

    return `
        <div class="auction-card-item" data-auction-id="${auction.id}">
            <div class="image-gallery">
                <img class="main-img" src="${mainImg}" alt="${auction.title}">
                <div class="thumbnails">
                    ${thumbnails.map(img => `<img src="${img}" alt="thumbnail">`).join('')}
                    ${thumbnails.length < 4 ? Array.from({length: 4 - thumbnails.length}, () => `<img src="https://via.placeholder.com/80x80?text=No+Image" style="opacity:0.3;">`).join('') : ''}
                </div>
            </div>
            <div class="auction-info">
                <div class="title">${auction.title}</div>
                <div class="rating">${ratingDisplay}</div>
                <div class="bid">R${currentBid.toLocaleString()}</div>
                <div class="specs">
                    ${specs.join('')}
                </div>
                ${timerHtml ? `<div class="timer ${timerHtml.includes('🚨') ? 'urgent' : ''}">${timerHtml}</div>` : ''}
            </div>
        </div>
    `;
}

// ============================================================
// ========== LEGACY / BACKWARD COMPATIBILITY ================
// ============================================================

// ---------- RENDER LANDING (old auction grid – kept for compatibility) ----------
function renderLanding() {
    // This is kept for backward compatibility.
    // The new default is renderSellerFeed.
    renderSellerFeed();
}

// ---------- HELPER: GET TIMER HTML ----------
function getTimerHtml(endTime) {
    const endMs = new Date(endTime).getTime();
    const now = Date.now();
    const diff = endMs - now;
    if (diff <= 0) return 'Auction ended';
    const days = Math.floor(diff / (24*60*60*1000));
    const hours = Math.floor((diff % (24*60*60*1000)) / (60*60*1000));
    const mins = Math.floor((diff % (60*60*1000)) / (60*1000));
    const secs = Math.floor((diff % (60*1000)) / 1000);
    let str = '';
    if (days > 0) str += `${days}d `;
    str += `${String(hours).padStart(2,'0')}h ${String(mins).padStart(2,'0')}m ${String(secs).padStart(2,'0')}s`;
    return diff < 3600000 ? str + ' 🚨' : str;
}

// ---------- HELPER: GET SELLER TRUST SCORE ----------
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

// ---------- HELPER: FORMAT PHONE FOR WHATSAPP ----------
function formatPhoneForWhatsApp(phone) {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '27' + cleaned.slice(1);
    if (!cleaned.startsWith('27')) cleaned = '27' + cleaned;
    return cleaned;
}

// ---------- HELPER: GET BADGE TEXT ----------
function getBadgeText(level) {
    const badges = {
        1: 'ID Verified ✓',
        2: 'ID + Selfie ✓',
        3: 'Address Verified ✓',
        4: 'Bank Verified ✓✓',
        5: 'Million-Rand ✓✓'
    };
    return badges[level] || 'Unverified';
}

// ============================================================
// ========== CREATE AUCTION MODAL ============================
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
            <label>Description</label>
            <textarea id="itemDescription" placeholder="Full description of the item..." style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;resize:vertical;min-height:80px;"></textarea>
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
        <div id="carSpecFields" style="display:block;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                <div class="form-group">
                    <label>Year</label>
                    <input type="number" id="itemYear" placeholder="2020" style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;">
                </div>
                <div class="form-group">
                    <label>Kilometres (KM)</label>
                    <input type="number" id="itemKilometers" placeholder="50000" style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;">
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                <div class="form-group">
                    <label>Condition</label>
                    <select id="itemCondition" style="color:#fff;background:rgba(255,255,255,0.05);padding:0.6rem;border-radius:8px;width:100%;border:1px solid rgba(255,255,255,0.1);">
                        <option value="">Select condition</option>
                        <option value="Excellent">Excellent</option>
                        <option value="Good">Good</option>
                        <option value="Fair">Fair</option>
                        <option value="Poor">Poor</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Colour</label>
                    <input id="itemColor" placeholder="White, Black, Blue, etc." style="width:100%;padding:0.6rem;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;">
                </div>
            </div>
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
    formData.append('description', document.getElementById('itemDescription').value);
    formData.append('category', document.getElementById('itemCat').value);
    formData.append('auctionType', document.getElementById('auctionType').value);
    formData.append('reserve', document.getElementById('itemReserve').value || 0);
    formData.append('startTime', document.getElementById('itemStartTime').value);
    formData.append('endTime', document.getElementById('itemEndTime')?.value || '');
    formData.append('city', `${document.getElementById('itemProvince').value}, ${document.getElementById('itemTown').value}`);
    formData.append('items', document.getElementById('itemCount').value || 1);
    formData.append('year', document.getElementById('itemYear')?.value || '');
    formData.append('kilometers', document.getElementById('itemKilometers')?.value || '');
    formData.append('condition', document.getElementById('itemCondition')?.value || '');
    formData.append('color', document.getElementById('itemColor')?.value || '');

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
        navigate('sellerFeed');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================
// ========== END OF PART 1 – PASTE PART 2 BELOW =============
// ============================================================
// ============================================================
// PART 2: AUCTION DETAIL, BID FUNCTIONS, ADMIN, DASHBOARD,
// ANALYTICS, RATINGS, GHOST LEADS, FINGERPRINT
// ============================================================

// ============================================================
// ========== VIEW AUCTION (Level 3: Single Auction Detail) ====
// ============================================================

async function viewAuction(auctionId) {
    try {
        const auction = await api(`/api/auctions/${auctionId}/detail`);
        if (!auction) return showToast('Auction not found', 'error');

        // Store for bid form and socket updates
        window._currentAuctionDetail = auction;

        const main = document.getElementById('mainContent');
        const isLive = auction.auctionType === 'LIVE' && (auction.status === 'LIVE' || auction.status === 'LIVE_LAST_10MIN');
        const isTimed = auction.auctionType === 'TIMED' && auction.status === 'LIVE';
        const isEnded = auction.status === 'ENDED' || auction.status === 'AWAITING_PAYMENT';

        const images = auction.images || [];
        const mainImage = images.length > 0 ? images[0] : 'https://via.placeholder.com/800x450?text=No+Image';
        const thumbnails = images.slice(0, 8);

        // Build bid history rows
        const bidRows = auction.bidHistory && auction.bidHistory.length > 0 ?
            auction.bidHistory.map(b => `<tr><td>${b.bidderName}</td><td>R${b.amount.toLocaleString()}</td><td>${b.time}</td></tr>`).join('') :
            '<tr><td colspan="3" style="color:var(--muted);text-align:center;">No bids yet</td></tr>';

        const timerHtml = auction.endTime ? getTimerHtml(auction.endTime) : '';

        // Build specs
        const specs = auction.specs || {};
        const specRows = [];
        if (specs.engineHours) specRows.push(`<li><strong>Engine Hours:</strong> ${specs.engineHours}</li>`);
        if (specs.vinNumber) specRows.push(`<li><strong>VIN:</strong> ${specs.vinNumber}</li>`);
        if (specs.year) specRows.push(`<li><strong>Year:</strong> ${specs.year}</li>`);
        if (specs.kilometers) specRows.push(`<li><strong>Kilometres:</strong> ${specs.kilometers.toLocaleString()}</li>`);
        if (specs.condition) specRows.push(`<li><strong>Condition:</strong> ${specs.condition}</li>`);
        if (specs.color) specRows.push(`<li><strong>Colour:</strong> ${specs.color}</li>`);
        if (auction.city) specRows.push(`<li><strong>Location:</strong> ${auction.city}</li>`);
        if (specRows.length === 0) specRows.push(`<li><strong>Category:</strong> ${auction.category || 'General'}</li>`);

        const minNextBid = (auction.currentBid || 0) + (auction.minIncrement || 1000);

        const bidBoxHtml = `
            <div class="bid-box">
                <div class="title">${auction.title}</div>
                <div class="rating">⭐ ${auction.seller.rating || 'New'} (${auction.seller.totalRatings || 0} reviews)</div>
                <div class="current-bid-label">Current Bid</div>
                <div class="current-bid-amount">R${auction.currentBid.toLocaleString()}</div>
                ${auction.reserve > 0 ? `<div class="starting-bid">Starting bid: R${auction.reserve.toLocaleString()}</div>` : ''}
                ${auction.endTime ? `<div class="countdown ${timerHtml.includes('🚨') ? 'urgent' : ''}">${timerHtml}</div>` : ''}
                ${!isEnded && (isLive || isTimed) ? `
                    <div class="bid-form">
                        <input type="number" id="bidAmountInput" placeholder="Min R${minNextBid.toLocaleString()}" step="${auction.minIncrement}" min="${minNextBid}">
                        <button class="btn btn-primary" onclick="placeBidFromDetail('${auction.id}')">Place Bid</button>
                    </div>
                ` : `<div style="color:var(--muted);text-align:center;padding:0.5rem;">This auction has ended</div>`}
                <div class="meta-info">
                    <span><i class="fas fa-eye"></i> ${auction.views || 0} views</span>
                    <span><i class="fas fa-gavel"></i> ${auction.bidCount || 0} bids</span>
                    <span><i class="fas fa-heart"></i> ${auction.watchCount || 0} watching</span>
                </div>
                <div class="seller-info" onclick="viewSeller('${auction.seller.id}')">
                    <img src="${auction.seller.avatar}" class="avatar" style="width:40px;height:40px;border-radius:50%;object-fit:cover;background:var(--green);">
                    <div class="details">
                        <div class="name">${auction.seller.name}</div>
                        <div class="rating">⭐ ${auction.seller.rating || 'New'} (${auction.seller.totalRatings || 0} reviews)</div>
                    </div>
                </div>
                ${auction.isLast10Min ? `<div style="background:rgba(255,68,68,0.2);padding:0.5rem;border-radius:8px;text-align:center;color:var(--red);font-weight:600;margin-top:0.5rem;">🔴 LIVE NOW - Last 10 minutes!</div>` : ''}
            </div>
        `;

        const detailHtml = `
            <div style="max-width:1200px;margin:0 auto;">
                <button class="back-btn" onclick="history.back()">
                    ← Back
                </button>
                <div class="auction-detail">
                    <!-- Left Column -->
                    <div class="left-col">
                        <img class="main-image" id="detailMainImage" src="${mainImage}" alt="${auction.title}">
                        <div class="thumbnails">
                            ${thumbnails.map((img, idx) => `
                                <img src="${img}" alt="thumb" class="${idx === 0 ? 'active' : ''}" onclick="document.getElementById('detailMainImage').src='${img}';document.querySelectorAll('.thumbnails img').forEach(el=>el.classList.remove('active'));this.classList.add('active');">
                            `).join('')}
                            ${thumbnails.length === 0 ? '<span style="color:var(--muted);">No additional images</span>' : ''}
                        </div>
                        <div class="description">
                            <h3>Description</h3>
                            <p style="color:var(--muted);">${auction.description || 'No description provided.'}</p>
                        </div>
                        <div class="bid-history">
                            <h3>Bid History</h3>
                            <table>
                                <thead><tr><th>Bidder</th><th>Amount</th><th>Time</th></tr></thead>
                                <tbody>${bidRows}</tbody>
                            </table>
                            ${auction.bidHistory && auction.bidHistory.length > 10 ? `<div style="text-align:center;color:var(--muted);font-size:0.85rem;margin-top:0.5rem;">+${auction.bidHistory.length - 10} more</div>` : ''}
                        </div>
                        <div class="spec-grid">
                            <h3>Specifications</h3>
                            <ul>
                                ${specRows.join('')}
                            </ul>
                        </div>
                    </div>
                    <!-- Right Column (Sticky) -->
                    <div class="right-col">
                        ${bidBoxHtml}
                    </div>
                </div>
            </div>
        `;

        main.innerHTML = detailHtml;

        // Start countdown timer
        if (auction.endTime) {
            if (detailTimerInterval) {
                clearInterval(detailTimerInterval);
                detailTimerInterval = null;
            }
            startDetailTimer(auction.endTime);
        }

        // Join the auction room for real-time updates
        if (app.socket) {
            app.socket.emit('joinAuction', auctionId);
        }

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (err) {
        showToast('Error loading auction: ' + err.message, 'error');
    }
}

// ---------- PLACE BID FROM DETAIL PAGE ----------
function placeBidFromDetail(auctionId) {
    const input = document.getElementById('bidAmountInput');
    const amount = parseFloat(input?.value);
    if (!amount || amount <= 0) {
        return showToast('Please enter a valid bid amount', 'error');
    }

    if (window._currentAuctionDetail) {
        const auction = window._currentAuctionDetail;
        const minNext = (auction.currentBid || 0) + (auction.minIncrement || 1000);
        if (amount < minNext) {
            return showToast(`Minimum bid is R${minNext.toLocaleString()}`, 'error');
        }
        if (auction.auctionType === 'LIVE') {
            if (!app.socket) return showToast('Not connected', 'error');
            app.socket.emit('handRaise', { auctionId, bidAmount: amount });
            showToast(`Bid of R${amount.toLocaleString()} raised! Waiting for ACK.`, 'info');
        } else if (auction.auctionType === 'TIMED') {
            // Use proxy bid – we need to call the API directly
            placeProxyBid(auctionId);
        }
    } else {
        showToast('Please refresh and try again', 'error');
    }
}

// ---------- DETAIL TIMER ----------
let detailTimerInterval = null;

function startDetailTimer(endTime) {
    if (detailTimerInterval) {
        clearInterval(detailTimerInterval);
        detailTimerInterval = null;
    }
    detailTimerInterval = setInterval(() => {
        const timerEl = document.querySelector('.countdown');
        if (!timerEl) {
            clearInterval(detailTimerInterval);
            detailTimerInterval = null;
            return;
        }
        const html = getTimerHtml(endTime);
        timerEl.textContent = html;
        if (html.includes('🚨')) {
            timerEl.classList.add('urgent');
        } else {
            timerEl.classList.remove('urgent');
        }
    }, 1000);
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
                        <p style="color:var(--muted);">No banned users yet.</p>
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
    // This only clears local display; the server still has data.
    // For full functionality, we'd need a server endpoint.
    showToast('All auctions cleared (local)', 'error');
    renderAdminDashboard();
};

// ============================================================
// ========== SELLER DASHBOARD ================================
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

// ============================================================
// ========== ANALYTICS =======================================
// ============================================================

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
// ========== GHOST LEADS =====================================
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
// ========== DOWNLOAD DNA REPORT =============================
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
// ========== ACK / REJECT / SOLD =============================
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
// ========== MARK AS PAID ====================================
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
// ========== PROXY BID =======================================
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
        if (window._currentAuctionDetail) viewAuction(window._currentAuctionDetail.id);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================
// ========== RATING POPUP ====================================
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
// ========== PROFILE =========================================
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
// ========== VIDEO STREAMING (Phase 9) ======================
// ============================================================

function startVideoStream() {
    if (!app.user || !app.isAuctioneer) {
        return showToast('Only the auctioneer can start the stream', 'error');
    }
    if (app.videoStream) {
        return showToast('Stream already active', 'info');
    }

    navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 48000,
            channelCount: 1
        }
    }).then(stream => {
        app.videoStream = stream;
        const container = document.getElementById('videoContainer');
        const localVideo = document.createElement('video');
        localVideo.id = 'localVideo';
        localVideo.srcObject = stream;
        localVideo.autoplay = true;
        localVideo.playsInline = true;
        localVideo.muted = true;
        localVideo.style.width = '100%';
        localVideo.style.maxHeight = '400px';
        localVideo.style.background = '#000';
        localVideo.style.borderRadius = '8px';
        localVideo.style.border = '2px solid var(--green)';

        const placeholder = container.querySelector('.video-placeholder');
        if (placeholder) placeholder.remove();
        const existing = document.getElementById('localVideo');
        if (existing) existing.remove();
        container.prepend(localVideo);

        const stopBtn = document.getElementById('stopStreamBtn');
        if (stopBtn) stopBtn.style.display = 'inline-block';

        updateStreamIndicator(true);

        initPeer(app.currentAuctionId, true);

        showToast('📹 Stream started! Buyers can now watch.', 'info');
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
    const localVideo = document.getElementById('localVideo');
    if (localVideo) localVideo.remove();
    const stopBtn = document.getElementById('stopStreamBtn');
    if (stopBtn) stopBtn.style.display = 'none';
    updateStreamIndicator(false);
    if (app.peer) {
        app.peer.destroy();
        app.peer = null;
    }
    const container = document.getElementById('videoContainer');
    const placeholder = container.querySelector('.video-placeholder');
    if (!placeholder) {
        const newPlaceholder = document.createElement('div');
        newPlaceholder.className = 'video-placeholder';
        newPlaceholder.textContent = '📹 Stream ended';
        container.prepend(newPlaceholder);
    }
    if (app.socket) {
        app.socket.emit('video-ended', { auctionId: app.currentAuctionId });
    }
    showToast('📹 Stream stopped', 'info');
}

function updateStreamIndicator(isLive) {
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

function initPeer(auctionId, isInitiator) {
    if (app.peer) {
        app.peer.destroy();
        app.peer = null;
    }
    const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ];
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
        const placeholder = document.querySelector('.video-placeholder');
        if (placeholder) placeholder.remove();
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

function handleVideoOffer(signal, senderId) {
    if (app.isAuctioneer) return;
    if (!app.peer) {
        initPeer(app.currentAuctionId, false);
    }
    if (app.peer) {
        app.peer.signal(signal);
    }
}

// ============================================================
// ========== START APP =======================================
// ============================================================

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

console.log('✅ SunAlgorithms app.js loaded (Phase 12 Complete)');