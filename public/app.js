// ============================================================
// app.js - CM Central Market - WITH LIVE AUCTION ROOM + MOBILE NAV
// Marketplace + Private Source + Live Room + Guest + KYC + Admin
// ============================================================

const app = {
    user: null,
    token: null,
    socket: null,
    deviceId: null,
    currentListingId: null,
    listings: [],
    sellerListings: [],
    marketplace: [],
    privateCollection: [],
    liveRoom: null,
    liveCurrentItem: null,
    liveQueue: [],
    livePeer: null,
    liveLocalStream: null,
    liveRemoteStreamActive: false,
    liveCountdownInterval: null,
    liveChatMessages: [],
    selectedCategory: 'All',
    selectedType: 'All',
    selectedSort: 'newest',
    searchQuery: '',
    currentView: 'landing',
    selectedListing: null,
    bidHistory: [],
    watchlist: [],
    favorites: [],
    notifications: [],
    unreadCount: 0,
    isAuctioneer: false,
    videoStream: null,
    peer: null,
    timerInterval: null,
    viewers: 0,
    _sellerCache: {},
    _marketplaceFilters: {
        filter: 'ALL',
        category: 'ALL',
        search: '',
        verifiedOnly: false,
        sort: 'recent'
    },
    currentPage: 'marketplace',
    filterPanelVisible: false
};

// ---------- XSS ESCAPE ----------
function esc(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, function(m) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return map[m];
    });
}

// ---------- TOAST ----------
function showToast(message, type = 'info') {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#101010;color:white;padding:0.8rem 1.5rem;border-radius:9999px;font-weight:600;z-index:9999;display:none;max-width:90%;';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.display = 'block';
    toast.style.borderColor = type === 'error' ? '#ff4444' : '#00ff88';
    toast.style.background = type === 'error' ? 'rgba(255,0,0,0.2)' : 'rgba(0,255,136,0.1)';
    clearTimeout(toast._hide);
    toast._hide = setTimeout(() => { toast.style.display = 'none'; }, 4000);
}

// ---------- API WRAPPER ----------
async function api(endpoint, method = 'GET', body = null) {
    const options = { method, headers: {} };
    if (app.token) options.headers['Authorization'] = `Bearer ${app.token}`;
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
    if (!res.ok) throw new Error(data.error || 'API request failed');
    return data;
}

// ---------- MODAL ----------
function openModal(content) {
    document.getElementById('modalContent').innerHTML = content;
    document.getElementById('modal').style.display = 'flex';
}
function closeModal() {
    document.getElementById('modal').style.display = 'none';
}

// ---------- LOGIN GUARD ----------
function requireLogin(actionLabel) {
    if (app.user && app.token) return true;
    showToast(`Please login to ${actionLabel}`, 'error');
    showLogin();
    return false;
}

// ---------- NAV MENU TOGGLE (mobile) ----------
function toggleNavMenu() {
    const dd = document.getElementById('navDropdown');
    const icon = document.getElementById('navMenuIcon');
    if (!dd) return;
    const isOpen = dd.style.display === 'block';
    dd.style.display = isOpen ? 'none' : 'block';
    if (icon) {
        icon.className = isOpen ? 'fas fa-bars' : 'fas fa-times';
    }
}

function closeNavMenu() {
    const dd = document.getElementById('navDropdown');
    const icon = document.getElementById('navMenuIcon');
    if (dd) dd.style.display = 'none';
    if (icon) icon.className = 'fas fa-bars';
}

// ============================================================
// ========== NAVIGATION ======================================
// ============================================================
function navigate(page) {
    closeNavMenu();

    if (!app.user && ['dashboard', 'createListing', 'kyc', 'profile', 'adminDashboard'].includes(page)) {
        showToast('Please login to access this page', 'error');
        return showLogin();
    }

    // Clear any live room state if navigating away
    if (app.currentPage === 'liveRoom' && page !== 'liveRoom') {
        cleanupLiveRoom();
    }

    app.currentPage = page;
    document.body.classList.toggle('private-theme', page === 'privateSource');
    document.body.classList.toggle('live-theme', page === 'liveRoom');

    switch (page) {
        case 'marketplace': renderMarketplace(); break;
        case 'privateSource': renderPrivateSource(); break;
        case 'liveRoom': renderLiveRoom(); break;
        case 'dashboard': renderDashboard(); break;
        case 'createListing': renderCreateListing(); break;
        case 'kyc': renderKYC(); break;
        case 'profile': renderProfile(); break;
        case 'adminDashboard': renderAdminDashboard(); break;
        default: renderMarketplace();
    }
}

// ============================================================
// ========== AUTH ============================================
// ============================================================
function showLogin() {
    closeNavMenu();
    openModal(`
        <span class="close-modal" onclick="closeModal()">&times;</span>
        <h2>CM Central Market Login</h2>
        <div class="form-group">
            <label for="loginEmail">Email</label>
            <input id="loginEmail" type="email" placeholder="you@example.com">
        </div>
        <div class="form-group">
            <label for="loginPassword">Password</label>
            <input id="loginPassword" type="password" placeholder="••••••••">
        </div>
        <button class="btn btn-primary" style="width:100%;background:#E30613;border:none;" onclick="handleLogin()">Login</button>
        <p style="margin-top:1rem;text-align:center;color:#888;">
            Don't have an account? <span style="color:#E30613;cursor:pointer;" onclick="closeModal();showRegister();">Register</span>
        </p>
    `);
}

async function handleLogin() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return showToast('Email and password required', 'error');

    const btn = document.querySelector('#modalContent .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Logging in...'; }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        app.token = data.token;
        app.user = data.user;
        localStorage.setItem('token', app.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        closeModal();
        await initApp();
        showToast(`Welcome, ${esc(app.user?.displayName || app.user?.name)}!`);
    } catch (err) {
        console.error('Login error:', err);
        showToast(err.name === 'AbortError' ? 'Request timed out.' : err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Login'; }
    }
}

function showRegister() {
    closeNavMenu();
    openModal(`
        <span class="close-modal" onclick="closeModal()">&times;</span>
        <h2>Register for CM Central Market</h2>
        <div class="form-group"><label for="regName">Full Name</label><input id="regName" placeholder="John Doe"></div>
        <div class="form-group"><label for="regDisplayName">Display Name</label><input id="regDisplayName" placeholder="JohnDoe (optional)"></div>
        <div class="form-group"><label for="regIdNumber">ID Number</label><input id="regIdNumber" placeholder="8001011234567"></div>
        <div class="form-group"><label for="regEmail">Email</label><input id="regEmail" type="email" placeholder="you@example.com"></div>
        <div class="form-group"><label for="regPhone">Phone (SA)</label><input id="regPhone" placeholder="0821234567"></div>
        <div class="form-group"><label for="regPassword">Password</label><input id="regPassword" type="password" placeholder="••••••••"></div>
        <div class="form-group">
            <label>Role</label>
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.3rem;">
                <button type="button" class="role-btn" data-role="BUYER" style="flex:1;padding:0.6rem;border:2px solid #EAEAEA;border-radius:8px;background:#fff;color:#101010;cursor:pointer;"><strong>Buyer</strong><br><small>Bid & buy</small></button>
                <button type="button" class="role-btn" data-role="INDIVIDUAL_SELLER" style="flex:1;padding:0.6rem;border:2px solid #EAEAEA;border-radius:8px;background:#fff;color:#101010;cursor:pointer;"><strong>Individual Seller</strong><br><small>Sell your own</small></button>
                <button type="button" class="role-btn" data-role="AUCTIONEER" style="flex:1;padding:0.6rem;border:2px solid #EAEAEA;border-radius:8px;background:#fff;color:#101010;cursor:pointer;"><strong>Auctioneer</strong><br><small>Invite only</small></button>
            </div>
            <input type="hidden" id="regRole" value="BUYER">
        </div>
        <div class="form-group">
            <label>ID Photo *</label>
            <div class="drag-area" id="registerIdDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;background:#fff;">
                <i class="fas fa-id-card" style="font-size:2rem;color:#E30613;"></i>
                <p style="margin:0.3rem 0;color:#666;font-size:0.85rem;">Click to upload ID photo</p>
            </div>
            <input type="file" id="regIdPhoto" accept="image/*" hidden>
            <div id="regIdPreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
        </div>
        <div class="form-group">
            <label>Selfie *</label>
            <div class="drag-area" id="registerSelfieDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;background:#fff;">
                <i class="fas fa-user" style="font-size:2rem;color:#E30613;"></i>
                <p style="margin:0.3rem 0;color:#666;font-size:0.85rem;">Take a selfie with your ID</p>
            </div>
            <input type="file" id="regSelfie" accept="image/*" hidden>
            <div id="regSelfiePreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
        </div>
        <button class="btn btn-primary" style="width:100%;margin-top:1rem;background:#E30613;border:none;" onclick="handleRegister()">Register</button>
        <p style="margin-top:1rem;text-align:center;color:#888;">
            Already have an account? <span style="color:#E30613;cursor:pointer;" onclick="closeModal();showLogin();">Login</span>
        </p>
    `);

    document.querySelectorAll('.role-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const role = this.dataset.role;
            document.getElementById('regRole').value = role;
            document.querySelectorAll('.role-btn').forEach(b => {
                b.style.borderColor = (b.dataset.role === role) ? '#E30613' : '#EAEAEA';
                b.style.background = (b.dataset.role === role) ? 'rgba(227,6,19,0.05)' : '#fff';
            });
        });
    });

    setupRegisterFileDrop('registerIdDrop', 'regIdPhoto', 'regIdPreview');
    setupRegisterFileDrop('registerSelfieDrop', 'regSelfie', 'regSelfiePreview');
}

function setupRegisterFileDrop(dropId, inputId, previewId) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!drop || !input) return;
    drop.onclick = () => input.click();
    drop.ondragover = (e) => { e.preventDefault(); drop.style.borderColor = '#E30613'; };
    drop.ondragleave = () => { drop.style.borderColor = '#EAEAEA'; };
    drop.ondrop = (e) => {
        e.preventDefault();
        drop.style.borderColor = '#EAEAEA';
        if (e.dataTransfer.files.length) {
            input.files = e.dataTransfer.files;
            if (preview) preview.innerHTML = `<span style="color:#E30613;">✅ ${esc(e.dataTransfer.files[0].name)}</span>`;
        }
    };
    input.onchange = () => {
        if (input.files.length && preview) {
            preview.innerHTML = `<span style="color:#E30613;">✅ ${esc(input.files[0].name)}</span>`;
        }
    };
}

