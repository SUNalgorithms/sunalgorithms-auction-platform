// ============================================================
// app.js - CM Central Market (Frontend) - GUEST BROWSING VERSION
// Guests can browse marketplace without login.
// Protected: bid, sell, dashboard, admin → show login/register.
// All previous fixes preserved (XSS, KYC upload, video preview, etc.)
// ============================================================

// ---------- GLOBAL STATE ----------
const app = {
    user: null,
    token: null,
    socket: null,
    deviceId: null,
    currentListingId: null,
    listings: [],
    sellerListings: [],
    marketplace: [],
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

// ---------- HTML ESCAPE (XSS protection) ----------
function esc(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, function(m) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return map[m];
    });
}

// ---------- TOAST (with fallback) ----------
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
    toast._hide = setTimeout(() => {
        toast.style.display = 'none';
    }, 4000);
}

// ---------- API WRAPPER ----------
async function api(endpoint, method = 'GET', body = null) {
    const options = { method, headers: {} };
    if (app.token) {
        options.headers['Authorization'] = `Bearer ${app.token}`;
    }
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

// ---------- MODAL ----------
function openModal(content) {
    const modal = document.getElementById('modal');
    const contentEl = document.getElementById('modalContent');
    contentEl.innerHTML = content;
    modal.style.display = 'flex';
}
function closeModal() {
    document.getElementById('modal').style.display = 'none';
}

// ---------- AUTH GUARD ----------
// Call this before any protected action. If user not logged in, show login.
function requireLogin(actionLabel) {
    if (app.user && app.token) return true;
    showToast(`Please login to ${actionLabel}`, 'error');
    showLogin();
    return false;
}

// ============================================================
// ========== NAVIGATION (with guard) =========================
// ============================================================
function navigate(page) {
    // Protected pages: dashboard, createListing, kyc, profile, adminDashboard
    if (!app.user && ['dashboard', 'createListing', 'kyc', 'profile', 'adminDashboard'].includes(page)) {
        showToast('Please login to access this page', 'error');
        return showLogin();
    }

    app.currentPage = page;
    switch (page) {
        case 'marketplace': renderMarketplace(); break;
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
    console.log('🔐 Login attempt:', email);
    if (!email || !password) return showToast('Email and password required', 'error');

    const loginBtn = document.querySelector('#modalContent .btn-primary');
    if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = 'Logging in...'; }

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

        console.log('📨 Response status:', res.status);
        const data = await res.json();
        console.log('📦 Response data:', data);
        if (!res.ok) throw new Error(data.error);

        app.token = data.token;
        app.user = data.user;
        localStorage.setItem('token', app.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        closeModal();
        await initApp();
        showToast(`Welcome, ${esc(app.user?.displayName || app.user?.name)}!`);
    } catch (err) {
        console.error('❌ Login error:', err);
        if (err.name === 'AbortError') {
            showToast('Request timed out. Please try again.', 'error');
        } else {
            showToast(err.message, 'error');
        }
    } finally {
        if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Login'; }
    }
}

function showRegister() {
    openModal(`
        <span class="close-modal" onclick="closeModal()">&times;</span>
        <h2>Register for CM Central Market</h2>
        <div class="form-group">
            <label for="regName">Full Name</label>
            <input id="regName" placeholder="John Doe">
        </div>
        <div class="form-group">
            <label for="regDisplayName">Display Name</label>
            <input id="regDisplayName" placeholder="JohnDoe (optional)">
        </div>
        <div class="form-group">
            <label for="regIdNumber">ID Number</label>
            <input id="regIdNumber" placeholder="8001011234567">
        </div>
        <div class="form-group">
            <label for="regEmail">Email</label>
            <input id="regEmail" type="email" placeholder="you@example.com">
        </div>
        <div class="form-group">
            <label for="regPhone">Phone (SA)</label>
            <input id="regPhone" placeholder="0821234567">
        </div>
        <div class="form-group">
            <label for="regPassword">Password</label>
            <input id="regPassword" type="password" placeholder="••••••••">
        </div>
        <div class="form-group">
            <label>Role</label>
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.3rem;">
                <button type="button" class="role-btn" data-role="BUYER" style="flex:1;padding:0.6rem;border:2px solid #EAEAEA;border-radius:8px;background:#fff;color:#101010;cursor:pointer;transition:0.2s;">
                    <strong>Buyer</strong><br><small>Bid & buy everything</small>
                </button>
                <button type="button" class="role-btn" data-role="INDIVIDUAL_SELLER" style="flex:1;padding:0.6rem;border:2px solid #EAEAEA;border-radius:8px;background:#fff;color:#101010;cursor:pointer;transition:0.2s;">
                    <strong>Individual Seller</strong><br><small>Sell your own items</small>
                </button>
                <button type="button" class="role-btn" data-role="AUCTIONEER" style="flex:1;padding:0.6rem;border:2px solid #EAEAEA;border-radius:8px;background:#fff;color:#101010;cursor:pointer;transition:0.2s;">
                    <strong>Auctioneer</strong><br><small>Pro auctions (Invite only)</small>
                </button>
            </div>
            <input type="hidden" id="regRole" value="BUYER">
        </div>
        <div class="form-group">
            <label for="regIdPhoto">ID Photo</label>
            <div class="drag-area" id="registerIdDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;background:#fff;">
                <i class="fas fa-id-card" style="font-size:2rem;color:#E30613;"></i>
                <p style="margin:0.3rem 0;color:#666;font-size:0.85rem;">Click to upload ID photo</p>
                <input type="file" id="regIdPhoto" accept="image/*" hidden>
            </div>
            <div id="regIdPreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
        </div>
        <div class="form-group">
            <label for="regSelfie">Selfie</label>
            <div class="drag-area" id="registerSelfieDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;background:#fff;">
                <i class="fas fa-user" style="font-size:2rem;color:#E30613;"></i>
                <p style="margin:0.3rem 0;color:#666;font-size:0.85rem;">Take a selfie with your ID</p>
                <input type="file" id="regSelfie" accept="image/*" hidden>
            </div>
            <div id="regSelfiePreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
        </div>
        <button class="btn btn-primary" style="width:100%;margin-top:1rem;background:#E30613;border:none;" onclick="handleRegister()">Register</button>
        <p style="margin-top:1rem;text-align:center;color:#888;">
            Already have an account? <span style="color:#E30613;cursor:pointer;" onclick="closeModal();showLogin();">Login</span>
        </p>
    `);

    // Role selection
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

    const newDrop = drop.cloneNode(true);
    drop.parentNode.replaceChild(newDrop, drop);
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    const newPreview = document.getElementById(previewId);

    newDrop.addEventListener('click', () => newInput.click());
    newDrop.addEventListener('dragover', (e) => { e.preventDefault(); newDrop.style.borderColor = '#E30613'; });
    newDrop.addEventListener('dragleave', () => { newDrop.style.borderColor = '#EAEAEA'; });
    newDrop.addEventListener('drop', (e) => {
        e.preventDefault();
        newDrop.style.borderColor = '#EAEAEA';
        if (e.dataTransfer.files.length) {
            newInput.files = e.dataTransfer.files;
            if (newPreview) newPreview.innerHTML = `<span style="color:#E30613;">✅ ${esc(e.dataTransfer.files[0].name)}</span>`;
        }
    });
    newInput.addEventListener('change', () => {
        if (newInput.files.length && newPreview) {
            newPreview.innerHTML = `<span style="color:#E30613;">✅ ${esc(newInput.files[0].name)}</span>`;
        }
    });
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

    if (!name || !idNumber || !email || !password) {
        return showToast('All fields required', 'error');
    }
    if (!idPhotoFile || !selfieFile) {
        return showToast('Please upload your ID photo and a selfie', 'error');
    }

    const regBtn = document.querySelector('#modalContent .btn-primary');
    if (regBtn) { regBtn.disabled = true; regBtn.textContent = 'Registering...'; }

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
        if (regBtn) { regBtn.disabled = false; regBtn.textContent = 'Register'; }
    }
}

