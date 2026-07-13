/**
 * Stan's Robot Shop - Modern Vanilla JS SPA Frontend
 */

// --- Global State ---
const state = {
    currentUser: {
        uniqueid: '',
        name: '',
        email: ''
    },
    cart: {
        total: 0,
        items: [],
        tax: 0
    },
    categories: [],
    products: {}, // Cache products by category: { categoryName: [products] }
    activeCategory: '', // Track which category is expanded in the sidebar
    orderHistory: [],
    toastTimeout: null
};

// --- API Helper ---
async function apiRequest(url, method = 'GET', data = null) {
    try {
        const options = {
            method,
            headers: {}
        };
        if (data) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(data);
        }
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        // Handle empty response gracefully
        const text = await response.text();
        return text ? JSON.parse(text) : {};
    } catch (error) {
        console.error(`API Error on ${url}:`, error);
        showToast(`Error: ${error.message || 'Request failed'}`);
        throw error;
    }
}

// --- Instana Telemetry Helpers ---
function trackPage(pageName) {
    if (typeof ineum !== 'undefined') {
        ineum('page', pageName);
    }
}

function trackUser(id, name = '', email = '') {
    if (typeof ineum !== 'undefined') {
        if (id && !id.startsWith('anonymous')) {
            ineum('user', id, name, email);
        } else {
            ineum('user', id);
        }
    }
}

// --- Initialize User & Cart ---
async function initUserAndCart() {
    // Check local storage for logged-in user session
    const storedUser = localStorage.getItem('robotshop_user');
    if (storedUser) {
        try {
            const parsed = JSON.parse(storedUser);
            state.currentUser = parsed;
            trackUser(state.currentUser.uniqueid, state.currentUser.name, state.currentUser.email);
        } catch (e) {
            console.error('Failed to parse stored user', e);
        }
    }

    // Generate unique ID if we don't have one
    if (!state.currentUser.uniqueid) {
        try {
            const res = await apiRequest('/api/user/uniqueid');
            state.currentUser.uniqueid = res.uuid;
            trackUser(res.uuid);
            // Save anonymous user session
            localStorage.setItem('robotshop_user', JSON.stringify(state.currentUser));
        } catch (err) {
            console.error('Error fetching unique ID:', err);
            state.currentUser.uniqueid = 'anonymous-' + Math.random().toString(36).substr(2, 9);
        }
    }

    // Load Cart
    await fetchCart();
}

// --- Fetch Categories ---
async function fetchCategories() {
    try {
        state.categories = await apiRequest('/api/catalogue/categories');
    } catch (err) {
        console.error('Error fetching categories:', err);
    }
}

// --- Fetch Products in Category ---
async function fetchProducts(category) {
    if (state.products[category]) return state.products[category];
    try {
        const prods = await apiRequest(`/api/catalogue/products/${category}`);
        state.products[category] = prods;
        return prods;
    } catch (err) {
        console.error(`Error fetching products for category ${category}:`, err);
        return [];
    }
}

// --- Fetch Cart ---
async function fetchCart() {
    if (!state.currentUser.uniqueid) return;
    try {
        const cart = await apiRequest(`/api/cart/cart/${state.currentUser.uniqueid}`);
        // If last item in cart is 'SHIP', reset shipping
        if (cart && cart.items && cart.items.length > 0 && cart.items[cart.items.length - 1].sku === 'SHIP') {
            const updatedCart = await apiRequest(`/api/cart/update/${state.currentUser.uniqueid}/SHIP/0`);
            state.cart = updatedCart;
        } else {
            state.cart = cart;
        }
        updateHeaderAndActions();
    } catch (err) {
        console.error('Error loading cart:', err);
    }
}

// --- Client-side Router ---
const routes = [
    { pattern: /^\/$/, view: renderSplash },
    { pattern: /^\/search\/(.+)$/, view: (match) => renderSearch(decodeURIComponent(match[1])) },
    { pattern: /^\/product\/(.+)$/, view: (match) => renderProduct(match[1]) },
    { pattern: /^\/login$/, view: renderLogin },
    { pattern: /^\/cart$/, view: renderCart },
    { pattern: /^\/shipping$/, view: renderShipping },
    { pattern: /^\/payment$/, view: renderPayment }
];

function navigateTo(url) {
    history.pushState(null, null, url);
    route();
}

async function route() {
    let path = window.location.pathname;
    
    // Support subdirectory base paths if Nginx serves us there
    // For standard dev setup, path is just relative to root
    let matched = false;
    for (const r of routes) {
        const match = path.match(r.pattern);
        if (match) {
            matched = true;
            // Highlight active navigation states
            updateHeaderAndActions();
            await r.view(match);
            break;
        }
    }

    if (!matched) {
        // Fallback to home
        navigateTo('/');
    }
}

// Listen for popstate (back/forward browser buttons)
window.addEventListener('popstate', route);

// Global link click handler for client-side routing
document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && link.href && link.host === window.location.host) {
        const targetAttr = link.getAttribute('target');
        if (targetAttr === '_blank') return; // let external links open in new tab
        
        e.preventDefault();
        navigateTo(link.pathname);
    }
});