async function handleRegister() {
    const name = document.getElementById('regName').value;
    const displayName = document.getElementById('regDisplayName').value || name;
    const idNumber = document.getElementById('regIdNumber').value;
    const email = document.getElementById('regEmail').value;
    const phone = document.getElementById('regPhone').value;
    const password = document.getElementById('regPassword').value;
    const role = document.getElementById('regRole').value;
    const idPhotoFile = document.getElementById('regIdPhoto')?.files?.[0];
    const selfieFile = document.getElementById('regSelfie')?.files?.[0];

    if (!name || !idNumber || !email || !password) return showToast('All fields required', 'error');
    if (!idPhotoFile || !selfieFile) return showToast('Please upload your ID photo and a selfie', 'error');

    const btn = document.querySelector('#modalContent .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Registering...'; }

    try {
        const formData = new FormData();
        formData.append('name', name);
        formData.append('displayName', displayName);
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
        localStorage.setItem('user', JSON.stringify(data.user));
        closeModal();
        initApp();
        showToast(`Registered! Welcome ${esc(app.user.displayName || app.user.name)}`);
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Register'; }
    }
}

function logout() {
    closeNavMenu();
    if (app.socket) { app.socket.disconnect(); app.socket = null; }
    cleanupLiveRoom();
    app.user = null;
    app.token = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    document.body.classList.remove('private-theme', 'live-theme');
    showToast('Logged out');
    initApp();
}

// ============================================================
// ========== INIT APP ========================================
// ============================================================
async function initApp() {
    app.deviceId = localStorage.getItem('deviceId') || Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('deviceId', app.deviceId);

    const token = localStorage.getItem('token');
    const navbar = document.getElementById('navbar');

    if (token) {
        app.token = token;
        try {
            const user = await api('/api/me');
            app.user = user;
            localStorage.setItem('user', JSON.stringify(user));
        } catch (err) {
            console.warn('Session invalid:', err.message);
            app.user = null;
            app.token = null;
            localStorage.removeItem('token');
            localStorage.removeItem('user');
        }
    }

    if (navbar) navbar.style.display = 'flex';

        // Helper: set display (with null check)
    const setBoth = (id, display) => {
        const el = document.getElementById(id);
        if (el) el.style.display = display;
    };

    if (app.user) {
        const isSeller = app.user.role === 'INDIVIDUAL_SELLER' || app.user.role === 'AUCTIONEER' || app.user.role === 'ADMIN';
        const isAdmin = app.user.role === 'ADMIN';

        setBoth('dashboardBtn', isSeller ? 'inline-flex' : 'none');
        setBoth('adminDashBtn', isAdmin ? 'inline-flex' : 'none');
        setBoth('profileBtn', 'inline-flex');

        // Show "+ Sell" button
        const sellBtn = document.getElementById('createListingBtn');
        if (sellBtn) {
            if (isSeller) sellBtn.classList.add('visible');
            else sellBtn.classList.remove('visible');
        }

        // User display
        const ud = document.getElementById('userDisplayDesktop');
        if (ud) ud.textContent = `👤 ${esc(app.user.displayName || app.user.name)}`;
        const udm = document.getElementById('userDisplayMobile');
        if (udm) udm.textContent = `👤 ${esc(app.user.displayName || app.user.name)}`;

        // Guest buttons off
        ['loginNavBtn', 'registerNavBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
            const elM = document.getElementById(id + 'Mobile');
            if (elM) elM.style.display = 'none';
        });

        // Logout on
        const logoutBtn = document.getElementById('logoutNavBtn');
        if (logoutBtn) logoutBtn.style.display = 'inline-block';
        const logoutBtnM = document.getElementById('logoutNavBtnMobile');
        if (logoutBtnM) logoutBtnM.style.display = 'flex';

        // Mobile dropdown dividers
        const d1 = document.getElementById('mobileDivider1');
        if (d1) d1.style.display = (isSeller || isAdmin) ? 'block' : 'none';
        const d2 = document.getElementById('mobileDivider2');
        if (d2) d2.style.display = 'block';

        connectSocket();
    } else {
        setBoth('dashboardBtn', 'none');
        setBoth('adminDashBtn', 'none');
        setBoth('profileBtn', 'none');

        const sellBtn = document.getElementById('createListingBtn');
        if (sellBtn) sellBtn.classList.remove('visible');

        const ud = document.getElementById('userDisplayDesktop');
        if (ud) ud.textContent = 'Guest';
        const udm = document.getElementById('userDisplayMobile');
        if (udm) udm.textContent = '👤 Guest';

        // Guest buttons on
        const loginBtn = document.getElementById('loginNavBtn');
        const registerBtn = document.getElementById('registerNavBtn');
        const loginBtnM = document.getElementById('loginNavBtnMobile');
        const registerBtnM = document.getElementById('registerNavBtnMobile');
        if (loginBtn) loginBtn.style.display = 'inline-block';
        if (registerBtn) registerBtn.style.display = 'inline-block';
        if (loginBtnM) loginBtnM.style.display = 'flex';
        if (registerBtnM) registerBtnM.style.display = 'flex';

        // Logout off
        const logoutBtn = document.getElementById('logoutNavBtn');
        const logoutBtnM = document.getElementById('logoutNavBtnMobile');
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (logoutBtnM) logoutBtnM.style.display = 'none';

        const d1 = document.getElementById('mobileDivider1');
        if (d1) d1.style.display = 'none';
        const d2 = document.getElementById('mobileDivider2');
        if (d2) d2.style.display = 'none';

        connectSocket();
    }

    await fetchMarketplace();
    navigate('marketplace');

    if (!app.user) {
        setTimeout(() => showToast('Browse freely! Login to bid or sell.', 'info'), 1200);
    }
}

// ============================================================
// ========== SOCKET.IO =======================================
// ============================================================
function connectSocket() {
    if (app.socket) return;
    try {
        app.socket = io({ auth: { token: app.token || '' } });
        app.socket.on('connect', () => console.log('Socket connected'));
        app.socket.on('connect_error', (err) => console.error('Socket error:', err.message));
        app.socket.on('marketplaceUpdated', () => fetchMarketplace());
        app.socket.on('bidUpdate', (data) => {
            showToast(`New bid: R${Number(data.currentBid).toLocaleString()}`, 'info');
            fetchMarketplace();
        });
        app.socket.on('error', (data) => showToast(data.message, 'error'));

        // ===== LIVE ROOM EVENT LISTENERS =====
        app.socket.on('liveViewerCount', (data) => {
            const el = document.getElementById('liveViewerCount');
            if (el) el.textContent = data.count;
        });

        app.socket.on('liveBidUpdate', (data) => {
            if (app.currentPage !== 'liveRoom') return;
            updateLiveBidDisplay(data);
        });

        app.socket.on('liveChatMessage', (data) => {
            if (app.currentPage !== 'liveRoom') return;
            appendLiveChat(data);
        });

        app.socket.on('liveItemStarted', (data) => {
            if (app.currentPage !== 'liveRoom') return;
            showToast('🔥 Next item on the block!', 'info');
            refreshLiveRoom();
        });

        app.socket.on('liveItemSold', (data) => {
            if (app.currentPage !== 'liveRoom') return;
            showToast(`🔨 SOLD to ${data.winnerName || 'winner'} for R${Number(data.finalPrice || 0).toLocaleString()}`, 'info');
        });

        app.socket.on('liveItemPassed', (data) => {
            if (app.currentPage !== 'liveRoom') return;
            showToast('⏭️ Item passed', 'info');
        });

        app.socket.on('liveRoomStarted', () => {
            if (app.currentPage !== 'liveRoom') return;
            showToast('🔴 Live auction started!', 'info');
            refreshLiveRoom();
        });

        app.socket.on('liveRoomEnded', () => {
            if (app.currentPage !== 'liveRoom') return;
            showToast('Live auction ended', 'info');
            refreshLiveRoom();
        });

        app.socket.on('liveItemAdded', () => {
            if (app.currentPage !== 'liveRoom') return;
            refreshLiveRoom();
        });

        // WebRTC signaling
        app.socket.on('liveVideoOffer', async (data) => {
            await handleLiveVideoOffer(data);
        });
        app.socket.on('liveVideoAnswer', async (data) => {
            if (app.livePeer && !app.livePeer.destroyed) {
                try { await app.livePeer.signal(data.signal); } catch (e) {}
            }
        });
        app.socket.on('liveVideoCandidate', async (data) => {
            if (app.livePeer && !app.livePeer.destroyed) {
                try { await app.livePeer.signal(data.candidate); } catch (e) {}
            }
        });
        app.socket.on('liveStreamStarted', () => {
            if (app.currentPage !== 'liveRoom') return;
            showToast('📹 Auctioneer is live', 'info');
            const ph = document.getElementById('liveVideoPlaceholder');
            if (ph) ph.style.display = 'none';
        });
        app.socket.on('liveStreamEnded', () => {
            if (app.currentPage !== 'liveRoom') return;
            const ph = document.getElementById('liveVideoPlaceholder');
            if (ph) ph.style.display = 'flex';
        });
    } catch (e) {
        console.warn('Socket connection failed:', e.message);
    }
}

// ============================================================
// ========== MARKETPLACE =====================================
// ============================================================
async function fetchMarketplace(filters = {}) {
    try {
        const params = new URLSearchParams(filters);
        const data = await api(`/api/marketplace?${params.toString()}`);
        app.marketplace = data;
        app.listings = data;
        return data;
    } catch (err) {
        console.error('Failed to fetch marketplace:', err);
        return [];
    }
}