function logout() {
    if (app.socket) {
        app.socket.disconnect();
        app.socket = null;
    }
    app.user = null;
    app.token = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    showToast('Logged out');
    initApp(); // refresh UI as guest
}

// ============================================================
// ========== INIT APP (GUEST-FRIENDLY) =======================
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
            console.warn('Session invalid, continuing as guest:', err.message);
            app.user = null;
            app.token = null;
            localStorage.removeItem('token');
            localStorage.removeItem('user');
        }
    } else {
        app.user = null;
        app.token = null;
    }

    // ALWAYS show navbar (guest or user)
    navbar.style.display = 'flex';

    if (app.user) {
        const isSeller = app.user.role === 'INDIVIDUAL_SELLER' || app.user.role === 'AUCTIONEER' || app.user.role === 'ADMIN';
        document.getElementById('dashboardBtn').style.display = isSeller ? 'inline' : 'none';
        document.getElementById('createListingBtn').style.display = isSeller ? 'inline' : 'none';
        document.getElementById('adminDashBtn').style.display = (app.user.role === 'ADMIN') ? 'inline' : 'none';
        document.getElementById('userDisplay').textContent = `👤 ${esc(app.user.displayName || app.user.name)}`;

        // Show login/register buttons as hidden
        const loginBtn = document.getElementById('loginNavBtn');
        const registerBtn = document.getElementById('registerNavBtn');
        const logoutBtn = document.getElementById('logoutNavBtn');
        if (loginBtn) loginBtn.style.display = 'none';
        if (registerBtn) registerBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'inline-block';

        connectSocket();
    } else {
        // GUEST MODE
        document.getElementById('dashboardBtn').style.display = 'none';
        document.getElementById('createListingBtn').style.display = 'none';
        document.getElementById('adminDashBtn').style.display = 'none';
        document.getElementById('userDisplay').textContent = 'Guest';

        const loginBtn = document.getElementById('loginNavBtn');
        const registerBtn = document.getElementById('registerNavBtn');
        const logoutBtn = document.getElementById('logoutNavBtn');
        if (loginBtn) loginBtn.style.display = 'inline-block';
        if (registerBtn) registerBtn.style.display = 'inline-block';
        if (logoutBtn) logoutBtn.style.display = 'none';
    }

    // Always load marketplace
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
    if (app.socket || !app.token) return;
    try {
        app.socket = io({ auth: { token: app.token } });
        app.socket.on('connect', () => console.log('Socket connected'));
        app.socket.on('connect_error', (err) => console.error('Socket error:', err.message));
        app.socket.on('marketplaceUpdated', () => fetchMarketplace());
        app.socket.on('bidUpdate', (data) => {
            showToast(`New bid on ${esc(data.listingId)}: R${Number(data.currentBid).toLocaleString()}`, 'info');
            fetchMarketplace();
        });
        app.socket.on('error', (data) => showToast(data.message, 'error'));
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
                <button onclick="setMarketplaceFilter('filter','${c.id}')" style="white-space:nowrap;padding:0.5rem 1.2rem;border-radius:9999px;font-size:0.9rem;font-weight:700;border:1px solid ${filters.filter === c.id ? '#101010' : '#EAEAEA'};background:${filters.filter === c.id ? '#101010' : 'white'};color:${filters.filter === c.id ? 'white' : '#666'};cursor:pointer;transition:0.2s;">
                    ${c.label}
                </button>
            `).join('')}
            <button onclick="setMarketplaceFilter('verifiedOnly', !${filters.verifiedOnly})" style="white-space:nowrap;padding:0.5rem 1.2rem;border-radius:9999px;font-size:0.9rem;font-weight:700;border:1px solid ${filters.verifiedOnly ? '#28a745' : '#EAEAEA'};background:${filters.verifiedOnly ? '#28a745' : 'white'};color:${filters.verifiedOnly ? 'white' : '#666'};cursor:pointer;transition:0.2s;">
                ✓ CM Verified only
            </button>
        </div>
        <div id="categoryChips" style="display:${app.filterPanelVisible ? 'flex' : 'none'}; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem; overflow-x:auto; padding-bottom:0.25rem; width:100%;">
            ${categories.map(c => `
                <button onclick="setMarketplaceFilter('category','${c}')" style="white-space:nowrap;padding:0.3rem 1rem;border-radius:9999px;font-size:0.85rem;font-weight:600;border:1px solid ${filters.category === c ? '#101010' : '#EAEAEA'};background:${filters.category === c ? '#F5F5F7' : 'white'};color:${filters.category === c ? '#101010' : '#666'};cursor:pointer;transition:0.2s;">
                    ${c}
                </button>
            `).join('')}
        </div>
    `;

    let html = `
        <div style="max-width:1400px;margin:0 auto;padding:0 1rem;background:#F5F5F7;min-height:100vh;">
            <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:0.75rem 1rem;display:flex;gap:0.5rem;margin-bottom:0.75rem;box-shadow:0 2px 8px rgba(0,0,0,0.05);flex-wrap:wrap;align-items:center;">
                <input id="marketplaceSearch" value="${esc(filters.search)}" placeholder="Search bike, car, TLB..." style="flex:1;min-width:160px;padding:0.6rem 1rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;font-size:0.95rem;outline:none;">
                <button onclick="applyMarketplaceFilters()" style="background:#E30613;color:#fff;padding:0.6rem 1.2rem;border:none;border-radius:8px;font-weight:700;cursor:pointer;transition:0.2s;">Search</button>
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
                        <p style="font-size:0.9rem;color:#888;">Try adjusting your filters</p>
                    </div>
                `}
            </div>
        </div>
    `;
    main.innerHTML = html;
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
    const search = document.getElementById('marketplaceSearch')?.value || '';
    app._marketplaceFilters.search = search;
    renderMarketplace();
}

// ---------- RENDER AUCTION CARD ----------
function renderAuctionCard(item) {
    const isAuction = item.listingType === 'AUCTION';
    const isLive = isAuction && (!item.endTime || new Date(item.endTime) > new Date());
    const isEnded = isAuction && item.endTime && new Date(item.endTime) <= new Date();
    const priceDisplay = isAuction
        ? (item.currentBid ? `R ${Number(item.currentBid).toLocaleString()}` : `R ${(item.startingPrice || 0).toLocaleString()}`)
        : `R ${(item.price || 0).toLocaleString()}`;
    const timeDisplay = isAuction
        ? (item.endTime ? getTimeRemaining(item.endTime) : 'No end time')
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
        <div class="auction-card-item" data-listing-id="${item.id}" onclick="viewListingDetail('${item.id}')" style="background:white;border:1px solid #EAEAEA;border-radius:12px;overflow:hidden;transition:var(--transition);cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
            <div style="position:relative;aspect-ratio:4/3;background:#F5F5F7;overflow:hidden;">
                <img src="${imageUrl}" alt="${title}" style="width:100%;height:100%;object-fit:cover;transition:transform 0.5s;" onerror="this.src='/logo.jpeg'">
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
        <div class="thumbnail-item ${idx === 0 ? 'active' : ''}" 
             id="thumb_${idx}" 
             onclick="setGalleryImage(${idx})" 
             style="flex-shrink:0;width:80px;height:80px;border-radius:8px;overflow:hidden;border:2px solid ${idx === 0 ? '#E30613' : 'transparent'};opacity:${idx === 0 ? 1 : 0.7};cursor:pointer;">
            <img src="${img}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='/logo.jpeg'">
        </div>
    `).join('');

    // Bid section: depends on login state
    let bidHtml;
    if (isOwnListing) {
        bidHtml = `<div style="background:#FFF3F3;padding:0.5rem;border-radius:8px;text-align:center;color:#E30613;font-weight:700;">You cannot bid on your own listing</div>`;
    } else if (isAuction) {
        bidHtml = `
            <input type="number" id="bidAmountInput" value="${(Number(listing.currentBid || listing.startingPrice || 0) + 1000)}" style="width:100%;padding:0.75rem;border:1px solid #EAEAEA;border-radius:8px;font-size:1.1rem;font-weight:bold;color:#101010;margin-bottom:0.75rem;outline:none;">
            <button onclick="placeBid('${listing.id}')" style="width:100%;background:#E30613;color:#fff;padding:0.9rem;border:none;border-radius:8px;font-weight:800;font-size:1rem;cursor:pointer;transition:0.2s;">
                Place Bid
            </button>
        `;
    } else {
        bidHtml = `
            <button onclick="buyNow('${listing.id}')" style="width:100%;background:#E30613;color:#fff;padding:0.9rem;border:none;border-radius:8px;font-weight:800;font-size:1rem;cursor:pointer;transition:0.2s;">
                Buy Now at R ${Number(listing.price || 0).toLocaleString()}
            </button>
        `;
    }

    main.innerHTML = `
        <div style="max-width:1400px;margin:0 auto;padding:1rem;background:#F5F5F7;min-height:100vh;">
            <button class="back-btn" onclick="navigate('marketplace')" style="background:white;border:1px solid #EAEAEA;padding:0.5rem 1rem;border-radius:8px;color:#666;cursor:pointer;margin-bottom:1rem;">
                ← Back to Marketplace
            </button>
            <div style="display:grid;grid-template-columns:1fr 380px;gap:1.5rem;">
                <div>
                    <div style="background:#000;border-radius:12px;overflow:hidden;position:relative;">
                        <div style="position:relative;width:100%;aspect-ratio:16/10;">
                            <img id="mainGalleryImage" src="${galleryImages[0]}" style="width:100%;height:100%;object-fit:contain;">
                            <button onclick="changeGalleryImage(-1)" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.9);border:none;width:40px;height:40px;border-radius:50%;font-size:1.5rem;cursor:pointer;">‹</button>
                            <button onclick="changeGalleryImage(1)" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.9);border:none;width:40px;height:40px;border-radius:50%;font-size:1.5rem;cursor:pointer;">›</button>
                            <div style="position:absolute;top:12px;left:12px;background:#E30613;color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.6rem;border-radius:4px;text-transform:uppercase;">
                                ${isAuction ? '● LIVE AUCTION' : 'FIXED PRICE'}
                            </div>
                            ${listing.isVerified ? `<div style="position:absolute;top:12px;right:12px;background:#28a745;color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.6rem;border-radius:4px;">✓ CM VERIFIED</div>` : `<div style="position:absolute;top:12px;right:12px;background:#666;color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.6rem;border-radius:4px;">UNVERIFIED</div>`}
                            <div id="galleryCounter" style="position:absolute;bottom:12px;right:12px;background:rgba(0,0,0,0.7);color:#fff;padding:0.15rem 0.6rem;border-radius:20px;font-size:0.8rem;">
                                1 / ${galleryImages.length}
                            </div>
                        </div>
                    </div>
                    <div class="thumbnails-container" style="display:flex;gap:0.5rem;overflow-x:auto;padding:0.5rem 0;margin-top:0.5rem;">
                        ${thumbnailHTML}
                    </div>
                    <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1rem;margin-top:1rem;">
                        <h4 style="margin:0 0 1rem 0;color:#101010;">Vehicle Specs</h4>
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.5rem;">
                            ${specs.map(spec => `
                                <div style="background:#F5F5F7;padding:0.5rem;border-radius:8px;text-align:center;">
                                    <p style="font-size:0.7rem;color:#888;text-transform:uppercase;margin:0;">${esc(spec.label)}</p>
                                    <p style="font-weight:800;color:#101010;margin:0;">${esc(spec.value)}</p>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1rem;margin-top:1rem;">
                        <h4 style="margin:0 0 0.5rem 0;color:#101010;">Description</h4>
                        <p style="color:#444;margin:0;">${esc(listing.description || 'No description provided.')}</p>
                    </div>
                </div>
                <div>
                    <div class="bid-panel" style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;position:sticky;top:80px;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
                        <div style="text-align:center;margin-bottom:1rem;border-bottom:1px solid #EAEAEA;padding-bottom:1rem;">
                            <p style="font-size:0.8rem;color:#888;text-transform:uppercase;margin:0;">${isAuction ? 'Auction Ends In' : 'Fixed Price'}</p>
                            <h3 style="font-size:2.2rem;font-weight:900;margin:0;color:#101010;" id="countdownTimer">
                                ${isAuction ? (listing.endTime ? getTimeRemaining(listing.endTime) : 'Ends Soon') : 'Buy Now'}
                            </h3>
                        </div>
                        <p style="font-size:0.8rem;color:#888;text-transform:uppercase;margin:0;">${isAuction ? 'Current Bid' : 'Price'}</p>
                        <p style="font-size:2.5rem;font-weight:900;margin:0;color:#101010;" id="currentBidDisplay">
                            R ${Number(listing.price || listing.currentBid || listing.startingPrice || 0).toLocaleString()}
                        </p>
                        <p style="font-size:0.9rem;color:#666;margin-top:0.25rem;">
                            ${isAuction ? `${listing.bidCount || 0} bids • Reserve not met` : (listing.isNegotiable ? 'Negotiable' : 'Instant purchase')}
                        </p>
                        <div style="margin-top:1.5rem;">
                            ${bidHtml}
                            <a href="https://wa.me/${listing.hqWhatsapp}?text=${encodeURIComponent(listing.waMessage || `Hi CM Agent, I'm interested in ${esc(listing.title)} (ID: ${listing.id}). Is viewing available?`)}" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:10px;background:#25D366;color:#fff;padding:0.9rem;border-radius:8px;font-weight:800;font-size:1rem;text-decoration:none;margin-top:0.5rem;">
                                <img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" width="20" style="filter:invert(1);"> WhatsApp CM Agent
                            </a>
                            <p style="font-size:0.7rem;color:#666;text-align:center;margin-top:8px;">All chats go via CM HQ. Seller contact hidden until deposit paid.</p>
                        </div>
                        <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid #EAEAEA;">
                            <p style="font-size:0.9rem;color:#888;margin:0;">Seller</p>
                            <p style="font-weight:bold;color:#101010;margin:0;">${esc(listing.seller?.name || 'CM Agent')}</p>
                            <a href="javascript:void(0)" onclick="viewSellerProfile('${listing.seller?.id}')" style="color:#E30613;font-size:0.9rem;font-weight:700;">View Profile →</a>
                        </div>
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

