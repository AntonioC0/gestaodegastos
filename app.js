(() => {
  'use strict';

  const SUPABASE_CONFIG = {
    url: 'https://xpjbxsbqxmmcpgqtzhcv.supabase.co',
    apiKey: 'sb_publishable_DJsyNpMVRIm0KZklraoQXQ_XNCJeeRf'
  };

  const SUPABASE_TABLES = {
    entries: 'entries'
  };

  const ENTRY_COLUMNS = 'id,type,description,value,category,date,is_fixed,payment,notes,created_at';
  const FIXED_SAVE_PERCENT = 40;
  const LOCAL_STORAGE_KEYS_TO_CLEAR = [
    'gestaoGastos.entries.v1',
    'gestaoGastos.settings.v1'
  ];

  const CATEGORY_COLORS = {
    'Moradia': '#2d6cdf',
    'Alimentação': '#28ad62',
    'Transporte': '#f6a20a',
    'Lazer': '#7d58dc',
    'Saúde': '#28a9b8',
    'Educação': '#b970d9',
    'Assinaturas': '#ef6682',
    'Outros': '#8b96a9',
    'Salário': '#18a45d',
    'Freelance': '#2c9da8',
    'Outros ganhos': '#67758d'
  };

  const EXPENSE_CATEGORIES = ['Moradia', 'Alimentação', 'Transporte', 'Lazer', 'Saúde', 'Educação', 'Assinaturas', 'Outros'];
  const INCOME_CATEGORIES = ['Salário', 'Freelance', 'Outros ganhos'];

  const VIEW_CONFIG = {
    dashboard: { title: 'Dashboard', subtitle: 'Visão geral do mês', element: 'dashboardView' },
    entries: { title: 'Lançamentos', subtitle: 'Registrar ganhos e gastos do mês', element: 'entriesView' },
    planning: { title: 'Planejamento', subtitle: 'Defina quanto guardar e quanto pode gastar', element: 'planningView' }
  };

  const state = {
    entries: [],
    activeView: 'dashboard',
    selectedMonth: '',
    entryType: 'income',
    isFixed: false,
    editingId: null,
    pendingDeleteId: null,
    syncError: ''
  };

  let supabaseClient = null;

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  const refs = {};

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    cacheDom();
    resetLocalDatabase();
    initializeMonth();
    initializeSupabase();
    bindEvents();
    setEntryType('income');
    resetEntryForm();
    renderAll();
    await loadData();
    renderAll();
  }

  function cacheDom() {
    refs.pageTitle = $('#pageTitle');
    refs.pageSubtitle = $('#pageSubtitle');
    refs.monthFilter = $('#monthFilter');
    refs.sidebar = $('.sidebar');
    refs.sidebarOverlay = $('#sidebarOverlay');
    refs.sidebarToggleButton = $('#sidebarToggleButton');
    refs.mobileMenuButton = $('#mobileMenuButton');
    refs.mobileMenuClose = $('#mobileMenuClose');

    refs.entryForm = $('#entryForm');
    refs.entryId = $('#entryId');
    refs.descriptionInput = $('#descriptionInput');
    refs.valueInput = $('#valueInput');
    refs.categoryInput = $('#categoryInput');
    refs.dateInput = $('#dateInput');
    refs.paymentInput = $('#paymentInput');
    refs.notesInput = $('#notesInput');
    refs.fixedField = $('#fixedField');
    refs.entryFormTitle = $('#entryFormTitle');
    refs.saveEntryButton = $('#saveEntryButton');
    refs.cancelEditButton = $('#cancelEditButton');
    refs.formMessage = $('#formMessage');

    refs.historyCategoryFilter = $('#historyCategoryFilter');
    refs.historyTypeFilter = $('#historyTypeFilter');
    refs.historySearch = $('#historySearch');
    refs.historyBody = $('#historyBody');
    refs.historyEmpty = $('#historyEmpty');
    refs.recentEntriesBody = $('#recentEntriesBody');
    refs.recentEmpty = $('#recentEmpty');

    refs.planIncomeInput = $('#planIncomeInput');
    refs.planFixedInput = $('#planFixedInput');
    refs.planPercentInput = $('#planPercentInput');

    refs.confirmDialog = $('#confirmDialog');
  }

  function bindEvents() {
    $$('.nav-item').forEach(button => {
      button.addEventListener('click', () => switchView(button.dataset.view));
    });

    $$('[data-go-to]').forEach(button => {
      button.addEventListener('click', () => switchView(button.dataset.goTo));
    });

    refs.monthFilter.addEventListener('change', () => {
      state.selectedMonth = refs.monthFilter.value;
      syncFormDateToMonth();
      renderAll();
    });

    refs.mobileMenuButton.addEventListener('click', openMobileMenu);
    refs.mobileMenuClose.addEventListener('click', closeMobileMenu);
    refs.sidebarOverlay.addEventListener('click', closeMobileMenu);
    refs.sidebarToggleButton.addEventListener('click', toggleSidebar);

    $$('#typeControl .segment').forEach(button => {
      button.addEventListener('click', () => setEntryType(button.dataset.type));
    });

    $$('#fixedControl .segment').forEach(button => {
      button.addEventListener('click', () => setFixed(button.dataset.fixed === 'true'));
    });

    refs.entryForm.addEventListener('submit', handleEntrySubmit);
    $('#clearFormButton').addEventListener('click', resetEntryForm);
    refs.cancelEditButton.addEventListener('click', resetEntryForm);

    refs.historyCategoryFilter.addEventListener('change', renderHistory);
    refs.historyTypeFilter.addEventListener('change', renderHistory);
    refs.historySearch.addEventListener('input', renderHistory);

    refs.historyBody.addEventListener('click', handleTableAction);

    refs.planPercentInput.readOnly = true;

    refs.confirmDialog.addEventListener('close', async () => {
      if (refs.confirmDialog.returnValue === 'confirm' && state.pendingDeleteId) {
        await deleteEntry(state.pendingDeleteId);
      }
      state.pendingDeleteId = null;
    });

    window.addEventListener('resize', () => {
      renderExpenseFlowChart(getSelectedEntries());
      renderCategoryDonut(getSelectedEntries());
      renderPlanningDonut(calculateMonth());
    });
  }

  function initializeMonth() {
    const now = new Date();
    state.selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    refs.monthFilter.value = state.selectedMonth;
  }

  function resetLocalDatabase() {
    try {
      LOCAL_STORAGE_KEYS_TO_CLEAR.forEach(key => localStorage.removeItem(key));
    } catch (error) {
      console.warn('Falha ao limpar o banco local:', error);
    }
  }

  function initializeSupabase() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      state.syncError = 'Biblioteca do Supabase não carregada.';
      return;
    }

    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.apiKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  async function loadData() {
    state.entries = [];

    if (!supabaseClient) {
      console.warn(state.syncError || 'Cliente do Supabase não inicializado.');
      return;
    }

    try {
      state.entries = await fetchEntriesFromSupabase();
      state.syncError = '';
    } catch (error) {
      state.syncError = 'Não foi possível carregar os dados do Supabase.';
      console.error('Falha ao carregar dados do Supabase:', error);
    }
  }

  async function fetchEntriesFromSupabase() {
    const { data, error } = await requireSupabase()
      .from(SUPABASE_TABLES.entries)
      .select(ENTRY_COLUMNS)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map(fromDbEntry);
  }

  function requireSupabase() {
    if (!supabaseClient) {
      throw new Error('Cliente do Supabase não inicializado.');
    }

    return supabaseClient;
  }

  function fromDbEntry(row) {
    return {
      id: row.id,
      type: row.type,
      description: row.description,
      value: Number(row.value || 0),
      category: row.category,
      date: row.date,
      isFixed: Boolean(row.is_fixed),
      payment: row.payment || '',
      notes: row.notes || '',
      createdAt: row.created_at ? new Date(row.created_at).getTime() : 0
    };
  }

  function toDbEntry(payload) {
    return {
      type: payload.type,
      description: payload.description,
      value: Number(payload.value),
      category: payload.category,
      date: payload.date,
      is_fixed: Boolean(payload.isFixed),
      payment: payload.payment || null,
      notes: payload.notes || null
    };
  }

  async function createEntryInSupabase(payload) {
    const { data, error } = await requireSupabase()
      .from(SUPABASE_TABLES.entries)
      .insert(toDbEntry(payload))
      .select(ENTRY_COLUMNS)
      .single();

    if (error) throw error;
    return fromDbEntry(data);
  }

  async function updateEntryInSupabase(id, payload) {
    const { data, error } = await requireSupabase()
      .from(SUPABASE_TABLES.entries)
      .update(toDbEntry(payload))
      .eq('id', id)
      .select(ENTRY_COLUMNS)
      .single();

    if (error) throw error;
    return fromDbEntry(data);
  }

  async function deleteEntryFromSupabase(id) {
    const { error } = await requireSupabase()
      .from(SUPABASE_TABLES.entries)
      .delete()
      .eq('id', id);

    if (error) throw error;
  }

  function switchView(viewName) {
    const config = VIEW_CONFIG[viewName];
    if (!config) return;

    state.activeView = viewName;
    refs.pageTitle.textContent = config.title;
    refs.pageSubtitle.textContent = config.subtitle;

    $$('.nav-item').forEach(item => item.classList.toggle('is-active', item.dataset.view === viewName));
    $$('.view').forEach(view => view.classList.remove('is-active'));
    document.getElementById(config.element).classList.add('is-active');

    closeMobileMenu();
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openMobileMenu() {
    refs.sidebar.classList.add('is-open');
    refs.sidebarOverlay.classList.add('is-open');
  }

  function closeMobileMenu() {
    refs.sidebar.classList.remove('is-open');
    refs.sidebarOverlay.classList.remove('is-open');
  }

  function toggleSidebar() {
    const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
    refs.sidebarToggleButton.setAttribute('aria-expanded', String(!isCollapsed));
    refs.sidebarToggleButton.setAttribute('aria-label', isCollapsed ? 'Expandir menu' : 'Recolher menu');
    refs.sidebarToggleButton.innerHTML = '<i data-lucide="menu" aria-hidden="true"></i>';
    refreshIcons();
    renderAll();
    window.setTimeout(renderAll, 240);
  }

  function syncFormDateToMonth() {
    if (!refs.dateInput.value || refs.dateInput.value.slice(0, 7) !== state.selectedMonth) {
      refs.dateInput.value = `${state.selectedMonth}-01`;
    }
  }

  function setEntryType(type) {
    state.entryType = type;
    $$('#typeControl .segment').forEach(button => {
      button.classList.toggle('is-selected', button.dataset.type === type);
    });

    const isExpense = type === 'expense';
    refs.fixedField.style.opacity = isExpense ? '1' : '0.55';
    $$('#fixedControl .segment').forEach(button => button.disabled = !isExpense);
    if (!isExpense) setFixed(false);
    populateCategoryInput(type);
  }

  function setFixed(value) {
    state.isFixed = Boolean(value);
    $$('#fixedControl .segment').forEach(button => {
      button.classList.toggle('is-selected', button.dataset.fixed === String(state.isFixed));
    });
  }

  function populateCategoryInput(type, selected = '') {
    const categories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    refs.categoryInput.innerHTML = '<option value="">Selecione uma categoria</option>' + categories
      .map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
      .join('');
    refs.categoryInput.value = selected;
  }

  function resetEntryForm() {
    refs.entryForm.reset();
    state.editingId = null;
    refs.entryId.value = '';
    refs.entryFormTitle.textContent = 'Novo lançamento';
    refs.saveEntryButton.textContent = 'Salvar lançamento';
    refs.cancelEditButton.classList.add('hidden');
    refs.formMessage.textContent = '';
    refs.formMessage.className = 'form-message';
    setEntryType('income');
    setFixed(false);
    refs.paymentInput.value = '';
    refs.notesInput.value = '';
    syncFormDateToMonth();
  }

  async function handleEntrySubmit(event) {
    event.preventDefault();

    const description = refs.descriptionInput.value.trim();
    const value = Number(refs.valueInput.value);
    const category = refs.categoryInput.value;
    const date = refs.dateInput.value;

    if (!description || !Number.isFinite(value) || value <= 0 || !category || !date) {
      showFormMessage('Preencha descrição, valor, categoria e data.', 'error');
      return;
    }

    const payload = {
      type: state.entryType,
      description,
      value,
      category,
      date,
      isFixed: state.entryType === 'expense' ? state.isFixed : false,
      payment: refs.paymentInput.value,
      notes: refs.notesInput.value.trim()
    };

    const editingId = state.editingId;
    refs.saveEntryButton.disabled = true;
    refs.saveEntryButton.textContent = 'Salvando...';

    try {
      if (editingId) {
        const updatedEntry = await updateEntryInSupabase(editingId, payload);
        const index = state.entries.findIndex(entry => entry.id === editingId);
        if (index >= 0) {
          state.entries[index] = updatedEntry;
        } else {
          state.entries.push(updatedEntry);
        }
        showFormMessage('Lançamento atualizado.', 'success');
      } else {
        const createdEntry = await createEntryInSupabase(payload);
        state.entries.push(createdEntry);
        showFormMessage('Lançamento salvo.', 'success');
      }

      const savedMessage = refs.formMessage.textContent;
      resetEntryForm();
      showFormMessage(savedMessage, 'success');
      renderAll();
    } catch (error) {
      console.error('Falha ao salvar lançamento no Supabase:', error);
      showFormMessage('Não foi possível salvar no Supabase. Confira as tabelas e políticas.', 'error');
    } finally {
      refs.saveEntryButton.disabled = false;
      if (refs.saveEntryButton.textContent === 'Salvando...') {
        refs.saveEntryButton.textContent = editingId ? 'Salvar alterações' : 'Salvar lançamento';
      }
    }
  }

  function showFormMessage(message, type) {
    refs.formMessage.textContent = message;
    refs.formMessage.className = `form-message ${type}`;
  }

  function handleTableAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const { action, id } = button.dataset;
    if (action === 'edit') editEntry(id);
    if (action === 'delete') requestDelete(id);
  }

  function editEntry(id) {
    const entry = state.entries.find(item => item.id === id);
    if (!entry) return;

    state.editingId = id;
    refs.entryId.value = id;
    refs.entryFormTitle.textContent = 'Editar lançamento';
    refs.saveEntryButton.textContent = 'Salvar alterações';
    refs.cancelEditButton.classList.remove('hidden');

    setEntryType(entry.type);
    populateCategoryInput(entry.type, entry.category);
    setFixed(entry.isFixed);
    refs.descriptionInput.value = entry.description;
    refs.valueInput.value = entry.value;
    refs.dateInput.value = entry.date;
    refs.paymentInput.value = entry.payment || '';
    refs.notesInput.value = entry.notes || '';
    switchView('entries');
    refs.entryForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function requestDelete(id) {
    state.pendingDeleteId = id;
    if (typeof refs.confirmDialog.showModal === 'function') {
      refs.confirmDialog.showModal();
    } else if (window.confirm('Excluir este lançamento?')) {
      deleteEntry(id);
    }
  }

  async function deleteEntry(id) {
    try {
      await deleteEntryFromSupabase(id);
      state.entries = state.entries.filter(entry => entry.id !== id);
      if (state.editingId === id) resetEntryForm();
      renderAll();
    } catch (error) {
      console.error('Falha ao excluir lançamento no Supabase:', error);
      window.alert('Não foi possível excluir no Supabase.');
    }
  }

  function renderAll() {
    const entries = getSelectedEntries();
    const metrics = calculateMonth(entries);

    renderDashboard(entries, metrics);
    renderEntries(entries, metrics);
    renderPlanning(entries, metrics);
    populateHistoryCategoryFilter();
    renderHistory();
    refreshIcons();
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  function getSelectedEntries() {
    return state.entries
      .filter(entry => entry.date && entry.date.slice(0, 7) === state.selectedMonth)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  }

  function calculateMonth(entries = getSelectedEntries(), overridePercent = null) {
    const income = sum(entries.filter(e => e.type === 'income').map(e => e.value));
    const fixed = sum(entries.filter(e => e.type === 'expense' && e.isFixed).map(e => e.value));
    const variable = sum(entries.filter(e => e.type === 'expense' && !e.isFixed).map(e => e.value));
    const baseBalance = income - fixed;
    const percent = overridePercent == null ? FIXED_SAVE_PERCENT : Number(overridePercent);
    const positiveBase = Math.max(baseBalance, 0);
    const saving = positiveBase * (percent / 100);
    const spendLimit = positiveBase - saving;
    const availableNow = spendLimit - variable;
    const totalExpenses = fixed + variable;
    const cashBalance = income - totalExpenses;

    return { income, fixed, variable, baseBalance, percent, saving, spendLimit, availableNow, totalExpenses, cashBalance };
  }

  function renderDashboard(entries, metrics) {
    setText('#dashIncome', currency(metrics.income));
    setText('#dashFixed', currency(metrics.fixed));
    setText('#dashBaseBalance', currency(metrics.baseBalance));
    setText('#dashSaving', currency(metrics.saving));
    setText('#dashSavingPercent', `${metrics.percent}% do restante`);
    setText('#dashSpendLimit', currency(metrics.spendLimit));
    setText('#dashAvailableNow', currency(metrics.availableNow));

    setText('#calcIncome', currency(metrics.income));
    setText('#calcFixed', currency(metrics.fixed));
    setText('#calcBase', currency(metrics.baseBalance));
    setText('#calcPercentLabel', `(${metrics.percent}%)`);
    setText('#calcSaving', currency(metrics.saving));
    setText('#calcSpendLimit', currency(metrics.spendLimit));
    setText('#calcVariable', currency(metrics.variable));
    setText('#calcAvailable', currency(metrics.availableNow));

    toggleNegative('#dashBaseBalance', metrics.baseBalance);
    toggleNegative('#dashAvailableNow', metrics.availableNow);
    toggleNegative('#calcBase', metrics.baseBalance);
    toggleNegative('#calcAvailable', metrics.availableNow);

    renderCalculationBar(metrics);
    renderExpenseFlowChart(entries);
    renderCategoryDonut(entries);
    renderRecentEntries(entries);
  }

  function renderCalculationBar(metrics) {
    const denominator = Math.max(metrics.income, 1);
    const values = {
      barIncome: 0,
      barFixed: Math.max(metrics.fixed, 0),
      barSaving: Math.max(metrics.saving, 0),
      barVariable: Math.max(metrics.variable, 0),
      barAvailable: Math.max(metrics.availableNow, 0)
    };

    Object.entries(values).forEach(([id, value]) => {
      const width = Math.min((value / denominator) * 100, 100);
      const element = document.getElementById(id);
      element.style.width = `${width}%`;
      element.style.display = width <= 0 ? 'none' : 'block';
    });
  }

  function renderEntries(entries, metrics) {
    setText('#entriesIncome', currency(metrics.income));
    setText('#entriesFixed', currency(metrics.fixed));
    setText('#entriesVariable', currency(metrics.variable));
    setText('#entriesBalance', currency(metrics.cashBalance));
    toggleNegative('#entriesBalance', metrics.cashBalance);
  }

  function renderRecentEntries(entries) {
    const recent = entries.slice(0, 5);
    refs.recentEntriesBody.innerHTML = recent.map(entry => `
      <tr>
        <td>${formatDate(entry.date)}</td>
        <td>${escapeHtml(entry.description)}</td>
        <td>${entryTypePill(entry)}</td>
        <td>${escapeHtml(entry.category)}</td>
        <td class="${entry.type === 'income' ? 'amount-income' : 'amount-expense'}">${entry.type === 'expense' ? '− ' : ''}${currency(entry.value)}</td>
      </tr>
    `).join('');

    refs.recentEmpty.style.display = recent.length ? 'none' : 'block';
  }

  function populateHistoryCategoryFilter() {
    const current = refs.historyCategoryFilter.value || 'all';
    const categories = [...new Set([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES])];
    refs.historyCategoryFilter.innerHTML = '<option value="all">Todas as categorias</option>' + categories
      .map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
      .join('');
    refs.historyCategoryFilter.value = categories.includes(current) ? current : 'all';
  }

  function renderHistory() {
    const category = refs.historyCategoryFilter.value;
    const type = refs.historyTypeFilter.value;
    const search = refs.historySearch.value.trim().toLocaleLowerCase('pt-BR');

    const filtered = getSelectedEntries().filter(entry => {
      const categoryMatch = category === 'all' || entry.category === category;
      const searchMatch = !search || `${entry.description} ${entry.category}`.toLocaleLowerCase('pt-BR').includes(search);
      let typeMatch = true;
      if (type === 'income') typeMatch = entry.type === 'income';
      if (type === 'expense') typeMatch = entry.type === 'expense';
      if (type === 'fixed') typeMatch = entry.type === 'expense' && entry.isFixed;
      if (type === 'variable') typeMatch = entry.type === 'expense' && !entry.isFixed;
      return categoryMatch && searchMatch && typeMatch;
    });

    refs.historyBody.innerHTML = filtered.map(entry => `
      <tr>
        <td>${formatDate(entry.date)}</td>
        <td>${escapeHtml(entry.description)}</td>
        <td>${entryTypePill(entry)}</td>
        <td>${escapeHtml(entry.category)}</td>
        <td>${entry.type === 'expense' ? `<span class="pill ${entry.isFixed ? 'pill-fixed' : 'pill-variable'}">${entry.isFixed ? 'Sim' : 'Não'}</span>` : '—'}</td>
        <td class="${entry.type === 'income' ? 'amount-income' : 'amount-expense'}">${entry.type === 'expense' ? '− ' : ''}${currency(entry.value)}</td>
        <td>
          <div class="icon-actions">
            <button class="icon-button" type="button" data-action="edit" data-id="${entry.id}" aria-label="Editar ${escapeHtml(entry.description)}"><i data-lucide="pencil" aria-hidden="true"></i></button>
            <button class="icon-button delete" type="button" data-action="delete" data-id="${entry.id}" aria-label="Excluir ${escapeHtml(entry.description)}"><i data-lucide="trash-2" aria-hidden="true"></i></button>
          </div>
        </td>
      </tr>
    `).join('');

    refs.historyEmpty.style.display = filtered.length ? 'none' : 'block';
  }

  function renderPlanning(entries, metrics) {
    setText('#planIncome', currency(metrics.income));
    setText('#planFixed', currency(metrics.fixed));
    setText('#planBase', currency(metrics.baseBalance));
    setText('#planPercent', `${metrics.percent}%`);
    setText('#planSaving', currency(metrics.saving));
    setText('#planSpendLimit', currency(metrics.spendLimit));

    refs.planIncomeInput.value = currency(metrics.income);
    refs.planFixedInput.value = currency(metrics.fixed);
    refs.planPercentInput.value = metrics.percent;

    setText('#planFormulaResult', currency(metrics.baseBalance));
    setText('#planningDonutTotal', currency(metrics.baseBalance));
    setText('#splitSaving', currency(metrics.saving));
    setText('#splitSpending', currency(metrics.spendLimit));
    setText('#splitSavingPercent', `${metrics.percent}%`);
    setText('#splitSpendingPercent', `${100 - metrics.percent}%`);

    setText('#summaryIncome', currency(metrics.income));
    setText('#summaryFixed', currency(metrics.fixed));
    setText('#summaryBase', currency(metrics.baseBalance));
    setText('#summarySaving', currency(metrics.saving));
    setText('#summarySpendLimit', currency(metrics.spendLimit));
    setText('#summaryVariable', currency(metrics.variable));
    setText('#summaryAvailable', currency(metrics.availableNow));

    toggleNegative('#planBase', metrics.baseBalance);
    toggleNegative('#planFormulaResult', metrics.baseBalance);
    toggleNegative('#summaryBase', metrics.baseBalance);
    toggleNegative('#summaryAvailable', metrics.availableNow);

    renderPlanningDonut(metrics);
    renderBudgetCategoryBars(entries, metrics);
  }

  function renderExpenseFlowChart(entries) {
    const canvas = $('#expenseFlowChart');
    if (!canvas || !canvas.offsetParent) return;

    const expenseEntries = entries.filter(entry => entry.type === 'expense');
    const daysInMonth = getDaysInSelectedMonth();
    const daily = Array.from({ length: daysInMonth }, () => 0);
    expenseEntries.forEach(entry => {
      const day = Number(entry.date.slice(-2));
      if (day >= 1 && day <= daysInMonth) daily[day - 1] += entry.value;
    });

    const { ctx, width, height } = prepareCanvas(canvas, 310);
    ctx.clearRect(0, 0, width, height);

    const padding = { top: 22, right: 12, bottom: 34, left: 48 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const maxValue = Math.max(...daily, 100);
    const roundedMax = Math.ceil(maxValue / 100) * 100;

    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7b879c';
    ctx.strokeStyle = '#e6eaf1';
    ctx.lineWidth = 1;

    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const ratio = i / gridLines;
      const y = padding.top + chartHeight - ratio * chartHeight;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.fillText(formatCompactNumber(roundedMax * ratio), padding.left - 8, y);
    }

    const slot = chartWidth / daysInMonth;
    const barWidth = Math.max(4, Math.min(13, slot * 0.55));

    daily.forEach((value, index) => {
      const x = padding.left + slot * index + (slot - barWidth) / 2;
      const barHeight = roundedMax > 0 ? (value / roundedMax) * chartHeight : 0;
      const y = padding.top + chartHeight - barHeight;
      drawRoundedRect(ctx, x, y, barWidth, barHeight, Math.min(5, barWidth / 2), '#e94b50');
    });

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#7b879c';
    const marks = [1, 5, 10, 15, 20, 25, daysInMonth];
    [...new Set(marks.filter(day => day <= daysInMonth))].forEach(day => {
      const x = padding.left + slot * (day - 1) + slot / 2;
      ctx.fillText(String(day), x, height - padding.bottom + 10);
    });
  }

  function renderCategoryDonut(entries) {
    const expenseEntries = entries.filter(entry => entry.type === 'expense');
    const totals = groupTotalsByCategory(expenseEntries);
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const total = sum(sorted.map(([, value]) => value));

    setText('#categoryTotal', currency(total));
    const legend = $('#categoryLegend');
    legend.innerHTML = sorted.length
      ? sorted.map(([category, value]) => {
        const percent = total > 0 ? (value / total) * 100 : 0;
        return `
          <div class="category-legend-item">
            <span class="category-name"><i class="dot" style="background:${CATEGORY_COLORS[category] || '#8b96a9'}"></i>${escapeHtml(category)}</span>
            <span class="category-amount">${currency(value)}</span>
            <span class="category-percent">${percent.toFixed(0)}%</span>
          </div>`;
      }).join('')
      : '<div class="empty-state" style="display:block;padding:0;text-align:left">Sem gastos no mês.</div>';

    drawDonut($('#categoryDonutChart'), sorted.map(([category, value]) => ({
      value,
      color: CATEGORY_COLORS[category] || '#8b96a9'
    })), '#ffffff');
  }

  function renderPlanningDonut(metrics) {
    drawDonut($('#planningDonutChart'), [
      { value: Math.max(metrics.saving, 0), color: '#f28b13' },
      { value: Math.max(metrics.spendLimit, 0), color: '#1f67e8' }
    ], '#ffffff');
  }

  function drawDonut(canvas, items, holeColor) {
    if (!canvas || !canvas.offsetParent) return;
    const { ctx, width, height } = prepareSquareCanvas(canvas);
    ctx.clearRect(0, 0, width, height);

    const total = sum(items.map(item => item.value));
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.42;
    const innerRadius = radius * 0.58;

    if (total <= 0) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.strokeStyle = '#e8ecf3';
      ctx.lineWidth = radius - innerRadius;
      ctx.stroke();
      return;
    }

    let startAngle = -Math.PI / 2;
    items.forEach(item => {
      const angle = (item.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, startAngle + angle);
      ctx.arc(centerX, centerY, innerRadius, startAngle + angle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = item.color;
      ctx.fill();
      startAngle += angle;
    });

    ctx.beginPath();
    ctx.arc(centerX, centerY, innerRadius - 1, 0, Math.PI * 2);
    ctx.fillStyle = holeColor;
    ctx.fill();
  }

  function renderBudgetCategoryBars(entries, metrics) {
    const variableEntries = entries.filter(entry => entry.type === 'expense' && !entry.isFixed);
    const totals = groupTotalsByCategory(variableEntries);
    const categories = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const container = $('#budgetCategoryBars');

    if (!categories.length) {
      container.innerHTML = '<div class="empty-state" style="display:block;padding:14px 0;text-align:left">Nenhum gasto variável lançado.</div>';
    } else {
      container.innerHTML = categories.map(([category, value]) => {
        const percentOfLimit = metrics.spendLimit > 0 ? Math.min((value / metrics.spendLimit) * 100, 100) : 0;
        return `
          <div class="budget-row">
            <span class="budget-name">${escapeHtml(category)}</span>
            <span class="budget-track"><span class="budget-fill" style="width:${percentOfLimit}%;background:${CATEGORY_COLORS[category] || '#8b96a9'}"></span></span>
            <span class="budget-percent">${percentOfLimit.toFixed(0)}%</span>
            <span class="budget-amount">${currency(value)}</span>
          </div>`;
      }).join('');
    }

    setText('#budgetTotalSpent', currency(metrics.variable));
    setText('#budgetTotalLimit', currency(metrics.spendLimit));
  }

  function groupTotalsByCategory(entries) {
    return entries.reduce((acc, entry) => {
      acc[entry.category] = (acc[entry.category] || 0) + Number(entry.value || 0);
      return acc;
    }, {});
  }

  function prepareCanvas(canvas, cssHeight) {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(260, canvas.clientWidth || canvas.parentElement.clientWidth || 500);
    const height = cssHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  }

  function prepareSquareCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const parentWidth = canvas.parentElement.clientWidth || canvas.clientWidth || 220;
    const parentHeight = canvas.parentElement.clientHeight || canvas.clientHeight || parentWidth;
    const size = Math.max(180, Math.round(Math.min(parentWidth, parentHeight)));

    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: size, height: size };
  }

  function drawRoundedRect(ctx, x, y, width, height, radius, color) {
    if (height <= 0 || width <= 0) return;
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function getDaysInSelectedMonth() {
    const [year, month] = state.selectedMonth.split('-').map(Number);
    return new Date(year, month, 0).getDate();
  }

  function entryTypePill(entry) {
    return entry.type === 'income'
      ? '<span class="pill pill-income">Ganho</span>'
      : `<span class="pill pill-expense">${entry.isFixed ? 'Gasto fixo' : 'Gasto'}</span>`;
  }

  function currency(value) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2
    }).format(Number(value || 0));
  }

  function formatDate(dateString) {
    if (!dateString) return '—';
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
  }

  function formatCompactNumber(value) {
    if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
    return Math.round(value).toString();
  }

  function sum(values) {
    return values.reduce((total, value) => total + Number(value || 0), 0);
  }

  function clampPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(90, Math.round(number)));
  }

  function setText(selector, text) {
    const element = typeof selector === 'string' ? $(selector) : selector;
    if (element) element.textContent = text;
  }

  function toggleNegative(selector, value) {
    const element = $(selector);
    if (!element) return;
    element.classList.toggle('text-red', value < 0);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
})();