async function renderMarketplace() {
    const main = document.getElementById('mainContent');
    if (!app._marketplaceFilters) {
        app._marketplaceFilters = { filter: 'ALL', category: 'ALL', search: '', verifiedOnly: false, sort: 'recent' };
    }
    const filters = app._marketplaceFilters;

    await fetchMarketplace({
        filter: filters.filter,
        category: filters.category === 'ALL' ? '' : filters.category,
        search: filters.search || '',
        verifiedOnly: filters.verifiedOnly ? 'true' : ''
    });
    const filtered = app.listings || [];
    const categories = ['ALL', 'Vehicles', 'Motorcycles', 'TLB/Machinery', 'Electronics', 'Other'];

    const filterChipsHtml = `
        <div id="filterChips" style="display:${app.filterPanelVisible ? 'flex' : 'none'}; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.5rem; overflow-x:auto; padding-bottom:0.25rem; width:100%;">
            ${[
                { id: 'ALL', label: 'All' },
                { id: 'AUCTION', label: '🔨 Live Auctions' },
                { id: 'FIXED_PRICE', label: '🏷️ Fixed Price' }
            ].map(c => `
                <button onclick="setMarketplaceFilter('filter','${c.id}')" style="white-space:nowrap;padding:0.5rem 1.2rem;border-radius:9999px;font-size:0.9rem;font-weight:700;border:1px solid ${filters.filter === c.id ? '#101010' : '#EAEAEA'};background:${filters.filter === c.id ? '#101010' : 'white'};color:${filters.filter === c.id ? 'white' : '#666'};cursor:pointer;">
                    ${c.label}
                </button>
            `).join('')}
            <button onclick="setMarketplaceFilter('verifiedOnly', !${filters.verifiedOnly})" style="white-space:nowrap;padding:0.5rem 1.2rem;border-radius:9999px;font-size:0.9rem;font-weight:700;border:1px solid ${filters.verifiedOnly ? '#28a745' : '#EAEAEA'};background:${filters.verifiedOnly ? '#28a745' : 'white'};color:${filters.verifiedOnly ? 'white' : '#666'};cursor:pointer;">
                ✓ CM Verified only
            </button>
        </div>
        <div id="categoryChips" style="display:${app.filterPanelVisible ? 'flex' : 'none'}; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem; overflow-x:auto; padding-bottom:0.25rem; width:100%;">
            ${categories.map(c => `
                <button onclick="setMarketplaceFilter('category','${c}')" style="white-space:nowrap;padding:0.3rem 1rem;border-radius:9999px;font-size:0.85rem;font-weight:600;border:1px solid ${filters.category === c ? '#101010' : '#EAEAEA'};background:${filters.category === c ? '#F5F5F7' : 'white'};color:${filters.category === c ? '#101010' : '#666'};cursor:pointer;">
                    ${c}
                </button>
            `).join('')}
        </div>
    `;

    main.innerHTML = `
        <div style="max-width:1400px;margin:0 auto;padding:0 1rem;background:#F5F5F7;min-height:100vh;">
            <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:0.75rem 1rem;display:flex;gap:0.5rem;margin-bottom:0.75rem;box-shadow:0 2px 8px rgba(0,0,0,0.05);flex-wrap:wrap;align-items:center;">
                <input id="marketplaceSearch" value="${esc(filters.search)}" placeholder="Search bike, car, TLB..." style="flex:1;min-width:160px;padding:0.6rem 1rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;font-size:0.95rem;outline:none;">
                <button onclick="applyMarketplaceFilters()" style="background:#E30613;color:#fff;padding:0.6rem 1.2rem;border:none;border-radius:8px;font-weight:700;cursor:pointer;">Search</button>
                <button onclick="toggleFilterPanel()" style="background:#101010;color:#fff;padding:0.6rem 1rem;border:none;border-radius:8px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
                    <i class="fas fa-sliders-h"></i> Filter
                </button>
                <select onchange="setMarketplaceFilter('sort', this.value)" style="padding:0.5rem 0.8rem;border-radius:8px;background:white;border:1px solid #EAEAEA;color:#101010;font-size:0.9rem;">
                    <option value="recent" ${filters.sort === 'recent' ? 'selected' : ''}>Most Recent</option>
                    <option value="price_low" ${filters.sort === 'price_low' ? 'selected' : ''}>Price: Low to High</option>
                    <option value="price_high" ${filters.sort === 'price_high' ? 'selected' : ''}>Price: High to Low</option>
                    <option value="ending" ${filters.sort === 'ending' ? 'selected' : ''}>Ending Soon</option>
                </select>
            </div>
            ${filterChipsHtml}
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:1rem;">
                <p style="font-size:0.9rem;color:#666;">${filtered.length} listings • From CM agents + private sellers</p>
            </div>
            <div class="marketplace-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.25rem;">
                ${filtered.length > 0 ? filtered.map(item => renderAuctionCard(item)).join('') : `
                    <div style="grid-column:1/-1;text-align:center;padding:3rem 0;">
                        <p style="font-size:1.2rem;font-weight:600;color:#666;">No listings found</p>
                    </div>
                `}
            </div>
        </div>
    `;
}

function toggleFilterPanel() {
    app.filterPanelVisible = !app.filterPanelVisible;
    renderMarketplace();
}
function setMarketplaceFilter(key, value) {
    if (!app._marketplaceFilters) app._marketplaceFilters = { filter: 'ALL', category: 'ALL', search: '', verifiedOnly: false, sort: 'recent' };
    app._marketplaceFilters[key] = value;
    renderMarketplace();
}
function applyMarketplaceFilters() {
    app._marketplaceFilters.search = document.getElementById('marketplaceSearch')?.value || '';
    renderMarketplace();
}

// ============================================================
// ========== PRIVATE SOURCE ==================================
// ============================================================
async function fetchPrivateCollection() {
    try {
        const data = await api('/api/private/collection');
        app.privateCollection = data;
        return data;
    } catch (err) {
        console.error('Failed to fetch private collection:', err);
        return { listings: [], cipc: '2024/XXXXXX/07', whatsapp: '27665254746' };
    }
}

async function renderPrivateSource() {
    const main = document.getElementById('mainContent');
    const data = await fetchPrivateCollection();
    const listings = data.listings || [];
    const cipc = data.cipc || '2024/XXXXXX/07';

    main.innerHTML = `
        <div style="max-width:1200px;margin:0 auto;padding:2rem 1rem;">
            <a href="javascript:void(0)" onclick="navigate('marketplace')" style="color:#9CA3AF;font-size:0.85rem;text-decoration:none;display:inline-block;margin-bottom:1.5rem;letter-spacing:0.5px;">
                ← Back to Marketplace
            </a>
            <div style="text-align:center;margin-bottom:2rem;">
                <p style="font-size:0.75rem;color:#9CA3AF;letter-spacing:3px;text-transform:uppercase;margin:0 0 0.5rem 0;">💎 By Instruction Only</p>
                <h1 style="font-size:2.5rem;font-weight:300;color:#1A1A1A;margin:0 0 1rem 0;letter-spacing:-0.5px;">Private Sourcing</h1>
                <p style="color:#6B6B6B;font-size:1rem;line-height:1.6;max-width:600px;margin:0 auto;">
                    For clients who don't have time for public auctions.<br>
                    We source clean, 1-owner vehicles quietly through our verified network.
                </p>
            </div>
            <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:1.5rem;padding:1rem 0;border-top:1px solid #E5E5E0;border-bottom:1px solid #E5E5E0;margin-bottom:2rem;font-size:0.8rem;color:#6B6B6B;">
                <span>✅ CIPC Registered: ${esc(cipc)}</span>
                <span>🛡️ Papers Verified & Clear</span>
                <span>🚛 500+ Vehicles Sourced</span>
                <span>🤝 Trusted by Fleet Clients</span>
            </div>
            <div class="private-card" style="padding:2rem;margin-bottom:2rem;">
                <h2 style="font-size:1.5rem;font-weight:400;color:#1A1A1A;margin:0 0 0.5rem 0;">Instruct Us To Find Your Vehicle</h2>
                <p style="color:#9CA3AF;font-size:0.9rem;margin:0 0 1.5rem 0;">5 fields. No public bidding. WhatsApp & email only.</p>
                <form id="privateInstructionForm">
                    <div class="form-group">
                        <label>What vehicle are you looking for? *</label>
                        <input id="piVehicleWanted" placeholder="e.g. 2023 Lexus RX 500h, White">
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                        <div class="form-group">
                            <label>Budget Range *</label>
                            <select id="piBudget">
                                <option value="">Select budget</option>
                                <option value="R300k-R500k">R300k – R500k</option>
                                <option value="R500k-R800k">R500k – R800k</option>
                                <option value="R800k-R1.2M">R800k – R1.2M</option>
                                <option value="R1.2M+">R1.2M+</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Year / KM Preference</label>
                            <input id="piYearKm" placeholder="e.g. 2022+, under 50,000km">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>How urgently? *</label>
                        <select id="piUrgency">
                            <option value="">Select urgency</option>
                            <option value="Within 7 days">Within 7 days</option>
                            <option value="Within 14 days">Within 14 days</option>
                            <option value="No rush — find the right one">No rush — find the right one</option>
                        </select>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                        <div class="form-group">
                            <label>WhatsApp Number *</label>
                            <input id="piWhatsapp" placeholder="0821234567">
                        </div>
                        <div class="form-group">
                            <label>Private Email</label>
                            <input id="piEmail" type="email" placeholder="you@example.com">
                        </div>
                    </div>
                    <button type="submit" class="btn-private" style="width:100%;margin-top:1rem;">Send Private Instruction</button>
                    <p style="font-size:0.7rem;color:#9CA3AF;text-align:center;margin-top:0.75rem;">Your instruction is private. Replies via WhatsApp & email only.</p>
                </form>
            </div>
            <div style="margin-bottom:2rem;">
                <h2 style="font-size:1.25rem;font-weight:400;color:#1A1A1A;margin:0 0 0.5rem 0;">Private Collection</h2>
                <p style="color:#9CA3AF;font-size:0.85rem;margin:0 0 1.5rem 0;">Selected vehicles — Price on Request</p>
                ${listings.length > 0 ? `
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.5rem;">
                        ${listings.map(item => renderPrivateCard(item)).join('')}
                    </div>
                ` : `
                    <div class="private-card" style="padding:3rem;text-align:center;color:#9CA3AF;">
                        <p style="margin:0 0 0.5rem 0;font-size:1rem;">No vehicles currently available in Private Collection</p>
                        <p style="margin:0;font-size:0.85rem;">Submit your instruction above — we'll source it for you.</p>
                    </div>
                `}
            </div>
            <div style="text-align:center;padding:1.5rem 0;border-top:1px solid #E5E5E0;font-size:0.75rem;color:#9CA3AF;line-height:1.7;">
                Registration & compliance docs available on request via WhatsApp.<br>
                No public bidding. All inspections done privately.
            </div>
        </div>
    `;

    document.getElementById('privateInstructionForm').addEventListener('submit', submitPrivateInstruction);
}