// ---------- BID & BUY (with login guard) ----------
async function placeBid(listingId) {
    if (!requireLogin('place a bid')) return;

    const listing = app._currentListing;
    if (listing && listing.seller && app.user.id === listing.seller.id) {
        return showToast('You cannot bid on your own listing', 'error');
    }
    const amountInput = document.getElementById('bidAmountInput');
    const amount = parseFloat(amountInput?.value);
    if (!amount || amount <= 0) return showToast('Enter a valid bid amount', 'error');

    const currentBid = listing?.currentBid || listing?.startingPrice || 0;
    if (amount < currentBid + 1000) {
        return showToast(`Minimum bid is R${(currentBid + 1000).toLocaleString()}`, 'error');
    }
    try {
        const data = await api(`/api/listings/${listingId}/bid`, 'POST', { amount });
        showToast(`Bid placed! Current bid: R${Number(data.currentBid).toLocaleString()}`, 'info');
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
        <div style="max-width:1200px;margin:0 auto;padding:1rem;background:#F5F5F7;min-height:100vh;">
            <button onclick="navigate('marketplace')" style="background:white;border:1px solid #EAEAEA;padding:0.5rem 1rem;border-radius:8px;color:#666;cursor:pointer;margin-bottom:1rem;">← Back to Marketplace</button>
            <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;display:flex;gap:1.5rem;flex-wrap:wrap;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <img src="${avatar}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;">
                <div style="flex:1;">
                    <h1 style="font-size:1.8rem;font-weight:700;margin:0;color:#101010;">${name}</h1>
                    <p style="color:#666;margin:0.2rem 0;">${esc(seller.role)} • Joined ${new Date(seller.joinedDate).toLocaleDateString()} • ${seller.listings?.length || 0} listings</p>
                    <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
                        <button style="border:1px solid #EAEAEA;padding:0.3rem 1rem;border-radius:8px;background:white;color:#101010;cursor:pointer;">Chat</button>
                        <button style="border:1px solid #EAEAEA;padding:0.3rem 1rem;border-radius:8px;background:white;color:#666;cursor:pointer;">Report</button>
                    </div>
                </div>
            </div>
            <h2 style="font-weight:700;font-size:1.2rem;margin:1.5rem 0 1rem 0;color:#101010;">Listings from ${name}</h2>
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
        main.innerHTML = `
            <div style="max-width:800px;margin:0 auto;padding:2rem;text-align:center;background:#F5F5F7;min-height:100vh;">
                <h2 style="color:#101010;">Access Denied</h2>
                <p style="color:#666;">This page is for Individual Sellers and Auctioneers only.</p>
                <button class="btn btn-primary" style="background:#E30613;border:none;" onclick="navigate('marketplace')">Go to Marketplace</button>
            </div>`;
        return;
    }

    const canSell = app.user.canSell === true;
    const kycOk = app.user.kycStatus === 'VERIFIED';
    if (!canSell || !kycOk) {
        main.innerHTML = `
            <div style="max-width:700px;margin:0 auto;padding:2rem;background:#F5F5F7;min-height:100vh;">
                <div style="background:#FFF8E1;border:1px solid #FFC107;padding:1.5rem;border-radius:12px;">
                    <h3 style="color:#FF9800;">⚠️ You need to verify to sell</h3>
                    <p style="color:#666;margin-bottom:1rem;">Upgrade your KYC to start listing items. This builds trust with buyers.</p>
                    <button class="btn btn-primary" style="background:#E30613;border:none;" onclick="navigate('kyc')">Upgrade KYC</button>
                </div>
            </div>`;
        return;
    }

    try {
        const stats = await api('/api/seller/dashboard');
        const allListings = await api('/api/my-listings');
        const myActive = allListings.filter(l => l.sellerId === app.user.id || l.seller?.id === app.user.id);

        main.innerHTML = `
            <div style="max-width:1200px;margin:0 auto;padding:1rem;background:#F5F5F7;min-height:100vh;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <img src="/logo.jpeg" style="width:40px;height:40px;border-radius:8px;object-fit:contain;">
                        <div>
                            <h2 style="margin:0;font-weight:900;color:#101010;">Welcome, ${esc(app.user.displayName || app.user.name)}</h2>
                            <p style="margin:0;color:#666;font-size:0.9rem;">CM Central Market Dashboard</p>
                        </div>
                    </div>
                    <button onclick="navigate('createListing')" style="background:#E30613;color:white;border:none;padding:0.7rem 1.2rem;border-radius:8px;font-weight:800;cursor:pointer;">+ Sell Vehicle</button>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:2rem;">
                    <div class="dash-stat"><p class="label">Active Listings</p><p class="value">${myActive.filter(l => l.status === 'ACTIVE').length}</p></div>
                    <div class="dash-stat"><p class="label">Total Views</p><p class="value">${myActive.reduce((s, l) => s + (l.views || 0), 0)}</p></div>
                    <div class="dash-stat"><p class="label">Bids Received</p><p class="value">${myActive.reduce((s, l) => s + (l.bids?.length || 0), 0)}</p></div>
                    <div class="dash-stat"><p class="label">Sold</p><p class="value">${myActive.filter(l => l.status === 'SOLD').length}</p></div>
                </div>
                <h3 style="margin-bottom:1rem;color:#101010;">My Listings</h3>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.25rem;">
                    ${myActive.length > 0 ? myActive.map(item => renderAuctionCard(item)).join('') : `<p style="color:#666;grid-column:1/-1;background:white;padding:2rem;border-radius:12px;text-align:center;border:1px dashed #EAEAEA;">No active listings. Start selling!</p>`}
                </div>
            </div>`;
    } catch (err) {
        showToast(err.message, 'error');
        main.innerHTML = `<p style="color:#666;text-align:center;padding:2rem;">Error loading dashboard.</p>`;
    }
}