// --- Dynamic Header & Sidebar Components ---
function updateHeaderAndActions() {
    // 1. Update Cart Badge
    const cartBtn = document.getElementById('cart-btn');
    if (cartBtn) {
        const totalQty = state.cart.items ? state.cart.items.reduce((sum, item) => sum + item.qty, 0) : 0;
        const totalCost = state.cart.total ? state.cart.total.toFixed(2) : '0.00';
        
        if (totalQty > 0) {
            cartBtn.classList.add('active-cart');
            cartBtn.innerHTML = `🛒 Cart <span class="badge">&euro;${totalCost} (${totalQty})</span>`;
        } else {
            cartBtn.classList.remove('active-cart');
            cartBtn.innerHTML = `🛒 Cart <span class="badge">Empty</span>`;
        }
    }

    // 2. Update Login Button Text
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        if (state.currentUser.name && !state.currentUser.uniqueid.startsWith('anonymous')) {
            loginBtn.innerHTML = `👤 ${state.currentUser.name}`;
        } else {
            loginBtn.innerHTML = `👤 Login`;
        }
    }

    // 3. Update Footer unique ID
    const footerUid = document.getElementById('footer-uniqueid');
    if (footerUid) {
        footerUid.textContent = `Session ID: ${state.currentUser.uniqueid}`;
    }
}

async function renderSidebar() {
    const sidebar = document.getElementById('sidebar-nav');
    if (!sidebar) return;

    let html = `
        <h3>Navigation</h3>
        <ul class="category-list" style="margin-bottom: 20px;">
            <li class="category-item">
                <div class="category-header" id="nav-home">🏠 Storefront</div>
            </li>
        </ul>
        <h3>Categories</h3>
        <ul class="category-list">
    `;

    for (const cat of state.categories) {
        const isActive = state.activeCategory === cat;
        html += `
            <li class="category-item">
                <div class="category-header ${isActive ? 'active' : ''}" data-category="${cat}">
                    <span>📂 ${cat}</span>
                    <span>${isActive ? '▲' : '▼'}</span>
                </div>
                ${isActive ? `<ul class="sub-products" id="sub-${cat}"><li>Loading...</li></ul>` : ''}
            </li>
        `;
    }

    html += '</ul>';
    sidebar.innerHTML = html;

    // Attach Category toggle events
    sidebar.querySelectorAll('.category-header').forEach(header => {
        header.addEventListener('click', async (e) => {
            const cat = header.dataset.category;
            if (!cat) {
                // Clicking Storefront
                state.activeCategory = '';
                navigateTo('/');
                return;
            }

            if (state.activeCategory === cat) {
                state.activeCategory = '';
            } else {
                state.activeCategory = cat;
            }
            
            // Re-render sidebar to open/close items
            await renderSidebar();

            // Load sub products if open
            if (state.activeCategory === cat) {
                const subUl = document.getElementById(`sub-${cat}`);
                const products = await fetchProducts(cat);
                if (products && products.length > 0) {
                    subUl.innerHTML = products.map(p => `
                        <li>
                            <a href="/product/${p.sku}">🤖 ${p.name}</a>
                        </li>
                    `).join('');
                } else {
                    subUl.innerHTML = '<li>No products</li>';
                }
            }
        });
    });
}

// --- Search Handler ---
function setupSearch() {
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');
    
    if (searchForm && searchInput) {
        searchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = searchInput.value.trim();
            if (text) {
                searchInput.value = '';
                navigateTo(`/search/${encodeURIComponent(text)}`);
            }
        });
    }
}

// --- Global Toast Notification ---
function showToast(message) {
    let toast = document.getElementById('toast-container');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-container';
        toast.style.position = 'fixed';
        toast.style.bottom = '24px';
        toast.style.right = '24px';
        toast.style.zIndex = '1100';
        document.body.appendChild(toast);
    }

    toast.innerHTML = `
        <div class="message-toast">
            <span>✨</span>
            <span>${message}</span>
        </div>
    `;

    if (state.toastTimeout) clearTimeout(state.toastTimeout);
    state.toastTimeout = setTimeout(() => {
        toast.innerHTML = '';
    }, 4000);
}