function renderPrivateCard(item) {
    const imageUrl = item.mainImageUrl || (item.imageUrls && item.imageUrls[0]) || '/logo.jpeg';
    const title = esc(item.title);
    const sourceBadge = esc(item.sourceBadge || 'Verified Private Collection');
    const trustLine = esc(item.trustLine || 'Papers Verified & Clear');
    const status = esc(item.privateStatus || 'Available Privately');
    const waMsg = encodeURIComponent(`Hi CM Private Sourcing, I'm interested in ${item.title} (ID: ${item.id}). Please send private details + inspection report.`);

    return `
        <div class="private-card">
            <div style="aspect-ratio:4/3;background:#000;overflow:hidden;">
                <img src="${imageUrl}" alt="${title}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='/logo.jpeg'">
            </div>
            <div style="padding:1.25rem;">
                <p style="font-size:0.65rem;color:#9CA3AF;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 0.5rem 0;">${sourceBadge}</p>
                <h3 style="font-size:1.1rem;font-weight:500;color:#1A1A1A;margin:0 0 0.5rem 0;line-height:1.3;">${title}</h3>
                <p style="font-size:0.8rem;color:#6B6B6B;margin:0 0 0.5rem 0;">${trustLine}</p>
                <p style="font-size:0.75rem;color:#9CA3AF;margin:0 0 1rem 0;">${status}</p>
                <p style="font-size:0.9rem;font-weight:600;color:#1A1A1A;margin:0 0 1rem 0;">Price on Request</p>
                <a href="https://wa.me/27665254746?text=${waMsg}" target="_blank" style="display:block;text-align:center;background:#1A1A1A;color:#fff;padding:0.75rem;border-radius:8px;font-weight:600;font-size:0.85rem;text-decoration:none;letter-spacing:0.5px;">
                    VIEW PRIVATELY →
                </a>
            </div>
        </div>
    `;
}

async function submitPrivateInstruction(e) {
    e.preventDefault();
    const vehicleWanted = document.getElementById('piVehicleWanted').value.trim();
    const budgetRange = document.getElementById('piBudget').value;
    const yearKmPref = document.getElementById('piYearKm').value.trim();
    const urgency = document.getElementById('piUrgency').value;
    const whatsapp = document.getElementById('piWhatsapp').value.trim();
    const privateEmail = document.getElementById('piEmail').value.trim();

    if (!vehicleWanted || !budgetRange || !urgency || !whatsapp) {
        return showToast('Please fill all required fields', 'error');
    }

    const btn = document.querySelector('#privateInstructionForm .btn-private');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

    try {
        const res = await fetch('/api/private/instruct', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(app.token ? { 'Authorization': `Bearer ${app.token}` } : {})
            },
            body: JSON.stringify({ vehicleWanted, budgetRange, yearKmPref, urgency, whatsapp, privateEmail })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast('Instruction received — check your WhatsApp', 'info');
        document.getElementById('privateInstructionForm').reset();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Send Private Instruction'; }
    }
}

// ============================================================
// ========== LIVE AUCTION ROOM ===============================
// ============================================================

async function renderLiveRoom() {
    const main = document.getElementById('mainContent');
    main.innerHTML = `
        <div style="max-width:1400px;margin:0 auto;padding:1rem;">
            <div style="text-align:center;padding:2rem 1rem;">
                <div class="live-dot" style="width:14px;height:14px;margin:0 auto 1rem auto;"></div>
                <p style="font-size:0.75rem;color:#E30613;letter-spacing:3px;text-transform:uppercase;margin:0 0 0.5rem 0;font-weight:700;">🔴 Live Auction Room</p>
                <h1 style="font-size:2rem;font-weight:900;color:#101010;margin:0 0 1rem 0;">Loading...</h1>
            </div>
            <div style="text-align:center;color:#666;">Connecting to live room...</div>
        </div>
    `;
    await refreshLiveRoom();
}

async function refreshLiveRoom() {
    try {
        const data = await api('/api/live/current');
        if (!data.room) {
            renderNoLiveRoom();
            return;
        }
        app.liveRoom = data.room;
        app.liveCurrentItem = data.room.currentItem;
        app.liveQueue = data.room.queue || [];
        renderLiveRoomUI();
    } catch (err) {
        console.error('Live room load error:', err);
        renderNoLiveRoom();
    }
}

function renderNoLiveRoom() {
    const main = document.getElementById('mainContent');
    main.innerHTML = `
        <div style="max-width:800px;margin:0 auto;padding:2rem 1rem;text-align:center;">
            <div style="background:white;border:1px solid #EAEAEA;border-radius:16px;padding:3rem 2rem;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
                <div class="live-dot" style="width:14px;height:14px;margin:0 auto 1rem auto;opacity:0.4;"></div>
                <h2 style="font-size:1.5rem;font-weight:900;color:#101010;margin:0 0 0.5rem 0;">No Live Auction Right Now</h2>
                <p style="color:#666;font-size:1rem;margin:0 0 2rem 0;">Check back soon — Tuesdays & Fridays 19:00.</p>
                <div style="background:#FFF8F1;border:1px solid #FFE0C4;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem;text-align:left;">
                    <p style="margin:0 0 0.5rem 0;font-weight:700;color:#101010;">📅 Scheduled Sessions</p>
                    <p style="margin:0;color:#666;font-size:0.9rem;">Tuesday 19:00 — Soweto Wheels Live</p>
                    <p style="margin:0;color:#666;font-size:0.9rem;">Friday 19:00 — Weekend Special</p>
                </div>
                <button onclick="navigate('marketplace')" class="btn btn-primary" style="background:#E30613;border:none;padding:0.75rem 1.5rem;">
                    Browse Marketplace Instead
                </button>
            </div>
        </div>
    `;
}