// ============================================================
// ========== KYC =============================================
// ============================================================
function renderKYC() {
    const main = document.getElementById('mainContent');
    if (!app.user) return showLogin();

    main.innerHTML = `
        <div style="max-width:600px;margin:0 auto;padding:2rem;background:#F5F5F7;min-height:100vh;">
            <h2 style="color:#101010;">Upgrade KYC</h2>
            <p style="color:#666;margin-bottom:1.5rem;">Upload your documents to become a verified seller.</p>
            <form id="kycForm" style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div class="form-group">
                    <label for="kycIdFile">ID Document (Front)</label>
                    <div class="drag-area" id="kycIdDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;background:#F5F5F7;">
                        <i class="fas fa-id-card" style="font-size:2rem;color:#E30613;"></i>
                        <p style="margin:0.3rem 0;color:#666;font-size:0.85rem;">Upload ID photo</p>
                        <input type="file" id="kycIdFile" accept="image/*" hidden>
                    </div>
                    <div id="kycIdPreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
                </div>
                <div class="form-group">
                    <label for="kycAddressFile">Proof of Address</label>
                    <div class="drag-area" id="kycAddressDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;background:#F5F5F7;">
                        <i class="fas fa-home" style="font-size:2rem;color:#E30613;"></i>
                        <p style="margin:0.3rem 0;color:#666;font-size:0.85rem;">Upload utility bill or bank statement</p>
                        <input type="file" id="kycAddressFile" accept="image/*,.pdf" hidden>
                    </div>
                    <div id="kycAddressPreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
                </div>
                <div class="form-group">
                    <label for="kycSelfieFile">Selfie with ID</label>
                    <div class="drag-area" id="kycSelfieDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;background:#F5F5F7;">
                        <i class="fas fa-user" style="font-size:2rem;color:#E30613;"></i>
                        <p style="margin:0.3rem 0;color:#666;font-size:0.85rem;">Take a selfie holding your ID</p>
                        <input type="file" id="kycSelfieFile" accept="image/*" hidden>
                    </div>
                    <div id="kycSelfiePreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%;margin-top:0.5rem;background:#E30613;border:none;">Submit for Verification</button>
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
        if (!idFile || !selfieFile) {
            return showToast('Please upload ID photo and selfie', 'error');
        }
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
            showToast('KYC submitted! Our team will review.', 'info');
            navigate('dashboard');
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

function setupKycFileDrop(dropId, inputId, previewId) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    if (!drop || !input) return;
    const newDrop = drop.cloneNode(true);
    drop.parentNode.replaceChild(newDrop, drop);
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    const newPreview = document.getElementById(previewId);
    newDrop.addEventListener('click', () => newInput.click());
    newDrop.addEventListener('dragover', (e) => { e.preventDefault(); newDrop.style.borderColor = '#E30613'; });
    newDrop.addEventListener('dragleave', () => { newDrop.style.borderColor = '#EAEAEA'; });
    newDrop.addEventListener('drop', (e) => {
        e.preventDefault();
        newDrop.style.borderColor = '#EAEAEA';
        if (e.dataTransfer.files.length) {
            newInput.files = e.dataTransfer.files;
            if (newPreview) newPreview.innerHTML = `<span style="color:#E30613;">✅ ${esc(e.dataTransfer.files[0].name)}</span>`;
        }
    });
    newInput.addEventListener('change', () => {
        if (newInput.files.length && newPreview) {
            newPreview.innerHTML = `<span style="color:#E30613;">✅ ${esc(newInput.files[0].name)}</span>`;
        }
    });
}

// ============================================================
// ========== CREATE LISTING ==================================
// ============================================================
function renderCreateListing() {
    const main = document.getElementById('mainContent');
    if (!app.user) return showLogin();
    if (!app.user.canSell && app.user.role !== 'ADMIN') {
        main.innerHTML = `
            <div style="max-width:600px;margin:0 auto;padding:2rem;text-align:center;background:#F5F5F7;min-height:100vh;">
                <h2 style="color:#101010;">Access Denied</h2>
                <p style="color:#666;">You need to be KYC verified to list items.</p>
                <button class="btn btn-primary" style="background:#E30613;border:none;" onclick="navigate('kyc')">Upgrade KYC</button>
            </div>`;
        return;
    }

    main.innerHTML = `
        <div style="max-width:700px;margin:0 auto;padding:1rem;background:#F5F5F7;min-height:100vh;">
            <h2 style="color:#101010;">Sell Something</h2>
            <p style="color:#666;margin-bottom:1rem;">Upload photos and video of your vehicle</p>
            <form id="createListingForm" enctype="multipart/form-data" style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;padding:0.25rem;background:#F5F5F7;border-radius:12px;margin-bottom:1rem;">
                    <button type="button" class="listing-type-btn active" data-type="AUCTION" style="padding:0.6rem;border:none;border-radius:8px;font-weight:700;background:white;color:#101010;cursor:pointer;">🔨 Auction</button>
                    <button type="button" class="listing-type-btn" data-type="FIXED_PRICE" style="padding:0.6rem;border:none;border-radius:8px;font-weight:700;background:transparent;color:#666;cursor:pointer;">🏷️ Fixed Price</button>
                </div>
                <input type="hidden" id="listingType" value="AUCTION">
                <div class="form-group">
                    <label for="listingTitle">Title *</label>
                    <input id="listingTitle" placeholder="e.g. Toyota Hilux 2.8 GD-6 2021" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                    <div class="form-group">
                        <label for="listingCategory">Category *</label>
                        <select id="listingCategory" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;">
                            <option>Vehicles</option><option>Motorcycles</option><option>TLB/Machinery</option><option>Other</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="listingCondition">Condition *</label>
                        <select id="listingCondition" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;">
                            <option>USED</option><option>NEW</option><option>FOR_PARTS</option>
                        </select>
                    </div>
                </div>
                <div style="margin:1.5rem 0;padding:1rem;background:#FFF8F8;border-radius:12px;border:1px solid #FFE0E0;">
                    <h4 style="margin:0 0 0.8rem 0;color:#E30613;">📸 Upload Photos & Video</h4>
                    <div class="form-group">
                        <label for="mainImageInput" style="font-weight:600;">Main Product Image <span style="color:#E30613;">*</span></label>
                        <div class="drag-area" id="mainImageDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;background:#F5F5F7;">
                            <i class="fas fa-camera" style="font-size:2rem;color:#E30613;"></i>
                            <p style="margin:0.3rem 0;color:#666;font-size:0.85rem;">Click to upload main product photo</p>
                            <input type="file" id="mainImageInput" accept="image/*" hidden>
                        </div>
                        <div id="mainImagePreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
                    </div>
                    <div class="form-group">
                        <label for="compartmentImageInput" style="font-weight:600;">Additional Photos <span style="color:#888;font-weight:400;">(up to 5)</span></label>
                        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:0.5rem;" id="compartmentDropContainer">
                            <div class="drag-area" id="compartmentImageDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1rem;text-align:center;cursor:pointer;background:#F5F5F7;min-height:80px;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                                <i class="fas fa-images" style="font-size:1.5rem;color:#E30613;"></i>
                                <p style="margin:0;color:#666;font-size:0.7rem;">Engine, interior, damage, etc.</p>
                                <input type="file" id="compartmentImageInput" accept="image/*" multiple hidden>
                            </div>
                        </div>
                        <div id="compartmentImagePreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;display:flex;flex-wrap:wrap;gap:0.3rem;"></div>
                    </div>
                    <div class="form-group">
                        <label for="videoInput" style="font-weight:600;">Odometer Video (10 seconds)</label>
                        <div class="drag-area" id="videoDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;background:#F5F5F7;">
                            <i class="fas fa-video" style="font-size:2rem;color:#E30613;"></i>
                            <p style="margin:0.3rem 0;color:#666;font-size:0.85rem;">Upload 10-second odometer video proof</p>
                            <input type="file" id="videoInput" accept="video/*" hidden>
                        </div>
                        <div id="videoPreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                    <div class="form-group"><label for="listingYear">Year</label><input id="listingYear" type="number" placeholder="2021" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                    <div class="form-group"><label for="listingKm">Kilometers</label><input id="listingKm" type="number" placeholder="85000" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;">
                    <div class="form-group"><label for="listingColor">Color</label><input id="listingColor" placeholder="White" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                    <div class="form-group"><label for="listingEngine">Engine</label><input id="listingEngine" placeholder="2.8L" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                    <div class="form-group"><label for="listingTrans">Transmission</label><select id="listingTrans" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"><option>Manual</option><option>Automatic</option></select></div>
                </div>
                <div id="auctionFields">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                        <div class="form-group"><label for="listingStartPrice">Starting Price (R)</label><input id="listingStartPrice" type="number" placeholder="50000" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                        <div class="form-group"><label for="listingReservePrice">Reserve Price (R)</label><input id="listingReservePrice" type="number" placeholder="60000" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                    </div>
                    <div class="form-group"><label for="listingDuration">Duration</label><select id="listingDuration" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"><option value="1d">1 Day</option><option value="3d">3 Days</option><option value="7d" selected>7 Days</option></select></div>
                </div>
                <div id="fixedFields" style="display:none;">
                    <div class="form-group"><label for="listingPrice">Price (R)</label><input id="listingPrice" type="number" placeholder="120000" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                </div>
                <div class="form-group"><label for="listingDescription">Description</label><textarea id="listingDescription" rows="4" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;resize:vertical;"></textarea></div>
                <div style="background:#FFF3F3;border:1px solid #FFCFCF;padding:1rem;border-radius:12px;margin-bottom:1rem;">
                    <h4 style="margin:0 0 0.8rem 0;color:#E30613;">CM Verification</h4>
                    <div class="form-group"><label for="listingVin">VIN Number</label><input id="listingVin" placeholder="17 characters" style="width:100%;padding:0.6rem;border-radius:8px;background:#fff;border:1px solid #EAEAEA;color:#101010;"></div>
                    <div class="form-group"><label for="listingEngineNo">Engine Number</label><input id="listingEngineNo" placeholder="e.g. 2GD-123456" style="width:100%;padding:0.6rem;border-radius:8px;background:#fff;border:1px solid #EAEAEA;color:#101010;"></div>
                    <label style="font-size:0.8rem;display:flex;gap:8px;margin-top:8px;color:#101010;">
                        <input type="checkbox" id="listingDeclare"> I declare this car is not stolen and km is true.
                    </label>
                </div>
                <button type="submit" class="btn btn-primary" style="width:100%;margin-top:0.5rem;background:#E30613;border:none;color:#fff;">Publish</button>
            </form>
        </div>`;

    setupFileDrop('mainImageDrop', 'mainImageInput', 'mainImagePreview', 'single');
    setupFileDrop('compartmentImageDrop', 'compartmentImageInput', 'compartmentImagePreview', 'multiple');
    setupFileDrop('videoDrop', 'videoInput', 'videoPreview', 'video');

    document.querySelectorAll('.listing-type-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const type = this.dataset.type;
            document.getElementById('listingType').value = type;
            document.querySelectorAll('.listing-type-btn').forEach(b => { b.style.background = 'transparent'; b.style.color = '#666'; b.classList.remove('active'); });
            this.style.background = 'white'; this.style.color = '#101010'; this.classList.add('active');
            document.getElementById('auctionFields').style.display = type === 'AUCTION' ? 'block' : 'none';
            document.getElementById('fixedFields').style.display = type === 'FIXED_PRICE' ? 'block' : 'none';
        });
    });

    document.getElementById('createListingForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!document.getElementById('listingDeclare').checked) {
            return showToast('You must declare the vehicle is not stolen.', 'error');
        }
        const vin = document.getElementById('listingVin').value.trim();
        if (vin && vin.length !== 17) return showToast('VIN must be exactly 17 characters', 'error');

        const mainInput = document.getElementById('mainImageInput');
        if (!mainInput.files || mainInput.files.length === 0) {
            return showToast('Please upload a main product image', 'error');
        }

        const fd = new FormData();
        fd.append('title', document.getElementById('listingTitle').value);
        fd.append('category', document.getElementById('listingCategory').value);
        fd.append('condition', document.getElementById('listingCondition').value);
        fd.append('year', document.getElementById('listingYear').value);
        fd.append('kilometers', document.getElementById('listingKm').value);
        fd.append('color', document.getElementById('listingColor').value);
        fd.append('engineSize', document.getElementById('listingEngine').value);
        fd.append('transmission', document.getElementById('listingTrans').value);
        fd.append('listingType', document.getElementById('listingType').value);
        fd.append('description', document.getElementById('listingDescription').value);
        fd.append('vinNumber', vin);
        fd.append('engineNumber', document.getElementById('listingEngineNo').value.trim());

        const sp = document.getElementById('listingStartPrice');
        if (sp) fd.append('startingPrice', sp.value);
        const rp = document.getElementById('listingReservePrice');
        if (rp) fd.append('reservePrice', rp.value);
        const pr = document.getElementById('listingPrice');
        if (pr) fd.append('price', pr.value);
        const du = document.getElementById('listingDuration');
        if (du) fd.append('duration', du.value);

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
            if (!res.ok) throw new Error(data.error || 'Failed');
            showToast('Listing published!', 'info');
            navigate('dashboard');
            fetchMarketplace();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

function setupFileDrop(dropId, inputId, previewId, mode = 'single') {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    if (!drop || !input) return;
    const newDrop = drop.cloneNode(true);
    drop.parentNode.replaceChild(newDrop, drop);
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    const newPreview = document.getElementById(previewId);

    newDrop.addEventListener('click', () => newInput.click());
    newDrop.addEventListener('dragover', (e) => { e.preventDefault(); newDrop.style.borderColor = '#E30613'; });
    newDrop.addEventListener('dragleave', () => { newDrop.style.borderColor = '#EAEAEA'; });
    newDrop.addEventListener('drop', (e) => {
        e.preventDefault();
        newDrop.style.borderColor = '#EAEAEA';
        if (e.dataTransfer.files.length) {
            newInput.files = e.dataTransfer.files;
            updateFilePreview(newInput, newPreview, mode);
        }
    });
    newInput.addEventListener('change', () => updateFilePreview(newInput, newPreview, mode));
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
            preview.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;">
                    <img src="${e.target.result}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;border:1px solid #EAEAEA;">
                    <span style="color:#E30613;">✅ ${esc(file.name)}</span>
                </div>
            `;
        };
        reader.readAsDataURL(file);
    } else {
        const names = Array.from(files).map(f => esc(f.name));
        preview.innerHTML = names.map(n => `<span style="background:#F5F5F7;padding:0.2rem 0.6rem;border-radius:4px;font-size:0.75rem;color:#101010;">📷 ${n}</span>`).join('');
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
        <div style="max-width:800px;margin:0 auto;padding:1rem;background:#F5F5F7;min-height:100vh;">
            <h2 style="color:#101010;">Your Profile</h2>
            <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
                    <img src="${avatar}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;">
                    <div style="flex:1;">
                        <p style="font-size:1.2rem;font-weight:700;margin:0;color:#101010;">${esc(user.displayName || user.name)}</p>
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
        <div class="form-group"><label for="editDisplayName">Display Name</label><input id="editDisplayName" value="${esc(user.displayName || '')}" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
        <div class="form-group"><label for="editBio">Bio</label><textarea id="editBio" rows="3" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;resize:vertical;">${esc(user.bio || '')}</textarea></div>
        <div class="form-group"><label for="editAvatar">Avatar URL</label><input id="editAvatar" value="${esc(user.avatar || '')}" placeholder="https://example.com/avatar.jpg" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
        <button class="btn btn-primary" style="width:100%;background:#E30613;border:none;" onclick="saveProfile()">Save Changes</button>
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
// ========== DEVICE FINGERPRINT ==============================
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

// ============================================================
// ========== START APP =======================================
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

console.log('✅ CM Central Market app.js loaded (GUEST BROWSING VERSION)');