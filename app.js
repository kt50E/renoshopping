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
    'turajanek@gmail.com'
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
    expenses: 'Expenses',
    shopping: 'Shopping List',
    timeline: 'Timeline'
  };

  function switchTab(tabName) {
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    tabs.forEach(t => {
      t.hidden = t.id !== 'tab-' + tabName;
      if (!t.hidden) t.classList.add('active');
      else t.classList.remove('active');
    });
    topbarTitle.textContent = tabTitles[tabName] || tabName;
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
    remEl.className = 'summary-value ' + (remaining < 0 ? 'over-budget' : 'under-budget');

    if (totalBudgetAmount === 0) {
      budgetProgress.innerHTML = '<p class="empty-state">Set your total renovation budget to track spending.</p>';
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
  let expenseSort = { key: 'date', dir: 'desc' };
  let shoppingSort = { key: null, dir: 'asc' };

  const STATUS_ORDER = { 'Wishlist': 0, 'Selected': 1, 'Purchased': 2 };

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
  const expensesBody = document.getElementById('expenses-body');
  const expenseFilterCat = document.getElementById('expense-filter-category');
  const expenseSearch = document.getElementById('expense-search');

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

  function renderExpenses() {
    const filterCat = expenseFilterCat.value;
    const search = expenseSearch.value.toLowerCase();

    let filtered = expenses;
    if (filterCat) filtered = filtered.filter(e => e.category === filterCat);
    if (search) filtered = filtered.filter(e =>
      (e.description || '').toLowerCase().includes(search) ||
      (e.category || '').toLowerCase().includes(search) ||
      (e.notes || '').toLowerCase().includes(search)
    );

    // Sort
    const eDir = expenseSort.dir === 'asc' ? 1 : -1;
    if (expenseSort.key === 'date') {
      filtered.sort((a, b) => eDir * (new Date(a.date) - new Date(b.date)));
    } else if (expenseSort.key === 'amount') {
      filtered.sort((a, b) => eDir * (Number(a.amount) - Number(b.amount)));
    }

    updateSortHeaders('#tab-expenses', expenseSort);

    if (filtered.length === 0) {
      expensesBody.innerHTML = '<tr class="empty-row"><td colspan="5">No expenses found.</td></tr>';
      return;
    }

    expensesBody.innerHTML = filtered.map(e => {
      const color = '#6B7280';
      return `
        <tr data-id="${e.id}">
          <td class="date-cell">${e.date}</td>
          <td>
            ${escapeHtml(e.description)}
            ${e.notes ? `<br><small style="color:var(--gray-400)">${escapeHtml(e.notes)}</small>` : ''}
          </td>
          <td><span class="category-badge" style="background:${color}20;color:${color}">${escapeHtml(e.category || 'Uncategorized')}</span></td>
          <td class="expense-amount">${formatCurrency(e.amount)}</td>
          <td>
            <div style="display:flex;gap:4px">
              <button class="btn-icon edit-expense" title="Edit">✏️</button>
              <button class="btn-icon delete-expense" title="Delete">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    expensesBody.querySelectorAll('.edit-expense').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.closest('tr').dataset.id;
        editExpense(id);
      });
    });
    expensesBody.querySelectorAll('.delete-expense').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.closest('tr').dataset.id;
        deleteExpense(id);
      });
    });
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
  expenseSearch.addEventListener('input', renderExpenses);

  document.querySelectorAll('#tab-expenses th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      toggleSort(expenseSort, th.dataset.sort);
      renderExpenses();
    });
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
  const shoppingFilterRoom = document.getElementById('shopping-filter-room');
  const shoppingFilterMaterial = document.getElementById('shopping-filter-material');
  const hidePurchased = document.getElementById('hide-purchased');
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
    const hideChecked = hidePurchased.checked;

    let filtered = shoppingItems;
    if (filterRoom) filtered = filtered.filter(i => i.room === filterRoom);
    if (filterMaterial) filtered = filtered.filter(i => i.material === filterMaterial);
    if (hideChecked) filtered = filtered.filter(i => !i.purchased);

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
        } else if (shoppingSort.key === 'status') {
          return sDir * ((STATUS_ORDER[a.status] || 0) - (STATUS_ORDER[b.status] || 0));
        }
        return 0;
      });
    } else {
      // Default: unpurchased first
      filtered.sort((a, b) => (a.purchased === b.purchased) ? 0 : a.purchased ? 1 : -1);
    }

    updateSortHeaders('#tab-shopping', shoppingSort);

    if (filtered.length === 0) {
      shoppingBody.innerHTML = '<tr class="empty-row"><td colspan="11">No items to show.</td></tr>';
    } else {
      shoppingBody.innerHTML = filtered.map(item => {
        const total = (item.qty || 1) * (item.price || 0);
        const status = item.status || 'Wishlist';
        const statusColor = status === 'Purchased' ? 'var(--success)' : status === 'Selected' ? '#3B82F6' : '#D97706';
        const statusBg = status === 'Purchased' ? 'var(--success-light)' : status === 'Selected' ? '#EFF6FF' : '#FEF9C3';
        let notesHtml = '';
        if (item.notes) {
          const lines = item.notes.split('\n').filter(l => l.trim());
          if (lines.length > 1) {
            notesHtml = `<span class="notes-first-line">${escapeHtml(lines[0])}</span><a href="#" class="notes-toggle">Read more</a><span class="notes-full" hidden>${escapeHtml(item.notes).replace(/\n/g, '<br>')}</span>`;
          } else {
            notesHtml = escapeHtml(item.notes);
          }
        }
        const imgHtml = item.imageUrl
          ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" class="item-thumbnail" data-full-src="${escapeHtml(item.imageUrl)}">`
          : `<div class="item-thumbnail-placeholder"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`;

        return `
          <tr data-id="${item.id}" class="${item.purchased ? 'purchased' : ''}">
            <td>${imgHtml}</td>
            <td>${escapeHtml(item.name || '')}</td>
            <td><span class="category-badge" style="background:#A8C5B020;color:#2C5F3F">${escapeHtml(item.room || '-')}</span></td>
            <td><span class="category-badge" style="background:#6C63FF20;color:#6C63FF">${escapeHtml(item.material || '-')}</span></td>
            <td>${escapeHtml(item.vendor || '-')}</td>
            <td>${item.qty || 1}</td>
            <td>${total > 0 ? formatCurrency(total) : '-'}</td>
            <td><span class="category-badge" style="background:${statusBg};color:${statusColor}">${status}</span></td>
            <td>${notesHtml || '-'}</td>
            <td>${item.link ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">View</a>` : '-'}</td>
            <td>
              <div style="display:flex;gap:4px">
                <button class="btn-icon edit-item" title="Edit">✏️</button>
                <button class="btn-icon delete-item" title="Delete">🗑️</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Total (unpurchased only)
    const unpurchasedTotal = shoppingItems
      .filter(i => !i.purchased)
      .reduce((s, i) => s + (i.qty || 1) * (i.price || 0), 0);
    shoppingTotal.textContent = `Estimated Total (unpurchased): ${formatCurrency(unpurchasedTotal)}`;

    // Events
    shoppingBody.querySelectorAll('.notes-toggle').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const firstLine = link.previousElementSibling;
        const full = link.nextElementSibling;
        if (full.hidden) {
          full.hidden = false;
          firstLine.hidden = true;
          link.textContent = 'Show less';
        } else {
          full.hidden = true;
          firstLine.hidden = false;
          link.textContent = 'Read more';
        }
      });
    });
    shoppingBody.querySelectorAll('.edit-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.closest('tr').dataset.id;
        editItem(id);
      });
    });
    shoppingBody.querySelectorAll('.delete-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.closest('tr').dataset.id;
        deleteItem(id);
      });
    });

    // Thumbnail click → lightbox
    shoppingBody.querySelectorAll('.item-thumbnail').forEach(img => {
      img.addEventListener('click', () => {
        openLightbox(img.dataset.fullSrc);
      });
    });
  }

  addItemBtn.addEventListener('click', () => {
    itemModalTitle.textContent = 'Add Item';
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
    itemModalTitle.textContent = 'Edit Item';
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
    if (id) {
      savedItem = shoppingItems.find(x => x.id === id);
      const wasPurchased = savedItem && savedItem.purchased;
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

    const justPurchased = savedItem.purchased && data.status === 'Purchased';
    saveShoppingItems();
    syncExpenseFromItem(savedItem);
    closeModal(itemModal);
    renderAll();
    if (justPurchased) launchConfetti();
  });

  shoppingFilterRoom.addEventListener('change', renderShopping);
  shoppingFilterMaterial.addEventListener('change', renderShopping);
  hidePurchased.addEventListener('change', renderShopping);

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

    // --- Donut Chart (SVG) ---
    const donutSvg = document.getElementById('donut-chart');
    const donutLegend = document.getElementById('donut-legend');
    const donutCenterAmount = document.getElementById('donut-center-amount');
    const radius = 84;
    const circumference = 2 * Math.PI * radius;

    donutCenterAmount.textContent = formatCurrency(totalSpent);

    let segments = '';
    let offset = 0;

    // Calculate midpoint angles for each segment (used for pop-out on hover)
    const segmentData = [];
    categories.forEach((cat, i) => {
      const pct = totalSpent > 0 ? cat.amount / totalSpent : 0;
      const dashLength = pct * circumference;
      const color = CHART_COLORS[i % CHART_COLORS.length];
      const midAngle = ((offset + dashLength / 2) / circumference) * 2 * Math.PI;

      segments += `<circle
        class="donut-segment"
        data-index="${i}"
        cx="100" cy="100" r="${radius}"
        stroke="${color}"
        stroke-dasharray="${dashLength} ${circumference - dashLength}"
        stroke-dashoffset="${-offset}"
      ><title>${escapeHtml(cat.name)}: ${formatCurrency(cat.amount)} (${(pct * 100).toFixed(1)}%)</title></circle>`;

      segmentData.push({ midAngle });
      offset += dashLength;
    });

    donutSvg.innerHTML = segments;

    // Legend
    donutLegend.innerHTML = categories.map((cat, i) => {
      const color = CHART_COLORS[i % CHART_COLORS.length];
      const pct = totalSpent > 0 ? ((cat.amount / totalSpent) * 100).toFixed(1) : 0;
      return `<span class="legend-item" data-index="${i}">
        <span class="legend-dot" style="background:${color}"></span>
        ${escapeHtml(cat.name)} <span class="legend-amount">${pct}%</span>
      </span>`;
    }).join('');

    // Hover interaction
    function highlightSegment(index) {
      donutSvg.querySelectorAll('.donut-segment').forEach(seg => {
        const i = parseInt(seg.dataset.index);
        if (i === index) {
          seg.classList.add('donut-hover');
          // Pop out the segment
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
        const i = parseInt(item.dataset.index);
        item.classList.toggle('legend-active', i === index);
        item.classList.toggle('legend-dimmed', i !== index);
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
      item.addEventListener('mouseenter', () => highlightSegment(parseInt(item.dataset.index)));
      item.addEventListener('mouseleave', resetSegments);
    });

  }

  function renderAll() {
    renderBudgets();
    renderExpenses();
    renderShopping();
    renderCharts();
    renderTimeline();
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
    'Vendor meeting': '#8B5CF6',
    'Site visit':     '#3B82F6',
    'Installation':   '#10B981',
    'Delivery':       '#F59E0B',
    'Other':          '#6B7280'
  };

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
          <button class="btn-icon edit-activity" title="Edit">✏️</button>
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
      document.getElementById('activity-type').value   = activity.type || 'Vendor meeting';
      document.getElementById('activity-vendor').value = activity.vendor || '';
      activityDeleteBtn.hidden = false;
    } else {
      activityModalTitle.textContent = 'Add Activity';
      document.getElementById('activity-id').value = '';
      document.getElementById('activity-date').value = defaultDate || ymd(new Date());
      document.getElementById('activity-type').value = 'Vendor meeting';
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

    // Sync localStorage with whatever we loaded (keeps offline cache fresh)
    Storage.set('totalBudget', totalBudgetAmount);
    Storage.set('expenses', expenses);
    Storage.set('shopping', shoppingItems);
    Storage.set('activities', activities);
  }

})();