function renderLiveRoomUI() {
    const main = document.getElementById('mainContent');
    const room = app.liveRoom;
    if (!room) return renderNoLiveRoom();

    const isLive = room.status === 'LIVE';
    const item = room.currentItem;

    main.innerHTML = `
        <div style="max-width:1400px;margin:0 auto;padding:1rem;">

            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:1rem;">
                <div>
                    <h1 style="font-size:1.5rem;font-weight:900;color:#101010;margin:0;display:flex;align-items:center;gap:0.5rem;">
                        ${isLive ? '<span class="live-dot"></span>' : ''}
                        ${esc(room.title || 'Live Auction Room')}
                    </h1>
                    <p style="color:#666;font-size:0.85rem;margin:0.25rem 0 0 0;">
                        👁️ <span id="liveViewerCount">${room.viewerCount || 0}</span> watching
                        ${isLive ? '• 🔴 LIVE NOW' : '• Not started yet'}
                    </p>
                </div>
                <button onclick="navigate('marketplace')" class="btn btn-outline" style="border-color:#EAEAEA;color:#666;">
                    ← Back to Marketplace
                </button>
            </div>

            <div class="live-grid">
                <div class="live-left">
                    <div class="live-video-wrap">
                        <div id="liveVideoPlaceholder" style="position:absolute;inset:0;display:${app.liveRemoteStreamActive ? 'none' : 'flex'};align-items:center;justify-content:center;flex-direction:column;background:linear-gradient(135deg,#1A1A1A 0%,#000 100%);color:#fff;text-align:center;padding:1rem;">
                            ${isLive ? `
                                <div class="live-dot" style="width:12px;height:12px;margin-bottom:0.75rem;"></div>
                                <p style="margin:0;font-weight:700;font-size:1rem;">Auctioneer is live</p>
                                <p style="margin:0.5rem 0 0 0;font-size:0.8rem;color:#9CA3AF;">Connecting to video stream...</p>
                            ` : `
                                <p style="margin:0;font-weight:700;font-size:1rem;">Stream starts when auctioneer goes live</p>
                                <p style="margin:0.5rem 0 0 0;font-size:0.8rem;color:#9CA3AF;">You'll see the auctioneer's camera here</p>
                            `}
                        </div>
                        <video id="liveVideoPlayer" autoplay playsinline muted style="width:100%;height:100%;object-fit:contain;background:#000;display:${app.liveRemoteStreamActive ? 'block' : 'none'};"></video>
                        ${isLive ? `<div style="position:absolute;top:12px;left:12px;background:#E30613;color:#fff;padding:4px 10px;border-radius:4px;font-size:0.75rem;font-weight:800;letter-spacing:1px;">🔴 LIVE</div>` : ''}
                    </div>

                    ${item ? renderLiveItemPanel(item) : `
                        <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;margin-top:1rem;text-align:center;">
                            <p style="color:#666;margin:0;font-size:0.95rem;">
                                ${isLive ? 'Waiting for next item on the block...' : 'Auction starts soon — get ready!'}
                            </p>
                        </div>
                    `}
                </div>

                <div class="live-right">
                    <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;flex:1;min-height:400px;max-height:600px;">
                        <div style="padding:0.75rem 1rem;background:#101010;color:#fff;font-weight:800;font-size:0.85rem;letter-spacing:1px;">
                            💬 LIVE CHAT
                        </div>
                        <div id="liveChatFeed" style="flex:1;overflow-y:auto;padding:0.75rem 1rem;background:#FAFAFA;">
                            ${renderChatMessages(room.recentMessages || [])}
                        </div>
                        <div style="padding:0.6rem;border-top:1px solid #EAEAEA;display:flex;gap:0.5rem;">
                            <input id="liveChatInput" placeholder="Type a message..." style="flex:1;padding:0.5rem 0.75rem;border:1px solid #EAEAEA;border-radius:8px;font-size:0.9rem;outline:none;" onkeydown="if(event.key==='Enter'){event.preventDefault();sendLiveChat();}">
                            <button onclick="sendLiveChat()" style="background:#E30613;color:#fff;border:none;border-radius:8px;padding:0.5rem 1rem;font-weight:800;cursor:pointer;font-size:0.85rem;">Send</button>
                        </div>
                    </div>

                    ${app.liveQueue && app.liveQueue.length > 0 ? `
                        <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1rem;margin-top:1rem;">
                            <p style="font-weight:800;color:#101010;margin:0 0 0.75rem 0;font-size:0.85rem;letter-spacing:1px;">📋 UP NEXT</p>
                            ${app.liveQueue.filter(q => q.status === 'PENDING').slice(0, 5).map((q, i) => `
                                <div style="display:flex;gap:0.75rem;align-items:center;padding:0.5rem 0;${i < 4 ? 'border-bottom:1px solid #F0F0F0;' : ''}">
                                    <img src="${q.mainImageUrl || '/logo.jpeg'}" style="width:50px;height:50px;object-fit:cover;border-radius:8px;flex-shrink:0;" onerror="this.src='/logo.jpeg'">
                                    <div style="flex:1;min-width:0;">
                                        <p style="margin:0;font-weight:700;font-size:0.85rem;color:#101010;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(q.title)}</p>
                                        <p style="margin:0;font-size:0.75rem;color:#666;">Start: R${Number(q.startPrice).toLocaleString()}</p>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    if (app.socket) {
        app.socket.emit('liveJoin', { roomId: room.id });
    }

    startLiveCountdownTicker();

    const feed = document.getElementById('liveChatFeed');
    if (feed) feed.scrollTop = feed.scrollHeight;
}

function renderLiveItemPanel(item) {
    const bid = item.currentBid || 0;
    const startPrice = item.startPrice || 0;
    const currentPrice = bid || startPrice;
    const minNextBid = bid ? bid + 500 : startPrice;
    const isOwnListing = app.user && item.seller?.id === app.user.id;

    return `
        <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.25rem;margin-top:1rem;">
            <div style="display:grid;grid-template-columns:100px 1fr;gap:1rem;align-items:start;">
                <img src="${esc(item.mainImageUrl || '/logo.jpeg')}" style="width:100px;height:100px;object-fit:cover;border-radius:8px;background:#F5F5F7;" onerror="this.src='/logo.jpeg'">
                <div style="min-width:0;">
                    <p style="margin:0 0 0.25rem 0;font-size:0.7rem;color:#E30613;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">🔴 ON THE BLOCK</p>
                    <h3 style="margin:0 0 0.25rem 0;font-size:1.1rem;font-weight:800;color:#101010;line-height:1.2;">${esc(item.title || (item.listing?.title || 'Loading...'))}</h3>
                    ${item.listing?.year || item.listing?.kilometers ? `<p style="margin:0;font-size:0.8rem;color:#666;">${item.listing?.year || ''} ${item.listing?.kilometers ? '• ' + Number(item.listing.kilometers).toLocaleString() + ' km' : ''}</p>` : ''}
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-top:1.25rem;">
                <div style="background:#F5F5F7;padding:0.75rem;border-radius:10px;text-align:center;">
                    <p style="margin:0;font-size:0.7rem;color:#888;text-transform:uppercase;letter-spacing:1px;">Current Bid</p>
                    <p id="liveCurrentBid" style="margin:0.2rem 0 0 0;font-size:1.6rem;font-weight:900;color:#101010;">R${Number(currentPrice).toLocaleString()}</p>
                </div>
                <div style="background:#FFF3F3;padding:0.75rem;border-radius:10px;text-align:center;">
                    <p style="margin:0;font-size:0.7rem;color:#E30613;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Countdown</p>
                    <p id="liveCountdown" style="margin:0.2rem 0 0 0;font-size:1.6rem;font-weight:900;color:#E30613;">${item.countdownEnds ? '10s' : '—'}</p>
                </div>
            </div>

            <div style="margin-top:0.75rem;display:flex;justify-content:space-between;align-items:center;font-size:0.8rem;color:#666;">
                <span id="liveBidderName">${item.currentBidderName ? `🏆 ${esc(item.currentBidderName)}` : 'No bids yet'}</span>
                <span id="liveBidCount">${item.bidCount || 0} bids</span>
            </div>

            ${isOwnListing ? `
                <div style="margin-top:1rem;background:#FFF3F3;padding:0.75rem;border-radius:8px;text-align:center;color:#E30613;font-weight:700;font-size:0.9rem;">
                    Your own listing
                </div>
            ` : `
                <div style="margin-top:1rem;display:flex;gap:0.5rem;">
                    <input type="number" id="liveBidInput" value="${minNextBid}" style="flex:1;min-width:0;padding:0.85rem 1rem;border:1px solid #EAEAEA;border-radius:10px;font-size:1.1rem;font-weight:800;color:#101010;outline:none;">
                    <button onclick="placeLiveBid('${item.id}')" class="live-bid-btn">BID NOW</button>
                </div>
            `}
        </div>
    `;
}

function renderChatMessages(messages) {
    if (!messages || messages.length === 0) {
        return `<p style="color:#999;font-size:0.85rem;text-align:center;padding:1rem;margin:0;">No messages yet. Say hello!</p>`;
    }
    return messages.map(m => {
        if (m.isSystem) {
            return `<div class="live-chat-bubble-system">${esc(m.message)}</div>`;
        }
        return `<div class="live-chat-bubble-user"><strong>${esc(m.userName)}:</strong> ${esc(m.message)}</div>`;
    }).join('');
}

function appendLiveChat(msg) {
    const feed = document.getElementById('liveChatFeed');
    if (!feed) return;
    const html = msg.isSystem
        ? `<div class="live-chat-bubble-system">${esc(msg.message)}</div>`
        : `<div class="live-chat-bubble-user"><strong>${esc(msg.userName)}:</strong> ${esc(msg.message)}</div>`;
    feed.innerHTML += html;
    feed.scrollTop = feed.scrollHeight;

    while (feed.children.length > 100) {
        feed.removeChild(feed.firstChild);
    }
}

function sendLiveChat() {
    if (!app.user) return showToast('Login to chat', 'error');
    const input = document.getElementById('liveChatInput');
    if (!input) return;
    const message = input.value.trim();
    if (!message || !app.socket || !app.liveRoom) return;
    app.socket.emit('liveChat', { roomId: app.liveRoom.id, message });
    input.value = '';
}

async function placeLiveBid(itemId) {
    if (!requireLogin('place a bid')) return;
    const input = document.getElementById('liveBidInput');
    const amount = parseFloat(input?.value);
    if (!amount || amount <= 0) return showToast('Enter a valid bid amount', 'error');

    if (!app.socket) return showToast('Not connected', 'error');
    app.socket.emit('liveBid', { itemId, amount });
}

function updateLiveBidDisplay(data) {
    const bidEl = document.getElementById('liveCurrentBid');
    const bidderEl = document.getElementById('liveBidderName');
    const countEl = document.getElementById('liveBidCount');
    const inputEl = document.getElementById('liveBidInput');
    const countdownEl = document.getElementById('liveCountdown');

    if (bidEl) bidEl.textContent = `R${Number(data.currentBid).toLocaleString()}`;
    if (bidderEl) bidderEl.textContent = `🏆 ${data.currentBidderName}`;
    if (countEl) countEl.textContent = `${data.bidCount} bids`;
    if (inputEl) inputEl.value = Number(data.currentBid) + 500;
    if (countdownEl && data.countdownEnds) {
        countdownEl.textContent = Math.max(0, Math.round((new Date(data.countdownEnds) - Date.now()) / 1000)) + 's';
    }

    if (data.extended) {
        showToast('⏱️ Extended +15 seconds!', 'info');
    }
}

function startLiveCountdownTicker() {
    if (app.liveCountdownInterval) clearInterval(app.liveCountdownInterval);
    app.liveCountdownInterval = setInterval(() => {
        const el = document.getElementById('liveCountdown');
        if (!el || !app.liveCurrentItem || !app.liveCurrentItem.countdownEnds) return;
        const remaining = Math.max(0, Math.round((new Date(app.liveCurrentItem.countdownEnds) - Date.now()) / 1000));
        el.textContent = remaining + 's';
    }, 250);
}

// ============================================================
// ========== LIVE ROOM: WebRTC RECEIVE =======================
// ============================================================
async function handleLiveVideoOffer(data) {
    if (app.currentPage !== 'liveRoom') return;
    if (!window.SimplePeer) {
        console.warn('SimplePeer not loaded');
        return;
    }

    try {
        if (app.livePeer && !app.livePeer.destroyed) {
            app.livePeer.destroy();
        }

        app.livePeer = new SimplePeer({
            initiator: false,
            trickle: true,
            config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
        });

        app.livePeer.on('signal', (signal) => {
            if (!app.socket) return;
            if (signal.type === 'answer') {
                app.socket.emit('liveVideoAnswer', { roomId: data.roomId, signal, to: data.from });
            } else if (signal.candidate) {
                app.socket.emit('liveVideoCandidate', { roomId: data.roomId, candidate: signal, to: data.from });
            }
        });

        app.livePeer.on('stream', (stream) => {
            const video = document.getElementById('liveVideoPlayer');
            const ph = document.getElementById('liveVideoPlaceholder');
            if (video) {
                video.srcObject = stream;
                video.style.display = 'block';
                video.play().catch(e => console.warn('Video play failed:', e.message));
            }
            if (ph) ph.style.display = 'none';
            app.liveRemoteStreamActive = true;
        });

        app.livePeer.on('error', (err) => {
            console.warn('Live peer error:', err.message);
        });

        app.livePeer.on('close', () => {
            app.liveRemoteStreamActive = false;
        });

        app.livePeer.signal(data.signal);
    } catch (e) {
        console.error('WebRTC offer handling failed:', e.message);
    }
}

function cleanupLiveRoom() {
    if (app.liveCountdownInterval) {
        clearInterval(app.liveCountdownInterval);
        app.liveCountdownInterval = null;
    }
    if (app.livePeer && !app.livePeer.destroyed) {
        app.livePeer.destroy();
        app.livePeer = null;
    }
    if (app.socket && app.liveRoom) {
        app.socket.emit('liveLeave', { roomId: app.liveRoom.id });
    }
    app.liveRemoteStreamActive = false;
    app.liveCurrentItem = null;
}

// ============================================================
// ========== AUCTION CARD ====================================
// ============================================================
function renderAuctionCard(item) {
    const isAuction = item.listingType === 'AUCTION';
    const endTime = item.endTime || null;
    const isLive = isAuction && (!endTime || new Date(endTime) > new Date());
    const isEnded = isAuction && endTime && new Date(endTime) <= new Date();

    let displayPrice = 0;
    if (item.displayPrice) displayPrice = item.displayPrice;
    else if (isAuction) displayPrice = item.currentBid || item.startingPrice || item.reservePrice || 0;
    else displayPrice = item.price || 0;

    const priceDisplay = `R ${Number(displayPrice).toLocaleString()}`;
    const timeDisplay = isAuction
        ? (endTime ? getTimeRemaining(endTime) : 'No end time')
        : (item.isNegotiable ? 'Negotiable' : 'Buy Now');

    const imageUrl = item.mainImageUrl || (item.images && item.images.length > 0 ? item.images[0] : '/logo.jpeg');
    const sellerName = esc(item.seller?.displayName || item.seller?.name || 'CM Agent');
    const sellerId = item.seller?.id || '';
    const specLine = item.year || item.kilometers
        ? `${item.year || ''} • ${item.kilometers ? Number(item.kilometers).toLocaleString() + ' km' : ''}`
        : item.category || '';
    const verifiedBadge = item.isVerified ? `<span style="background:#28a745;color:white;font-size:0.65rem;padding:2px 6px;border-radius:4px;margin-left:6px;">✓ VERIFIED</span>` : '';
    const title = esc(item.title);

    return `
        <div class="auction-card-item" onclick="viewListingDetail('${item.id}')" style="background:white;border:1px solid #EAEAEA;border-radius:12px;overflow:hidden;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
            <div style="position:relative;aspect-ratio:4/3;background:#F5F5F7;overflow:hidden;">
                <img src="${imageUrl}" alt="${title}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='/logo.jpeg'">
                ${isAuction && isLive ? `<span style="position:absolute;top:0.75rem;left:0.75rem;background:#E30613;color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.6rem;border-radius:4px;text-transform:uppercase;">LIVE</span>` : ''}
                ${isAuction && isEnded ? `<span style="position:absolute;top:0.75rem;left:0.75rem;background:#666;color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.6rem;border-radius:4px;text-transform:uppercase;">ENDED</span>` : ''}
                ${!isAuction ? `<span style="position:absolute;top:0.75rem;left:0.75rem;background:#101010;color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.6rem;border-radius:4px;text-transform:uppercase;">FIXED</span>` : ''}
                ${isAuction && isLive && item.isVerified ? `<span style="position:absolute;top:0.75rem;right:0.75rem;background:#28a745;color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.6rem;border-radius:4px;">✓ VERIFIED</span>` : ''}
            </div>
            <div style="padding:0.75rem 1rem;background:white;">
                <h3 style="font-size:0.95rem;font-weight:700;margin:0 0 0.2rem 0;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#101010;">${title}${verifiedBadge}</h3>
                ${specLine ? `<p style="font-size:0.8rem;color:#666;margin:0 0 0.3rem 0;">${esc(specLine)}</p>` : `<p style="font-size:0.8rem;color:#666;margin:0 0 0.3rem 0;">${esc(item.category || 'General')}</p>`}
                <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:0.4rem;">
                    <div>
                        <p style="font-size:0.7rem;color:#888;text-transform:uppercase;margin:0;">${isAuction ? 'Current Bid' : 'Price'}</p>
                        <p style="font-size:1.1rem;font-weight:800;color:#101010;margin:0;">${priceDisplay}</p>
                    </div>
                    <p style="font-size:0.75rem;color:${isAuction && isLive ? '#E30613' : '#666'};font-weight:600;margin:0;">${timeDisplay}</p>
                </div>
                ${sellerId ? `<p style="font-size:0.7rem;color:#888;margin-top:0.3rem;">Seller: <span style="color:#101010;cursor:pointer;font-weight:500;" onclick="event.stopPropagation();viewSellerProfile('${sellerId}')">${sellerName}</span></p>` : ''}
            </div>
        </div>
    `;
}

function getTimeRemaining(endTime) {
    const end = new Date(endTime).getTime();
    const now = Date.now();
    const diff = end - now;
    if (diff <= 0) return 'Ended';
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
    const secs = Math.floor((diff % (60 * 1000)) / 1000);
    if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}h`;
    if (hours > 0) return `${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`;
    return `${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
}

// ============================================================
// ========== LISTING DETAIL ==================================
// ============================================================
let currentGalleryIndex = 0;
let galleryImages = [];

async function viewListingDetail(listingId) {
    try {
        const listing = await api(`/api/listings/${listingId}`);
        if (!listing) return showToast('Listing not found', 'error');
        app._currentListing = listing;
        galleryImages = [];
        if (listing.mainImageUrl) galleryImages.push(listing.mainImageUrl);
        if (listing.imageUrls && listing.imageUrls.length) galleryImages.push(...listing.imageUrls);
        if (galleryImages.length === 0 && listing.images && listing.images.length) galleryImages = listing.images;
        if (galleryImages.length === 0) galleryImages = ['/logo.jpeg'];
        currentGalleryIndex = 0;
        renderListingDetail(listing);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function renderListingDetail(listing) {
    const main = document.getElementById('mainContent');
    const isAuction = listing.listingType === 'AUCTION';
    const isOwnListing = app.user && app.user.id === listing.seller?.id;

    const specs = [
        { label: 'Year', value: listing.year || '-' },
        { label: 'Mileage', value: listing.kilometers ? Number(listing.kilometers).toLocaleString() + ' km' : '-' },
        { label: 'Transmission', value: listing.transmission || '-' },
        { label: 'Fuel', value: listing.fuelType || '-' },
        { label: 'Engine', value: listing.engineSize || '-' },
        { label: 'Color', value: listing.color || '-' }
    ];

    const thumbnailHTML = galleryImages.map((img, idx) => `
        <div class="thumbnail-item ${idx === 0 ? 'active' : ''}" onclick="setGalleryImage(${idx})">
            <img src="${img}" onerror="this.src='/logo.jpeg'">
        </div>
    `).join('');

    const detailPrice = isAuction
        ? (listing.currentBid || listing.startingPrice || listing.reservePrice || 0)
        : (listing.price || 0);

    let bidHtml;
    if (isOwnListing) {
        bidHtml = `<div style="background:#FFF3F3;padding:0.75rem;border-radius:8px;text-align:center;color:#E30613;font-weight:700;font-size:0.9rem;">You cannot bid on your own listing</div>`;
    } else if (isAuction) {
        bidHtml = `
            <div class="bid-input-row">
                <input type="number" id="bidAmountInput" value="${(Number(detailPrice) + 1000)}" class="bid-input">
                <button onclick="placeBid('${listing.id}')" class="bid-submit-btn">Place Bid</button>
            </div>
        `;
    } else {
        bidHtml = `<button onclick="buyNow('${listing.id}')" style="width:100%;background:#E30613;color:#fff;padding:0.9rem;border:none;border-radius:8px;font-weight:800;font-size:1rem;cursor:pointer;">Buy Now at R ${Number(listing.price || 0).toLocaleString()}</button>`;
    }

    main.innerHTML = `
        <div class="listing-detail-page">
            <button class="back-btn" onclick="navigate('marketplace')">← Back to Marketplace</button>
            <div class="listing-detail-grid">
                <div class="listing-gallery-block">
                    <div style="background:#000;border-radius:12px;overflow:hidden;position:relative;">
                        <div style="position:relative;width:100%;aspect-ratio:16/10;">
                            <img id="mainGalleryImage" src="${galleryImages[0]}" style="width:100%;height:100%;object-fit:contain;">
                            <button onclick="changeGalleryImage(-1)" class="gallery-nav-btn gallery-nav-left">‹</button>
                            <button onclick="changeGalleryImage(1)" class="gallery-nav-btn gallery-nav-right">›</button>
                            <div class="gallery-badge-type">${isAuction ? '● LIVE AUCTION' : 'FIXED PRICE'}</div>
                            ${listing.isVerified ? `<div class="gallery-badge-verified">✓ CM VERIFIED</div>` : `<div class="gallery-badge-unverified">UNVERIFIED</div>`}
                            <div id="galleryCounter" class="gallery-counter">1 / ${galleryImages.length}</div>
                        </div>
                    </div>
                    <div class="thumbnails-container">${thumbnailHTML}</div>
                </div>

                <div class="listing-specs-block">
                    <h4 class="block-title">Vehicle Specs</h4>
                    <div class="specs-grid">
                        ${specs.map(spec => `<div class="spec-item"><p class="spec-label">${esc(spec.label)}</p><p class="spec-value">${esc(spec.value)}</p></div>`).join('')}
                    </div>
                </div>

                <div class="listing-description-block">
                    <h4 class="block-title">Description</h4>
                    <p class="description-text">${esc(listing.description || 'No description provided.')}</p>
                </div>

                <div class="bid-panel">
                    <div class="bid-panel-header">
                        <p class="bid-panel-label">${isAuction ? 'Auction Ends In' : 'Fixed Price'}</p>
                        <h3 class="bid-timer" id="countdownTimer">${isAuction ? (listing.endTime ? getTimeRemaining(listing.endTime) : 'Ends Soon') : 'Buy Now'}</h3>
                    </div>
                    <p class="bid-panel-label">${isAuction ? 'Current Bid' : 'Price'}</p>
                    <p class="bid-price" id="currentBidDisplay">R ${Number(detailPrice).toLocaleString()}</p>
                    <p class="bid-subtext">${isAuction ? `${listing.bidCount || 0} bids • Reserve not met` : (listing.isNegotiable ? 'Negotiable' : 'Instant purchase')}</p>
                    <div class="bid-actions">
                        ${bidHtml}
                        <a href="https://wa.me/${listing.hqWhatsapp}?text=${encodeURIComponent(listing.waMessage || `Hi CM Agent, I'm interested in ${esc(listing.title)}`)}" target="_blank" class="wa-btn">
                            <img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" width="20" style="filter:invert(1);"> WhatsApp CM Agent
                        </a>
                        <p class="bid-note">All chats go via CM HQ. Seller contact hidden until deposit paid.</p>
                    </div>
                    <div class="bid-seller">
                        <p class="bid-panel-label">Seller</p>
                        <p class="seller-name">${esc(listing.seller?.name || 'CM Agent')}</p>
                        <a href="javascript:void(0)" onclick="viewSellerProfile('${listing.seller?.id}')" class="seller-link">View Profile →</a>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function setGalleryImage(index) {
    const mainImg = document.getElementById('mainGalleryImage');
    const counter = document.getElementById('galleryCounter');
    if (!mainImg) return;
    currentGalleryIndex = index;
    mainImg.src = galleryImages[index] || '/logo.jpeg';
    if (counter) counter.innerText = `${index + 1} / ${galleryImages.length}`;
    document.querySelectorAll('.thumbnail-item').forEach((thumb, i) => {
        thumb.style.borderColor = i === index ? '#E30613' : 'transparent';
        thumb.style.opacity = i === index ? 1 : 0.7;
    });
}
function changeGalleryImage(offset) {
    const newIndex = (currentGalleryIndex + offset + galleryImages.length) % galleryImages.length;
    setGalleryImage(newIndex);
}

async function placeBid(listingId) {
    if (!requireLogin('place a bid')) return;
    const listing = app._currentListing;
    if (listing && listing.seller && app.user.id === listing.seller.id) {
        return showToast('You cannot bid on your own listing', 'error');
    }
    const amount = parseFloat(document.getElementById('bidAmountInput')?.value);
    if (!amount || amount <= 0) return showToast('Enter a valid bid amount', 'error');
    const currentBid = listing?.currentBid || listing?.startingPrice || 0;
    if (amount < currentBid + 1000) {
        return showToast(`Minimum bid is R${(currentBid + 1000).toLocaleString()}`, 'error');
    }
    try {
        const data = await api(`/api/listings/${listingId}/bid`, 'POST', { amount });
        showToast(`Bid placed! Current: R${Number(data.currentBid).toLocaleString()}`, 'info');
        document.getElementById('currentBidDisplay').innerText = `R ${Number(data.currentBid).toLocaleString()}`;
        document.getElementById('bidAmountInput').value = Number(data.currentBid) + 1000;
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function buyNow(listingId) {
    if (!requireLogin('purchase')) return;
    showToast('Direct purchase coming soon', 'info');
}

// ============================================================
// ========== SELLER PROFILE ==================================
// ============================================================
async function viewSellerProfile(sellerId) {
    try {
        const seller = await api(`/api/sellers/${sellerId}`);
        if (!seller) return showToast('Seller not found', 'error');
        renderSellerProfile(seller);
    } catch (err) {
        showToast(err.message, 'error');
    }
}
function renderSellerProfile(seller) {
    const main = document.getElementById('mainContent');
    const avatar = seller.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(seller.displayName || seller.name)}&background=E30613&color=fff&size=128`;
    const name = esc(seller.displayName || seller.name);
    main.innerHTML = `
        <div style="max-width:1200px;margin:0 auto;padding:1rem;">
            <button onclick="navigate('marketplace')" class="back-btn">← Back to Marketplace</button>
            <div class="card" style="display:flex;gap:1.5rem;flex-wrap:wrap;align-items:center;padding:1.5rem;">
                <img src="${avatar}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;">
                <div style="flex:1;">
                    <h1 style="font-size:1.8rem;font-weight:700;margin:0;color:#101010;">${name}</h1>
                    <p style="color:#666;margin:0.2rem 0;">${esc(seller.role)} • Joined ${new Date(seller.joinedDate).toLocaleDateString()}</p>
                </div>
            </div>
            <h2 style="font-weight:700;font-size:1.2rem;margin:1.5rem 0 1rem 0;">Listings from ${name}</h2>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.25rem;">
                ${seller.listings && seller.listings.length > 0 ? seller.listings.map(item => renderAuctionCard(item)).join('') : `<p style="color:#666;grid-column:1/-1;text-align:center;">No active listings</p>`}
            </div>
        </div>
    `;
}

// ============================================================
// ========== DASHBOARD =======================================
// ============================================================
async function renderDashboard() {
    const main = document.getElementById('mainContent');
    if (!app.user) return showLogin();

    const isSeller = (app.user.role === 'INDIVIDUAL_SELLER' || app.user.role === 'AUCTIONEER');
    if (!isSeller && app.user.role !== 'ADMIN') {
        main.innerHTML = `<div style="max-width:800px;margin:0 auto;padding:2rem;text-align:center;">
            <h2>Access Denied</h2>
            <p style="color:#666;">This page is for Individual Sellers and Auctioneers only.</p>
            <button class="btn btn-primary" onclick="navigate('marketplace')">Go to Marketplace</button>
        </div>`;
        return;
    }

    const canSell = app.user.canSell === true;
    const kycOk = app.user.kycStatus === 'VERIFIED';
    if (!canSell || !kycOk) {
        main.innerHTML = `<div style="max-width:700px;margin:0 auto;padding:2rem;">
            <div style="background:#FFF8E1;border:1px solid #FFC107;padding:1.5rem;border-radius:12px;">
                <h3 style="color:#FF9800;">⚠️ You need to verify to sell</h3>
                <p style="color:#666;margin-bottom:1rem;">Upgrade your KYC to start listing items.</p>
                <button class="btn btn-primary" onclick="navigate('kyc')">Upgrade KYC</button>
            </div>
        </div>`;
        return;
    }

    try {
        const allListings = await api('/api/my-listings');
        const myActive = allListings.filter(l => l.sellerId === app.user.id || l.seller?.id === app.user.id);
        main.innerHTML = `
            <div style="max-width:1200px;margin:0 auto;padding:1rem;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem;">
                    <h2 style="margin:0;font-weight:900;">Welcome, ${esc(app.user.displayName || app.user.name)}</h2>
                    <button onclick="navigate('createListing')" style="background:#E30613;color:white;border:none;padding:0.7rem 1.2rem;border-radius:8px;font-weight:800;cursor:pointer;">+ Sell Vehicle</button>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:2rem;">
                    <div class="dash-stat"><p class="label">Active</p><p class="value">${myActive.filter(l => l.status === 'ACTIVE').length}</p></div>
                    <div class="dash-stat"><p class="label">Views</p><p class="value">${myActive.reduce((s, l) => s + (l.views || 0), 0)}</p></div>
                    <div class="dash-stat"><p class="label">Bids</p><p class="value">${myActive.reduce((s, l) => s + (l.bids?.length || 0), 0)}</p></div>
                    <div class="dash-stat"><p class="label">Sold</p><p class="value">${myActive.filter(l => l.status === 'SOLD').length}</p></div>
                </div>
                <h3>My Listings</h3>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.25rem;margin-top:1rem;">
                    ${myActive.length > 0 ? myActive.map(item => renderAuctionCard(item)).join('') : `<p style="color:#666;grid-column:1/-1;text-align:center;padding:2rem;">No listings yet.</p>`}
                </div>
            </div>`;
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================
// ========== KYC =============================================
// ============================================================
function renderKYC() {
    const main = document.getElementById('mainContent');
    if (!app.user) return showLogin();
    main.innerHTML = `
        <div style="max-width:600px;margin:0 auto;padding:2rem;">
            <h2>Upgrade KYC</h2>
            <p style="color:#666;margin-bottom:1.5rem;">Upload documents to become a verified seller.</p>
            <form id="kycForm" style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;">
                <div class="form-group">
                    <label>ID Document</label>
                    <div class="drag-area" id="kycIdDrop"><i class="fas fa-id-card"></i><p>Upload ID photo</p></div>
                    <input type="file" id="kycIdFile" accept="image/*" hidden>
                    <div id="kycIdPreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
                </div>
                <div class="form-group">
                    <label>Proof of Address</label>
                    <div class="drag-area" id="kycAddressDrop"><i class="fas fa-home"></i><p>Utility bill / bank statement</p></div>
                    <input type="file" id="kycAddressFile" accept="image/*,.pdf" hidden>
                    <div id="kycAddressPreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
                </div>
                <div class="form-group">
                    <label>Selfie with ID</label>
                    <div class="drag-area" id="kycSelfieDrop"><i class="fas fa-user"></i><p>Take a selfie holding your ID</p></div>
                    <input type="file" id="kycSelfieFile" accept="image/*" hidden>
                    <div id="kycSelfiePreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%;margin-top:0.5rem;background:#E30613;border:none;">Submit</button>
            </form>
        </div>`;

    setupKycFileDrop('kycIdDrop', 'kycIdFile', 'kycIdPreview');
    setupKycFileDrop('kycAddressDrop', 'kycAddressFile', 'kycAddressPreview');
    setupKycFileDrop('kycSelfieDrop', 'kycSelfieFile', 'kycSelfiePreview');

    document.getElementById('kycForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const idFile = document.getElementById('kycIdFile')?.files?.[0];
        const addressFile = document.getElementById('kycAddressFile')?.files?.[0];
        const selfieFile = document.getElementById('kycSelfieFile')?.files?.[0];
        if (!idFile || !selfieFile) return showToast('Please upload ID photo and selfie', 'error');
        try {
            const fd = new FormData();
            fd.append('idDocument', idFile);
            fd.append('selfie', selfieFile);
            if (addressFile) fd.append('licenseDisk', addressFile);
            const res = await fetch('/api/upload/verification', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${app.token}` },
                body: fd
            });
            if (!res.ok) throw new Error('Upload failed');
            await api('/api/kyc/upgrade', 'POST', { targetLevel: 2 });
            showToast('KYC submitted!', 'info');
            navigate('dashboard');
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

function setupKycFileDrop(dropId, inputId, previewId) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!drop || !input) return;
    drop.onclick = () => input.click();
    drop.ondragover = (e) => { e.preventDefault(); drop.style.borderColor = '#E30613'; };
    drop.ondragleave = () => { drop.style.borderColor = '#EAEAEA'; };
    drop.ondrop = (e) => {
        e.preventDefault();
        drop.style.borderColor = '#EAEAEA';
        if (e.dataTransfer.files.length) {
            input.files = e.dataTransfer.files;
            if (preview) preview.innerHTML = `<span style="color:#E30613;">✅ ${esc(e.dataTransfer.files[0].name)}</span>`;
        }
    };
    input.onchange = () => {
        if (input.files.length && preview) {
            preview.innerHTML = `<span style="color:#E30613;">✅ ${esc(input.files[0].name)}</span>`;
        }
    };
}