// --- Render Helper ---
function renderView(html) {
    const viewContainer = document.getElementById('view');
    if (viewContainer) {
        viewContainer.innerHTML = `<div class="animated-view">${html}</div>`;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// --- View 1: Splash Screen ---
async function renderSplash() {
    trackPage('splash');
    const html = `
        <div class="splash-container">
            <h2 class="splash-title">Welcome to Stan's Robot Shop</h2>
            <p>
                Browse our state-of-the-art catalog of robotic assistants and companion droids. Stan's Robot Shop offers 
                an ultra-modern shopping experience powered by microservices architecture.
            </p>
            <p style="font-weight: 500; color: var(--primary-cyan)">
                Explore categories on the left panel to begin.
            </p>
            
            <h3 style="margin-top: 40px; font-size: 1.1rem; text-transform: uppercase; color: var(--primary-blue)">Built with modern microservices:</h3>
            <div class="tech-grid">
                <div class="tech-badge">Vanilla JS</div>
                <div class="tech-badge">CSS Grid/Flex</div>
                <div class="tech-badge">Nginx</div>
                <div class="tech-badge">NodeJS</div>
                <div class="tech-badge">Java</div>
                <div class="tech-badge">Python</div>
                <div class="tech-badge">Golang</div>
                <div class="tech-badge">PHP</div>
                <div class="tech-badge">MongoDB</div>
                <div class="tech-badge">Redis</div>
                <div class="tech-badge">MySQL</div>
                <div class="tech-badge">RabbitMQ</div>
            </div>

            <p style="margin-top: 30px; font-size: 0.9rem;">
                Stan monitors this store using <strong>Instana EUM</strong>. To learn more about full stack monitoring and APM, visit 
                <a href="https://instana.com/" target="_blank" class="cont">Instana</a>.
            </p>
            <p style="font-size: 0.9rem;">
                Source code is fully open source on <a href="https://github.com/instana/robot-shop" target="_blank" class="cont">GitHub</a>.
            </p>
        </div>
    `;
    renderView(html);
}

// --- View 2: Search Screen ---
async function renderSearch(searchText) {
    trackPage(`search/${searchText}`);
    renderView(`<h2>Searching for "${searchText}"...</h2>`);
    
    try {
        const results = await apiRequest(`/api/catalogue/search/${searchText}`);
        if (!results || results.length === 0) {
            renderView(`
                <div class="glass-panel" style="text-align: center; padding: 40px 20px;">
                    <h3 style="color: var(--accent-rose)">No matches found</h3>
                    <p style="color: var(--text-secondary); margin-top: 10px;">We couldn't find any excellent robot candidates matching "${searchText}". Try searching for something else!</p>
                </div>
            `);
            return;
        }

        const itemsHtml = results.map(item => `
            <div class="search-item">
                <div>
                    <h4 style="font-size: 1.2rem;"><a href="/product/${item.sku}">🤖 ${item.name}</a></h4>
                    <p style="color: var(--text-secondary); margin-top: 6px; font-size: 0.9rem;">${item.description}</p>
                </div>
                <div style="text-align: right;">
                    <div style="font-family: var(--font-heading); color: var(--primary-cyan); font-weight: bold; font-size: 1.2rem;">&euro;${item.price.toFixed(2)}</div>
                    <a href="/product/${item.sku}" class="cta-btn" style="padding: 6px 14px; font-size: 0.75rem; margin-top: 8px; display: inline-block;">Details</a>
                </div>
            </div>
        `).join('');

        renderView(`
            <div class="glass-panel">
                <h3 style="margin-bottom: 20px;">Matches for "${searchText}"</h3>
                <div class="search-grid">
                    ${itemsHtml}
                </div>
            </div>
        `);
    } catch (e) {
        renderView(`<h3>Error running search</h3>`);
    }
}

// --- View 3: Product Detail View ---
async function renderProduct(sku) {
    trackPage(`product/${sku}`);
    renderView(`<h2>Loading Product Details...</h2>`);

    try {
        // Load product and rating concurrently
        const [product, rating] = await Promise.all([
            apiRequest(`/api/catalogue/product/${sku}`),
            apiRequest(`/api/ratings/api/fetch/${sku}`).catch(() => ({ avg_rating: 0, rating_count: 0 }))
        ]);

        const avgRating = rating && rating.avg_rating ? rating.avg_rating : 0;
        const ratingCount = rating && rating.rating_count ? rating.rating_count : 0;

        let ratingHtml = '';
        if (avgRating > 0) {
            ratingHtml = `★ ${avgRating.toFixed(1)} / 5.0 (${ratingCount} votes)`;
        } else {
            ratingHtml = 'No votes yet. Be the first to vote!';
        }

        const isInstock = product.instock !== 0;

        const html = `
            <div class="glass-panel">
                <div class="product-detail-layout">
                    <div class="product-image-container">
                        <img src="/images/${product.sku}.png" alt="${product.name}" onerror="this.src='/images/placeholder.png'">
                    </div>
                    
                    <div class="product-info-panel">
                        <div>
                            <h2 class="product-name">${product.name}</h2>
                            <div class="rating-container" style="margin: 15px 0;">
                                <div class="rating-text">
                                    ${ratingHtml}
                                </div>
                                <div class="stars-row" id="stars-row">
                                    ${[1, 2, 3, 4, 5].map(v => `
                                        <span class="vote-star empty" data-score="${v}">★</span>
                                    `).join('')}
                                </div>
                            </div>
                            <p class="product-description">${product.description}</p>
                        </div>
                        
                        <div class="product-cart-panel">
                            <div class="price-tag">&euro;${product.price.toFixed(2)}</div>
                            
                            ${isInstock ? `
                                <div style="display: flex; align-items: center; gap: 16px;">
                                    <div class="qty-control">
                                        <button class="qty-btn" id="qty-dec">-</button>
                                        <input type="number" id="qty-input" class="qty-input" value="1" min="1" max="10" readonly>
                                        <button class="qty-btn" id="qty-inc">+</button>
                                    </div>
                                    <button class="cta-btn" id="add-to-cart-btn">Add To Cart</button>
                                </div>
                            ` : `
                                <div class="out-of-stock-tag">OUT OF STOCK</div>
                            `}
                        </div>
                    </div>
                </div>
            </div>
        `;

        renderView(html);

        // Bind interactive hover rating actions
        const stars = document.querySelectorAll('.vote-star');
        stars.forEach(star => {
            const score = parseInt(star.dataset.score);
            
            star.addEventListener('mouseover', () => {
                for (let i = 0; i < 5; i++) {
                    if (i < score) {
                        stars[i].classList.add('filled');
                        stars[i].classList.remove('empty');
                    } else {
                        stars[i].classList.add('empty');
                        stars[i].classList.remove('filled');
                    }
                }
            });

            star.addEventListener('mouseout', () => {
                stars.forEach(s => {
                    s.classList.add('empty');
                    s.classList.remove('filled');
                });
            });

            // Cast rating vote
            star.addEventListener('click', async () => {
                try {
                    await apiRequest(`/api/ratings/api/rate/${product.sku}/${score}`, 'PUT');
                    showToast('Thank you for rating!');
                    // Reload product to show updated rating
                    renderProduct(sku);
                } catch (e) {
                    console.error('Failed to rate', e);
                }
            });
        });

        // Add to Cart Quantity control listeners
        const qtyInput = document.getElementById('qty-input');
        const qtyDec = document.getElementById('qty-dec');
        const qtyInc = document.getElementById('qty-inc');
        const addToCartBtn = document.getElementById('add-to-cart-btn');

        if (qtyInput && qtyDec && qtyInc && addToCartBtn) {
            qtyDec.addEventListener('click', () => {
                let current = parseInt(qtyInput.value) || 1;
                if (current > 1) qtyInput.value = current - 1;
            });

            qtyInc.addEventListener('click', () => {
                let current = parseInt(qtyInput.value) || 1;
                if (current < 10) qtyInput.value = current + 1;
            });

            addToCartBtn.addEventListener('click', async () => {
                addToCartBtn.disabled = true;
                const qty = parseInt(qtyInput.value) || 1;
                try {
                    const cart = await apiRequest(`/api/cart/add/${state.currentUser.uniqueid}/${product.sku}/${qty}`);
                    state.cart = cart;
                    updateHeaderAndActions();
                    showToast(`Added ${qty}x ${product.name} to cart`);
                } catch (e) {
                    showToast('Failed to add product to cart');
                } finally {
                    addToCartBtn.disabled = false;
                }
            });
        }

    } catch (e) {
        renderView(`<div class="glass-panel"><h3 style="color: var(--accent-rose)">Product details failed to load.</h3></div>`);
    }
}

// --- View 4: Cart Screen ---
async function renderCart() {
    trackPage('cart');
    renderView(`<h2>Loading Shopping Cart...</h2>`);

    await fetchCart();

    const items = state.cart.items || [];
    if (items.length === 0) {
        renderView(`
            <div class="glass-panel" style="text-align: center; padding: 40px 20px;">
                <h3 style="color: var(--primary-cyan)">Your cart is empty</h3>
                <p style="color: var(--text-secondary); margin-top: 10px;">Find some awesome robot friends and add them to your cart!</p>
                <button class="cta-btn" id="go-home-btn" style="margin-top: 20px;">Continue Shopping</button>
            </div>
        `);
        
        document.getElementById('go-home-btn')?.addEventListener('click', () => navigateTo('/'));
        return;
    }

    let rowsHtml = items.map(item => `
        <tr data-sku="${item.sku}">
            <td>
                <div class="qty-control" style="display: inline-flex;">
                    <button class="qty-btn dec-cart-qty">-</button>
                    <input type="number" class="qty-input cart-qty-input" value="${item.qty}" min="0" max="10" readonly>
                    <button class="qty-btn inc-cart-qty">+</button>
                </div>
            </td>
            <td>
                <a href="/product/${item.sku}" style="font-weight: 500;">🤖 ${item.name}</a>
            </td>
            <td class="currency">&euro;${item.subtotal.toFixed(2)}</td>
        </tr>
    `).join('');

    const html = `
        <div class="glass-panel">
            <h3>Shopping Cart</h3>
            <p style="font-size: 0.9rem; color: var(--text-secondary); margin: 6px 0 20px 0;">Checkout session for user: <strong>${state.currentUser.uniqueid}</strong></p>
            
            <div class="data-table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="width: 150px;">Quantity</th>
                            <th>Item Name</th>
                            <th style="text-align: right;">Sub Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                        <tr>
                            <td colspan="3" style="border: none;">&nbsp;</td>
                        </tr>
                        <tr>
                            <td>&nbsp;</td>
                            <td style="text-align: right; font-weight: 500;">Inc Tax:</td>
                            <td class="currency">&euro;${state.cart.tax.toFixed(2)}</td>
                        </tr>
                        <tr style="border-top: 2px solid var(--border-color)">
                            <td>&nbsp;</td>
                            <td style="text-align: right; font-weight: bold; color: var(--text-primary);">Total:</td>
                            <td class="currency" style="font-size: 1.3rem;">&euro;${state.cart.total.toFixed(2)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style="display: flex; justify-content: space-between; margin-top: 30px; align-items: center;">
                <a href="/" class="cont">← Keep Shopping</a>
                <button class="cta-btn" id="cart-checkout-btn">Proceed to Checkout</button>
            </div>
        </div>
    `;

    renderView(html);

    // Bind quantity increment/decrement/changes
    const decBtns = document.querySelectorAll('.dec-cart-qty');
    const incBtns = document.querySelectorAll('.inc-cart-qty');

    async function changeQty(sku, newQty) {
        try {
            const updatedCart = await apiRequest(`/api/cart/update/${state.currentUser.uniqueid}/${sku}/${newQty}`);
            state.cart = updatedCart;
            renderCart();
        } catch (e) {
            showToast('Failed to update cart quantity');
        }
    }

    decBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const row = e.target.closest('tr');
            const sku = row.dataset.sku;
            const input = row.querySelector('.cart-qty-input');
            const currentQty = parseInt(input.value) || 0;
            if (currentQty > 0) {
                changeQty(sku, currentQty - 1);
            }
        });
    });

    incBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const row = e.target.closest('tr');
            const sku = row.dataset.sku;
            const input = row.querySelector('.cart-qty-input');
            const currentQty = parseInt(input.value) || 0;
            if (currentQty < 10) {
                changeQty(sku, currentQty + 1);
            }
        });
    });

    document.getElementById('cart-checkout-btn')?.addEventListener('click', () => {
        navigateTo('/shipping');
    });
}

