// ============================================================
// app.js - CM Central Market (Frontend)
// Features: 3 Roles (BUYER, INDIVIDUAL_SELLER, AUCTIONEER),
// Hybrid Marketplace (Listing), KYC, Seller Profiles, Admin
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
        filter: 'ALL', // 'ALL' | 'AUCTION' | 'FIXED_PRICE'
        category: 'ALL',
        search: '',
        verifiedOnly: false,
        sort: 'recent'
    },
    currentPage: 'marketplace'
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

// ============================================================
// ========== NAVIGATION ======================================
// ============================================================

function navigate(page) {
    const main = document.getElementById('mainContent');
    app.currentPage = page;
    switch (page) {
        case 'marketplace':
            renderMarketplace();
            break;
        case 'sellerProfile':
            // handled by viewSellerProfile
            break;
        case 'dashboard':
            renderDashboard();
            break;
        case 'createListing':
            renderCreateListing();
            break;
        case 'kyc':
            renderKYC();
            break;
        case 'profile':
            renderProfile();
            break;
        case 'listingDetail':
            // handled by viewListingDetail
            break;
        default:
            renderMarketplace();
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
            <label>Email</label>
            <input id="loginEmail" type="email" placeholder="you@example.com">
        </div>
        <div class="form-group">
            <label>Password</label>
            <input id="loginPassword" type="password" placeholder="••••••••">
        </div>
        <button class="btn btn-primary" style="width:100%;background:#E30613;border:none;" onclick="handleLogin()">Login</button>
        <p style="margin-top:1rem;text-align:center;color:var(--muted);">
            Don't have an account? <span style="color:#E30613;cursor:pointer;" onclick="closeModal();showRegister();">Register</span>
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
        showToast(`Welcome, ${app.user.displayName || app.user.name}!`);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function showRegister() {
    openModal(`
        <span class="close-modal" onclick="closeModal()">&times;</span>
        <h2>Register for CM Central Market</h2>
        <div class="form-group">
            <label>Full Name</label>
            <input id="regName" placeholder="John Doe">
        </div>
        <div class="form-group">
            <label>Display Name</label>
            <input id="regDisplayName" placeholder="JohnDoe (optional)">
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
            <label>Password</label>
            <input id="regPassword" type="password" placeholder="••••••••">
        </div>
        <div class="form-group">
            <label>Role</label>
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.3rem;">
                <button type="button" class="role-btn" onclick="selectRole('BUYER')" style="flex:1;padding:0.6rem;border:2px solid #EAEAEA;border-radius:8px;background:#fff;color:#101010;cursor:pointer;transition:0.2s;">
                    <strong>Buyer</strong><br><small>Bid & buy everything</small>
                </button>
                <button type="button" class="role-btn" onclick="selectRole('INDIVIDUAL_SELLER')" style="flex:1;padding:0.6rem;border:2px solid #EAEAEA;border-radius:8px;background:#fff;color:#101010;cursor:pointer;transition:0.2s;">
                    <strong>Individual Seller</strong><br><small>Sell your own items</small>
                </button>
                <button type="button" class="role-btn" onclick="selectRole('AUCTIONEER')" style="flex:1;padding:0.6rem;border:2px solid #EAEAEA;border-radius:8px;background:#fff;color:#101010;cursor:pointer;transition:0.2s;">
                    <strong>Auctioneer</strong><br><small>Pro auctions (Invite only)</small>
                </button>
            </div>
            <input type="hidden" id="regRole" value="BUYER">
        </div>
        <div class="form-group">
            <label>ID Photo</label>
            <div class="drag-area" id="registerIdDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;background:#fff;">
                <i class="fas fa-id-card" style="font-size:2rem;color:#E30613;"></i>
                <p style="margin:0.3rem 0;color:#666;font-size:0.85rem;">Click to upload ID photo</p>
                <input type="file" id="regIdPhoto" accept="image/*" hidden>
            </div>
            <div id="regIdPreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
        </div>
        <div class="form-group">
            <label>Selfie</label>
            <div class="drag-area" id="registerSelfieDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;background:#fff;">
                <i class="fas fa-user" style="font-size:2rem;color:#E30613;"></i>
                <p style="margin:0.3rem 0;color:#666;font-size:0.85rem;">Take a selfie with your ID</p>
                <input type="file" id="regSelfie" accept="image/*" hidden>
            </div>
            <div id="regSelfiePreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
        </div>
        <button class="btn btn-primary" style="width:100%;margin-top:1rem;background:#E30613;border:none;" onclick="handleRegister()">Register</button>
        <p style="margin-top:1rem;text-align:center;color:#666;">
            Already have an account? <span style="color:#E30613;cursor:pointer;" onclick="closeModal();showLogin();">Login</span>
        </p>
    `);

    // Setup role selection
    window.selectRole = (role) => {
        document.getElementById('regRole').value = role;
        document.querySelectorAll('.role-btn').forEach(btn => {
            btn.style.borderColor = btn.textContent.includes(role) ? '#E30613' : '#EAEAEA';
            btn.style.background = btn.textContent.includes(role) ? 'rgba(227,6,19,0.05)' : '#fff';
        });
    };

    setupRegisterFileDrop('registerIdDrop', 'regIdPhoto', 'regIdPreview');
    setupRegisterFileDrop('registerSelfieDrop', 'regSelfie', 'regSelfiePreview');
}

function setupRegisterFileDrop(dropId, inputId, previewId) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = '#E30613'; });
    drop.addEventListener('dragleave', () => { drop.style.borderColor = '#EAEAEA'; });
    drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.style.borderColor = '#EAEAEA';
        const files = e.dataTransfer.files;
        if (files.length) {
            input.files = files;
            preview.innerHTML = `<span style="color:#E30613;">✅ ${files[0].name}</span>`;
        }
    });
    input.addEventListener('change', () => {
        if (input.files.length) {
            preview.innerHTML = `<span style="color:#E30613;">✅ ${input.files[0].name}</span>`;
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
        localStorage.setItem('user', JSON.stringify(app.user));
        closeModal();
        initApp();
        showToast(`Registered successfully! Welcome to CM Central Market, ${app.user.displayName || app.user.name}`);
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
            <img src="/logo.jpeg" alt="CM" style="width:80px;height:80px;object-fit:contain;border-radius:16px;margin-bottom:1rem;">
            <h1 style="font-weight:900;color:#101010;">CM CENTRAL MARKET</h1>
            <p style="color:#666;font-weight:600;letter-spacing:2px;">AUTOMOTIVE AUCTIONS</p>
            <div style="display:flex;gap:1rem;justify-content:center;margin-top:2rem;">
                <button class="btn btn-primary" style="background:#E30613;border:none;" onclick="showLogin()">Login</button>
                <button class="btn btn-outline" style="border-color:#E30613;color:#E30613;" onclick="showRegister()">Register</button>
            </div>
        </div>
    `;
    showToast('Logged out');
}

// ---------- INIT APP ----------
async function initApp() {
    // 🟢 FIX: Set deviceId if not set
    app.deviceId = localStorage.getItem('deviceId') || Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('deviceId', app.deviceId);

    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');

    if (token && userData) {
        app.token = token;
        app.user = JSON.parse(userData);
        document.getElementById('navbar').style.display = 'flex';

        // Show/hide buttons based on role
        const isSeller = app.user.role === 'INDIVIDUAL_SELLER' || app.user.role === 'AUCTIONEER';
        document.getElementById('dashboardBtn').style.display = isSeller ? 'inline' : 'none';
        document.getElementById('createListingBtn').style.display = isSeller ? 'inline' : 'none';
        document.getElementById('adminDashBtn').style.display = (app.user.role === 'ADMIN') ? 'inline' : 'none';
        document.getElementById('userDisplay').textContent = `👤 ${app.user.displayName || app.user.name}`;

        connectSocket();
        await fetchMarketplace();
        navigate('marketplace');
    } else {
        document.getElementById('navbar').style.display = 'none';
        document.getElementById('mainContent').innerHTML = `
            <div class="landing-hero">
                <img src="/logo.jpeg" alt="CM" style="width:80px;height:80px;object-fit:contain;border-radius:16px;margin-bottom:1rem;">
                <h1 style="font-weight:900;color:#101010;">CM CENTRAL MARKET</h1>
                <p style="color:#666;font-weight:600;letter-spacing:2px;">AUTOMOTIVE AUCTIONS</p>
                <div style="display:flex;gap:1rem;justify-content:center;margin-top:2rem;">
                    <button class="btn btn-primary" style="background:#E30613;border:none;" onclick="showLogin()">Login</button>
                    <button class="btn btn-outline" style="border-color:#E30613;color:#E30613;" onclick="showRegister()">Register</button>
                </div>
            </div>
        `;
    }
}

// ============================================================
// ========== SOCKET.IO CONNECTION ============================
// ============================================================

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

    app.socket.on('marketplaceUpdated', () => {
        fetchMarketplace();
    });

    app.socket.on('bidUpdate', (data) => {
        showToast(`New bid on ${data.listingId}: R${data.currentBid.toLocaleString()}`, 'info');
        fetchMarketplace();
    });

    app.socket.on('error', (data) => {
        showToast(data.message, 'error');
    });
}

// ============================================================
// ========== FETCH MARKETPLACE ===============================
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
// ============================================================
// ========== PART 2: MARKETPLACE, CARDS, LISTING DETAIL =====
// ============================================================
// ============================================================
// ========== PART 2: MARKETPLACE, CARDS, LISTING DETAIL =====
// ============================================================

// ---------- RENDER MARKETPLACE (WeBuyCars Light Mode) ----------
async function renderMarketplace() {
    const main = document.getElementById('mainContent');

    // Build filter state if not exists
    if (!app._marketplaceFilters) {
        app._marketplaceFilters = {
            filter: 'ALL', // 'ALL' | 'AUCTION' | 'FIXED_PRICE'
            category: 'ALL',
            search: '',
            verifiedOnly: false,
            sort: 'recent'
        };
    }

    const filters = app._marketplaceFilters;
    const listings = app.listings || [];

    // Re-fetch with filters
    await fetchMarketplace({
        filter: filters.filter,
        category: filters.category === 'ALL' ? '' : filters.category,
        search: filters.search || '',
        verifiedOnly: filters.verifiedOnly ? 'true' : ''
    });

    const filtered = app.listings || [];

    const categories = ['ALL', 'Vehicles', 'Motorcycles', 'TLB/Machinery', 'Electronics', 'Other'];

    let html = `
        <div style="max-width:1400px;margin:0 auto;padding:0 1rem;background:#F5F5F7;min-height:100vh;">
            <!-- Search Bar -->
            <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1rem;display:flex;gap:0.75rem;margin-bottom:1rem;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <input id="marketplaceSearch" value="${filters.search || ''}" placeholder="Search bike, car, TLB..." style="flex:1;min-width:0;padding:0.75rem 1rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;font-size:1rem;outline:none;">
                <button onclick="applyMarketplaceFilters()" style="background:#E30613;color:#fff;padding:0.75rem 1.5rem;border:none;border-radius:8px;font-weight:700;cursor:pointer;transition:0.2s;">
                    Search
                </button>
            </div>

            <!-- Type Chips (White pills) -->
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem;overflow-x:auto;padding-bottom:0.25rem;">
                ${[
                    {id:'ALL', label:'All'},
                    {id:'AUCTION', label:'🔨 Live Auctions'},
                    {id:'FIXED_PRICE', label:'🏷️ Fixed Price'}
                ].map(c => `
                    <button onclick="setMarketplaceFilter('filter','${c.id}')" style="white-space:nowrap;padding:0.5rem 1.2rem;border-radius:9999px;font-size:0.9rem;font-weight:700;border:1px solid ${filters.filter===c.id ? '#101010' : '#EAEAEA'};background:${filters.filter===c.id ? '#101010' : 'white'};color:${filters.filter===c.id ? 'white' : '#666'};cursor:pointer;transition:0.2s;">
                        ${c.label}
                    </button>
                `).join('')}
                <button onclick="setMarketplaceFilter('verifiedOnly', !${filters.verifiedOnly})" style="white-space:nowrap;padding:0.5rem 1.2rem;border-radius:9999px;font-size:0.9rem;font-weight:700;border:1px solid ${filters.verifiedOnly ? '#28a745' : '#EAEAEA'};background:${filters.verifiedOnly ? '#28a745' : 'white'};color:${filters.verifiedOnly ? 'white' : '#666'};cursor:pointer;transition:0.2s;margin-left:0.25rem;">
                    ✓ CM Verified only
                </button>
            </div>

            <!-- Category Chips (Grey pills) -->
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;overflow-x:auto;padding-bottom:0.25rem;">
                ${categories.map(c => `
                    <button onclick="setMarketplaceFilter('category','${c}')" style="white-space:nowrap;padding:0.3rem 1rem;border-radius:9999px;font-size:0.85rem;font-weight:600;border:1px solid ${filters.category===c ? '#101010' : '#EAEAEA'};background:${filters.category===c ? '#F5F5F7' : 'white'};color:${filters.category===c ? '#101010' : '#666'};cursor:pointer;transition:0.2s;">
                        ${c}
                    </button>
                `).join('')}
            </div>

            <!-- Results Info -->
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:1rem;">
                <p style="font-size:0.9rem;color:#666;">${filtered.length} listings • From CM agents + private sellers</p>
                <select onchange="setMarketplaceFilter('sort', this.value)" style="font-size:0.9rem;padding:0.3rem 0.8rem;border-radius:8px;background:white;border:1px solid #EAEAEA;color:#101010;">
                    <option value="recent" ${filters.sort==='recent'?'selected':''}>Most Recent</option>
                    <option value="price_low" ${filters.sort==='price_low'?'selected':''}>Price: Low to High</option>
                    <option value="price_high" ${filters.sort==='price_high'?'selected':''}>Price: High to Low</option>
                    <option value="ending" ${filters.sort==='ending'?'selected':''}>Ending Soon</option>
                </select>
            </div>

            <!-- Grid (White Cards) -->
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

// ---------- MARKETPLACE FILTER HELPERS ----------
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

// ---------- RENDER AUCTION CARD (WeBuyCars Light Style) ----------
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

    const imageUrl = (item.images && item.images.length > 0) ? item.images[0] : '/logo.jpeg';
    const sellerName = item.seller?.displayName || item.seller?.name || 'CM Agent';
    const sellerId = item.seller?.id || '';

    // Extract specs for card
    const specLine = item.year || item.kilometers
        ? `${item.year || ''} • ${item.kilometers ? Number(item.kilometers).toLocaleString() + ' km' : ''}`
        : item.category || '';

    const verifiedBadge = item.isVerified ? `<span style="background:#28a745;color:white;font-size:0.65rem;padding:2px 6px;border-radius:4px;margin-left:6px;">✓ VERIFIED</span>` : '';

    return `
        <div class="auction-card-item" data-listing-id="${item.id}" onclick="viewListingDetail('${item.id}')" style="background:white;border:1px solid #EAEAEA;border-radius:12px;overflow:hidden;transition:var(--transition);cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
            <div style="position:relative;aspect-ratio:4/3;background:#F5F5F7;overflow:hidden;">
                <img src="${imageUrl}" alt="${item.title}" style="width:100%;height:100%;object-fit:cover;transition:transform 0.5s;" onerror="this.src='/logo.jpeg'">
                ${isAuction && isLive ? `<span style="position:absolute;top:0.75rem;left:0.75rem;background:#E30613;color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.6rem;border-radius:4px;text-transform:uppercase;">LIVE</span>` : ''}
                ${isAuction && isEnded ? `<span style="position:absolute;top:0.75rem;left:0.75rem;background:#666;color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.6rem;border-radius:4px;text-transform:uppercase;">ENDED</span>` : ''}
                ${!isAuction ? `<span style="position:absolute;top:0.75rem;left:0.75rem;background:#101010;color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.6rem;border-radius:4px;text-transform:uppercase;">FIXED</span>` : ''}
                ${isAuction && isLive && item.isVerified ? `<span style="position:absolute;top:0.75rem;right:0.75rem;background:#28a745;color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.6rem;border-radius:4px;">✓ VERIFIED</span>` : ''}
            </div>
            <div style="padding:0.75rem 1rem;background:white;">
                <h3 style="font-size:0.95rem;font-weight:700;margin:0 0 0.2rem 0;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#101010;">${item.title}${verifiedBadge}</h3>
                ${specLine ? `<p style="font-size:0.8rem;color:#666;margin:0 0 0.3rem 0;">${specLine}</p>` : `<p style="font-size:0.8rem;color:#666;margin:0 0 0.3rem 0;">${item.category || 'General'}</p>`}
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

// ---------- HELPER: GET TIME REMAINING ----------
function getTimeRemaining(endTime) {
    const end = new Date(endTime).getTime();
    const now = Date.now();
    const diff = end - now;
    if (diff <= 0) return 'Ended';
    const days = Math.floor(diff / (24*60*60*1000));
    const hours = Math.floor((diff % (24*60*60*1000)) / (60*60*1000));
    const mins = Math.floor((diff % (60*60*1000)) / (60*1000));
    const secs = Math.floor((diff % (60*1000)) / 1000);
    if (days > 0) return `${days}d ${String(hours).padStart(2,'0')}h`;
    if (hours > 0) return `${String(hours).padStart(2,'0')}h ${String(mins).padStart(2,'0')}m`;
    return `${String(mins).padStart(2,'0')}m ${String(secs).padStart(2,'0')}s`;
}

// ============================================================
// ========== VIEW LISTING DETAIL (Pro Gallery & Bid Panel) ===
// ============================================================

// ---------- GALLERY STATE ----------
let currentGalleryIndex = 0;
let galleryImages = [];

async function viewListingDetail(listingId) {
    try {
        const listing = await api(`/api/listings/${listingId}`);
        if (!listing) return showToast('Listing not found', 'error');

        // Store for later use
        app._currentListing = listing;
        galleryImages = listing.images && listing.images.length > 0 ? listing.images : ['/logo.jpeg'];
        currentGalleryIndex = 0;

        renderListingDetail(listing);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function renderListingDetail(listing) {
    const main = document.getElementById('mainContent');
    const isAuction = listing.listingType === 'AUCTION';
    const isSeller = app.user && (app.user.role === 'INDIVIDUAL_SELLER' || app.user.role === 'AUCTIONEER');
    const isOwnListing = isSeller && app.user.id === listing.seller?.id;

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

    main.innerHTML = `
        <div style="max-width:1400px;margin:0 auto;padding:1rem;background:#F5F5F7;min-height:100vh;">
            <button class="back-btn" onclick="navigate('marketplace')" style="background:white;border:1px solid #EAEAEA;padding:0.5rem 1rem;border-radius:8px;color:#666;cursor:pointer;margin-bottom:1rem;">
                ← Back to Marketplace
            </button>

            <div style="display:grid;grid-template-columns:1fr 380px;gap:1.5rem;">
                
                <!-- ===== LEFT COLUMN: GALLERY & SPECS ===== -->
                <div>
                    <!-- Main Gallery (Black Background, object-contain) -->
                    <div style="background:#000;border-radius:12px;overflow:hidden;position:relative;">
                        <div style="position:relative;width:100%;aspect-ratio:16/10;">
                            <img id="mainGalleryImage" src="${galleryImages[0]}" style="width:100%;height:100%;object-fit:contain;">
                            
                            <!-- Left/Right Arrows -->
                            <button onclick="changeGalleryImage(-1)" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.9);border:none;width:40px;height:40px;border-radius:50%;font-size:1.5rem;cursor:pointer;">‹</button>
                            <button onclick="changeGalleryImage(1)" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.9);border:none;width:40px;height:40px;border-radius:50%;font-size:1.5rem;cursor:pointer;">›</button>
                            
                            <!-- Badges -->
                            <div style="position:absolute;top:12px;left:12px;background:#E30613;color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.6rem;border-radius:4px;text-transform:uppercase;">
                                ${isAuction ? '● LIVE AUCTION' : 'FIXED PRICE'}
                            </div>
                            ${listing.isVerified ? `<div style="position:absolute;top:12px;right:12px;background:#28a745;color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.6rem;border-radius:4px;">✓ CM VERIFIED</div>` : `<div style="position:absolute;top:12px;right:12px;background:#666;color:#fff;font-size:0.7rem;font-weight:700;padding:0.15rem 0.6rem;border-radius:4px;">UNVERIFIED</div>`}
                            
                            <!-- Counter -->
                            <div id="galleryCounter" style="position:absolute;bottom:12px;right:12px;background:rgba(0,0,0,0.7);color:#fff;padding:0.15rem 0.6rem;border-radius:20px;font-size:0.8rem;">
                                1 / ${galleryImages.length}
                            </div>
                        </div>
                    </div>

                    <!-- Thumbnails Under Gallery -->
                    <div class="thumbnails-container" style="display:flex;gap:0.5rem;overflow-x:auto;padding:0.5rem 0;margin-top:0.5rem;">
                        ${thumbnailHTML}
                    </div>

                    <!-- Specs Boxes -->
                    <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1rem;margin-top:1rem;">
                        <h4 style="margin:0 0 1rem 0;color:#101010;">Vehicle Specs</h4>
                        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.5rem;">
                            ${specs.map(spec => `
                                <div style="background:#F5F5F7;padding:0.5rem;border-radius:8px;text-align:center;">
                                    <p style="font-size:0.7rem;color:#888;text-transform:uppercase;margin:0;">${spec.label}</p>
                                    <p style="font-weight:800;color:#101010;margin:0;">${spec.value}</p>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Description -->
                    <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1rem;margin-top:1rem;">
                        <h4 style="margin:0 0 0.5rem 0;color:#101010;">Description</h4>
                        <p style="color:#444;margin:0;">${listing.description || 'No description provided.'}</p>
                    </div>
                </div>

                <!-- ===== RIGHT COLUMN: STICKY BID PANEL ===== -->
                <div>
                    <div class="bid-panel" style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;position:sticky;top:80px;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
                        
                        <!-- Timer / Price Header -->
                        <div style="text-align:center;margin-bottom:1rem;border-bottom:1px solid #EAEAEA;padding-bottom:1rem;">
                            <p style="font-size:0.8rem;color:#888;text-transform:uppercase;margin:0;">${isAuction ? 'Auction Ends In' : 'Fixed Price'}</p>
                            <h3 style="font-size:2.2rem;font-weight:900;margin:0;color:#101010;" id="countdownTimer">
                                ${isAuction ? (listing.endTime ? getTimeRemaining(listing.endTime) : 'Ends Soon') : 'Buy Now'}
                            </h3>
                        </div>

                        <!-- Current Bid / Price -->
                        <p style="font-size:0.8rem;color:#888;text-transform:uppercase;margin:0;">${isAuction ? 'Current Bid' : 'Price'}</p>
                        <p style="font-size:2.5rem;font-weight:900;margin:0;color:#101010;" id="currentBidDisplay">
                            R ${Number(listing.price || listing.currentBid || listing.startingPrice || 0).toLocaleString()}
                        </p>
                        <p style="font-size:0.9rem;color:#666;margin-top:0.25rem;">
                            ${isAuction ? `${listing.bidCount || 0} bids • Reserve not met` : (listing.isNegotiable ? 'Negotiable' : 'Instant purchase')}
                        </p>

                        <!-- Actions -->
                        <div style="margin-top:1.5rem;">
                            ${isAuction ? `
                                <input type="number" id="bidAmountInput" value="${(Number(listing.currentBid || listing.startingPrice || 0) + 1000)}" style="width:100%;padding:0.75rem;border:1px solid #EAEAEA;border-radius:8px;font-size:1.1rem;font-weight:bold;color:#101010;margin-bottom:0.75rem;outline:none;">
                                <button onclick="placeBid('${listing.id}')" style="width:100%;background:#E30613;color:#fff;padding:0.9rem;border:none;border-radius:8px;font-weight:800;font-size:1rem;cursor:pointer;transition:0.2s;">
                                    Place Bid
                                </button>
                            ` : `
                                <button onclick="buyNow('${listing.id}')" style="width:100%;background:#E30613;color:#fff;padding:0.9rem;border:none;border-radius:8px;font-weight:800;font-size:1rem;cursor:pointer;transition:0.2s;">
                                    Buy Now at R ${Number(listing.price || 0).toLocaleString()}
                                </button>
                            `}

                            <!-- WhatsApp CM Agent Button -->
                            <a href="https://wa.me/${listing.hqWhatsapp}?text=${encodeURIComponent(listing.waMessage || `Hi CM Agent, I'm interested in ${listing.title} (ID: ${listing.id}). Is viewing available?`)}" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:10px;background:#25D366;color:#fff;padding:0.9rem;border-radius:8px;font-weight:800;font-size:1rem;text-decoration:none;margin-top:0.5rem;">
                                <img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" width="20" style="filter:invert(1);"> WhatsApp CM Agent
                            </a>

                            <p style="font-size:0.7rem;color:#666;text-align:center;margin-top:8px;">All chats go via CM HQ. Seller contact hidden until deposit paid.</p>
                        </div>
                        
                        <!-- Seller Info -->
                        <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid #EAEAEA;">
                            <p style="font-size:0.9rem;color:#888;margin:0;">Seller</p>
                            <p style="font-weight:bold;color:#101010;margin:0;">${listing.seller?.name || 'CM Agent'}</p>
                            <a href="javascript:void(0)" onclick="viewSellerProfile('${listing.seller?.id}')" style="color:#E30613;font-size:0.9rem;font-weight:700;">View Profile →</a>
                        </div>

                        <!-- Live Video Container (Placeholder until WebRTC connects) -->
                        <div id="liveVideoContainer" style="display:none;margin-top:1rem;background:#000;border-radius:8px;padding:1rem;text-align:center;color:#fff;">
                            <p>🔴 LIVE STREAM IS ACTIVE</p>
                            <video id="liveVideoPlayer" autoplay playsinline style="width:100%;max-height:300px;background:#000;border-radius:8px;"></video>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ---------- GALLERY FUNCTIONS ----------
function setGalleryImage(index) {
    currentGalleryIndex = index;
    const mainImg = document.getElementById('mainGalleryImage');
    const counter = document.getElementById('galleryCounter');
    if (mainImg) mainImg.src = galleryImages[index];
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

// ---------- BID & BUY FUNCTIONS ----------
async function placeBid(listingId) {
    const amountInput = document.getElementById('bidAmountInput');
    const amount = parseFloat(amountInput?.value);
    if (!amount || amount <= 0) return showToast('Enter a valid bid amount', 'error');

    // Check for R1000 deposit (simulated here)
    if (!app.user || !app.user.kycStatus) {
        return showToast('You must be logged in to bid. R1000 refundable deposit applies.', 'error');
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
    showToast('Direct purchase coming soon', 'info');
    // Implement buy now logic if needed
}

// ---------- LIVE AUCTION FUNCTIONS (Start/Join) ----------
function startLiveAuction(listingId) {
    if (!app.socket) return showToast('Not connected', 'error');
    
    app.socket.emit('streamStarted', { listingId: listingId });
    
    document.getElementById('liveVideoContainer').style.display = 'block';
    document.getElementById('liveVideoContainer').innerHTML = `
        <p style="color:#E30613;font-weight:bold;">🔴 YOUR LIVE STREAM IS NOW ACTIVE</p>
        <p style="font-size:0.8rem;color:#888;">WebRTC camera initialization would happen here.</p>
    `;
    showToast('Live stream started!', 'info');
}

function joinLiveAuction(listingId) {
    if (!app.socket) return showToast('Not connected', 'error');
    
    app.socket.emit('joinListing', listingId);
    
    document.getElementById('liveVideoContainer').style.display = 'block';
    document.getElementById('liveVideoContainer').innerHTML = `
        <p style="color:#E30613;font-weight:bold;">🔴 JOINING LIVE AUCTION...</p>
        <p style="font-size:0.8rem;color:#888;">WebRTC video would initialize here.</p>
    `;
    showToast('Joined live auction!', 'info');
}

// ============================================================
// ========== END OF PART 2 ====================================
// ============================================================
// ============================================================
// ========== PART 3: SELLER PROFILE, DASHBOARD, KYC, CREATE, ADMIN, INIT
// ============================================================

// ---------- VIEW SELLER PROFILE (Public) ----------
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

    main.innerHTML = `
        <div style="max-width:1200px;margin:0 auto;padding:1rem;background:#F5F5F7;min-height:100vh;">
            <button onclick="navigate('marketplace')" style="background:white;border:1px solid #EAEAEA;padding:0.5rem 1rem;border-radius:8px;color:#666;cursor:pointer;margin-bottom:1rem;">← Back to Marketplace</button>
            <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;display:flex;gap:1.5rem;flex-wrap:wrap;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <img src="${avatar}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;">
                <div style="flex:1;">
                    <h1 style="font-size:1.8rem;font-weight:700;margin:0;color:#101010;">${seller.displayName || seller.name}</h1>
                    <p style="color:#666;margin:0.2rem 0;">${seller.role} • Joined ${new Date(seller.joinedDate).toLocaleDateString()} • ${seller.listings?.length || 0} listings</p>
                    <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
                        <button style="border:1px solid #EAEAEA;padding:0.3rem 1rem;border-radius:8px;background:white;color:#101010;cursor:pointer;">Chat</button>
                        <button style="border:1px solid #EAEAEA;padding:0.3rem 1rem;border-radius:8px;background:white;color:#666;cursor:pointer;">Report</button>
                    </div>
                </div>
            </div>
            <h2 style="font-weight:700;font-size:1.2rem;margin:1.5rem 0 1rem 0;color:#101010;">Listings from ${seller.displayName || seller.name}</h2>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.25rem;">
                ${seller.listings && seller.listings.length > 0 ? seller.listings.map(item => renderAuctionCard(item)).join('') : `<p style="color:#666;grid-column:1/-1;text-align:center;">No active listings</p>`}
            </div>
        </div>
    `;
}

// ---------- RENDER DASHBOARD (Seller Tools) ----------
async function renderDashboard() {
    const main = document.getElementById('mainContent');
    if (!app.user) return showToast('Please login first', 'error');

    const isSeller = app.user.role === 'INDIVIDUAL_SELLER' || app.user.role === 'AUCTIONEER';
    // 🟢 FIX: Admin can access dashboard even if not seller
    if (!isSeller && app.user.role !== 'ADMIN') {
        main.innerHTML = `
            <div style="max-width:800px;margin:0 auto;padding:2rem;text-align:center;background:#F5F5F7;min-height:100vh;">
                <h2 style="color:#101010;">Access Denied</h2>
                <p style="color:#666;">This page is for Individual Sellers and Auctioneers only.</p>
                <button class="btn btn-primary" style="background:#E30613;border:none;" onclick="navigate('marketplace')">Go to Marketplace</button>
            </div>`;
        return;
    }

    // 🟢 FIX: Admin bypass KYC warning
    if (app.user.kycStatus !== 'VERIFIED' && !app.user.canSell && app.user.role !== 'ADMIN') {
        main.innerHTML = `
            <div style="max-width:700px;margin:0 auto;padding:2rem;background:#F5F5F7;min-height:100vh;">
                <div style="background:#FFF8E1;border:1px solid #FFC107;padding:1.5rem;border-radius:12px;">
                    <h3 style="color:#FF9800;">⚠️ You need to verify to sell</h3>
                    <p style="color:#666;margin-bottom:1rem;">Upgrade your KYC to start listing items. This helps build trust with buyers.</p>
                    <button class="btn btn-primary" style="background:#E30613;border:none;" onclick="navigate('kyc')">Upgrade KYC</button>
                </div>
            </div>`;
        return;
    }

    try {
        const stats = await api('/api/seller/dashboard');
        const allListings = await api('/api/my-listings');
        // Fix dashboard filter bug: check both sellerId and seller.id
        const myActive = allListings.filter(l => l.sellerId === app.user.id || l.seller?.id === app.user.id);

        main.innerHTML = `
            <div style="max-width:1200px;margin:0 auto;padding:1rem;background:#F5F5F7;min-height:100vh;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <img src="/logo.jpeg" style="width:40px;height:40px;border-radius:8px;object-fit:contain;">
                        <div>
                            <h2 style="margin:0;font-weight:900;color:#101010;">Welcome, ${app.user.displayName || app.user.name}</h2>
                            <p style="margin:0;color:#666;font-size:0.9rem;">CM Central Market Dashboard</p>
                        </div>
                    </div>
                    <button onclick="navigate('createListing')" style="background:#E30613;color:white;border:none;padding:0.7rem 1.2rem;border-radius:8px;font-weight:800;cursor:pointer;">+ Sell Vehicle</button>
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:2rem;">
                    <div class="dash-stat"><p class="label">Active Listings</p><p class="value">${myActive.filter(l=>l.status==='ACTIVE').length}</p></div>
                    <div class="dash-stat"><p class="label">Total Views</p><p class="value">${myActive.reduce((s,l)=>s+(l.views||0),0)}</p></div>
                    <div class="dash-stat"><p class="label">Bids Received</p><p class="value">${myActive.reduce((s,l)=>s+(l.bids?.length||0),0)}</p></div>
                    <div class="dash-stat"><p class="label">Sold</p><p class="value">${myActive.filter(l=>l.status==='SOLD').length}</p></div>
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

// ---------- RENDER KYC UPGRADE PAGE ----------
function renderKYC() {
    const main = document.getElementById('mainContent');
    main.innerHTML = `
        <div style="max-width:600px;margin:0 auto;padding:2rem;background:#F5F5F7;min-height:100vh;">
            <h2 style="color:#101010;">Upgrade KYC</h2>
            <p style="color:#666;margin-bottom:1.5rem;">Upload your documents to become a verified seller. This builds trust with buyers.</p>
            <form id="kycForm" style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div class="form-group">
                    <label style="color:#666;">ID Document (Front)</label>
                    <div class="drag-area" id="kycIdDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;background:#F5F5F7;">
                        <i class="fas fa-id-card" style="font-size:2rem;color:#E30613;"></i>
                        <p style="margin:0.3rem 0;color:#666;font-size:0.85rem;">Upload ID photo</p>
                        <input type="file" id="kycIdFile" accept="image/*" hidden>
                    </div>
                    <div id="kycIdPreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
                </div>
                <div class="form-group">
                    <label style="color:#666;">Proof of Address</label>
                    <div class="drag-area" id="kycAddressDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;background:#F5F5F7;">
                        <i class="fas fa-home" style="font-size:2rem;color:#E30613;"></i>
                        <p style="margin:0.3rem 0;color:#666;font-size:0.85rem;">Upload utility bill or bank statement</p>
                        <input type="file" id="kycAddressFile" accept="image/*,.pdf" hidden>
                    </div>
                    <div id="kycAddressPreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
                </div>
                <div class="form-group">
                    <label style="color:#666;">Selfie with ID</label>
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
        showToast('KYC submitted! Our team will review your documents.', 'info');
        navigate('dashboard');
    });
}

function setupKycFileDrop(dropId, inputId, previewId) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!drop || !input || !preview) return;
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = '#E30613'; });
    drop.addEventListener('dragleave', () => { drop.style.borderColor = '#EAEAEA'; });
    drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.style.borderColor = '#EAEAEA';
        const files = e.dataTransfer.files;
        if (files.length) {
            input.files = files;
            preview.innerHTML = `<span style="color:#E30613;">✅ ${files[0].name}</span>`;
        }
    });
    input.addEventListener('change', () => {
        if (input.files.length) {
            preview.innerHTML = `<span style="color:#E30613;">✅ ${input.files[0].name}</span>`;
        }
    });
}

