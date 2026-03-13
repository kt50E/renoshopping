// ===== RenoTracker App =====

(function () {
  'use strict';

  // --- Storage Helpers ---
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

  // --- UUID ---
  function uuid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  // --- Format Currency ---
  function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  }

  // --- Password Lock ---
  const lockScreen = document.getElementById('lock-screen');
  const app = document.getElementById('app');
  const lockPassword = document.getElementById('lock-password');
  const lockSubmit = document.getElementById('lock-submit');
  const lockError = document.getElementById('lock-error');
  const lockSetup = document.getElementById('lock-setup');
  const setupPassword = document.getElementById('setup-password');
  const setupConfirm = document.getElementById('setup-confirm');
  const setupSubmit = document.getElementById('setup-submit');
  const setupError = document.getElementById('setup-error');
  const lockBtn = document.getElementById('lock-btn');

  function hashPassword(pw) {
    // Simple hash for local use — not meant for production security
    let hash = 0;
    for (let i = 0; i < pw.length; i++) {
      const char = pw.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString();
  }

  function initLock() {
    const stored = Storage.get('password_hash');
    if (!stored) {
      // First time — show setup
      lockPassword.parentElement.style.display = 'none';
      lockSubmit.style.display = 'none';
      lockSetup.hidden = false;
    } else {
      lockPassword.parentElement.style.display = '';
      lockSubmit.style.display = '';
      lockSetup.hidden = true;
    }
  }

  function unlock() {
    lockScreen.hidden = true;
    app.hidden = false;
    renderAll();
  }

  function lock() {
    lockScreen.hidden = false;
    app.hidden = true;
    lockPassword.value = '';
    lockError.hidden = true;
    initLock();
  }

  setupSubmit.addEventListener('click', () => {
    const pw = setupPassword.value;
    const confirm = setupConfirm.value;
    if (pw.length < 4) {
      setupError.textContent = 'Password must be at least 4 characters.';
      setupError.hidden = false;
      return;
    }
    if (pw !== confirm) {
      setupError.textContent = 'Passwords do not match.';
      setupError.hidden = false;
      return;
    }
    Storage.set('password_hash', hashPassword(pw));
    unlock();
  });

  lockSubmit.addEventListener('click', () => {
    const stored = Storage.get('password_hash');
    if (hashPassword(lockPassword.value) === stored) {
      unlock();
    } else {
      lockError.hidden = false;
      lockPassword.value = '';
      lockPassword.focus();
    }
  });

  lockPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lockSubmit.click();
  });

  lockBtn.addEventListener('click', lock);

  initLock();

  // --- Tab Navigation ---
  const navBtns = document.querySelectorAll('.sidebar-nav-btn');
  const tabs = document.querySelectorAll('.tab-content');
  const topbarTitle = document.getElementById('topbar-title');

  const tabTitles = {
    dashboard: 'Budget Dashboard',
    expenses: 'Expenses',
    shopping: 'Shopping List'
  };

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      tabs.forEach(t => {
        t.hidden = t.id !== 'tab-' + tabName;
        if (!t.hidden) t.classList.add('active');
        else t.classList.remove('active');
      });
      topbarTitle.textContent = tabTitles[tabName] || tabName;
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
  // BUDGETS
  // ============================
  let budgets = Storage.get('budgets', []);

  const addBudgetBtn = document.getElementById('add-budget-btn');
  const budgetModal = document.getElementById('budget-modal');
  const budgetForm = document.getElementById('budget-form');
  const budgetModalTitle = document.getElementById('budget-modal-title');
  const budgetList = document.getElementById('budget-list');

  function saveBudgets() {
    Storage.set('budgets', budgets);
  }

  function getBudgetSpent(budgetName) {
    return expenses
      .filter(e => e.category === budgetName)
      .reduce((sum, e) => sum + Number(e.amount), 0);
  }

  function renderBudgets() {
    const totalBudget = budgets.reduce((s, b) => s + Number(b.amount), 0);
    const totalSpent = budgets.reduce((s, b) => s + getBudgetSpent(b.name), 0);
    const remaining = totalBudget - totalSpent;

    document.getElementById('total-budget').textContent = formatCurrency(totalBudget);
    document.getElementById('total-spent').textContent = formatCurrency(totalSpent);

    const remEl = document.getElementById('total-remaining');
    remEl.textContent = formatCurrency(remaining);
    remEl.className = 'summary-value ' + (remaining < 0 ? 'over-budget' : 'under-budget');

    if (budgets.length === 0) {
      budgetList.innerHTML = '<p class="empty-state">No budgets yet. Add a budget to get started!</p>';
      return;
    }

    budgetList.innerHTML = budgets.map(b => {
      const spent = getBudgetSpent(b.name);
      const pct = b.amount > 0 ? Math.min((spent / b.amount) * 100, 100) : 0;
      const over = spent > b.amount;
      const actualPct = b.amount > 0 ? ((spent / b.amount) * 100).toFixed(1) : 0;

      return `
        <div class="budget-item" data-id="${b.id}">
          <div class="budget-item-header">
            <span class="budget-item-name">
              <span class="budget-color-dot" style="background:${b.color}"></span>
              ${escapeHtml(b.name)}
            </span>
            <span class="budget-item-amounts">
              <strong>${formatCurrency(spent)}</strong> of ${formatCurrency(b.amount)}
            </span>
          </div>
          <div class="budget-bar-track">
            <div class="budget-bar-fill ${over ? 'over' : ''}" style="width:${pct}%;background:${over ? '' : b.color}"></div>
          </div>
          <div class="budget-item-footer">
            <span class="budget-percent" style="color:${over ? 'var(--danger)' : b.color}">${actualPct}%</span>
            <div class="budget-actions">
              <button class="btn-icon edit-budget" title="Edit">✏️</button>
              <button class="btn-icon delete-budget" title="Delete">🗑️</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach budget action events
    budgetList.querySelectorAll('.edit-budget').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.closest('.budget-item').dataset.id;
        editBudget(id);
      });
    });
    budgetList.querySelectorAll('.delete-budget').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.closest('.budget-item').dataset.id;
        deleteBudget(id);
      });
    });
  }

  addBudgetBtn.addEventListener('click', () => {
    budgetModalTitle.textContent = 'Add Budget';
    budgetForm.reset();
    document.getElementById('budget-id').value = '';
    document.getElementById('budget-color').value = '#6C63FF';
    openModal(budgetModal);
  });

  function editBudget(id) {
    const b = budgets.find(x => x.id === id);
    if (!b) return;
    budgetModalTitle.textContent = 'Edit Budget';
    document.getElementById('budget-name').value = b.name;
    document.getElementById('budget-amount').value = b.amount;
    document.getElementById('budget-color').value = b.color;
    document.getElementById('budget-id').value = b.id;
    openModal(budgetModal);
  }

  function deleteBudget(id) {
    if (!confirm('Delete this budget? Expenses in this category will remain.')) return;
    budgets = budgets.filter(b => b.id !== id);
    saveBudgets();
    renderAll();
  }

  budgetForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('budget-id').value;
    const name = document.getElementById('budget-name').value.trim();
    const amount = parseFloat(document.getElementById('budget-amount').value);
    const color = document.getElementById('budget-color').value;

    if (id) {
      const b = budgets.find(x => x.id === id);
      if (b) {
        // Update expense categories if name changed
        if (b.name !== name) {
          expenses.forEach(exp => {
            if (exp.category === b.name) exp.category = name;
          });
          saveExpenses();
          // Update shopping item categories too
          shoppingItems.forEach(item => {
            if (item.category === b.name) item.category = name;
          });
          saveShoppingItems();
        }
        b.name = name;
        b.amount = amount;
        b.color = color;
      }
    } else {
      budgets.push({ id: uuid(), name, amount, color });
    }

    saveBudgets();
    closeModal(budgetModal);
    renderAll();
  });

  // ============================
  // EXPENSES
  // ============================
  let expenses = Storage.get('expenses', []);

  const addExpenseBtn = document.getElementById('add-expense-btn');
  const expenseModal = document.getElementById('expense-modal');
  const expenseForm = document.getElementById('expense-form');
  const expenseModalTitle = document.getElementById('expense-modal-title');
  const expensesBody = document.getElementById('expenses-body');
  const expenseFilterCat = document.getElementById('expense-filter-category');
  const expenseSearch = document.getElementById('expense-search');

  function saveExpenses() {
    Storage.set('expenses', expenses);
  }

  function populateCategoryDropdowns() {
    const cats = budgets.map(b => b.name);
    const selects = [
      document.getElementById('expense-category'),
      document.getElementById('expense-filter-category'),
      document.getElementById('item-category'),
      document.getElementById('shopping-filter-category')
    ];

    selects.forEach((sel, i) => {
      const current = sel.value;
      const isFilter = i === 1 || i === 3;
      sel.innerHTML = isFilter
        ? '<option value="">All Categories</option>'
        : '<option value="">Select category...</option>';
      cats.forEach(c => {
        sel.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
      });
      sel.value = current;
    });
  }

  function renderExpenses() {
    const filterCat = expenseFilterCat.value;
    const search = expenseSearch.value.toLowerCase();

    let filtered = expenses;
    if (filterCat) filtered = filtered.filter(e => e.category === filterCat);
    if (search) filtered = filtered.filter(e =>
      e.description.toLowerCase().includes(search) ||
      e.category.toLowerCase().includes(search) ||
      (e.notes && e.notes.toLowerCase().includes(search))
    );

    // Sort by date descending
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (filtered.length === 0) {
      expensesBody.innerHTML = '<tr class="empty-row"><td colspan="5">No expenses found.</td></tr>';
      return;
    }

    expensesBody.innerHTML = filtered.map(e => {
      const budget = budgets.find(b => b.name === e.category);
      const color = budget ? budget.color : '#6B7280';
      return `
        <tr data-id="${e.id}">
          <td>${e.date}</td>
          <td>
            ${escapeHtml(e.description)}
            ${e.notes ? `<br><small style="color:var(--gray-400)">${escapeHtml(e.notes)}</small>` : ''}
          </td>
          <td><span class="category-badge" style="background:${color}20;color:${color}">${escapeHtml(e.category)}</span></td>
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
    openModal(expenseModal);
  });

  function editExpense(id) {
    const e = expenses.find(x => x.id === id);
    if (!e) return;
    expenseModalTitle.textContent = 'Edit Expense';
    document.getElementById('expense-date').value = e.date;
    document.getElementById('expense-desc').value = e.description;
    document.getElementById('expense-category').value = e.category;
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
      category: document.getElementById('expense-category').value,
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

  // ============================
  // SHOPPING LIST
  // ============================
  let shoppingItems = Storage.get('shopping', []);

  const addItemBtn = document.getElementById('add-item-btn');
  const itemModal = document.getElementById('item-modal');
  const itemForm = document.getElementById('item-form');
  const itemModalTitle = document.getElementById('item-modal-title');
  const shoppingListEl = document.getElementById('shopping-list');
  const shoppingFilterCat = document.getElementById('shopping-filter-category');
  const hidePurchased = document.getElementById('hide-purchased');
  const shoppingTotal = document.getElementById('shopping-total');

  function saveShoppingItems() {
    Storage.set('shopping', shoppingItems);
  }

  function renderShopping() {
    const filterCat = shoppingFilterCat.value;
    const hideChecked = hidePurchased.checked;

    let filtered = shoppingItems;
    if (filterCat) filtered = filtered.filter(i => i.category === filterCat);
    if (hideChecked) filtered = filtered.filter(i => !i.purchased);

    // Sort: unpurchased first
    filtered.sort((a, b) => (a.purchased === b.purchased) ? 0 : a.purchased ? 1 : -1);

    if (filtered.length === 0) {
      shoppingListEl.innerHTML = '<p class="empty-state">No items to show.</p>';
    } else {
      shoppingListEl.innerHTML = filtered.map(item => {
        const budget = budgets.find(b => b.name === item.category);
        const color = budget ? budget.color : '#6B7280';
        const total = (item.qty || 1) * (item.price || 0);
        return `
          <div class="shopping-item ${item.purchased ? 'purchased' : ''}" data-id="${item.id}">
            <input type="checkbox" class="shopping-item-check" ${item.purchased ? 'checked' : ''}>
            <div class="shopping-item-info">
              <div class="shopping-item-name">${escapeHtml(item.name)}</div>
              <div class="shopping-item-details">
                <span class="category-badge" style="background:${color}20;color:${color}">${escapeHtml(item.category)}</span>
                &nbsp; Qty: ${item.qty || 1}
                ${item.link ? ` &nbsp; <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">View Link</a>` : ''}
                ${item.notes ? `<br>${escapeHtml(item.notes)}` : ''}
              </div>
            </div>
            <span class="shopping-item-price">${total > 0 ? formatCurrency(total) : ''}</span>
            <div class="shopping-item-actions">
              <button class="btn-icon edit-item" title="Edit">✏️</button>
              <button class="btn-icon delete-item" title="Delete">🗑️</button>
            </div>
          </div>
        `;
      }).join('');
    }

    // Total (unpurchased only)
    const unpurchasedTotal = shoppingItems
      .filter(i => !i.purchased)
      .reduce((s, i) => s + (i.qty || 1) * (i.price || 0), 0);
    shoppingTotal.textContent = `Estimated Total (unpurchased): ${formatCurrency(unpurchasedTotal)}`;

    // Events
    shoppingListEl.querySelectorAll('.shopping-item-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.closest('.shopping-item').dataset.id;
        const item = shoppingItems.find(i => i.id === id);
        if (item) {
          item.purchased = cb.checked;
          saveShoppingItems();
          renderShopping();
        }
      });
    });
    shoppingListEl.querySelectorAll('.edit-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.closest('.shopping-item').dataset.id;
        editItem(id);
      });
    });
    shoppingListEl.querySelectorAll('.delete-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.closest('.shopping-item').dataset.id;
        deleteItem(id);
      });
    });
  }

  addItemBtn.addEventListener('click', () => {
    itemModalTitle.textContent = 'Add Item';
    itemForm.reset();
    document.getElementById('item-id').value = '';
    openModal(itemModal);
  });

  function editItem(id) {
    const item = shoppingItems.find(x => x.id === id);
    if (!item) return;
    itemModalTitle.textContent = 'Edit Item';
    document.getElementById('item-name').value = item.name;
    document.getElementById('item-category').value = item.category;
    document.getElementById('item-qty').value = item.qty || 1;
    document.getElementById('item-price').value = item.price || '';
    document.getElementById('item-link').value = item.link || '';
    document.getElementById('item-notes').value = item.notes || '';
    document.getElementById('item-id').value = item.id;
    openModal(itemModal);
  }

  function deleteItem(id) {
    if (!confirm('Delete this item?')) return;
    shoppingItems = shoppingItems.filter(i => i.id !== id);
    saveShoppingItems();
    renderShopping();
  }

  itemForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('item-id').value;
    const data = {
      name: document.getElementById('item-name').value.trim(),
      category: document.getElementById('item-category').value,
      qty: parseInt(document.getElementById('item-qty').value) || 1,
      price: parseFloat(document.getElementById('item-price').value) || 0,
      link: document.getElementById('item-link').value.trim(),
      notes: document.getElementById('item-notes').value.trim()
    };

    if (id) {
      const item = shoppingItems.find(x => x.id === id);
      if (item) Object.assign(item, data);
    } else {
      shoppingItems.push({ id: uuid(), purchased: false, ...data });
    }

    saveShoppingItems();
    closeModal(itemModal);
    renderShopping();
  });

  shoppingFilterCat.addEventListener('change', renderShopping);
  hidePurchased.addEventListener('change', renderShopping);

  // ============================
  // RENDER ALL
  // ============================
  function renderAll() {
    populateCategoryDropdowns();
    renderBudgets();
    renderExpenses();
    renderShopping();
  }

  // ============================
  // HTML Escape
  // ============================
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

})();