// --- View 5: Shipping Screen ---
async function renderShipping() {
    trackPage('shipping');
    renderView(`<h2>Loading Shipping Wizard...</h2>`);

    try {
        const countries = await apiRequest('/api/shipping/codes');
        
        const wizardHeader = `
            <div class="checkout-wizard-steps">
                <div class="step-indicator complete">
                    <div class="step-dot">1</div>
                    <div class="step-label">Cart</div>
                </div>
                <div class="step-indicator active">
                    <div class="step-dot">2</div>
                    <div class="step-label">Shipping</div>
                </div>
                <div class="step-indicator">
                    <div class="step-dot">3</div>
                    <div class="step-label">Payment</div>
                </div>
            </div>
        `;

        const html = `
            <div class="glass-panel">
                ${wizardHeader}
                <h3 style="margin-bottom: 24px;">Shipping Information</h3>
                
                <div class="auth-form-card" style="width: 100%; max-width: 600px; margin: 0 auto;">
                    <div class="form-group">
                        <label for="ship-country">Destination Country</label>
                        <select id="ship-country">
                            <option value="">-- Choose Country --</option>
                            ${countries.map(c => `<option value="${c.code}">${c.name}</option>`).join('')}
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="ship-location">City / Location</label>
                        <div style="position: relative;">
                            <input type="text" id="ship-location" placeholder="Type to search location..." disabled autocomplete="off">
                            <div class="autocomplete-suggestions" id="loc-suggestions" style="display: none;"></div>
                        </div>
                    </div>

                    <button class="cta-btn" id="calc-shipping-btn" style="width: 100%; margin-top: 10px;" disabled>Calculate Shipping Cost</button>
                    
                    <div id="shipping-results-slot"></div>
                </div>
            </div>
        `;

        renderView(html);

        const countrySelect = document.getElementById('ship-country');
        const locationInput = document.getElementById('ship-location');
        const suggestionsBox = document.getElementById('loc-suggestions');
        const calcBtn = document.getElementById('calc-shipping-btn');
        const resultsSlot = document.getElementById('shipping-results-slot');

        let selectedCountryCode = '';
        let selectedLocationUuid = '';
        let selectedLocationName = '';
        let shippingData = null;

        countrySelect.addEventListener('change', () => {
            selectedCountryCode = countrySelect.value;
            locationInput.value = '';
            selectedLocationUuid = '';
            selectedLocationName = '';
            calcBtn.disabled = true;
            resultsSlot.innerHTML = '';
            suggestionsBox.style.display = 'none';

            if (selectedCountryCode) {
                locationInput.disabled = false;
                locationInput.focus();
            } else {
                locationInput.disabled = true;
            }
        });

        // Location Autocomplete input listener
        let debounceTimer;
        locationInput.addEventListener('input', () => {
            const query = locationInput.value.trim();
            calcBtn.disabled = true;
            resultsSlot.innerHTML = '';
            
            if (query.length < 2) {
                suggestionsBox.style.display = 'none';
                return;
            }

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                try {
                    const matches = await apiRequest(`/api/shipping/match/${selectedCountryCode}/${encodeURIComponent(query)}`);
                    if (matches && matches.length > 0) {
                        suggestionsBox.innerHTML = matches.map(m => `
                            <div class="autocomplete-suggestion" data-uuid="${m.uuid}" data-name="${m.name}">
                                🏙️ ${m.name}
                            </div>
                        `).join('');
                        suggestionsBox.style.display = 'block';

                        // suggestion click binding
                        suggestionsBox.querySelectorAll('.autocomplete-suggestion').forEach(item => {
                            item.addEventListener('click', () => {
                                selectedLocationUuid = item.dataset.uuid;
                                selectedLocationName = item.dataset.name;
                                locationInput.value = selectedLocationName;
                                suggestionsBox.style.display = 'none';
                                calcBtn.disabled = false;
                            });
                        });
                    } else {
                        suggestionsBox.innerHTML = `<div class="autocomplete-suggestion" style="cursor: default; color: var(--text-muted);">No matching cities</div>`;
                        suggestionsBox.style.display = 'block';
                    }
                } catch (e) {
                    console.error('Error fetching shipping matches', e);
                }
            }, 300);
        });

        // Hide suggestions when clicking outside
        document.addEventListener('click', (e) => {
            if (e.target !== locationInput && e.target !== suggestionsBox) {
                suggestionsBox.style.display = 'none';
            }
        });

        // Calculate Shipping Button
        calcBtn.addEventListener('click', async () => {
            calcBtn.disabled = true;
            resultsSlot.innerHTML = `<p style="margin-top: 15px; text-align: center; color: var(--primary-cyan)">Calculating transit matrix...</p>`;
            
            try {
                const res = await apiRequest(`/api/shipping/calc/${selectedLocationUuid}`);
                shippingData = res;
                // Add readable location details
                const countryText = countrySelect.options[countrySelect.selectedIndex].text;
                shippingData.location = `${countryText} - ${selectedLocationName}`;
                
                resultsSlot.innerHTML = `
                    <div class="shipping-cost-card animated-view">
                        <div class="shipping-cost-row">
                            <span>📍 Delivery Route:</span>
                            <span>${shippingData.location}</span>
                        </div>
                        <div class="shipping-cost-row">
                            <span>✈️ Distance:</span>
                            <span>${shippingData.distance} km</span>
                        </div>
                        <div class="shipping-cost-row" style="border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 10px; margin-top: 5px;">
                            <span>📦 Shipping Cost:</span>
                            <span>&euro;${shippingData.cost.toFixed(2)}</span>
                        </div>
                        
                        <button class="cta-btn" id="confirm-shipping-btn" style="margin-top: 15px; width: 100%; background: linear-gradient(135deg, var(--accent-purple) 0%, var(--primary-blue) 100%); color: #ffffff;">Confirm & Proceed to Payment</button>
                    </div>
                `;

                document.getElementById('confirm-shipping-btn').addEventListener('click', async () => {
                    const confirmBtn = document.getElementById('confirm-shipping-btn');
                    confirmBtn.disabled = true;
                    try {
                        const newCart = await apiRequest(`/api/shipping/confirm/${state.currentUser.uniqueid}`, 'POST', shippingData);
                        state.cart = newCart;
                        updateHeaderAndActions();
                        navigateTo('/payment');
                    } catch (e) {
                        showToast('Failed to confirm shipping');
                        confirmBtn.disabled = false;
                    }
                });

            } catch (e) {
                resultsSlot.innerHTML = `<p style="margin-top: 15px; text-align: center; color: var(--accent-rose)">Shipping calculation error</p>`;
            } finally {
                calcBtn.disabled = false;
            }
        });

    } catch (e) {
        renderView(`<h3>Failed to load shipping codes</h3>`);
    }
}