// ---------- RENDER CREATE LISTING (JSON submission) ----------
function renderCreateListing() {
    const main = document.getElementById('mainContent');
    // 🟢 FIX: Admin can access create listing even if canSell false
    if (!app.user || (!app.user.canSell && app.user.role !== 'ADMIN')) {
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
            <p style="color:#666;margin-bottom:1rem;">List as auction or fixed price — like WeBuyCars</p>
            <form id="createListingForm" style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;padding:0.25rem;background:#F5F5F7;border-radius:12px;margin-bottom:1rem;">
                    <button type="button" class="listing-type-btn active" data-type="AUCTION" style="padding:0.6rem;border:none;border-radius:8px;font-weight:700;background:white;color:#101010;cursor:pointer;">🔨 Auction</button>
                    <button type="button" class="listing-type-btn" data-type="FIXED_PRICE" style="padding:0.6rem;border:none;border-radius:8px;font-weight:700;background:transparent;color:#666;cursor:pointer;">🏷️ Fixed Price</button>
                </div>
                <input type="hidden" id="listingType" value="AUCTION">
                <div class="form-group"><label style="color:#666;">Title *</label><input id="listingTitle" placeholder="e.g. Toyota Hilux 2.8 GD-6 2021" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                    <div class="form-group"><label style="color:#666;">Category *</label><select id="listingCategory" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"><option>Vehicles</option><option>Motorcycles</option><option>TLB/Machinery</option><option>Other</option></select></div>
                    <div class="form-group"><label style="color:#666;">Condition *</label><select id="listingCondition" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"><option>USED</option><option>NEW</option><option>FOR_PARTS</option></select></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                    <div class="form-group"><label style="color:#666;">Year</label><input id="listingYear" type="number" placeholder="2021" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                    <div class="form-group"><label style="color:#666;">Kilometers</label><input id="listingKm" type="number" placeholder="85000" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;">
                    <div class="form-group"><label style="color:#666;">Color</label><input id="listingColor" placeholder="White" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                    <div class="form-group"><label style="color:#666;">Engine</label><input id="listingEngine" placeholder="2.8L" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                    <div class="form-group"><label style="color:#666;">Transmission</label><select id="listingTrans" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"><option>Manual</option><option>Automatic</option></select></div>
                </div>
                <div id="auctionFields">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                        <div class="form-group"><label style="color:#666;">Starting Price (R)</label><input id="listingStartPrice" type="number" placeholder="50000" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                        <div class="form-group"><label style="color:#666;">Reserve Price (R)</label><input id="listingReservePrice" type="number" placeholder="60000" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                    </div>
                    <div class="form-group"><label style="color:#666;">Duration</label><select id="listingDuration" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"><option value="1d">1 Day</option><option value="3d">3 Days</option><option value="7d" selected>7 Days</option></select></div>
                </div>
                <div id="fixedFields" style="display:none;">
                    <div class="form-group"><label style="color:#666;">Price (R)</label><input id="listingPrice" type="number" placeholder="120000" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                </div>
                <div class="form-group"><label style="color:#666;">Description</label><textarea id="listingDescription" rows="4" placeholder="Condition, extras, reason for selling..." style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;resize:vertical;"></textarea></div>
                
                <!-- CM Verification Section (inputs only; photo upload removed for now) -->
                <div style="background:#FFF3F3;border:1px solid #FFCFCF;padding:1rem;border-radius:12px;margin-bottom:1rem;">
                    <h4 style="margin:0 0 0.8rem 0;color:#E30613;">CM Verification (Required for GREEN badge)</h4>
                    <div class="form-group"><label style="color:#666;">VIN Number</label><input id="listingVin" placeholder="17 characters on windshield" style="width:100%;padding:0.6rem;border-radius:8px;background:#fff;border:1px solid #EAEAEA;color:#101010;"></div>
                    <div class="form-group"><label style="color:#666;">Engine Number</label><input id="listingEngineNo" placeholder="e.g. 2GD-123456" style="width:100%;padding:0.6rem;border-radius:8px;background:#fff;border:1px solid #EAEAEA;color:#101010;"></div>
                    <label style="font-size:0.8rem;display:flex;gap:8px;margin-top:8px;color:#101010;"><input type="checkbox" id="listingDeclare"> I declare this car is not stolen, not under finance, and km is true. False = banned.</label>
                </div>

                <div class="form-group"><label style="color:#666;">Images (URLs, comma separated)</label><input id="listingImages" placeholder="https://..., https://..." style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                
                <button type="submit" class="btn btn-primary" style="width:100%;margin-top:0.5rem;background:#E30613;border:none;color:#fff;">Publish to CM Central Market</button>
            </form>
        </div>`;

    // Type toggle
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
            return showToast('You must declare the vehicle is not stolen and km is true.', 'error');
        }

        const listingData = {
            title: document.getElementById('listingTitle').value,
            category: document.getElementById('listingCategory').value,
            condition: document.getElementById('listingCondition').value,
            year: parseInt(document.getElementById('listingYear').value) || null,
            kilometers: parseInt(document.getElementById('listingKm').value) || null,
            color: document.getElementById('listingColor').value,
            engineSize: document.getElementById('listingEngine').value,
            transmission: document.getElementById('listingTrans').value,
            listingType: document.getElementById('listingType').value,
            description: document.getElementById('listingDescription').value,
            vinNumber: document.getElementById('listingVin').value,
            engineNumber: document.getElementById('listingEngineNo').value,
            startingPrice: document.getElementById('listingStartPrice')?.value ? parseFloat(document.getElementById('listingStartPrice').value) : null,
            reservePrice: document.getElementById('listingReservePrice')?.value ? parseFloat(document.getElementById('listingReservePrice').value) : null,
            price: document.getElementById('listingPrice')?.value ? parseFloat(document.getElementById('listingPrice').value) : null,
            duration: document.getElementById('listingDuration')?.value || null,
            images: document.getElementById('listingImages').value.split(',').map(s => s.trim()).filter(Boolean)
        };

        try {
            const result = await api('/api/listings', 'POST', listingData);
            showToast('Listing published to CM!', 'info');
            navigate('dashboard');
            fetchMarketplace();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

// ---------- RENDER PROFILE PAGE ----------
function renderProfile() {
    const main = document.getElementById('mainContent');
    const user = app.user;
    if (!user) return showToast('Please login first', 'error');

    const avatar = user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.name)}&background=E30613&color=fff&size=128`;

    main.innerHTML = `
        <div style="max-width:800px;margin:0 auto;padding:1rem;background:#F5F5F7;min-height:100vh;">
            <h2 style="color:#101010;">Your Profile</h2>
            <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
                    <img src="${avatar}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;">
                    <div style="flex:1;">
                        <p style="font-size:1.2rem;font-weight:700;margin:0;color:#101010;">${user.displayName || user.name}</p>
                        <p style="color:#666;margin:0;">${user.email} • ${user.role}</p>
                        <p style="color:#666;margin:0;font-size:0.9rem;">KYC Status: ${user.kycStatus || 'NONE'} ${user.canSell ? '✅ Can Sell' : ''}</p>
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

// ---------- EDIT PROFILE ----------
function editProfile() {
    const user = app.user;
    openModal(`
        <span class="close-modal" onclick="closeModal()">&times;</span>
        <h3>Edit Profile</h3>
        <div class="form-group"><label>Display Name</label><input id="editDisplayName" value="${user.displayName || ''}" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
        <div class="form-group"><label>Bio</label><textarea id="editBio" rows="3" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;resize:vertical;">${user.bio || ''}</textarea></div>
        <div class="form-group"><label>Avatar URL</label><input id="editAvatar" value="${user.avatar || ''}" placeholder="https://example.com/avatar.jpg" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
        <button class="btn btn-primary" style="width:100%;background:#E30613;border:none;" onclick="saveProfile()">Save Changes</button>
    `);
}

async function saveProfile() {
    const displayName = document.getElementById('editDisplayName').value;
    const bio = document.getElementById('editBio').value;
    const avatar = document.getElementById('editAvatar').value;

    try {
        const res = await api('/api/users/me', 'PUT', { displayName, bio, avatar });
        app.user.displayName = displayName || app.user.name;
        app.user.bio = bio;
        app.user.avatar = avatar;
        localStorage.setItem('user', JSON.stringify(app.user));
        closeModal();
        showToast('Profile updated successfully!', 'info');
        renderProfile();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ---------- ADMIN DASHBOARD ----------
async function renderAdminDashboard() {
    if (app.user?.role !== 'ADMIN') return showToast('Admin access required', 'error');
    const main = document.getElementById('mainContent');
    try {
        const data = await api('/api/admin/overview');
        main.innerHTML = `
            <div style="max-width:1400px;margin:0 auto;background:#F5F5F7;min-height:100vh;padding:1rem;">
                <h2 style="color:#101010;">CM ADMIN HQ</h2>
                <p style="color:#666;">Total Users: ${data.users.length} | Listings: ${data.listings.length} | HQ WhatsApp: ${data.hqWhatsapp}</p>
                <div style="margin-top:2rem;">
                    <h3>Users</h3>
                    <table style="width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;">
                        <thead><tr><th style="padding:8px;text-align:left;">Email</th><th style="padding:8px;text-align:left;">Role</th><th style="padding:8px;text-align:left;">Action</th></tr></thead>
                        <tbody>${data.users.map(u => `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${u.email}</td><td style="padding:8px;border-bottom:1px solid #eee;">${u.role}</td><td style="padding:8px;border-bottom:1px solid #eee;">${u.role !== 'AUCTIONEER' ? `<button onclick="makeAuctioneer('${u.id}')" style="background:#E30613;color:white;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;">Make Auctioneer</button>` : '✓ Auctioneer'}</td></tr>`).join('')}</tbody>
                    </table>
                </div>
            </div>`;
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function makeAuctioneer(userId) {
    if (!confirm('Make this user AUCTIONEER?')) return;
    try {
        await api('/api/admin/make-auctioneer', 'POST', { userId });
        showToast('User promoted to Auctioneer', 'info');
        renderAdminDashboard();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ---------- DEVICE FINGERPRINT ----------
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

// ---------- START APP ----------
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    if (token) {
        app.token = token;
        const userData = localStorage.getItem('user');
        if (userData) app.user = JSON.parse(userData);
    }
    initApp();
});

console.log('✅ CM Central Market app.js loaded (Legacy Auction Cleaned, Listing Only)');// ============================================================
// ========== PART 3: SELLER PROFILE, DASHBOARD, KYC, CREATE, ADMIN, INIT
// ============================================================

// ---------- VIEW SELLER PROFILE (Public) ----------
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

    main.innerHTML = `
        <div style="max-width:1200px;margin:0 auto;padding:1rem;background:#F5F5F7;min-height:100vh;">
            <button onclick="navigate('marketplace')" style="background:white;border:1px solid #EAEAEA;padding:0.5rem 1rem;border-radius:8px;color:#666;cursor:pointer;margin-bottom:1rem;">← Back to Marketplace</button>
            <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;display:flex;gap:1.5rem;flex-wrap:wrap;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <img src="${avatar}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;">
                <div style="flex:1;">
                    <h1 style="font-size:1.8rem;font-weight:700;margin:0;color:#101010;">${seller.displayName || seller.name}</h1>
                    <p style="color:#666;margin:0.2rem 0;">${seller.role} • Joined ${new Date(seller.joinedDate).toLocaleDateString()} • ${seller.listings?.length || 0} listings</p>
                    <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
                        <button style="border:1px solid #EAEAEA;padding:0.3rem 1rem;border-radius:8px;background:white;color:#101010;cursor:pointer;">Chat</button>
                        <button style="border:1px solid #EAEAEA;padding:0.3rem 1rem;border-radius:8px;background:white;color:#666;cursor:pointer;">Report</button>
                    </div>
                </div>
            </div>
            <h2 style="font-weight:700;font-size:1.2rem;margin:1.5rem 0 1rem 0;color:#101010;">Listings from ${seller.displayName || seller.name}</h2>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.25rem;">
                ${seller.listings && seller.listings.length > 0 ? seller.listings.map(item => renderAuctionCard(item)).join('') : `<p style="color:#666;grid-column:1/-1;text-align:center;">No active listings</p>`}
            </div>
        </div>
    `;
}

// ---------- RENDER DASHBOARD (Seller Tools) ----------
async function renderDashboard() {
    const main = document.getElementById('mainContent');
    if (!app.user) return showToast('Please login first', 'error');

    const isSeller = app.user.role === 'INDIVIDUAL_SELLER' || app.user.role === 'AUCTIONEER';
    // 🟢 FIX: Admin can access dashboard even if not seller
    if (!isSeller && app.user.role !== 'ADMIN') {
        main.innerHTML = `
            <div style="max-width:800px;margin:0 auto;padding:2rem;text-align:center;background:#F5F5F7;min-height:100vh;">
                <h2 style="color:#101010;">Access Denied</h2>
                <p style="color:#666;">This page is for Individual Sellers and Auctioneers only.</p>
                <button class="btn btn-primary" style="background:#E30613;border:none;" onclick="navigate('marketplace')">Go to Marketplace</button>
            </div>`;
        return;
    }

    // 🟢 FIX: Admin bypass KYC warning
    if (app.user.kycStatus !== 'VERIFIED' && !app.user.canSell && app.user.role !== 'ADMIN') {
        main.innerHTML = `
            <div style="max-width:700px;margin:0 auto;padding:2rem;background:#F5F5F7;min-height:100vh;">
                <div style="background:#FFF8E1;border:1px solid #FFC107;padding:1.5rem;border-radius:12px;">
                    <h3 style="color:#FF9800;">⚠️ You need to verify to sell</h3>
                    <p style="color:#666;margin-bottom:1rem;">Upgrade your KYC to start listing items. This helps build trust with buyers.</p>
                    <button class="btn btn-primary" style="background:#E30613;border:none;" onclick="navigate('kyc')">Upgrade KYC</button>
                </div>
            </div>`;
        return;
    }

    try {
        const stats = await api('/api/seller/dashboard');
        const allListings = await api('/api/my-listings');
        // Fix dashboard filter bug: check both sellerId and seller.id
        const myActive = allListings.filter(l => l.sellerId === app.user.id || l.seller?.id === app.user.id);

        main.innerHTML = `
            <div style="max-width:1200px;margin:0 auto;padding:1rem;background:#F5F5F7;min-height:100vh;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <img src="/logo.jpeg" style="width:40px;height:40px;border-radius:8px;object-fit:contain;">
                        <div>
                            <h2 style="margin:0;font-weight:900;color:#101010;">Welcome, ${app.user.displayName || app.user.name}</h2>
                            <p style="margin:0;color:#666;font-size:0.9rem;">CM Central Market Dashboard</p>
                        </div>
                    </div>
                    <button onclick="navigate('createListing')" style="background:#E30613;color:white;border:none;padding:0.7rem 1.2rem;border-radius:8px;font-weight:800;cursor:pointer;">+ Sell Vehicle</button>
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:2rem;">
                    <div class="dash-stat"><p class="label">Active Listings</p><p class="value">${myActive.filter(l=>l.status==='ACTIVE').length}</p></div>
                    <div class="dash-stat"><p class="label">Total Views</p><p class="value">${myActive.reduce((s,l)=>s+(l.views||0),0)}</p></div>
                    <div class="dash-stat"><p class="label">Bids Received</p><p class="value">${myActive.reduce((s,l)=>s+(l.bids?.length||0),0)}</p></div>
                    <div class="dash-stat"><p class="label">Sold</p><p class="value">${myActive.filter(l=>l.status==='SOLD').length}</p></div>
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

// ---------- RENDER KYC UPGRADE PAGE ----------
function renderKYC() {
    const main = document.getElementById('mainContent');
    main.innerHTML = `
        <div style="max-width:600px;margin:0 auto;padding:2rem;background:#F5F5F7;min-height:100vh;">
            <h2 style="color:#101010;">Upgrade KYC</h2>
            <p style="color:#666;margin-bottom:1.5rem;">Upload your documents to become a verified seller. This builds trust with buyers.</p>
            <form id="kycForm" style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div class="form-group">
                    <label style="color:#666;">ID Document (Front)</label>
                    <div class="drag-area" id="kycIdDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;background:#F5F5F7;">
                        <i class="fas fa-id-card" style="font-size:2rem;color:#E30613;"></i>
                        <p style="margin:0.3rem 0;color:#666;font-size:0.85rem;">Upload ID photo</p>
                        <input type="file" id="kycIdFile" accept="image/*" hidden>
                    </div>
                    <div id="kycIdPreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
                </div>
                <div class="form-group">
                    <label style="color:#666;">Proof of Address</label>
                    <div class="drag-area" id="kycAddressDrop" style="border:2px dashed #EAEAEA;border-radius:12px;padding:1.5rem;text-align:center;cursor:pointer;background:#F5F5F7;">
                        <i class="fas fa-home" style="font-size:2rem;color:#E30613;"></i>
                        <p style="margin:0.3rem 0;color:#666;font-size:0.85rem;">Upload utility bill or bank statement</p>
                        <input type="file" id="kycAddressFile" accept="image/*,.pdf" hidden>
                    </div>
                    <div id="kycAddressPreview" style="margin-top:0.3rem;font-size:0.8rem;color:#E30613;"></div>
                </div>
                <div class="form-group">
                    <label style="color:#666;">Selfie with ID</label>
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
        showToast('KYC submitted! Our team will review your documents.', 'info');
        navigate('dashboard');
    });
}

function setupKycFileDrop(dropId, inputId, previewId) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!drop || !input || !preview) return;
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = '#E30613'; });
    drop.addEventListener('dragleave', () => { drop.style.borderColor = '#EAEAEA'; });
    drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.style.borderColor = '#EAEAEA';
        const files = e.dataTransfer.files;
        if (files.length) {
            input.files = files;
            preview.innerHTML = `<span style="color:#E30613;">✅ ${files[0].name}</span>`;
        }
    });
    input.addEventListener('change', () => {
        if (input.files.length) {
            preview.innerHTML = `<span style="color:#E30613;">✅ ${input.files[0].name}</span>`;
        }
    });
}

// ---------- RENDER CREATE LISTING (JSON submission) ----------
function renderCreateListing() {
    const main = document.getElementById('mainContent');
    // 🟢 FIX: Admin can access create listing even if canSell false
    if (!app.user || (!app.user.canSell && app.user.role !== 'ADMIN')) {
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
            <p style="color:#666;margin-bottom:1rem;">List as auction or fixed price — like WeBuyCars</p>
            <form id="createListingForm" style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;padding:0.25rem;background:#F5F5F7;border-radius:12px;margin-bottom:1rem;">
                    <button type="button" class="listing-type-btn active" data-type="AUCTION" style="padding:0.6rem;border:none;border-radius:8px;font-weight:700;background:white;color:#101010;cursor:pointer;">🔨 Auction</button>
                    <button type="button" class="listing-type-btn" data-type="FIXED_PRICE" style="padding:0.6rem;border:none;border-radius:8px;font-weight:700;background:transparent;color:#666;cursor:pointer;">🏷️ Fixed Price</button>
                </div>
                <input type="hidden" id="listingType" value="AUCTION">
                <div class="form-group"><label style="color:#666;">Title *</label><input id="listingTitle" placeholder="e.g. Toyota Hilux 2.8 GD-6 2021" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                    <div class="form-group"><label style="color:#666;">Category *</label><select id="listingCategory" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"><option>Vehicles</option><option>Motorcycles</option><option>TLB/Machinery</option><option>Other</option></select></div>
                    <div class="form-group"><label style="color:#666;">Condition *</label><select id="listingCondition" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"><option>USED</option><option>NEW</option><option>FOR_PARTS</option></select></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                    <div class="form-group"><label style="color:#666;">Year</label><input id="listingYear" type="number" placeholder="2021" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                    <div class="form-group"><label style="color:#666;">Kilometers</label><input id="listingKm" type="number" placeholder="85000" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;">
                    <div class="form-group"><label style="color:#666;">Color</label><input id="listingColor" placeholder="White" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                    <div class="form-group"><label style="color:#666;">Engine</label><input id="listingEngine" placeholder="2.8L" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                    <div class="form-group"><label style="color:#666;">Transmission</label><select id="listingTrans" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"><option>Manual</option><option>Automatic</option></select></div>
                </div>
                <div id="auctionFields">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                        <div class="form-group"><label style="color:#666;">Starting Price (R)</label><input id="listingStartPrice" type="number" placeholder="50000" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                        <div class="form-group"><label style="color:#666;">Reserve Price (R)</label><input id="listingReservePrice" type="number" placeholder="60000" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                    </div>
                    <div class="form-group"><label style="color:#666;">Duration</label><select id="listingDuration" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"><option value="1d">1 Day</option><option value="3d">3 Days</option><option value="7d" selected>7 Days</option></select></div>
                </div>
                <div id="fixedFields" style="display:none;">
                    <div class="form-group"><label style="color:#666;">Price (R)</label><input id="listingPrice" type="number" placeholder="120000" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                </div>
                <div class="form-group"><label style="color:#666;">Description</label><textarea id="listingDescription" rows="4" placeholder="Condition, extras, reason for selling..." style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;resize:vertical;"></textarea></div>
                
                <!-- CM Verification Section (inputs only; photo upload removed for now) -->
                <div style="background:#FFF3F3;border:1px solid #FFCFCF;padding:1rem;border-radius:12px;margin-bottom:1rem;">
                    <h4 style="margin:0 0 0.8rem 0;color:#E30613;">CM Verification (Required for GREEN badge)</h4>
                    <div class="form-group"><label style="color:#666;">VIN Number</label><input id="listingVin" placeholder="17 characters on windshield" style="width:100%;padding:0.6rem;border-radius:8px;background:#fff;border:1px solid #EAEAEA;color:#101010;"></div>
                    <div class="form-group"><label style="color:#666;">Engine Number</label><input id="listingEngineNo" placeholder="e.g. 2GD-123456" style="width:100%;padding:0.6rem;border-radius:8px;background:#fff;border:1px solid #EAEAEA;color:#101010;"></div>
                    <label style="font-size:0.8rem;display:flex;gap:8px;margin-top:8px;color:#101010;"><input type="checkbox" id="listingDeclare"> I declare this car is not stolen, not under finance, and km is true. False = banned.</label>
                </div>

                <div class="form-group"><label style="color:#666;">Images (URLs, comma separated)</label><input id="listingImages" placeholder="https://..., https://..." style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
                
                <button type="submit" class="btn btn-primary" style="width:100%;margin-top:0.5rem;background:#E30613;border:none;color:#fff;">Publish to CM Central Market</button>
            </form>
        </div>`;

    // Type toggle
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
            return showToast('You must declare the vehicle is not stolen and km is true.', 'error');
        }

        const listingData = {
            title: document.getElementById('listingTitle').value,
            category: document.getElementById('listingCategory').value,
            condition: document.getElementById('listingCondition').value,
            year: parseInt(document.getElementById('listingYear').value) || null,
            kilometers: parseInt(document.getElementById('listingKm').value) || null,
            color: document.getElementById('listingColor').value,
            engineSize: document.getElementById('listingEngine').value,
            transmission: document.getElementById('listingTrans').value,
            listingType: document.getElementById('listingType').value,
            description: document.getElementById('listingDescription').value,
            vinNumber: document.getElementById('listingVin').value,
            engineNumber: document.getElementById('listingEngineNo').value,
            startingPrice: document.getElementById('listingStartPrice')?.value ? parseFloat(document.getElementById('listingStartPrice').value) : null,
            reservePrice: document.getElementById('listingReservePrice')?.value ? parseFloat(document.getElementById('listingReservePrice').value) : null,
            price: document.getElementById('listingPrice')?.value ? parseFloat(document.getElementById('listingPrice').value) : null,
            duration: document.getElementById('listingDuration')?.value || null,
            images: document.getElementById('listingImages').value.split(',').map(s => s.trim()).filter(Boolean)
        };

        try {
            const result = await api('/api/listings', 'POST', listingData);
            showToast('Listing published to CM!', 'info');
            navigate('dashboard');
            fetchMarketplace();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

// ---------- RENDER PROFILE PAGE ----------
function renderProfile() {
    const main = document.getElementById('mainContent');
    const user = app.user;
    if (!user) return showToast('Please login first', 'error');

    const avatar = user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.name)}&background=E30613&color=fff&size=128`;

    main.innerHTML = `
        <div style="max-width:800px;margin:0 auto;padding:1rem;background:#F5F5F7;min-height:100vh;">
            <h2 style="color:#101010;">Your Profile</h2>
            <div style="background:white;border:1px solid #EAEAEA;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
                    <img src="${avatar}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;">
                    <div style="flex:1;">
                        <p style="font-size:1.2rem;font-weight:700;margin:0;color:#101010;">${user.displayName || user.name}</p>
                        <p style="color:#666;margin:0;">${user.email} • ${user.role}</p>
                        <p style="color:#666;margin:0;font-size:0.9rem;">KYC Status: ${user.kycStatus || 'NONE'} ${user.canSell ? '✅ Can Sell' : ''}</p>
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

// ---------- EDIT PROFILE ----------
function editProfile() {
    const user = app.user;
    openModal(`
        <span class="close-modal" onclick="closeModal()">&times;</span>
        <h3>Edit Profile</h3>
        <div class="form-group"><label>Display Name</label><input id="editDisplayName" value="${user.displayName || ''}" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
        <div class="form-group"><label>Bio</label><textarea id="editBio" rows="3" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;resize:vertical;">${user.bio || ''}</textarea></div>
        <div class="form-group"><label>Avatar URL</label><input id="editAvatar" value="${user.avatar || ''}" placeholder="https://example.com/avatar.jpg" style="width:100%;padding:0.6rem;border-radius:8px;background:#F5F5F7;border:1px solid #EAEAEA;color:#101010;"></div>
        <button class="btn btn-primary" style="width:100%;background:#E30613;border:none;" onclick="saveProfile()">Save Changes</button>
    `);
}

async function saveProfile() {
    const displayName = document.getElementById('editDisplayName').value;
    const bio = document.getElementById('editBio').value;
    const avatar = document.getElementById('editAvatar').value;

    try {
        const res = await api('/api/users/me', 'PUT', { displayName, bio, avatar });
        app.user.displayName = displayName || app.user.name;
        app.user.bio = bio;
        app.user.avatar = avatar;
        localStorage.setItem('user', JSON.stringify(app.user));
        closeModal();
        showToast('Profile updated successfully!', 'info');
        renderProfile();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ---------- ADMIN DASHBOARD ----------
async function renderAdminDashboard() {
    if (app.user?.role !== 'ADMIN') return showToast('Admin access required', 'error');
    const main = document.getElementById('mainContent');
    try {
        const data = await api('/api/admin/overview');
        main.innerHTML = `
            <div style="max-width:1400px;margin:0 auto;background:#F5F5F7;min-height:100vh;padding:1rem;">
                <h2 style="color:#101010;">CM ADMIN HQ</h2>
                <p style="color:#666;">Total Users: ${data.users.length} | Listings: ${data.listings.length} | HQ WhatsApp: ${data.hqWhatsapp}</p>
                <div style="margin-top:2rem;">
                    <h3>Users</h3>
                    <table style="width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;">
                        <thead><tr><th style="padding:8px;text-align:left;">Email</th><th style="padding:8px;text-align:left;">Role</th><th style="padding:8px;text-align:left;">Action</th></tr></thead>
                        <tbody>${data.users.map(u => `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${u.email}</td><td style="padding:8px;border-bottom:1px solid #eee;">${u.role}</td><td style="padding:8px;border-bottom:1px solid #eee;">${u.role !== 'AUCTIONEER' ? `<button onclick="makeAuctioneer('${u.id}')" style="background:#E30613;color:white;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;">Make Auctioneer</button>` : '✓ Auctioneer'}</td></tr>`).join('')}</tbody>
                    </table>
                </div>
            </div>`;
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function makeAuctioneer(userId) {
    if (!confirm('Make this user AUCTIONEER?')) return;
    try {
        await api('/api/admin/make-auctioneer', 'POST', { userId });
        showToast('User promoted to Auctioneer', 'info');
        renderAdminDashboard();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ---------- DEVICE FINGERPRINT ----------
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

// ---------- START APP ----------
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    if (token) {
        app.token = token;
        const userData = localStorage.getItem('user');
        if (userData) app.user = JSON.parse(userData);
    }
    initApp();
});

console.log('✅ CM Central Market app.js loaded (Legacy Auction Cleaned, Listing Only)');