// ============================================================
// ========== CREATE LISTING ==================================
// ============================================================
function renderCreateListing() {
    const main = document.getElementById('mainContent');
    if (!app.user) return showLogin();
    if (!app.user.canSell && app.user.role !== 'ADMIN') {
        main.innerHTML = `<div style="max-width:600px;margin:0 auto;padding:2rem;text-align:center;">
            <h2>Access Denied</h2>
            <p style="color:#666;">You need KYC verification to list.</p>
            <button class="btn btn-primary" onclick="navigate('kyc')">Upgrade KYC</button>
        </div>`;
        return;
    }

    main.innerHTML = `
        <div style="max-width:700px;margin:0 auto;padding:1rem;">
            <h2>Sell Something</h2>
            <form id="createListingForm" enctype="multipart/form-data" style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;margin-top:1rem;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;padding:0.25rem;background:#F5F5F7;border-radius:12px;margin-bottom:1rem;">
                    <button type="button" class="listing-type-btn active" data-type="AUCTION" style="padding:0.6rem;border:none;border-radius:8px;font-weight:700;background:white;cursor:pointer;">🔨 Auction</button>
                    <button type="button" class="listing-type-btn" data-type="FIXED_PRICE" style="padding:0.6rem;border:none;border-radius:8px;font-weight:700;background:transparent;cursor:pointer;">🏷️ Fixed Price</button>
                </div>
                <input type="hidden" id="listingType" value="AUCTION">

                <div class="form-group"><label>Title *</label><input id="listingTitle" placeholder="Toyota Hilux 2021"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                    <div class="form-group"><label>Category</label><select id="listingCategory"><option>Vehicles</option><option>Motorcycles</option><option>TLB/Machinery</option><option>Other</option></select></div>
                    <div class="form-group"><label>Condition</label><select id="listingCondition"><option>USED</option><option>NEW</option><option>FOR_PARTS</option></select></div>
                </div>

                <div style="margin:1.5rem 0;padding:1rem;background:#FFF8F8;border-radius:12px;">
                    <h4 style="color:#E30613;margin-bottom:0.8rem;">📸 Upload Photos & Video</h4>
                    <div class="form-group">
                        <label>Main Image *</label>
                        <div class="drag-area" id="mainImageDrop"><i class="fas fa-camera"></i><p>Main product photo</p></div>
                        <input type="file" id="mainImageInput" accept="image/*" hidden>
                        <div id="mainImagePreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
                    </div>
                    <div class="form-group">
                        <label>Additional Photos (up to 5)</label>
                        <div class="drag-area" id="compartmentImageDrop"><i class="fas fa-images"></i><p>Engine, interior, etc.</p></div>
                        <input type="file" id="compartmentImageInput" accept="image/*" multiple hidden>
                        <div id="compartmentImagePreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
                    </div>
                    <div class="form-group">
                        <label>Odometer Video</label>
                        <div class="drag-area" id="videoDrop"><i class="fas fa-video"></i><p>10-second video</p></div>
                        <input type="file" id="videoInput" accept="video/*" hidden>
                        <div id="videoPreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                    <div class="form-group"><label>Year</label><input id="listingYear" type="number" placeholder="2021"></div>
                    <div class="form-group"><label>Kilometers</label><input id="listingKm" type="number" placeholder="85000"></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;">
                    <div class="form-group"><label>Color</label><input id="listingColor" placeholder="White"></div>
                    <div class="form-group"><label>Engine</label><input id="listingEngine" placeholder="2.8L"></div>
                    <div class="form-group"><label>Transmission</label><select id="listingTrans"><option>Manual</option><option>Automatic</option></select></div>
                </div>

                <div id="auctionFields">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                        <div class="form-group"><label>Starting Price (R)</label><input id="listingStartPrice" type="number"></div>
                        <div class="form-group"><label>Reserve Price (R)</label><input id="listingReservePrice" type="number"></div>
                    </div>
                    <div class="form-group"><label>Duration</label><select id="listingDuration"><option value="1">1 Day</option><option value="3">3 Days</option><option value="7" selected>7 Days</option></select></div>
                </div>
                <div id="fixedFields" style="display:none;">
                    <div class="form-group"><label>Price (R)</label><input id="listingPrice" type="number"></div>
                </div>

                <div class="form-group"><label>Description</label><textarea id="listingDescription" rows="4"></textarea></div>

                <div style="background:#FFF3F3;border:1px solid #FFCFCF;padding:1rem;border-radius:12px;margin-bottom:1rem;">
                    <h4 style="color:#E30613;margin-bottom:0.8rem;">CM Verification</h4>
                    <div class="form-group"><label>VIN</label><input id="listingVin" placeholder="17 characters"></div>
                    <div class="form-group"><label>Engine Number</label><input id="listingEngineNo"></div>
                    <label style="font-size:0.8rem;display:flex;gap:8px;margin-top:8px;">
                        <input type="checkbox" id="listingDeclare"> I declare this car is not stolen and km is true.
                    </label>
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%;background:#E30613;border:none;">Publish</button>
            </form>
        </div>`;

    setupFileDrop('mainImageDrop', 'mainImageInput', 'mainImagePreview', 'single');
    setupFileDrop('compartmentImageDrop', 'compartmentImageInput', 'compartmentImagePreview', 'multiple');
    setupFileDrop('videoDrop', 'videoInput', 'videoPreview', 'video');

    document.querySelectorAll('.listing-type-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const type = this.dataset.type;
            document.getElementById('listingType').value = type;
            document.querySelectorAll('.listing-type-btn').forEach(b => { b.style.background = 'transparent'; b.classList.remove('active'); });
            this.style.background = 'white'; this.classList.add('active');
            document.getElementById('auctionFields').style.display = type === 'AUCTION' ? 'block' : 'none';
            document.getElementById('fixedFields').style.display = type === 'FIXED_PRICE' ? 'block' : 'none';
        });
    });

    document.getElementById('createListingForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!document.getElementById('listingDeclare').checked) return showToast('You must declare', 'error');
        const vin = document.getElementById('listingVin').value.trim();
        if (vin && vin.length !== 17) return showToast('VIN must be 17 chars', 'error');
        const mainInput = document.getElementById('mainImageInput');
        if (!mainInput.files || mainInput.files.length === 0) return showToast('Main image required', 'error');

        const fd = new FormData();
        ['title', 'category', 'condition', 'year', 'kilometers', 'color', 'engineSize', 'transmission', 'listingType', 'description', 'vinNumber', 'engineNumber', 'startingPrice', 'reservePrice', 'price', 'duration'].forEach(k => {
            const el = document.getElementById('listing' + k.charAt(0).toUpperCase() + k.slice(1));
            if (el && el.value) fd.append(k, el.value);
        });
        fd.append('mainImage', mainInput.files[0]);
        const compInput = document.getElementById('compartmentImageInput');
        if (compInput.files) for (let i = 0; i < Math.min(compInput.files.length, 5); i++) fd.append('compartmentImages', compInput.files[i]);
        const videoInput = document.getElementById('videoInput');
        if (videoInput.files && videoInput.files.length > 0) fd.append('odometerVideo', videoInput.files[0]);

        try {
            const res = await fetch('/api/listings', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${app.token}` },
                body: fd
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            showToast('Listing published!', 'info');
            navigate('dashboard');
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

function setupFileDrop(dropId, inputId, previewId, mode = 'single') {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!drop || !input) return;
    drop.onclick = () => input.click();
    drop.ondragover = (e) => { e.preventDefault(); drop.style.borderColor = '#E30613'; };
    drop.ondragleave = () => { drop.style.borderColor = '#EAEAEA'; };
    drop.ondrop = (e) => {
        e.preventDefault();
        drop.style.borderColor = '#EAEAEA';
        if (e.dataTransfer.files.length) {
            input.files = e.dataTransfer.files;
            updateFilePreview(input, preview, mode);
        }
    };
    input.onchange = () => updateFilePreview(input, preview, mode);
}

function updateFilePreview(input, preview, mode) {
    if (!preview) return;
    const files = input.files;
    if (!files || files.length === 0) { preview.innerHTML = ''; return; }
    if (mode === 'video') {
        const file = files[0];
        preview.innerHTML = `✅ ${esc(file.name)} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
        return;
    }
    if (mode === 'single') {
        const file = files[0];
        const reader = new FileReader();
        reader.onload = (e) => {
            preview.innerHTML = `<div style="display:flex;gap:8px;align-items:center;">
                <img src="${e.target.result}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;">
                <span style="color:#E30613;">✅ ${esc(file.name)}</span>
            </div>`;
        };
        reader.readAsDataURL(file);
    } else {
        const names = Array.from(files).map(f => esc(f.name));
        preview.innerHTML = names.map(n => `<span style="background:#F5F5F7;padding:0.2rem 0.6rem;border-radius:4px;font-size:0.75rem;">📷 ${n}</span>`).join('');
    }
}

// ============================================================
// ========== PROFILE =========================================
// ============================================================
function renderProfile() {
    const main = document.getElementById('mainContent');
    if (!app.user) return showLogin();
    const user = app.user;
    const avatar = user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.name)}&background=E30613&color=fff&size=128`;
    main.innerHTML = `
        <div style="max-width:800px;margin:0 auto;padding:1rem;">
            <h2>Your Profile</h2>
            <div class="card" style="padding:1.5rem;margin-top:1rem;">
                <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
                    <img src="${avatar}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;">
                    <div style="flex:1;">
                        <p style="font-size:1.2rem;font-weight:700;margin:0;">${esc(user.displayName || user.name)}</p>
                        <p style="color:#666;margin:0;">${esc(user.email)} • ${esc(user.role)}</p>
                        <p style="color:#666;margin:0;font-size:0.9rem;">KYC: ${esc(user.kycStatus || 'NONE')} ${user.canSell ? '✅ Can Sell' : ''}</p>
                    </div>
                </div>
                <div style="display:flex;gap:0.5rem;margin-top:1rem;flex-wrap:wrap;">
                    <button class="btn btn-primary" style="background:#E30613;border:none;" onclick="editProfile()">Edit Profile</button>
                    ${user.role !== 'BUYER' && user.kycStatus !== 'VERIFIED' ? `<button class="btn btn-outline" style="border-color:#E30613;color:#E30613;" onclick="navigate('kyc')">Upgrade KYC</button>` : ''}
                    ${user.role !== 'BUYER' ? `<button class="btn btn-outline" style="border-color:#E30613;color:#E30613;" onclick="navigate('dashboard')">Dashboard</button>` : ''}
                </div>
            </div>
        </div>`;
}

function editProfile() {
    const user = app.user;
    openModal(`
        <span class="close-modal" onclick="closeModal()">&times;</span>
        <h3>Edit Profile</h3>
        <div class="form-group"><label>Display Name</label><input id="editDisplayName" value="${esc(user.displayName || '')}"></div>
        <div class="form-group"><label>Bio</label><textarea id="editBio" rows="3">${esc(user.bio || '')}</textarea></div>
        <div class="form-group"><label>Avatar URL</label><input id="editAvatar" value="${esc(user.avatar || '')}"></div>
        <button class="btn btn-primary" style="width:100%;background:#E30613;border:none;" onclick="saveProfile()">Save</button>
    `);
}

async function saveProfile() {
    const displayName = document.getElementById('editDisplayName').value;
    const bio = document.getElementById('editBio').value;
    const avatar = document.getElementById('editAvatar').value;
    try {
        await api('/api/users/me', 'PUT', { displayName, bio, avatar });
        app.user.displayName = displayName || app.user.name;
        app.user.bio = bio;
        app.user.avatar = avatar;
        localStorage.setItem('user', JSON.stringify(app.user));
        closeModal();
        showToast('Profile updated!', 'info');
        renderProfile();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ============================================================
// ========== ADMIN REDIRECT ==================================
// ============================================================
function renderAdminDashboard() {
    if (!app.user) return showLogin();
    if (app.user.role !== 'ADMIN') return showToast('Admin access required', 'error');
    window.open('/admin.html', '_blank');
}

// ============================================================
// ========== START ===========================================
// ============================================================
if (typeof Fingerprint2 !== 'undefined') {
    Fingerprint2.get(function(components) {
        const values = components.map(c => c.value);
        const deviceId = Fingerprint2.x64hash128(values.join(''), 31);
        localStorage.setItem('deviceId', deviceId);
        app.deviceId = deviceId;
    });
} else {
    app.deviceId = localStorage.getItem('deviceId') || 'unknown';
}

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

console.log('✅ CM app.js loaded (Live Auction Room + Mobile Nav)');