// --- View 6: Payment Screen ---
async function renderPayment() {
    trackPage('payment');
    renderView(`<h2>Loading Order Review...</h2>`);

    const items = state.cart.items || [];
    if (items.length === 0) {
        navigateTo('/cart');
        return;
    }

    const wizardHeader = `
        <div class="checkout-wizard-steps">
            <div class="step-indicator complete">
                <div class="step-dot">1</div>
                <div class="step-label">Cart</div>
            </div>
            <div class="step-indicator complete">
                <div class="step-dot">2</div>
                <div class="step-label">Shipping</div>
            </div>
            <div class="step-indicator active">
                <div class="step-dot">3</div>
                <div class="step-label">Payment</div>
            </div>
        </div>
    `;

    let rowsHtml = items.map(item => `
        <tr>
            <td style="text-align: center;">${item.qty}</td>
            <td>🤖 ${item.name}</td>
            <td class="currency">&euro;${item.subtotal.toFixed(2)}</td>
        </tr>
    `).join('');

    const html = `
        <div class="glass-panel">
            ${wizardHeader}
            <h3 style="margin-bottom: 20px;">Review Your Order</h3>
            
            <div class="data-table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="width: 100px; text-align: center;">Qty</th>
                            <th>Description</th>
                            <th style="text-align: right;">Sub Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                        <tr>
                            <td colspan="3" style="border: none;">&nbsp;</td>
                        </tr>
                        <tr>
                            <td>&nbsp;</td>
                            <td style="text-align: right; font-weight: 500;">Inc Tax:</td>
                            <td class="currency">&euro;${state.cart.tax.toFixed(2)}</td>
                        </tr>
                        <tr style="border-top: 2px solid var(--border-color)">
                            <td>&nbsp;</td>
                            <td style="text-align: right; font-weight: bold; color: var(--text-primary);">Order Total:</td>
                            <td class="currency" style="font-size: 1.3rem;">&euro;${state.cart.total.toFixed(2)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div id="payment-status-slot" style="margin: 20px 0;"></div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 30px;">
                <a href="/shipping" class="cont">← Change Shipping</a>
                <button class="cta-btn" id="pay-btn" style="background: linear-gradient(135deg, var(--accent-rose) 0%, var(--accent-purple) 100%); color: #ffffff; box-shadow: var(--glow-rose);">Pay Now</button>
            </div>
        </div>
    `;

    renderView(html);

    const payBtn = document.getElementById('pay-btn');
    const statusSlot = document.getElementById('payment-status-slot');

    payBtn.addEventListener('click', async () => {
        payBtn.disabled = true;
        payBtn.style.display = 'none';
        statusSlot.innerHTML = `<p style="text-align: center; color: var(--primary-cyan);">Processing payment gateway authorization...</p>`;
        
        try {
            const res = await apiRequest(`/api/payment/pay/${state.currentUser.uniqueid}`, 'POST', state.cart);
            statusSlot.innerHTML = `
                <div class="glass-panel animated-view" style="border-color: var(--accent-purple); background: rgba(177, 86, 255, 0.05); text-align: center; padding: 30px;">
                    <h3 style="color: var(--primary-cyan); text-shadow: var(--glow-cyan)">✨ Order Placed Successfully!</h3>
                    <p style="margin-top: 15px; font-size: 1.1rem; color: var(--text-primary)">
                        Order Reference: <strong style="color: var(--accent-purple); font-family: var(--font-heading);">${res.orderid}</strong>
                    </p>
                    <p style="margin-top: 10px; font-size: 0.95rem; color: var(--text-secondary)">
                        Thank you for shopping at Stan's Robot Shop. Your robots will be dispatched shortly.
                    </p>
                    <button class="cta-btn" id="checkout-finished-btn" style="margin-top: 25px;">Back to Storefront</button>
                </div>
            `;

            // Reset local cart state
            state.cart = { total: 0, items: [], tax: 0 };
            updateHeaderAndActions();

            document.getElementById('checkout-finished-btn').addEventListener('click', () => {
                navigateTo('/');
            });
        } catch (e) {
            statusSlot.innerHTML = `<p style="text-align: center; color: var(--accent-rose); font-weight: bold;">Payment processor rejected transaction. Please try again.</p>`;
            payBtn.disabled = false;
            payBtn.style.display = 'inline-block';
        }
    });
}

