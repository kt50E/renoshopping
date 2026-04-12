// ===== RenoTracker App =====

(function () {
  'use strict';

  // --- Storage Helpers (localStorage fallback) ---
  const Storage = {
    get(key, fallback = null) {
      try {
        const val = localStorage.getItem('reno_' + key);
        return val ? JSON.parse(val) : fallback;
      } catch { return fallback; }
    },
    set(key, value) {
      localStorage.setItem('reno_' + key, JSON.stringify(value));
    },
    remove(key) {
      localStorage.removeItem('reno_' + key);
    }
  };

  // --- Firebase Init ---
  const firebaseConfig = {
    apiKey: "AIzaSyD7Xqxh6d9CcDlFe9jKOTUv8BMx_5nU3fE",
    authDomain: "renotracker-bbaa2.firebaseapp.com",
    projectId: "renotracker-bbaa2",
    storageBucket: "renotracker-bbaa2.firebasestorage.app",
    messagingSenderId: "1099101874698",
    appId: "1:1099101874698:web:af6a1f4f51e5efc23acdf3"
  };

  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();
  const auth = firebase.auth();
  const googleProvider = new firebase.auth.GoogleAuthProvider();

  // Only these Google accounts can access the app
  const ALLOWED_EMAILS = [
    'turajanek@gmail.com',
    'stevenho413@gmail.com'
  ];

  // --- Firestore Helpers ---
  const Firestore = {
    async loadCollection(name) {
      try {
        const snapshot = await db.collection(name).get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (err) {
        console.warn('Firestore load failed for', name, err);
        return null; // signals caller to use localStorage fallback
      }
    },
    async saveCollection(name, items) {
      try {
        const batch = db.batch();
        // Get all existing docs to detect deletions
        const snapshot = await db.collection(name).get();
        const existingIds = new Set(snapshot.docs.map(d => d.id));
        const newIds = new Set(items.map(i => i.id));

        // Delete docs that no longer exist locally
        snapshot.docs.forEach(doc => {
          if (!newIds.has(doc.id)) batch.delete(doc.ref);
        });

        // Set (upsert) all current items
        items.forEach(item => {
          const docRef = db.collection(name).doc(item.id);
          const data = { ...item };
          delete data.id; // id is the doc key, not a field
          batch.set(docRef, data);
        });

        await batch.commit();
      } catch (err) {
        console.warn('Firestore save failed for', name, err);
      }
    }
  };

  // --- UUID ---
  function uuid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  // --- Format Currency ---
  function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  }

  // --- Thumbnail Helper ---
  const MATERIAL_ICONS = {
    'Flooring':    '⬡', // hexagon
    'Lighting':    '☀',
    'Paint & Finishes': '◐',
    'Hardware':    '⚙',
    'Plumbing':    '◉',
    'Furniture':   '▣',
    'Tiles':       '▦',
    'Textiles':    '≋',
    'Decor & Accessories': '✦',
    'Appliances':  '⊞',
    'Storage & Organization': '⊟',
    'Samples':     '◈',
    'Other':       '○'
  };

  function renderThumbnail(item) {
    if (item.imageUrl) {
      return `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" class="item-thumbnail" loading="lazy" data-full-src="${escapeHtml(item.imageUrl)}">`;
    }
    const icon = MATERIAL_ICONS[item.material] || '○';
    return `<div class="item-thumbnail-placeholder"><span class="placeholder-icon">${icon}</span></div>`;
  }

  // --- Firebase Auth ---
  const lockScreen = document.getElementById('lock-screen');
  const appEl = document.getElementById('app');
  const lockError = document.getElementById('lock-error');
  const lockBtn = document.getElementById('lock-btn');
  const googleSignInBtn = document.getElementById('google-sign-in-btn');

  function showApp() {
    lockScreen.hidden = true;
    appEl.hidden = false;
    const lastTab = Storage.get('activeTab', 'dashboard');
    switchTab(lastTab);
    renderAll();
  }

  function showLockScreen() {
    lockScreen.hidden = false;
    appEl.hidden = true;
    lockError.hidden = true;
  }

  // Google sign-in button
  googleSignInBtn.addEventListener('click', () => {
    lockError.hidden = true;
    auth.signInWithPopup(googleProvider).catch((error) => {
      console.error('Sign-in error:', error);
      if (error.code !== 'auth/popup-closed-by-user') {
        lockError.textContent = 'Sign-in failed. Please try again.';
        lockError.hidden = false;
      }
    });
  });

  // Sign-out button
  lockBtn.addEventListener('click', () => {
    auth.signOut();
  });

  // Auth state listener — handles sign-in, sign-out, and page reload
  auth.onAuthStateChanged((user) => {
    if (user) {
      if (ALLOWED_EMAILS.includes(user.email.toLowerCase())) {
        // Authorized user — load data and show app
        initData().then(() => showApp());
      } else {
        // Unauthorized user — show error and sign them out
        lockError.textContent = 'Access denied. This account (' + user.email + ') is not authorized.';
        lockError.hidden = false;
        auth.signOut();
      }
    } else {
      // No user signed in — show lock screen
      showLockScreen();
    }
  });

  // --- Tab Navigation ---
  const navBtns = document.querySelectorAll('.sidebar-nav-btn');
  const tabs = document.querySelectorAll('.tab-content');
  const topbarTitle = document.getElementById('topbar-title');

  const tabTitles = {
    dashboard: 'Budget Dashboard',
    expenses: 'Spending Summary',
    shopping: 'Wishlist',
    purchased: 'Purchased History',
    timeline: 'Timeline'
  };

  function switchTab(tabName) {
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    tabs.forEach(t => {
      t.hidden = t.id !== 'tab-' + tabName;
      if (!t.hidden) t.classList.add('active');
      else t.classList.remove('active');
    });
    topbarTitle.innerHTML = `<span class="topbar-breadcrumb">RenoTracker</span> <span class="topbar-sep">›</span> ${tabTitles[tabName] || tabName}`;
    Storage.set('activeTab', tabName);
  }

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
      // Close mobile sidebar
      document.querySelector('.sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay').classList.remove('open');
    });
  });

  // --- Mobile Menu ---
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.querySelector('.sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      sidebarOverlay.classList.toggle('open');
    });
    sidebarOverlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('open');
    });
  }

  // --- Modal Helpers ---
  function openModal(modalEl) {
    modalEl.hidden = false;
  }
  function closeModal(modalEl) {
    modalEl.hidden = true;
  }

  document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal');
      closeModal(modal);
    });
  });

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  // ============================
  // BUDGET (single total)
  // ============================
  let totalBudgetAmount = 0;

  const editBudgetBtn = document.getElementById('edit-budget-btn');
  const budgetModal = document.getElementById('budget-modal');
  const budgetForm = document.getElementById('budget-form');
  const budgetProgress = document.getElementById('budget-progress');

  function saveBudget() {
    Storage.set('totalBudget', totalBudgetAmount);
    Firestore.saveCollection('budgets', [{ id: 'total', amount: totalBudgetAmount }]);
  }

  function renderBudgets() {
    const totalSpent = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const remaining = totalBudgetAmount - totalSpent;

    // Motivational message
    const msg = getBudgetMessage();
    document.getElementById('budget-message').innerHTML =
      `<span class="budget-message-icon">${msg.icon}</span> ${escapeHtml(msg.text)}`;

    document.getElementById('total-budget').textContent = formatCurrency(totalBudgetAmount);
    document.getElementById('total-spent').textContent = formatCurrency(totalSpent);

    const remEl = document.getElementById('total-remaining');
    remEl.textContent = formatCurrency(remaining);
    remEl.className = 'hero-value ' + (remaining < 0 ? 'over-budget' : 'under-budget');

    if (totalBudgetAmount === 0) {
      budgetProgress.innerHTML = '<p class="budget-progress-hint">Set a total budget above to start tracking your spending.</p>';
      return;
    }

    const pct = Math.min((totalSpent / totalBudgetAmount) * 100, 100);
    const actualPct = ((totalSpent / totalBudgetAmount) * 100).toFixed(1);
    const over = totalSpent > totalBudgetAmount;

    budgetProgress.innerHTML = `
      <div class="budget-progress-header">
        <span class="budget-progress-label">${formatCurrency(totalSpent)} spent of ${formatCurrency(totalBudgetAmount)}</span>
        <span class="budget-progress-percent" style="color:${over ? 'var(--danger)' : 'var(--success)'}">${actualPct}%</span>
      </div>
      <div class="budget-bar-track">
        <div class="budget-bar-fill ${over ? 'over' : ''}" style="width:${pct}%"></div>
      </div>
    `;
    // Trigger shimmer pulse on each render so a budget/spend change feels alive
    const fill = budgetProgress.querySelector('.budget-bar-fill');
    if (fill) {
      // Force reflow so the class re-application restarts the animation
      requestAnimationFrame(() => {
        fill.classList.add('pulse');
        setTimeout(() => fill.classList.remove('pulse'), 1100);
      });
    }
  }

  editBudgetBtn.addEventListener('click', () => {
    document.getElementById('budget-amount').value = totalBudgetAmount || '';
    openModal(budgetModal);
  });

  budgetForm.addEventListener('submit', (e) => {
    e.preventDefault();
    totalBudgetAmount = parseFloat(document.getElementById('budget-amount').value) || 0;
    saveBudget();
    closeModal(budgetModal);
    renderAll();
  });

  // ============================
  // SORT HELPERS
  // ============================
  let shoppingSort = { key: null, dir: 'asc' };

  function updateSortHeaders(tableSelector, sortState) {
    document.querySelectorAll(`${tableSelector} th.sortable`).forEach(th => {
      const isActive = th.dataset.sort === sortState.key;
      th.classList.toggle('sort-active', isActive);
      const arrow = th.querySelector('.sort-arrow');
      if (arrow) {
        arrow.textContent = isActive ? (sortState.dir === 'asc' ? '▲' : '▼') : '▲▼';
      }
    });
  }

  function toggleSort(sortState, key) {
    if (sortState.key === key) {
      sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
      sortState.key = key;
      sortState.dir = 'asc';
    }
  }

  // ============================
  // EXPENSES
  // ============================
  let expenses = [];

  const addExpenseBtn = document.getElementById('add-expense-btn');
  const expenseModal = document.getElementById('expense-modal');
  const expenseForm = document.getElementById('expense-form');
  const expenseModalTitle = document.getElementById('expense-modal-title');
  const expenseGroupsEl = document.getElementById('expense-groups');
  const expenseFilterCat = document.getElementById('expense-filter-category');
  const expenseFilterMonth = document.getElementById('expense-filter-month');
  const expenseSearch = document.getElementById('expense-search');
  const expenseClearBtn = document.getElementById('expense-clear-filters');
  const expenseStatsCount = document.getElementById('expense-stats-count');
  const expenseStatsTotal = document.getElementById('expense-stats-total');

  function saveExpenses() {
    Storage.set('expenses', expenses);
    Firestore.saveCollection('expenses', expenses);
  }

  const expenseCategorySelect = document.getElementById('expense-category');
  const expenseCategoryCustom = document.getElementById('expense-category-custom');

  expenseCategorySelect.addEventListener('change', () => {
    if (expenseCategorySelect.value === 'custom') {
      expenseCategoryCustom.style.display = '';
      expenseCategoryCustom.focus();
    } else {
      expenseCategoryCustom.style.display = 'none';
      expenseCategoryCustom.value = '';
    }
  });

  function getExpenseCategoryValue() {
    return expenseCategorySelect.value === 'custom'
      ? expenseCategoryCustom.value.trim()
      : expenseCategorySelect.value;
  }

  function setExpenseCategoryValue(name) {
    const option = Array.from(expenseCategorySelect.options).find(o => o.value === name);
    if (option) {
      expenseCategorySelect.value = name;
      expenseCategoryCustom.style.display = 'none';
      expenseCategoryCustom.value = '';
    } else {
      expenseCategorySelect.value = 'custom';
      expenseCategoryCustom.style.display = '';
      expenseCategoryCustom.value = name;
    }
  }

  // Build the Month dropdown options from existing expense dates.
  // Options are sorted newest-first; values are 'YYYY-MM' so they sort lexically.
  function refreshMonthFilterOptions() {
    const months = new Set();
    expenses.forEach(e => {
      if (e.date && /^\d{4}-\d{2}/.test(e.date)) months.add(e.date.slice(0, 7));
    });
    const sorted = Array.from(months).sort().reverse();
    const current = expenseFilterMonth.value;
    const labelFor = (ym) => {
      const [y, m] = ym.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    };
    expenseFilterMonth.innerHTML = '<option value="">All months</option>' +
      sorted.map(ym => `<option value="${ym}">${labelFor(ym)}</option>`).join('');
    // Preserve user selection if still valid
    if (current && sorted.includes(current)) expenseFilterMonth.value = current;
  }

  function renderExpenses() {
    refreshMonthFilterOptions();

    const filterCat   = expenseFilterCat.value;
    const filterMonth = expenseFilterMonth.value;
    const search      = expenseSearch.value.toLowerCase();
    const hasFilters  = !!(filterCat || filterMonth || search);
    expenseClearBtn.hidden = !hasFilters;

    let filtered = expenses;
    if (filterCat)   filtered = filtered.filter(e => e.category === filterCat);
    if (filterMonth) filtered = filtered.filter(e => (e.date || '').startsWith(filterMonth));
    if (search) filtered = filtered.filter(e =>
      (e.description || '').toLowerCase().includes(search) ||
      (e.category || '').toLowerCase().includes(search) ||
      (e.notes || '').toLowerCase().includes(search)
    );

    // Stats reflect what's currently visible.
    const totalAmount = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);
    expenseStatsCount.textContent = filtered.length + (filtered.length === 1 ? ' expense' : ' expenses');
    expenseStatsTotal.textContent = formatCurrency(totalAmount) + ' total';

    if (filtered.length === 0) {
      expenseGroupsEl.innerHTML = '<div class="empty-row">No expenses match these filters. Try clearing them.</div>';
      return;
    }

    // Group by YYYY-MM (newest month first; rows within month newest first)
    const groups = {};
    filtered.forEach(e => {
      const key = (e.date || '').slice(0, 7) || 'unknown';
      (groups[key] = groups[key] || []).push(e);
    });
    const groupKeys = Object.keys(groups).sort().reverse();

    const monthLabel = (key) => {
      if (key === 'unknown') return 'No date';
      const [y, m] = key.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    };

    expenseGroupsEl.innerHTML = groupKeys.map(key => {
      const items = groups[key].slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const subtotal = items.reduce((s, e) => s + Number(e.amount || 0), 0);
      return `
        <div class="expense-group">
          <div class="expense-group-header">
            <span class="expense-group-title">${escapeHtml(monthLabel(key))}</span>
            <span class="expense-group-total">${formatCurrency(subtotal)}</span>
          </div>
          <div class="expense-group-body">
            ${items.map(e => renderExpenseRow(e)).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Wire up row events
    expenseGroupsEl.querySelectorAll('.edit-expense').forEach(btn => {
      btn.addEventListener('click', () => editExpense(btn.closest('.expense-row').dataset.id));
    });
    expenseGroupsEl.querySelectorAll('.delete-expense').forEach(btn => {
      btn.addEventListener('click', () => deleteExpense(btn.closest('.expense-row').dataset.id));
    });
  }

  function renderExpenseRow(e) {
    const d = e.date ? parseDateLocal(e.date) : null;
    const dayNum  = d ? d.getDate() : '—';
    const dayName = d ? d.toLocaleDateString('en-US', { weekday: 'short' }) : '';
    return `
      <div class="expense-row" data-id="${e.id}">
        <div class="expense-day-col">
          <div class="expense-day-num">${dayNum}</div>
          <div class="expense-day-name">${dayName}</div>
        </div>
        <div class="expense-info">
          <div class="expense-desc-line">
            <span class="expense-desc">${escapeHtml(e.description || 'Untitled')}</span>
            <span class="expense-cat-pill">${escapeHtml(e.category || 'Uncategorized')}</span>
          </div>
          ${e.notes ? `<div class="expense-notes-text">${escapeHtml(e.notes)}</div>` : ''}
        </div>
        <div class="expense-amount-cell">${formatCurrency(e.amount)}</div>
        <div class="expense-actions">
          <button class="btn-icon edit-expense" aria-label="Edit expense" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn-icon delete-expense" aria-label="Delete expense" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>
        </div>
      </div>
    `;
  }

  addExpenseBtn.addEventListener('click', () => {
    expenseModalTitle.textContent = 'Add Expense';
    expenseForm.reset();
    document.getElementById('expense-id').value = '';
    document.getElementById('expense-date').value = new Date().toISOString().split('T')[0];
    expenseCategoryCustom.style.display = 'none';
    expenseCategoryCustom.value = '';
    openModal(expenseModal);
  });

  function editExpense(id) {
    const e = expenses.find(x => x.id === id);
    if (!e) return;
    expenseModalTitle.textContent = 'Edit Expense';
    document.getElementById('expense-date').value = e.date;
    document.getElementById('expense-desc').value = e.description;
    setExpenseCategoryValue(e.category);
    document.getElementById('expense-amount').value = e.amount;
    document.getElementById('expense-notes').value = e.notes || '';
    document.getElementById('expense-id').value = e.id;
    openModal(expenseModal);
  }

  function deleteExpense(id) {
    if (!confirm('Delete this expense?')) return;
    expenses = expenses.filter(e => e.id !== id);
    saveExpenses();
    renderAll();
  }

  expenseForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('expense-id').value;
    const data = {
      date: document.getElementById('expense-date').value,
      description: document.getElementById('expense-desc').value.trim(),
      category: getExpenseCategoryValue(),
      amount: parseFloat(document.getElementById('expense-amount').value),
      notes: document.getElementById('expense-notes').value.trim()
    };

    if (id) {
      const exp = expenses.find(x => x.id === id);
      if (exp) Object.assign(exp, data);
    } else {
      expenses.push({ id: uuid(), ...data });
    }

    saveExpenses();
    closeModal(expenseModal);
    renderAll();
  });

  expenseFilterCat.addEventListener('change', renderExpenses);
  expenseFilterMonth.addEventListener('change', renderExpenses);
  expenseSearch.addEventListener('input', renderExpenses);
  expenseClearBtn.addEventListener('click', () => {
    expenseFilterCat.value = '';
    expenseFilterMonth.value = '';
    expenseSearch.value = '';
    renderExpenses();
  });

  // ============================
  // SHOPPING LIST
  // ============================
  let shoppingItems = [];

  const addItemBtn = document.getElementById('add-item-btn');
  const itemModal = document.getElementById('item-modal');
  const itemForm = document.getElementById('item-form');
  const itemModalTitle = document.getElementById('item-modal-title');
  const shoppingBody = document.getElementById('shopping-body');
  const shoppingTableWrapper = document.getElementById('shopping-table-wrapper');
  const shoppingFilterRoom = document.getElementById('shopping-filter-room');
  const shoppingFilterMaterial = document.getElementById('shopping-filter-material');
  const shoppingTotal = document.getElementById('shopping-total');
  const itemStatus = document.getElementById('item-status');
  const purchaseDateGroup = document.getElementById('purchase-date-group');
  const itemPurchaseDate = document.getElementById('item-purchase-date');

  function togglePurchaseDate() {
    if (itemStatus.value === 'Purchased') {
      purchaseDateGroup.hidden = false;
      if (!itemPurchaseDate.value) {
        itemPurchaseDate.value = new Date().toISOString().split('T')[0];
      }
    } else {
      purchaseDateGroup.hidden = true;
    }
  }

  itemStatus.addEventListener('change', togglePurchaseDate);

  function saveShoppingItems() {
    Storage.set('shopping', shoppingItems);
    Firestore.saveCollection('shopping', shoppingItems);
  }

  function syncExpenseFromItem(item) {
    // Remove any existing linked expense
    expenses = expenses.filter(e => e.shoppingItemId !== item.id);

    // If purchased, create a new expense
    if (item.status === 'Purchased') {
      const total = (item.qty || 1) * (item.price || 0);
      expenses.push({
        id: uuid(),
        shoppingItemId: item.id,
        date: item.purchaseDate || new Date().toISOString().split('T')[0],
        description: item.name,
        category: item.room || '',
        amount: total,
        notes: [item.vendor ? `Vendor: ${item.vendor}` : '', item.material ? `Type: ${item.material}` : '', item.notes || ''].filter(Boolean).join(' | ')
      });
    }

    saveExpenses();
  }

  function renderShopping() {
    const filterRoom = shoppingFilterRoom.value;
    const filterMaterial = shoppingFilterMaterial.value;

    // Wishlist tab only shows non-purchased items. Purchased items
    // live in their own (forthcoming) Purchased History view.
    let filtered = shoppingItems.filter(i => !i.purchased);
    if (filterRoom) filtered = filtered.filter(i => i.room === filterRoom);
    if (filterMaterial) filtered = filtered.filter(i => i.material === filterMaterial);

    // Sort
    if (shoppingSort.key) {
      const sDir = shoppingSort.dir === 'asc' ? 1 : -1;
      filtered.sort((a, b) => {
        if (shoppingSort.key === 'name') {
          return sDir * (a.name || '').localeCompare(b.name || '');
        } else if (shoppingSort.key === 'room') {
          return sDir * (a.room || '').localeCompare(b.room || '');
        } else if (shoppingSort.key === 'total') {
          return sDir * (((a.qty || 1) * (a.price || 0)) - ((b.qty || 1) * (b.price || 0)));
        }
        return 0;
      });
    }

    updateSortHeaders('#tab-shopping', shoppingSort);

    if (filtered.length === 0) {
      shoppingBody.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-illustration">
            <svg viewBox="0 0 140 110" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M70 6 Q60 14 56 22" stroke-width="1.5" opacity="0.6"/>
              <path d="M52 22 L96 22 Q104 22 109 28 L130 52 Q134 56 130 60 L100 90 Q96 94 92 90 L42 40 Q38 36 42 32 L48 26 Q50 22 52 22 Z" fill="var(--primary-light)" stroke="currentColor"/>
              <circle cx="58" cy="32" r="3.5" fill="white" stroke="currentColor"/>
              <path d="M82 50 C 78 46 72 46 72 52 C 72 58 82 66 82 66 C 82 66 92 58 92 52 C 92 46 86 46 82 50 Z" fill="white" stroke="currentColor" stroke-width="1.8"/>
              <path d="M22 18 L22 26 M18 22 L26 22" stroke-width="1.5" opacity="0.55"/>
              <path d="M120 88 L120 96 M116 92 L124 92" stroke-width="1.5" opacity="0.55"/>
            </svg>
          </div>
          <h3 class="empty-state-title">Start your wishlist</h3>
          <p class="empty-state-text">Save the things you're considering before you commit.</p>
          <button type="button" class="btn btn-primary" onclick="document.getElementById('add-item-btn').click()">+ Add your first item</button>
        </div>`;
    } else {
      // Group by room
      const groups = {};
      filtered.forEach(item => {
        const key = item.room || 'No room';
        (groups[key] = groups[key] || []).push(item);
      });
      const roomKeys = Object.keys(groups).sort((a, b) => {
        if (a === 'No room') return 1;
        if (b === 'No room') return -1;
        return a.localeCompare(b);
      });

      shoppingBody.innerHTML = roomKeys.map(room => {
        const items = groups[room];
        const subtotal = items.reduce((s, i) => s + (i.qty || 1) * (i.price || 0), 0);
        const countLabel = items.length + (items.length === 1 ? ' item' : ' items');

        const rows = items.map(item => {
          const total = (item.qty || 1) * (item.price || 0);
          // Count how many detail fields are filled
          const filledFields = [item.material, item.vendor, item.price, item.room].filter(Boolean).length;
          const isSparse = filledFields < 3;

          if (isSparse) {
            // Sparse row: thumbnail + name + whatever details exist, compact
            const details = [];
            if (item.material) details.push(escapeHtml(item.material));
            if (item.vendor) details.push(escapeHtml(item.vendor));
            if (total > 0) details.push(formatCurrency(total));
            const detailStr = details.length ? `<span class="producto-detail-inline">${details.join(' · ')}</span>` : '';

            return `
              <div class="producto-row producto-row-sparse" data-id="${item.id}">
                <div class="producto-thumb">${renderThumbnail(item)}</div>
                <div class="producto-info">
                  <span class="producto-name">${escapeHtml(item.name || 'Untitled')}</span>
                  ${detailStr}
                </div>
                <div class="producto-status"><span class="status-dot status-wishlist"></span> Wishlist</div>
                <div class="producto-actions">
                  <button class="btn-icon edit-item" aria-label="Edit" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                  <button class="btn-icon delete-item" aria-label="Delete" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>
                </div>
              </div>`;
          }

          // Full row: all columns visible
          return `
            <div class="producto-row" data-id="${item.id}">
              <div class="producto-thumb">${renderThumbnail(item)}</div>
              <div class="producto-info">
                <span class="producto-name">${escapeHtml(item.name || 'Untitled')}</span>
                <span class="producto-brand">${escapeHtml(item.vendor || '')}</span>
              </div>
              <div class="producto-col producto-type">${escapeHtml(item.material || '')}</div>
              <div class="producto-col producto-qty">${item.qty || 1}</div>
              <div class="producto-col producto-price">${total > 0 ? formatCurrency(total) : ''}</div>
              <div class="producto-col producto-link">${item.link ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">Link</a>` : ''}</div>
              <div class="producto-status"><span class="status-dot status-wishlist"></span> Wishlist</div>
              <div class="producto-actions">
                <button class="btn-icon edit-item" aria-label="Edit" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="btn-icon delete-item" aria-label="Delete" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>
              </div>
            </div>`;
        }).join('');

        return `
          <div class="producto-group">
            <div class="producto-group-header">
              <span class="producto-group-title">${escapeHtml(room)}</span>
              <span class="producto-group-meta">${countLabel} · ${formatCurrency(subtotal)}</span>
            </div>
            ${rows}
          </div>`;
      }).join('');
    }

    // Wishlist total
    const wishlistTotal = shoppingItems
      .filter(i => !i.purchased)
      .reduce((s, i) => s + (i.qty || 1) * (i.price || 0), 0);
    shoppingTotal.textContent = `Wishlist Total: ${formatCurrency(wishlistTotal)}`;

    // Events
    shoppingBody.querySelectorAll('.edit-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.closest('.producto-row').dataset.id;
        editItem(id);
      });
    });
    shoppingBody.querySelectorAll('.delete-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.closest('.producto-row').dataset.id;
        deleteItem(id);
      });
    });
    shoppingBody.querySelectorAll('.item-thumbnail').forEach(img => {
      img.addEventListener('click', () => {
        openLightbox(img.dataset.fullSrc);
      });
    });
  }

  addItemBtn.addEventListener('click', () => {
    itemModalTitle.textContent = 'Add to Wishlist';
    itemForm.reset();
    document.getElementById('item-id').value = '';
    purchaseDateGroup.hidden = true;
    itemPurchaseDate.value = '';
    resetImageUpload();
    openModal(itemModal);
  });

  function editItem(id) {
    const item = shoppingItems.find(x => x.id === id);
    if (!item) return;
    itemModalTitle.textContent = 'Edit Wishlist Item';
    document.getElementById('item-name').value = item.name;
    document.getElementById('item-room').value = item.room || '';
    document.getElementById('item-material').value = item.material || '';
    document.getElementById('item-vendor').value = item.vendor || '';
    document.getElementById('item-qty').value = item.qty || 1;
    document.getElementById('item-price').value = item.price || '';
    document.getElementById('item-link').value = item.link || '';
    document.getElementById('item-status').value = item.status || 'Wishlist';
    document.getElementById('item-notes').value = item.notes || '';
    document.getElementById('item-id').value = item.id;
    itemPurchaseDate.value = item.purchaseDate || '';
    togglePurchaseDate();

    // Load existing image
    resetImageUpload();
    if (item.imageUrl) {
      existingImageUrl = item.imageUrl;
      showImagePreview(item.imageUrl);
    }

    openModal(itemModal);
  }

  function deleteItem(id) {
    if (!confirm('Delete this item?')) return;
    shoppingItems = shoppingItems.filter(i => i.id !== id);
    expenses = expenses.filter(e => e.shoppingItemId !== id);
    saveShoppingItems();
    saveExpenses();
    renderAll();
  }

  itemForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const id = document.getElementById('item-id').value;
    const data = {
      name: document.getElementById('item-name').value.trim(),
      room: document.getElementById('item-room').value,
      material: document.getElementById('item-material').value,
      vendor: document.getElementById('item-vendor').value.trim(),
      qty: parseInt(document.getElementById('item-qty').value) || 1,
      price: parseFloat(document.getElementById('item-price').value) || 0,
      link: document.getElementById('item-link').value.trim(),
      status: document.getElementById('item-status').value,
      notes: document.getElementById('item-notes').value.trim(),
      purchaseDate: itemStatus.value === 'Purchased' ? itemPurchaseDate.value : ''
    };

    let savedItem;
    let wasPurchased = false;
    if (id) {
      savedItem = shoppingItems.find(x => x.id === id);
      wasPurchased = !!(savedItem && savedItem.purchased);
      if (savedItem) Object.assign(savedItem, data);
    } else {
      savedItem = { id: uuid(), purchased: data.status === 'Purchased', ...data };
      shoppingItems.push(savedItem);
    }
    savedItem.purchased = savedItem.status === 'Purchased';

    // Handle image data
    if (pendingImageData) {
      savedItem.imageUrl = pendingImageData;
    } else if (imageRemoved) {
      savedItem.imageUrl = '';
    }

    // Only celebrate the transition from wishlist -> purchased (not every save)
    const justPurchased = savedItem.purchased && !wasPurchased;
    saveShoppingItems();
    syncExpenseFromItem(savedItem);
    closeModal(itemModal);
    renderAll();
    if (justPurchased) launchConfetti();
  });

  shoppingFilterRoom.addEventListener('change', renderShopping);
  shoppingFilterMaterial.addEventListener('change', renderShopping);

  document.querySelectorAll('#tab-shopping th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      toggleSort(shoppingSort, th.dataset.sort);
      renderShopping();
    });
  });

  // ============================
  // RENDER ALL
  // ============================
  // ============================
  // CONFETTI
  // ============================
  function launchConfetti() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    const colors = ['#A8C5B0', '#FFD700', '#FFC0CB', '#6C63FF', '#F59E0B', '#EC4899', '#14B8A6'];
    const pieces = [];

    for (let i = 0; i < 80; i++) {
      pieces.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 200,
        y: canvas.height / 2,
        vx: (Math.random() - 0.5) * 16,
        vy: Math.random() * -14 - 4,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 12,
        shape: Math.random() > 0.5 ? 'rect' : 'circle',
        opacity: 1
      });
    }

    let frame = 0;
    const maxFrames = 90;

    function animate() {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      pieces.forEach(p => {
        p.x += p.vx;
        p.vy += 0.35;
        p.y += p.vy;
        p.rotation += p.rotSpeed;
        p.opacity = Math.max(0, 1 - (frame / maxFrames));

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;

        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });

      if (frame < maxFrames) {
        requestAnimationFrame(animate);
      } else {
        canvas.remove();
      }
    }
    requestAnimationFrame(animate);
  }

  // ============================
  // MOTIVATIONAL MESSAGES
  // ============================
  function getBudgetMessage() {
    const totalSpent = expenses.reduce((s, e) => s + Number(e.amount), 0);

    if (totalBudgetAmount === 0 && totalSpent === 0) {
      return { text: "Fresh start! Let's make this house a home.", icon: "🏡" };
    }
    if (totalBudgetAmount === 0 && totalSpent > 0) {
      return { text: "You're spending — set a budget to keep track!", icon: "📋" };
    }

    const pct = (totalSpent / totalBudgetAmount) * 100;

    if (pct === 0) return { text: "Budget set! Time to make some moves.", icon: "🎯" };
    if (pct < 25) return { text: "Off to a great start — plenty of room!", icon: "🌱" };
    if (pct < 50) return { text: "Looking good! Plenty of room to breathe.", icon: "😊" };
    if (pct < 75) return { text: "Making moves! Keep an eye on the finish line.", icon: "🏃" };
    if (pct < 90) return { text: "Getting close — every dollar counts now!", icon: "👀" };
    if (pct < 100) return { text: "Almost at the limit... choose wisely!", icon: "🤞" };
    return { text: "Over budget — but hey, renovations have a mind of their own!", icon: "🙈" };
  }

  // ============================
  // SPENDING CHARTS
  // ============================
  const CHART_COLORS = [
    '#A8C5B0', '#6C63FF', '#F59E0B', '#EC4899', '#14B8A6',
    '#8B5CF6', '#EF4444', '#3B82F6', '#F97316', '#06B6D4',
    '#84CC16', '#E879F9', '#FB923C', '#2DD4BF', '#A78BFA'
  ];

  function getSpendingByCategory() {
    const map = {};
    expenses.forEach(e => {
      const cat = e.category || 'Uncategorized';
      map[cat] = (map[cat] || 0) + Number(e.amount);
    });
    // Sort by amount descending
    return Object.entries(map)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  function renderCharts() {
    const chartsEl = document.getElementById('spending-charts');
    const categories = getSpendingByCategory();
    const totalSpent = categories.reduce((s, c) => s + c.amount, 0);

    if (categories.length === 0) {
      chartsEl.hidden = true;
      return;
    }
    chartsEl.hidden = false;

    // --- Roll up tiny categories into "Other" so the donut stays legible.
    // Anything below 2% of total gets grouped, but only when 2+ such
    // categories exist (a single small wedge keeps its own identity).
    const SMALL_THRESHOLD = 0.02;
    const OTHER_COLOR = '#B8AEA0'; // warm neutral that doesn't compete with sage
    const smallIndices = [];
    categories.forEach((cat, i) => {
      const pct = totalSpent > 0 ? cat.amount / totalSpent : 0;
      if (pct < SMALL_THRESHOLD) smallIndices.push(i);
    });
    const shouldRollUp = smallIndices.length >= 2;

    // donutWedges: what the donut chart actually draws.
    // originalToDonut: maps original category index -> donut wedge index
    // (used for hover sync between full legend and rolled-up donut).
    const donutWedges = [];
    const originalToDonut = new Array(categories.length);
    const smallSet = shouldRollUp ? new Set(smallIndices) : new Set();

    categories.forEach((cat, i) => {
      if (smallSet.has(i)) return;
      const wedgeIdx = donutWedges.length;
      donutWedges.push({
        name: cat.name,
        amount: cat.amount,
        color: CHART_COLORS[wedgeIdx % CHART_COLORS.length]
      });
      originalToDonut[i] = wedgeIdx;
    });
    if (smallSet.size > 0) {
      const otherIndices = [...smallSet];
      const otherTotal = otherIndices.reduce((s, i) => s + categories[i].amount, 0);
      const otherNames = otherIndices.map(i => categories[i].name).join(', ');
      const otherWedgeIdx = donutWedges.length;
      donutWedges.push({
        name: `Other (${otherIndices.length})`,
        tooltipName: `Other: ${otherNames}`,
        amount: otherTotal,
        color: OTHER_COLOR
      });
      otherIndices.forEach(i => { originalToDonut[i] = otherWedgeIdx; });
    }

    // --- Donut Chart (SVG) ---
    const donutSvg = document.getElementById('donut-chart');
    const donutLegend = document.getElementById('donut-legend');
    const donutCenterAmount = document.getElementById('donut-center-amount');
    const radius = 84;
    const circumference = 2 * Math.PI * radius;

    donutCenterAmount.textContent = formatCurrency(totalSpent);

    let segments = '';
    let offset = 0;
    const segmentData = [];

    donutWedges.forEach((wedge, i) => {
      const pct = totalSpent > 0 ? wedge.amount / totalSpent : 0;
      const dashLength = pct * circumference;
      const midAngle = ((offset + dashLength / 2) / circumference) * 2 * Math.PI;
      const tooltipLabel = wedge.tooltipName || wedge.name;

      segments += `<circle
        class="donut-segment"
        data-index="${i}"
        cx="100" cy="100" r="${radius}"
        stroke="${wedge.color}"
        stroke-dasharray="${dashLength} ${circumference - dashLength}"
        stroke-dashoffset="${-offset}"
      ><title>${escapeHtml(tooltipLabel)}: ${formatCurrency(wedge.amount)} (${(pct * 100).toFixed(1)}%)</title></circle>`;

      segmentData.push({ midAngle });
      offset += dashLength;
    });

    donutSvg.innerHTML = segments;

    // Legend shows ALL original categories (no information loss).
    // Each legend item points back to its donut wedge via data-donut-index.
    donutLegend.innerHTML = categories.map((cat, i) => {
      const donutIdx = originalToDonut[i];
      const color = donutWedges[donutIdx].color;
      const pct = totalSpent > 0 ? ((cat.amount / totalSpent) * 100).toFixed(1) : 0;
      const isRolledUp = smallSet.has(i);
      return `<span class="legend-item${isRolledUp ? ' legend-rolled-up' : ''}" data-donut-index="${donutIdx}">
        <span class="legend-dot" style="background:${color}"></span>
        ${escapeHtml(cat.name)} <span class="legend-amount">${pct}%</span>
      </span>`;
    }).join('');

    // Hover interaction
    function highlightSegment(donutIndex) {
      donutSvg.querySelectorAll('.donut-segment').forEach(seg => {
        const i = parseInt(seg.dataset.index);
        if (i === donutIndex) {
          seg.classList.add('donut-hover');
          const angle = segmentData[i].midAngle;
          const tx = Math.cos(angle) * 6;
          const ty = Math.sin(angle) * 6;
          seg.style.transform = `translate(${tx}px, ${ty}px)`;
        } else {
          seg.classList.add('donut-dimmed');
          seg.style.transform = '';
        }
      });
      donutLegend.querySelectorAll('.legend-item').forEach(item => {
        const i = parseInt(item.dataset.donutIndex);
        item.classList.toggle('legend-active', i === donutIndex);
        item.classList.toggle('legend-dimmed', i !== donutIndex);
      });
    }

    function resetSegments() {
      donutSvg.querySelectorAll('.donut-segment').forEach(seg => {
        seg.classList.remove('donut-hover', 'donut-dimmed');
        seg.style.transform = '';
      });
      donutLegend.querySelectorAll('.legend-item').forEach(item => {
        item.classList.remove('legend-active', 'legend-dimmed');
      });
    }

    donutSvg.querySelectorAll('.donut-segment').forEach(seg => {
      seg.addEventListener('mouseenter', () => highlightSegment(parseInt(seg.dataset.index)));
      seg.addEventListener('mouseleave', resetSegments);
    });

    donutLegend.querySelectorAll('.legend-item').forEach(item => {
      item.addEventListener('mouseenter', () => highlightSegment(parseInt(item.dataset.donutIndex)));
      item.addEventListener('mouseleave', resetSegments);
    });

  }

  function renderAll() {
    renderBudgets();
    renderExpenses();
    renderShopping();
    renderPurchased();
    renderCharts();
    renderTimeline();
  }

  // ============================
  // PURCHASED HISTORY (grouped by room)
  // ============================
  const purchasedGroupsEl = document.getElementById('purchased-groups');
  const purchasedStatsCount = document.getElementById('purchased-stats-count');
  const purchasedStatsTotal = document.getElementById('purchased-stats-total');

  function renderPurchased() {
    const purchased = shoppingItems.filter(i => i.purchased);

    // Stats strip
    const totalAmount = purchased.reduce((s, i) => s + (i.qty || 1) * (i.price || 0), 0);
    purchasedStatsCount.textContent = purchased.length + (purchased.length === 1 ? ' item' : ' items');
    purchasedStatsTotal.textContent = formatCurrency(totalAmount) + ' total';

    if (purchased.length === 0) {
      purchasedGroupsEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-illustration">
            <svg viewBox="0 0 140 110" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M30 56 L70 24 L110 56 L110 96 L30 96 Z" fill="var(--primary-light)" stroke="currentColor"/>
              <path d="M22 60 L70 22 L118 60" stroke-width="2.2"/>
              <path d="M60 96 L60 74 Q60 70 64 70 L76 70 Q80 70 80 74 L80 96" fill="white" stroke="currentColor"/>
              <circle cx="76" cy="84" r="1.2" fill="currentColor" stroke="none"/>
              <rect x="38" y="64" width="14" height="14" rx="1" fill="white" stroke="currentColor"/>
              <line x1="45" y1="64" x2="45" y2="78" stroke-width="1.4"/>
              <line x1="38" y1="71" x2="52" y2="71" stroke-width="1.4"/>
              <rect x="88" y="64" width="14" height="14" rx="1" fill="white" stroke="currentColor"/>
              <line x1="95" y1="64" x2="95" y2="78" stroke-width="1.4"/>
              <line x1="88" y1="71" x2="102" y2="71" stroke-width="1.4"/>
              <path d="M92 38 L92 28 L100 28 L100 46" stroke-width="2"/>
              <circle cx="116" cy="32" r="12" fill="var(--primary)" stroke="currentColor" stroke-width="2"/>
              <path d="M110 32 L114 36 L122 28" stroke="white" stroke-width="2.4"/>
              <line x1="14" y1="98" x2="126" y2="98" stroke-width="1.6" opacity="0.5"/>
            </svg>
          </div>
          <h3 class="empty-state-title">Nothing purchased yet</h3>
          <p class="empty-state-text">When you mark a wishlist item as Purchased, it'll show up here, grouped by room. The receipts of your reno.</p>
        </div>`;
      return;
    }

    // Group by room (alphabetical, "No room" goes last)
    const groups = {};
    purchased.forEach(item => {
      const key = item.room || 'No room';
      (groups[key] = groups[key] || []).push(item);
    });
    const roomKeys = Object.keys(groups).sort((a, b) => {
      if (a === 'No room') return 1;
      if (b === 'No room') return -1;
      return a.localeCompare(b);
    });

    purchasedGroupsEl.innerHTML = roomKeys.map(room => {
      const items = groups[room].slice().sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''));
      const subtotal = items.reduce((s, i) => s + (i.qty || 1) * (i.price || 0), 0);
      const countLabel = items.length + (items.length === 1 ? ' item' : ' items');

      const rows = items.map(item => {
        const total = (item.qty || 1) * (item.price || 0);
        let dateStr = '';
        if (item.purchaseDate) {
          const d = parseDateLocal(item.purchaseDate);
          if (d) dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }

        return `
          <div class="producto-row" data-id="${item.id}">
            <div class="producto-thumb">${renderThumbnail(item)}</div>
            <div class="producto-info">
              <span class="producto-name">${escapeHtml(item.name || 'Untitled')}</span>
              <span class="producto-brand">${escapeHtml(item.vendor || '')}</span>
            </div>
            <div class="producto-col producto-type">${escapeHtml(item.material || '')}</div>
            <div class="producto-col producto-qty">${item.qty || 1}</div>
            <div class="producto-col producto-price">${total > 0 ? formatCurrency(total) : ''}</div>
            <div class="producto-col producto-date">${dateStr}</div>
            <div class="producto-status"><span class="status-dot status-purchased"></span> Purchased</div>
            <div class="producto-actions">
              <button class="btn-icon edit-item" aria-label="Edit" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
              <button class="btn-icon delete-item" aria-label="Delete" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>
            </div>
          </div>`;
      }).join('');

      return `
        <div class="producto-group">
          <div class="producto-group-header">
            <span class="producto-group-title">${escapeHtml(room)}</span>
            <span class="producto-group-meta">${countLabel} · ${formatCurrency(subtotal)}</span>
          </div>
          ${rows}
        </div>`;
    }).join('');

    // Wire up actions
    purchasedGroupsEl.querySelectorAll('.edit-item').forEach(btn => {
      btn.addEventListener('click', () => {
        editItem(btn.closest('.producto-row').dataset.id);
      });
    });
    purchasedGroupsEl.querySelectorAll('.delete-item').forEach(btn => {
      btn.addEventListener('click', () => {
        deleteItem(btn.closest('.producto-row').dataset.id);
      });
    });
    purchasedGroupsEl.querySelectorAll('.item-thumbnail').forEach(img => {
      img.addEventListener('click', () => {
        openLightbox(img.dataset.fullSrc);
      });
    });
  }

  // ============================
  // TIMELINE / ACTIVITIES
  // ============================
  let activities = [];
  let timelineView = 'month'; // 'month' | 'list'
  // Current month displayed in the calendar. Defaults to today's month.
  let timelineCursor = (function () {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  })();

  const ACTIVITY_COLORS = {
    'Vendor office visit': '#8B5CF6',
    'Onsite visit':        '#3B82F6',
    'Installation':        '#EC4899',
    'Virtual meeting':     '#14B8A6',
    'Delivery':            '#F59E0B',
    'Others':              '#6B7280'
  };

  // Migrate any shopping items still using the legacy 'Selected' status
  // to plain 'Wishlist'. Selected was removed when we split the page
  // into Wishlist + Purchased History.
  function migrateShoppingStatuses() {
    let changed = false;
    shoppingItems.forEach(item => {
      if (item.status === 'Selected') {
        item.status = 'Wishlist';
        item.purchased = false;
        changed = true;
      }
    });
    if (changed) saveShoppingItems();
  }

  // Migrate legacy activity types to current names. Runs after data load.
  function migrateActivityTypes() {
    const map = {
      'Vendor meeting': 'Vendor office visit',
      'Site visit':     'Onsite visit',
      'Other':          'Others'
    };
    let changed = false;
    activities.forEach(a => {
      if (map[a.type]) { a.type = map[a.type]; changed = true; }
    });
    if (changed) saveActivities();
  }

  const addActivityBtn    = document.getElementById('add-activity-btn');
  const activityModal     = document.getElementById('activity-modal');
  const activityForm      = document.getElementById('activity-form');
  const activityModalTitle= document.getElementById('activity-modal-title');
  const activityDeleteBtn = document.getElementById('activity-delete-btn');
  const timelinePrev      = document.getElementById('timeline-prev');
  const timelineNext      = document.getElementById('timeline-next');
  const timelineTodayBtn  = document.getElementById('timeline-today');
  const timelineMonthLabel= document.getElementById('timeline-month-label');
  const calendarGrid      = document.getElementById('calendar-grid');
  const activitiesList    = document.getElementById('activities-list');
  const timelineMonthViewEl = document.getElementById('timeline-month-view');
  const timelineListViewEl  = document.getElementById('timeline-list-view');
  const viewBtns = document.querySelectorAll('.view-toggle-btn');

  function saveActivities() {
    Storage.set('activities', activities);
    Firestore.saveCollection('activities', activities);
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  function parseDateLocal(str) {
    // Parse 'YYYY-MM-DD' as a LOCAL date (avoids UTC off-by-one).
    if (!str) return null;
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatActivityTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 || 12;
    return hr + (m ? ':' + pad2(m) : '') + ' ' + ampm;
  }

  function renderTimeline() {
    if (timelineView === 'month') {
      timelineMonthViewEl.hidden = false;
      timelineListViewEl.hidden = true;
      renderCalendarMonth();
    } else {
      timelineMonthViewEl.hidden = true;
      timelineListViewEl.hidden = false;
      renderActivityList();
    }
  }

  function renderCalendarMonth() {
    const year  = timelineCursor.getFullYear();
    const month = timelineCursor.getMonth();

    timelineMonthLabel.textContent = timelineCursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const firstOfMonth = new Date(year, month, 1);
    const startWeekday = firstOfMonth.getDay(); // 0 = Sun
    const gridStart = new Date(year, month, 1 - startWeekday);

    const todayStr = ymd(new Date());

    // Group activities by date
    const byDate = {};
    activities.forEach(a => {
      if (!a.date) return;
      (byDate[a.date] = byDate[a.date] || []).push(a);
    });
    // Sort each day's activities by time
    Object.values(byDate).forEach(list => list.sort((a, b) => (a.time || '').localeCompare(b.time || '')));

    let html = '';
    for (let i = 0; i < 42; i++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(gridStart.getDate() + i);
      const cellStr = ymd(cellDate);
      const isOtherMonth = cellDate.getMonth() !== month;
      const isToday = cellStr === todayStr;
      const dayEvents = byDate[cellStr] || [];

      const MAX_VISIBLE = 3;
      const visible = dayEvents.slice(0, MAX_VISIBLE);
      const hiddenCount = dayEvents.length - visible.length;

      html += `
        <div class="calendar-cell ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}" data-date="${cellStr}">
          <span class="cell-date">${cellDate.getDate()}</span>
          <div class="cell-events">
            ${visible.map(ev => `
              <div class="cell-event" data-activity-id="${ev.id}" style="background:${ACTIVITY_COLORS[ev.type] || '#6B7280'}" title="${escapeHtml(ev.title)}">
                ${ev.time ? escapeHtml(formatActivityTime(ev.time)) + ' ' : ''}${escapeHtml(ev.title)}
              </div>
            `).join('')}
            ${hiddenCount > 0 ? `<div class="cell-event-more">+${hiddenCount} more</div>` : ''}
          </div>
        </div>
      `;
    }
    calendarGrid.innerHTML = html;
  }

  function renderActivityList() {
    if (activities.length === 0) {
      activitiesList.innerHTML = '<div class="activity-empty">No activities yet. Click "+ Add Activity" to log your first one.</div>';
      return;
    }

    const todayStr = ymd(new Date());
    // Sort: upcoming ascending, then past descending; we'll split into two groups.
    const upcoming = activities.filter(a => a.date >= todayStr).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const past     = activities.filter(a => a.date <  todayStr).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));

    const rowHtml = (a, isPast) => {
      const d = parseDateLocal(a.date);
      const day = d ? d.getDate() : '';
      const mon = d ? d.toLocaleDateString('en-US', { month: 'short' }) : '';
      const color = ACTIVITY_COLORS[a.type] || '#6B7280';
      const metaParts = [a.type];
      if (a.time) metaParts.push(formatActivityTime(a.time));
      if (a.vendor) metaParts.push(escapeHtml(a.vendor));
      return `
        <div class="activity-row ${isPast ? 'past' : ''}" data-activity-id="${a.id}">
          <div class="activity-date-col">
            <div class="activity-date-day">${day}</div>
            <div class="activity-date-month">${mon}</div>
          </div>
          <div class="activity-type-bar" style="background:${color}"></div>
          <div class="activity-info">
            <div class="activity-info-title">${escapeHtml(a.title)}</div>
            <div class="activity-info-meta">${metaParts.filter(Boolean).join(' · ')}</div>
          </div>
          <button class="btn-icon edit-activity" aria-label="Edit activity" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        </div>
      `;
    };

    let html = '';
    if (upcoming.length) {
      html += '<div class="activity-group"><div class="activity-group-label">Upcoming</div>';
      html += upcoming.map(a => rowHtml(a, false)).join('');
      html += '</div>';
    }
    if (past.length) {
      html += '<div class="activity-group"><div class="activity-group-label">Past</div>';
      html += past.map(a => rowHtml(a, true)).join('');
      html += '</div>';
    }
    activitiesList.innerHTML = html;
  }

  // --- Month navigation ---
  timelinePrev.addEventListener('click', () => {
    timelineCursor = new Date(timelineCursor.getFullYear(), timelineCursor.getMonth() - 1, 1);
    renderCalendarMonth();
  });
  timelineNext.addEventListener('click', () => {
    timelineCursor = new Date(timelineCursor.getFullYear(), timelineCursor.getMonth() + 1, 1);
    renderCalendarMonth();
  });
  timelineTodayBtn.addEventListener('click', () => {
    const now = new Date();
    timelineCursor = new Date(now.getFullYear(), now.getMonth(), 1);
    renderTimeline();
  });

  // --- View toggle ---
  viewBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      timelineView = btn.dataset.view;
      viewBtns.forEach(b => b.classList.toggle('active', b === btn));
      renderTimeline();
    });
  });

  // --- Add/Edit activity ---
  function openActivityModal(activity, defaultDate) {
    activityForm.reset();
    if (activity) {
      activityModalTitle.textContent = 'Edit Activity';
      document.getElementById('activity-id').value     = activity.id;
      document.getElementById('activity-title').value  = activity.title || '';
      document.getElementById('activity-date').value   = activity.date || '';
      document.getElementById('activity-time').value   = activity.time || '';
      document.getElementById('activity-type').value   = activity.type || 'Vendor office visit';
      document.getElementById('activity-vendor').value = activity.vendor || '';
      activityDeleteBtn.hidden = false;
    } else {
      activityModalTitle.textContent = 'Add Activity';
      document.getElementById('activity-id').value = '';
      document.getElementById('activity-date').value = defaultDate || ymd(new Date());
      document.getElementById('activity-type').value = 'Vendor office visit';
      activityDeleteBtn.hidden = true;
    }
    openModal(activityModal);
  }

  addActivityBtn.addEventListener('click', () => openActivityModal(null));

  // Click a calendar cell to add an activity for that day;
  // click an existing event chip to edit.
  calendarGrid.addEventListener('click', (e) => {
    const chip = e.target.closest('.cell-event');
    if (chip) {
      e.stopPropagation();
      const id = chip.dataset.activityId;
      const act = activities.find(a => a.id === id);
      if (act) openActivityModal(act);
      return;
    }
    const more = e.target.closest('.cell-event-more');
    if (more) {
      // Switch to list view, jumping to that date's group.
      timelineView = 'list';
      viewBtns.forEach(b => b.classList.toggle('active', b.dataset.view === 'list'));
      renderTimeline();
      return;
    }
    const cell = e.target.closest('.calendar-cell');
    if (cell && !cell.classList.contains('other-month')) {
      openActivityModal(null, cell.dataset.date);
    }
  });

  activitiesList.addEventListener('click', (e) => {
    const row = e.target.closest('.activity-row');
    if (!row) return;
    const act = activities.find(a => a.id === row.dataset.activityId);
    if (act) openActivityModal(act);
  });

  activityForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id     = document.getElementById('activity-id').value;
    const title  = document.getElementById('activity-title').value.trim();
    const date   = document.getElementById('activity-date').value;
    const time   = document.getElementById('activity-time').value;
    const type   = document.getElementById('activity-type').value;
    const vendor = document.getElementById('activity-vendor').value.trim();

    if (!title || !date) {
      alert('Please enter a title and date.');
      return;
    }

    if (id) {
      const idx = activities.findIndex(a => a.id === id);
      if (idx >= 0) activities[idx] = { ...activities[idx], title, date, time, type, vendor };
    } else {
      activities.push({ id: uuid(), title, date, time, type, vendor });
    }
    saveActivities();
    closeModal(activityModal);
    renderTimeline();
  });

  activityDeleteBtn.addEventListener('click', () => {
    const id = document.getElementById('activity-id').value;
    if (!id) return;
    if (!confirm('Delete this activity?')) return;
    activities = activities.filter(a => a.id !== id);
    saveActivities();
    closeModal(activityModal);
    renderTimeline();
  });

  // ============================
  // HTML Escape
  // ============================
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================
  // IMAGE HANDLING
  // ============================
  const MAX_IMAGE_WIDTH = 600;
  const IMAGE_QUALITY = 0.6;

  function compressImageToBase64(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img;

          if (width > MAX_IMAGE_WIDTH) {
            height = Math.round((height * MAX_IMAGE_WIDTH) / width);
            width = MAX_IMAGE_WIDTH;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Return as base64 data URL string (stored directly in Firestore)
          const dataUrl = canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
          resolve(dataUrl);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // --- Image Upload UI ---
  const imageUploadZone = document.getElementById('image-upload-zone');
  const imageFileInput = document.getElementById('item-image-input');
  const imageUploadPlaceholder = document.getElementById('image-upload-placeholder');
  const imageUploadPreview = document.getElementById('image-upload-preview');
  const imagePreviewImg = document.getElementById('image-preview-img');
  const imageRemoveBtn = document.getElementById('image-remove-btn');

  let pendingImageData = null;   // new base64 image to save
  let existingImageUrl = null;   // current image data from Firestore
  let imageRemoved = false;      // user explicitly removed the image

  function resetImageUpload() {
    pendingImageData = null;
    existingImageUrl = null;
    imageRemoved = false;
    imageUploadPlaceholder.hidden = false;
    imageUploadPreview.hidden = true;
    imagePreviewImg.src = '';
    imageFileInput.value = '';
  }

  function showImagePreview(src) {
    imagePreviewImg.src = src;
    imageUploadPlaceholder.hidden = true;
    imageUploadPreview.hidden = false;
  }

  function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    compressImageToBase64(file).then(dataUrl => {
      pendingImageData = dataUrl;
      imageRemoved = false;
      showImagePreview(dataUrl);
    });
  }

  imageUploadZone.addEventListener('click', (e) => {
    if (e.target.closest('.image-remove-btn')) return;
    imageFileInput.click();
  });

  imageFileInput.addEventListener('change', () => {
    if (imageFileInput.files[0]) handleImageFile(imageFileInput.files[0]);
  });

  // Drag & drop
  imageUploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    imageUploadZone.classList.add('dragover');
  });

  imageUploadZone.addEventListener('dragleave', () => {
    imageUploadZone.classList.remove('dragover');
  });

  imageUploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    imageUploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  });

  imageRemoveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pendingImageData = null;
    imageRemoved = true;
    imageUploadPlaceholder.hidden = false;
    imageUploadPreview.hidden = true;
    imagePreviewImg.src = '';
    imageFileInput.value = '';
  });

  // --- Lightbox ---
  const lightbox = document.getElementById('image-lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxClose = document.getElementById('lightbox-close');
  const lightboxBackdrop = lightbox.querySelector('.lightbox-backdrop');

  function openLightbox(src) {
    lightboxImg.src = src;
    lightbox.hidden = false;
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lightboxImg.src = '';
  }

  lightboxClose.addEventListener('click', closeLightbox);
  lightboxBackdrop.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
  });

  // ============================
  // EXPORT / IMPORT
  // ============================
  const exportModal = document.getElementById('export-modal');
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const importFile = document.getElementById('import-file');

  exportBtn.addEventListener('click', () => openModal(exportModal));

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function getTimestamp() {
    return new Date().toISOString().slice(0, 10);
  }

  // --- JSON Export ---
  document.getElementById('export-json').addEventListener('click', () => {
    const data = { totalBudgetAmount, expenses, shoppingItems };
    downloadFile(
      `renotracker-backup-${getTimestamp()}.json`,
      JSON.stringify(data, null, 2),
      'application/json'
    );
    closeModal(exportModal);
  });

  // --- CSV/Excel Export ---
  function toCsvRow(values) {
    return values.map(v => {
      const str = String(v == null ? '' : v);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? '"' + str.replace(/"/g, '""') + '"'
        : str;
    }).join(',');
  }

  document.getElementById('export-excel').addEventListener('click', () => {
    let csv = '';

    // Budgets sheet
    csv += '--- BUDGET ---\n';
    csv += toCsvRow(['Total Budget']) + '\n';
    csv += toCsvRow([totalBudgetAmount]) + '\n';

    csv += '\n--- EXPENSES ---\n';
    csv += toCsvRow(['Date', 'Description', 'Category', 'Amount', 'Notes']) + '\n';
    expenses.forEach(e => {
      csv += toCsvRow([e.date, e.description, e.category, e.amount, e.notes || '']) + '\n';
    });

    csv += '\n--- SHOPPING LIST ---\n';
    csv += toCsvRow(['Item', 'Room', 'Type', 'Vendor', 'Qty', 'Price', 'Status', 'Notes', 'Link']) + '\n';
    shoppingItems.forEach(i => {
      csv += toCsvRow([i.name, i.room, i.material, i.vendor, i.qty, i.price, i.status, i.notes || '', i.link || '']) + '\n';
    });

    downloadFile(
      `renotracker-export-${getTimestamp()}.csv`,
      csv,
      'text/csv'
    );
    closeModal(exportModal);
  });

  // --- JSON Import ---
  importBtn.addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!confirm('This will replace all your current data. Continue?')) return;

        if (typeof data.totalBudgetAmount === 'number') {
          totalBudgetAmount = data.totalBudgetAmount;
          saveBudget();
        } else if (Array.isArray(data.budgets)) {
          // Backwards compatibility: sum old per-category budgets
          totalBudgetAmount = data.budgets.reduce((s, b) => s + Number(b.amount || 0), 0);
          saveBudget();
        }
        if (Array.isArray(data.expenses)) {
          expenses = data.expenses;
          saveExpenses();
        }
        if (Array.isArray(data.shoppingItems)) {
          shoppingItems = data.shoppingItems;
          saveShoppingItems();
        }

        renderAll();
        alert('Data imported and synced to cloud!');
      } catch {
        alert('Invalid file. Please select a valid JSON backup file.');
      }
    };
    reader.readAsText(file);
    importFile.value = '';
  });

  // --- Load data from Firestore (with localStorage fallback) then start app ---
  async function initData() {
    const [fbBudgets, fbExpenses, fbShopping, fbActivities] = await Promise.all([
      Firestore.loadCollection('budgets'),
      Firestore.loadCollection('expenses'),
      Firestore.loadCollection('shopping'),
      Firestore.loadCollection('activities')
    ]);

    // Use Firestore data if available, otherwise fall back to localStorage
    if (fbBudgets && fbBudgets.length > 0) {
      // New format: single total budget doc
      const totalDoc = fbBudgets.find(b => b.id === 'total');
      if (totalDoc) {
        totalBudgetAmount = Number(totalDoc.amount) || 0;
      } else {
        // Backwards compatibility: sum old per-category budgets
        totalBudgetAmount = fbBudgets.reduce((s, b) => s + Number(b.amount || 0), 0);
      }
    } else {
      totalBudgetAmount = Storage.get('totalBudget', 0);
    }
    expenses = fbExpenses || Storage.get('expenses', []);
    shoppingItems = fbShopping || Storage.get('shopping', []);
    activities = fbActivities || Storage.get('activities', []);
    migrateActivityTypes();
    migrateShoppingStatuses();

    // Sync localStorage with whatever we loaded (keeps offline cache fresh)
    Storage.set('totalBudget', totalBudgetAmount);
    Storage.set('expenses', expenses);
    Storage.set('shopping', shoppingItems);
    Storage.set('activities', activities);
  }

})();