// --- View 7: Login / Register / Order History Screen ---
async function renderLogin() {
    trackPage('login');
    
    // Check if user is already logged in
    const isLoggedIn = state.currentUser.name && !state.currentUser.uniqueid.startsWith('anonymous');
    
    if (isLoggedIn) {
        renderView(`<h2>Loading account info...</h2>`);
        try {
            const historyRes = await apiRequest(`/api/user/history/${state.currentUser.name}`);
            state.orderHistory = historyRes.history || [];
        } catch (e) {
            console.error('Failed to load history', e);
            state.orderHistory = [];
        }

        let historyRows = state.orderHistory.map(hist => `
            <tr>
                <td style="font-family: var(--font-heading); color: var(--primary-cyan); font-weight: 500;">${hist.orderid}</td>
                <td>
                    <ul style="list-style: none; display: flex; flex-direction: column; gap: 4px;">
                        ${hist.cart.items.map(item => `<li>🤖 ${item.name} (x${item.qty})</li>`).join('')}
                    </ul>
                </td>
                <td class="currency">&euro;${hist.cart.total.toFixed(2)}</td>
            </tr>
        `).join('');

        const html = `
            <div class="glass-panel">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                    <div>
                        <h2>Greetings, ${state.currentUser.name}!</h2>
                        <p style="color: var(--text-secondary); margin-top: 6px;">Logged in email: <strong>${state.currentUser.email}</strong></p>
                    </div>
                    <button class="cta-btn" id="logout-btn" style="background: var(--bg-surface); border: 1px solid var(--accent-rose); color: var(--accent-rose); font-weight: bold;">Logout</button>
                </div>

                <h3 style="margin-top: 40px; color: var(--primary-blue); border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">Order History</h3>
                ${state.orderHistory.length === 0 ? `
                    <p style="color: var(--text-muted); margin-top: 15px;">No previous orders found for this account.</p>
                ` : `
                    <div class="data-table-container">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Order Reference</th>
                                    <th>Items Ordered</th>
                                    <th style="text-align: right;">Total Paid</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${historyRows}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        `;

        renderView(html);

        // Bind logout event
        document.getElementById('logout-btn').addEventListener('click', async () => {
            localStorage.removeItem('robotshop_user');
            state.currentUser = { uniqueid: '', name: '', email: '' };
            
            // Re-init with anonymous session
            await initUserAndCart();
            navigateTo('/login');
        });

        return;
    }

    // Otherwise render Login & Register cards side-by-side
    const html = `
        <div class="auth-grid">
            <!-- Login -->
            <div class="auth-form-card">
                <h3>Sign In</h3>
                <div id="login-error" style="color: var(--accent-rose); font-weight: 500; min-height: 24px; margin-bottom: 12px;"></div>
                
                <form id="login-form-inner">
                    <div class="form-group">
                        <label for="login-name">User Name</label>
                        <input type="text" id="login-name" required autocomplete="username">
                    </div>
                    <div class="form-group">
                        <label for="login-password">Password</label>
                        <input type="password" id="login-password" required autocomplete="current-password">
                    </div>
                    <button type="submit" class="cta-btn" id="login-submit-btn" style="width: 100%; margin-top: 10px;">Login</button>
                </form>
            </div>

            <!-- Register -->
            <div class="auth-form-card">
                <h3>Create Account</h3>
                <div id="register-error" style="color: var(--accent-rose); font-weight: 500; min-height: 24px; margin-bottom: 12px;"></div>
                
                <form id="register-form-inner">
                    <div class="form-group">
                        <label for="reg-name">User Name</label>
                        <input type="text" id="reg-name" required autocomplete="new-username">
                    </div>
                    <div class="form-group">
                        <label for="reg-email">Email Address</label>
                        <input type="email" id="reg-email" required autocomplete="email">
                    </div>
                    <div class="form-group">
                        <label for="reg-password">Password</label>
                        <input type="password" id="reg-password" required autocomplete="new-password">
                    </div>
                    <div class="form-group">
                        <label for="reg-confirm">Confirm Password</label>
                        <input type="password" id="reg-confirm" required autocomplete="new-password">
                    </div>
                    <button type="submit" class="cta-btn" id="register-submit-btn" style="width: 100%; margin-top: 10px; background: linear-gradient(135deg, var(--accent-purple) 0%, var(--primary-blue) 100%); color: #ffffff;">Register Account</button>
                </form>
            </div>
        </div>
    `;

    renderView(html);

    const loginForm = document.getElementById('login-form-inner');
    const loginError = document.getElementById('login-error');
    const loginSubmitBtn = document.getElementById('login-submit-btn');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.textContent = '';
        loginSubmitBtn.disabled = true;

        const name = document.getElementById('login-name').value.trim();
        const password = document.getElementById('login-password').value;

        try {
            const res = await apiRequest('/api/user/login', 'POST', { name, password });
            
            // Success
            const oldUniqueid = state.currentUser.uniqueid;
            state.currentUser = {
                uniqueid: res.name,
                name: res.name,
                email: res.email
            };
            
            // Save user session
            localStorage.setItem('robotshop_user', JSON.stringify(state.currentUser));
            trackUser(res.name, res.name, res.email);

            // Relocate / merge anonymous cart to user's name
            try {
                await apiRequest(`/api/cart/rename/${oldUniqueid}/${res.name}`);
            } catch (cartErr) {
                console.log('No anonymous cart to transfer or error migrating cart:', cartErr);
            }

            // Sync cart state
            await fetchCart();
            showToast(`Logged in as ${res.name}`);
            navigateTo('/login');

        } catch (err) {
            loginError.textContent = 'Invalid user credentials. Please try again.';
            loginSubmitBtn.disabled = false;
        }
    });

    const registerForm = document.getElementById('register-form-inner');
    const registerError = document.getElementById('register-error');
    const registerSubmitBtn = document.getElementById('register-submit-btn');

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        registerError.textContent = '';
        
        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        const confirm = document.getElementById('reg-confirm').value;

        if (password !== confirm) {
            registerError.textContent = 'Passwords do not match';
            return;
        }

        registerSubmitBtn.disabled = true;

        try {
            await apiRequest('/api/user/register', 'POST', { name, email, password });
            
            // Registered successfully, auto login
            state.currentUser = {
                uniqueid: name,
                name: name,
                email: email
            };
            localStorage.setItem('robotshop_user', JSON.stringify(state.currentUser));
            trackUser(name, name, email);
            
            showToast('Registered account successfully!');
            navigateTo('/login');

        } catch (err) {
            registerError.textContent = 'Registration failed. Username may be taken.';
            registerSubmitBtn.disabled = false;
        }
    });
}

// --- App Entry Point ---
document.addEventListener('DOMContentLoaded', async () => {
    setupSearch();
    
    // Parallel load initial metadata
    await Promise.all([
        initUserAndCart(),
        fetchCategories()
    ]);

    // Initial sidebar render
    await renderSidebar();
    
    // Resolve router path
    route();
});
