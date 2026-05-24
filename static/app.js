// ==========================================================================
// CONFIGURAÇÕES GERAIS E ESTADO GLOBAL
// ==========================================================================

const API_BASE_URL = window.location.origin; // O front e o back rodam na mesma porta em prod
let CURRENT_USER = null;
let SELECTED_PATIENT = null;
let EDIT_SELECTED_PATIENT = null;
let DEMANDS_CHART = null;
let RESPONSIBLES_CHART = null;
let ACTIVE_COUNTDOWN_INTERVAL = null;
let NOTIFICATION_POLL_INTERVAL = null;
let CURRENT_DEMANDS = [];
let SORT_COLUMN = '';
let SORT_DIRECTION = 'asc';
let COMPLETED_DEMANDS = [];
let SORT_COLUMN_COMPLETED = '';
let SORT_DIRECTION_COMPLETED = 'asc';

// ==========================================================================
// SESSÃO E AUTENTICAÇÃO (JWT)
// ==========================================================================

function getAuthToken() {
    return localStorage.getItem('token');
}

function setAuthToken(token) {
    if (token) {
        localStorage.setItem('token', token);
    } else {
        localStorage.removeItem('token');
    }
}

function getHeaders() {
    const headers = {
        'Content-Type': 'application/json'
    };
    const token = getAuthToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

// Inicializar aplicativo
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    setupEventListeners();
    checkAuthSession();
    updateDateDisplay();
});

// Verifica se o usuário já possui sessão ativa
async function checkAuthSession() {
    const token = getAuthToken();
    if (!token) {
        showView('login');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
            method: 'GET',
            headers: getHeaders()
        });
        
        if (response.ok) {
            CURRENT_USER = await response.json();
            setupUserProfile();
            showView('app');
            switchView('dashboard');
            requestNotificationPermission();
            startNotificationPolling();
        } else {
            // Token inválido/expirado
            logout();
        }
    } catch (error) {
        console.error("Erro ao validar sessão:", error);
        // Em caso de erro de rede, mantém o token mas alerta o usuário
        showToast("Erro ao conectar ao servidor. Rodando offline.", "error");
        showView('login');
    }
}

// Configura o painel do usuário logado na sidebar
function setupUserProfile() {
    if (!CURRENT_USER) return;
    
    document.getElementById('profile-name').textContent = CURRENT_USER.name;
    document.getElementById('profile-role').textContent = CURRENT_USER.role;
    
    // Iniciais para o avatar
    const nameParts = CURRENT_USER.name.split(' ');
    const initials = nameParts.length > 1 
        ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
        : nameParts[0].substring(0, 2).toUpperCase();
    
    document.getElementById('user-avatar-initials').textContent = initials;

    // Atualiza elementos baseados na role do usuário
    updateUIForRole();
}

// Função auxiliar para atualizar a interface com base no papel do usuário
function updateUIForRole() {
    if (!CURRENT_USER) return;
    const isAdmin = CURRENT_USER.role === 'Admin';
    
    // Exibir ou ocultar elementos de ação restritos a Admin
    document.querySelectorAll('.admin-only').forEach(el => {
        if (isAdmin) {
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    });

    // Ajustar painel de pacientes se não for Admin
    const patientFormPanel = document.querySelector('.patient-form-panel');
    const patientsLayout = document.querySelector('.patients-layout');
    if (patientFormPanel && patientsLayout) {
        if (isAdmin) {
            patientFormPanel.classList.remove('hidden');
            patientsLayout.style.gridTemplateColumns = '0.8fr 1.2fr';
        } else {
            patientFormPanel.classList.add('hidden');
            patientsLayout.style.gridTemplateColumns = '1fr';
        }
    }

    // Ajustar botão rápido de novo paciente
    const btnQuickNewPatient = document.getElementById('btn-quick-new-patient');
    if (btnQuickNewPatient) {
        if (isAdmin) {
            btnQuickNewPatient.classList.remove('hidden');
        } else {
            btnQuickNewPatient.classList.add('hidden');
        }
    }
}

function logout() {
    setAuthToken(null);
    CURRENT_USER = null;
    if (ACTIVE_COUNTDOWN_INTERVAL) {
        clearInterval(ACTIVE_COUNTDOWN_INTERVAL);
    }
    stopNotificationPolling();
    showView('login');
    showToast("Sessão encerrada com sucesso.", "info");
}

// ==========================================================================
// TOAST NOTIFICATIONS (ALERTAS FLUTUANTES)
// ==========================================================================

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'fa-circle-check';
    if (type === 'error') iconClass = 'fa-circle-xmark';
    if (type === 'info') iconClass = 'fa-circle-info';
    
    toast.innerHTML = `
        <i class="fa-solid ${iconClass} toast-icon"></i>
        <div class="toast-message">${message}</div>
    `;
    
    container.appendChild(toast);
    
    // Auto-destruição após 4 segundos com efeito suave
    setTimeout(() => {
        toast.style.transform = 'translateX(120%)';
        toast.style.opacity = '0';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

// ==========================================================================
// NOTIFICAÇÕES VIA BROWSER
// ==========================================================================

function requestNotificationPermission() {
    if (!("Notification" in window)) {
        console.log("Este navegador não suporta notificações de desktop.");
        return;
    }
    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }
}

function startNotificationPolling() {
    if (NOTIFICATION_POLL_INTERVAL) {
        clearInterval(NOTIFICATION_POLL_INTERVAL);
    }
    
    // Executa a primeira busca imediatamente
    pollNotifications();
    
    // Configura o intervalo para buscar a cada 20 segundos
    NOTIFICATION_POLL_INTERVAL = setInterval(pollNotifications, 20000);
}

function stopNotificationPolling() {
    if (NOTIFICATION_POLL_INTERVAL) {
        clearInterval(NOTIFICATION_POLL_INTERVAL);
        NOTIFICATION_POLL_INTERVAL = null;
    }
}

async function pollNotifications() {
    if (!getAuthToken()) {
        stopNotificationPolling();
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/notifications`, {
            method: 'GET',
            headers: getHeaders()
        });
        
        if (!response.ok) return;
        
        const notifications = await response.json();
        if (notifications && notifications.length > 0) {
            notifications.forEach(notif => {
                // Notificação no Navegador
                if (Notification.permission === "granted") {
                    try {
                        const browserNotification = new Notification("JurisFlow", {
                            body: notif.message,
                            icon: "favicon.png"
                        });
                        
                        browserNotification.onclick = function() {
                            window.focus();
                            if (notif.demand_id) {
                                viewDemandDetails(notif.demand_id);
                            }
                        };
                    } catch (err) {
                        console.error("Erro ao instanciar Notification:", err);
                    }
                }
                
                // Mostrar também um toast interno na tela
                showToast(notif.message, "info");
            });
            
            // Marcar todas como lidas
            const ids = notifications.map(n => n.id);
            await fetch(`${API_BASE_URL}/api/notifications/mark-read`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ ids })
            });
        }
    } catch (error) {
        console.error("Erro ao buscar notificações do servidor:", error);
    }
}

// ==========================================================================
// GERENCIADOR DE TEMAS (DARK / LIGHT)
// ==========================================================================

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark-theme';
    document.body.className = savedTheme;
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.body.classList.contains('dark-theme') ? 'dark-theme' : 'light-theme';
    const newTheme = currentTheme === 'dark-theme' ? 'light-theme' : 'dark-theme';
    document.body.className = newTheme;
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
    const icon = document.querySelector('#theme-toggle-btn i');
    if (!icon) return;
    if (theme === 'dark-theme') {
        icon.className = 'fa-solid fa-sun';
    } else {
        icon.className = 'fa-solid fa-moon';
    }
}

// ==========================================================================
// NAVEGAÇÃO DA APLICAÇÃO (ROTAS SPA)
// ==========================================================================

function showView(viewType) {
    // viewType: 'login' ou 'app'
    const loginView = document.getElementById('login-view');
    const appView = document.getElementById('app-view');
    
    if (viewType === 'login') {
        loginView.classList.add('active');
        appView.classList.remove('active');
    } else {
        loginView.classList.remove('active');
        appView.classList.add('active');
    }
}

// Alternar entre as subviews internas do app
function switchView(target) {
    // Desativar todas as subviews
    document.querySelectorAll('.subview').forEach(view => {
        view.classList.remove('active');
    });
    
    // Desativar todos os itens de menu
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Ativar a subview alvo
    const targetView = document.getElementById(`subview-${target}`);
    if (targetView) {
        targetView.classList.add('active');
    }
    
    // Ativar o item do menu correspondente
    const menuItem = document.querySelector(`.menu-item[data-target="${target}"]`);
    if (menuItem) {
        menuItem.classList.add('active');
    }
    
    // Atualizar título no header
    const titles = {
        'dashboard': 'Dashboard de Controle',
        'demands': 'Controle de Demandas Judiciais',
        'completed': 'Demandas Concluídas',
        'new-demand': 'Cadastrar Nova Demanda',
        'patients': 'Cadastro de Pacientes',
        'users': 'Gerenciamento de Usuários',
        'reports': 'Relatórios Gerenciais',
        'demand-details': 'Detalhes do Processo'
    };
    document.getElementById('current-view-title').textContent = titles[target] || 'Sistema';

    // Desativar interval de countdown antigo se mudar de view
    if (ACTIVE_COUNTDOWN_INTERVAL && target !== 'dashboard' && target !== 'demand-details') {
        clearInterval(ACTIVE_COUNTDOWN_INTERVAL);
        ACTIVE_COUNTDOWN_INTERVAL = null;
    }

    // Ações ao abrir cada view
    if (target === 'dashboard') {
        loadDashboardData();
    } else if (target === 'demands') {
        loadDemandsList();
    } else if (target === 'completed') {
        loadCompletedDemandsList();
    } else if (target === 'new-demand') {
        clearNewDemandForm();
        loadUsersForDropdown('demand-responsible');
        setDefaultReceivedTime();
    } else if (target === 'patients') {
        loadPatientsList();
    } else if (target === 'users') {
        loadUsersList();
    } else if (target === 'reports') {
        setupReportsPage();
    }
}

function updateDateDisplay() {
    const dateEl = document.getElementById('date-display');
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    dateEl.textContent = new Date().toLocaleDateString('pt-BR', options);
}

// ==========================================================================
// CONFIGURAÇÃO DOS COMPONENTES (EVENT LISTENERS)
// ==========================================================================

function setupEventListeners() {
    // Formulário de Login
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    
    // Logout
    document.getElementById('btn-logout').addEventListener('click', logout);
    
    // Alternância de Tema
    document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);
    
    // Menu de navegação da sidebar
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const target = item.getAttribute('data-target');
            switchView(target);
        });
    });

    // Filtros de Demandas (Listagem)
    document.getElementById('demands-search').addEventListener('input', debounce(loadDemandsList, 300));
    document.getElementById('demands-filter-status').addEventListener('change', loadDemandsList);
    document.getElementById('demands-filter-my').addEventListener('change', loadDemandsList);

    // Auto-complete de pacientes na criação de demanda
    const patientSearchInput = document.getElementById('demand-patient-search');
    patientSearchInput.addEventListener('input', debounce(handlePatientSearch, 250));
    
    // Limpar seleção do paciente no formulário de demanda
    document.getElementById('btn-clear-patient').addEventListener('click', clearSelectedPatient);

    // Modal de Cadastro Rápido de Paciente (Nova Demanda)
    document.getElementById('btn-quick-new-patient').addEventListener('click', () => {
        openModal('patient-modal');
    });
    
    // Fechar Modal
    document.getElementById('btn-close-patient-modal').addEventListener('click', () => {
        closeModal('patient-modal');
    });
    document.getElementById('btn-cancel-patient-modal').addEventListener('click', () => {
        closeModal('patient-modal');
    });
    
    // Formulário de Cadastro Rápido de Paciente (Modal)
    document.getElementById('quick-patient-form').addEventListener('submit', handleQuickPatientSubmit);

    // Formulário completo de cadastro de paciente (na tela de Pacientes)
    document.getElementById('new-patient-form').addEventListener('submit', handleFullPatientSubmit);
    document.getElementById('patients-list-search').addEventListener('input', debounce(loadPatientsList, 250));

    // Formulário de nova Demanda
    document.getElementById('new-demand-form').addEventListener('submit', handleNewDemandSubmit);

    // Detalhes da Demanda - Abas
    document.querySelectorAll('.tab-btn').forEach(tabBtn => {
        tabBtn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            
            tabBtn.classList.add('active');
            const targetPanel = document.getElementById(`tab-${tabBtn.getAttribute('data-tab')}`);
            if (targetPanel) targetPanel.classList.add('active');
        });
    });

    // Detalhes da Demanda - Ações (Status & Encaminhar)
    document.getElementById('detail-status-select').addEventListener('change', handleDetailStatusChange);
    document.getElementById('detail-forward-select').addEventListener('change', handleDetailForwardChange);
    
    // Detalhes da Demanda - Adicionar Comentário
    document.getElementById('add-comment-form').addEventListener('submit', handleCommentSubmit);

    // Máscaras de CPF
    const patCpf = document.getElementById('pat-cpf');
    if (patCpf) {
        patCpf.setAttribute('maxlength', '14');
        patCpf.addEventListener('input', (e) => {
            e.target.value = maskCPF(e.target.value);
        });
    }
    const quickPatCpf = document.getElementById('quick-pat-cpf');
    if (quickPatCpf) {
        quickPatCpf.setAttribute('maxlength', '14');
        quickPatCpf.addEventListener('input', (e) => {
            e.target.value = maskCPF(e.target.value);
        });
    }

    // Máscara de ProData
    const demandProdata = document.getElementById('demand-prodata-number');
    if (demandProdata) {
        demandProdata.setAttribute('maxlength', '12');
        demandProdata.addEventListener('input', (e) => {
            e.target.value = maskProData(e.target.value);
        });
    }

    // Ouvintes para cálculo automático do prazo limite
    const receivedInput = document.getElementById('demand-received-at');
    const durationDaysInput = document.getElementById('demand-duration-days');
    const durationHoursInput = document.getElementById('demand-duration-hours');
    if (receivedInput && durationDaysInput && durationHoursInput) {
        receivedInput.addEventListener('input', calculateDemandDeadline);
        durationDaysInput.addEventListener('input', calculateDemandDeadline);
        durationHoursInput.addEventListener('input', calculateDemandDeadline);
    }

    // Modal de Confirmação de Encaminhamento
    document.getElementById('btn-ok-confirm-modal').addEventListener('click', () => {
        if (CONFIRM_MODAL_CALLBACK) {
            CONFIRM_MODAL_CALLBACK(true);
            CONFIRM_MODAL_CALLBACK = null;
        }
        closeModal('confirm-modal');
    });
    
    const cancelConfirmAction = () => {
        if (CONFIRM_MODAL_CALLBACK) {
            CONFIRM_MODAL_CALLBACK(false);
            CONFIRM_MODAL_CALLBACK = null;
        }
        closeModal('confirm-modal');
    };
    document.getElementById('btn-cancel-confirm-modal').addEventListener('click', cancelConfirmAction);
    document.getElementById('btn-close-confirm-modal').addEventListener('click', cancelConfirmAction);

    // Modal de Edição de Paciente
    document.getElementById('btn-close-edit-patient-modal').addEventListener('click', () => {
        closeModal('edit-patient-modal');
    });
    document.getElementById('btn-cancel-edit-patient-modal').addEventListener('click', () => {
        closeModal('edit-patient-modal');
    });
    document.getElementById('edit-patient-form').addEventListener('submit', handleEditPatientSubmit);
    
    const editPatCpf = document.getElementById('edit-pat-cpf');
    if (editPatCpf) {
        editPatCpf.setAttribute('maxlength', '14');
        editPatCpf.addEventListener('input', (e) => {
            e.target.value = maskCPF(e.target.value);
        });
    }

    // Edição Completa de Demanda - Botões do Modal e Eventos
    document.getElementById('btn-edit-demand').addEventListener('click', openEditDemandModal);
    document.getElementById('btn-close-edit-demand-modal').addEventListener('click', () => closeModal('edit-demand-modal'));
    document.getElementById('btn-cancel-edit-demand-modal').addEventListener('click', () => closeModal('edit-demand-modal'));
    document.getElementById('edit-demand-form').addEventListener('submit', handleEditDemandSubmit);
    
    // Auto-complete de pacientes na edição de demanda
    const editDemandPatientSearch = document.getElementById('edit-demand-patient-search');
    if (editDemandPatientSearch) {
        editDemandPatientSearch.addEventListener('input', debounce(handleEditPatientSearch, 250));
    }
    
    // Limpar seleção de paciente na edição
    document.getElementById('btn-edit-clear-patient').addEventListener('click', clearEditSelectedPatient);
    
    // Ouvintes para cálculo automático do prazo limite na edição
    const editReceivedInput = document.getElementById('edit-demand-received-at');
    const editDurationDaysInput = document.getElementById('edit-demand-duration-days');
    const editDurationHoursInput = document.getElementById('edit-demand-duration-hours');
    if (editReceivedInput && editDurationDaysInput && editDurationHoursInput) {
        editReceivedInput.addEventListener('input', calculateEditDemandDeadline);
        editDurationDaysInput.addEventListener('input', calculateEditDemandDeadline);
        editDurationHoursInput.addEventListener('input', calculateEditDemandDeadline);
    }
    
    // Máscara de ProData na edição
    const editDemandProdata = document.getElementById('edit-demand-prodata-number');
    if (editDemandProdata) {
        editDemandProdata.setAttribute('maxlength', '12');
        editDemandProdata.addEventListener('input', (e) => {
            e.target.value = maskProData(e.target.value);
        });
    }

    // Dropdown de Urgência (Listagem)
    const filterUrgency = document.getElementById('demands-filter-urgency');
    if (filterUrgency) {
        filterUrgency.addEventListener('change', loadDemandsList);
    }

    // Dashboard Cards Redirecionamento
    const cardMyDemands = document.getElementById('card-my-demands');
    if (cardMyDemands) {
        cardMyDemands.addEventListener('click', () => {
            const filterMy = document.getElementById('demands-filter-my');
            const filterStatus = document.getElementById('demands-filter-status');
            const filterUrgency = document.getElementById('demands-filter-urgency');
            const searchInput = document.getElementById('demands-search');
            if (filterMy) filterMy.checked = true;
            if (filterStatus) filterStatus.value = "";
            if (filterUrgency) filterUrgency.value = "";
            if (searchInput) searchInput.value = "";
            switchView('demands');
        });
    }

    const cardCriticalUrgency = document.getElementById('card-critical-urgency');
    if (cardCriticalUrgency) {
        cardCriticalUrgency.addEventListener('click', () => {
            const filterMy = document.getElementById('demands-filter-my');
            const filterStatus = document.getElementById('demands-filter-status');
            const filterUrgency = document.getElementById('demands-filter-urgency');
            const searchInput = document.getElementById('demands-search');
            if (filterMy) filterMy.checked = false;
            if (filterStatus) filterStatus.value = "";
            if (filterUrgency) filterUrgency.value = "critical";
            if (searchInput) searchInput.value = "";
            switchView('demands');
        });
    }

    const cardWarningUrgency = document.getElementById('card-warning-urgency');
    if (cardWarningUrgency) {
        cardWarningUrgency.addEventListener('click', () => {
            const filterMy = document.getElementById('demands-filter-my');
            const filterStatus = document.getElementById('demands-filter-status');
            const filterUrgency = document.getElementById('demands-filter-urgency');
            const searchInput = document.getElementById('demands-search');
            if (filterMy) filterMy.checked = false;
            if (filterStatus) filterStatus.value = "";
            if (filterUrgency) filterUrgency.value = "warning";
            if (searchInput) searchInput.value = "";
            switchView('demands');
        });
    }

    const cardCompletedDemands = document.getElementById('card-completed-demands');
    if (cardCompletedDemands) {
        cardCompletedDemands.addEventListener('click', () => {
            const filterMy = document.getElementById('demands-filter-my');
            const filterStatus = document.getElementById('demands-filter-status');
            const filterUrgency = document.getElementById('demands-filter-urgency');
            const searchInput = document.getElementById('demands-search');
            if (filterMy) filterMy.checked = false;
            if (filterStatus) filterStatus.value = "Concluído";
            if (filterUrgency) filterUrgency.value = "";
            if (searchInput) searchInput.value = "";
            switchView('demands');
        });
    }

    // Ordenação de colunas da tabela de demandas
    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            handleSort(th.getAttribute('data-sort'));
        });
    });

    // Botões do Perfil na Sidebar
    const profileBtn = document.getElementById('btn-profile');
    if (profileBtn) {
        profileBtn.addEventListener('click', openProfileModal);
    }
    const userBadge = document.getElementById('sidebar-user-badge');
    if (userBadge) {
        userBadge.addEventListener('click', openProfileModal);
    }
    const btnCloseProfile = document.getElementById('btn-close-profile-modal');
    if (btnCloseProfile) {
        btnCloseProfile.addEventListener('click', () => closeModal('profile-modal'));
    }
    const btnCancelProfile = document.getElementById('btn-cancel-profile-modal');
    if (btnCancelProfile) {
        btnCancelProfile.addEventListener('click', () => closeModal('profile-modal'));
    }
    const profileForm = document.getElementById('profile-form');
    if (profileForm) {
        profileForm.addEventListener('submit', handleProfileFormSubmit);
    }

    // Usuários CRUD Form
    const userForm = document.getElementById('user-form');
    if (userForm) {
        userForm.addEventListener('submit', handleUserFormSubmit);
    }
    const btnCancelUserEdit = document.getElementById('btn-cancel-user-edit');
    if (btnCancelUserEdit) {
        btnCancelUserEdit.addEventListener('click', cancelUserEdit);
    }

    // Redirecionamento da balança/logo no canto superior esquerdo
    const sidebarLogo = document.getElementById('sidebar-logo');
    if (sidebarLogo) {
        sidebarLogo.addEventListener('click', () => {
            switchView('dashboard');
        });
    }

    // Filtros e ordenação da aba de Demandas Concluídas
    const completedSearch = document.getElementById('completed-search');
    if (completedSearch) {
        completedSearch.addEventListener('input', debounce(loadCompletedDemandsList, 300));
    }
    const completedFilterMy = document.getElementById('completed-filter-my');
    if (completedFilterMy) {
        completedFilterMy.addEventListener('change', loadCompletedDemandsList);
    }
    document.querySelectorAll('th.sortable-completed').forEach(th => {
        th.addEventListener('click', () => {
            handleSortCompleted(th.getAttribute('data-sort'));
        });
    });

    // Exclusão de Demanda (Admin)
    const btnDeleteDemand = document.getElementById('btn-delete-demand');
    if (btnDeleteDemand) {
        btnDeleteDemand.addEventListener('click', handleDeleteDemand);
    }

    // Módulo de Relatórios
    const btnGenerateReport = document.getElementById('btn-generate-report');
    if (btnGenerateReport) {
        btnGenerateReport.addEventListener('click', generateReport);
    }
    const btnPrintReport = document.getElementById('btn-print-report');
    if (btnPrintReport) {
        btnPrintReport.addEventListener('click', () => {
            window.print();
        });
    }
    const reportTypeSelect = document.getElementById('report-type-select');
    if (reportTypeSelect) {
        reportTypeSelect.addEventListener('change', handleReportTypeChange);
    }
}

// Utilitário para evitar muitas chamadas na digitação rápida (Debounce)
function debounce(func, delay) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

// Funções auxiliares para formatação de máscara e cálculo do prazo limite
function maskCPF(value) {
    const digits = value.replace(/\D/g, '').substring(0, 11);
    let formatted = '';
    if (digits.length > 0) {
        formatted += digits.substring(0, 3);
    }
    if (digits.length > 3) {
        formatted += '.' + digits.substring(3, 6);
    }
    if (digits.length > 6) {
        formatted += '.' + digits.substring(6, 9);
    }
    if (digits.length > 9) {
        formatted += '-' + digits.substring(9, 11);
    }
    return formatted;
}

function maskProData(value) {
    const digits = value.replace(/\D/g, '').substring(0, 10);
    let formatted = '';
    if (digits.length > 0) {
        formatted += digits.substring(0, 4);
    }
    if (digits.length > 4) {
        formatted += '.' + digits.substring(4, 7);
    }
    if (digits.length > 7) {
        formatted += '.' + digits.substring(7, 10);
    }
    return formatted;
}

function calculateDemandDeadline() {
    const receivedVal = document.getElementById('demand-received-at').value;
    const daysVal = parseInt(document.getElementById('demand-duration-days').value) || 0;
    const hoursVal = parseInt(document.getElementById('demand-duration-hours').value) || 0;
    const deadlineInput = document.getElementById('demand-deadline');
    
    if (!receivedVal) {
        deadlineInput.value = '';
        return;
    }
    
    const receivedDate = new Date(receivedVal);
    receivedDate.setDate(receivedDate.getDate() + daysVal);
    receivedDate.setHours(receivedDate.getHours() + hoursVal);
    
    const year = receivedDate.getFullYear();
    const month = String(receivedDate.getMonth() + 1).padStart(2, '0');
    const day = String(receivedDate.getDate()).padStart(2, '0');
    const hours = String(receivedDate.getHours()).padStart(2, '0');
    const minutes = String(receivedDate.getMinutes()).padStart(2, '0');
    
    deadlineInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
}

function setDefaultReceivedTime() {
    const receivedInput = document.getElementById('demand-received-at');
    if (!receivedInput) return;
    
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    receivedInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
    calculateDemandDeadline();
}

// Modais
function openModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
    // Limpar formulário se houver
    const form = document.querySelector(`#${modalId} form`);
    if (form) form.reset();
}

// ==========================================================================
// CONTROLADORES DE LOGIN E SESSÃO
// ==========================================================================

async function handleLogin(e) {
    e.preventDefault();
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    
    const payload = {
        username: usernameInput.value,
        password: passwordInput.value
    };
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            setAuthToken(data.token);
            CURRENT_USER = data.user;
            setupUserProfile();
            showView('app');
            switchView('dashboard');
            showToast(`Bem-vindo, ${CURRENT_USER.name}!`, "success");
            requestNotificationPermission();
            startNotificationPolling();
            
            // Limpa form
            usernameInput.value = '';
            passwordInput.value = '';
        } else {
            showToast(data.message || "Erro no login.", "error");
        }
    } catch (error) {
        console.error("Erro na chamada de login:", error);
        showToast("Erro ao conectar com o servidor.", "error");
    }
}

// ==========================================================================
// DASHBOARD LOGIC (INDICADORES, CONTADORES E GRÁFICOS)
// ==========================================================================

async function loadDashboardData() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/demands`, {
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error("Erro ao buscar demandas para o dashboard.");
        
        const demands = await response.json();
        
        // 1. Processar Métricas
        let myDemandsCount = 0;
        let criticalCount = 0;
        let warningCount = 0;
        let completedCount = 0;
        
        const urgentDemands = [];
        
        demands.forEach(d => {
            if (d.status === 'Concluído') {
                completedCount++;
            } else {
                if (d.current_user_id === CURRENT_USER.id) {
                    myDemandsCount++;
                }
                
                if (d.urgency === 'critical') {
                    criticalCount++;
                    urgentDemands.push(d); // Inclui nos prazos críticos
                } else if (d.urgency === 'warning') {
                    warningCount++;
                    urgentDemands.push(d); // Também coloca na lista de prazos curtos
                }
            }
        });
        
        // Atualizar indicadores na tela
        document.getElementById('dash-my-count').textContent = myDemandsCount;
        document.getElementById('dash-critical-count').textContent = criticalCount;
        document.getElementById('dash-warning-count').textContent = warningCount;
        document.getElementById('dash-completed-count').textContent = completedCount;
        
        // Ordenar demandas da lista urgente pela menor contagem de tempo restante
        urgentDemands.sort((a, b) => {
            return new Date(a.deadline) - new Date(b.deadline);
        });
        
        // Atualizar badge de demandas urgentes
        document.getElementById('dash-urgent-badge').textContent = `${criticalCount} críticas / ${warningCount} alertas`;
        
        // 2. Renderizar lista urgente
        renderUrgentDemandsList(urgentDemands);
        
        // 3. Renderizar Gráficos
        renderCharts(demands);
        
        // Iniciar timer dinâmico a cada 30 segundos para a contagem de prazo ativa
        if (ACTIVE_COUNTDOWN_INTERVAL) clearInterval(ACTIVE_COUNTDOWN_INTERVAL);
        ACTIVE_COUNTDOWN_INTERVAL = setInterval(() => {
            updateDashboardTimers(urgentDemands);
        }, 30000);
        
    } catch (error) {
        console.error("Erro no Dashboard:", error);
        showToast("Erro ao carregar dados do painel.", "error");
    }
}

function renderUrgentDemandsList(demands) {
    const listEl = document.getElementById('dash-urgent-list');
    
    if (demands.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-circle-check font-green"></i>
                <p>Nenhuma demanda pendente próxima do prazo crítico. Excelente!</p>
            </div>
        `;
        return;
    }
    
    listEl.innerHTML = '';
    demands.forEach(d => {
        const item = document.createElement('div');
        item.className = 'urgent-item';
        item.onclick = () => viewDemandDetails(d.id);
        
        const prodataTag = d.prodata_number ? `<span class="table-prodata">[${d.prodata_number}]</span>` : '';
        
        item.innerHTML = `
            <div class="urgent-left">
                <span class="urgent-process">${d.process_number} ${prodataTag}</span>
                <span class="urgent-patient">${d.patient_name}</span>
                <span class="urgent-title">${d.title}</span>
            </div>
            <div class="urgent-right">
                <div class="countdown-timer ${d.urgency}" data-deadline="${d.deadline}">
                    <i class="fa-solid fa-clock"></i> <span class="timer-text">${d.time_left}</span>
                </div>
                <span class="urgent-responsible">Resp: ${d.current_name}</span>
            </div>
        `;
        listEl.appendChild(item);
    });
}

// Loop que atualiza os temporizadores sem precisar recarregar o backend
function updateDashboardTimers(demandsList) {
    const timerElements = document.querySelectorAll('.countdown-timer');
    const now = new Date();
    
    timerElements.forEach(el => {
        const deadlineStr = el.getAttribute('data-deadline');
        if (!deadlineStr) return;
        
        const deadline = new Date(deadlineStr.replace(' ', 'T')); // Converter formato YYYY-MM-DD HH:MM:SS
        const diff = deadline - now;
        const textSpan = el.querySelector('.timer-text');
        
        if (diff <= 0) {
            textSpan.textContent = "Atrasado";
            el.className = "countdown-timer critical";
        } else {
            const totalHours = diff / 3600000;
            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            const minutes = Math.floor((diff % 3600000) / 60000);
            
            if (days > 0) {
                textSpan.textContent = `Restam ${days}d e ${hours}h`;
            } else {
                textSpan.textContent = `Restam ${hours}h e ${minutes}m`;
            }
            
            // Ajustar urgência dinamicamente
            if (totalHours <= 24) {
                el.className = "countdown-timer critical";
            } else if (totalHours <= 72) {
                el.className = "countdown-timer warning";
            } else {
                el.className = "countdown-timer normal";
            }
        }
    });
}

// Renders visual charts using Chart.js
function renderCharts(demands) {
    // Destruir gráficos existentes antes de criar novos (evita sobreposição)
    if (DEMANDS_CHART) DEMANDS_CHART.destroy();
    if (RESPONSIBLES_CHART) RESPONSIBLES_CHART.destroy();
    
    // 1. Processar dados por status
    const statusCounts = { 'Pendente': 0, 'Em Andamento': 0, 'Concluído': 0, 'Atrasado': 0 };
    demands.forEach(d => {
        if (statusCounts[d.status] !== undefined) statusCounts[d.status]++;
    });
    
    const demandsCtx = document.getElementById('demandsChart').getContext('2d');
    
    // Cores HSL do design system
    const isDark = document.body.classList.contains('dark-theme');
    const labelColor = isDark ? '#94a3b8' : '#475569';
    
    DEMANDS_CHART = new Chart(demandsCtx, {
        type: 'doughnut',
        data: {
            labels: ['Pendente', 'Em Andamento', 'Concluído', 'Atrasado'],
            datasets: [{
                data: [statusCounts['Pendente'], statusCounts['Em Andamento'], statusCounts['Concluído'], statusCounts['Atrasado']],
                backgroundColor: ['#f59e0b', '#3b82f6', '#10b981', '#ef4444'],
                borderWidth: 2,
                borderColor: isDark ? '#111726' : '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: labelColor, boxWidth: 12, font: { family: 'Plus Jakarta Sans', size: 11 } }
                },
                title: {
                    display: true,
                    text: 'Demandas por Status',
                    color: isDark ? '#f8fafc' : '#0f172a',
                    font: { family: 'Outfit', size: 14, weight: '700' }
                }
            },
            cutout: '70%'
        }
    });
    
    // 2. Processar dados para gráfico comparativo (Concluídos Último Mês x Em Aberto x Atrasados)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    let completedLastMonth = 0;
    let openCount = 0;
    let delayedCount = 0;
    
    demands.forEach(d => {
        if (d.status === 'Concluído') {
            const updatedTime = d.updated_at ? new Date(d.updated_at.replace(' ', 'T')) : (d.created_at ? new Date(d.created_at.replace(' ', 'T')) : null);
            if (updatedTime && updatedTime >= thirtyDaysAgo) {
                completedLastMonth++;
            }
        } else if (d.status === 'Atrasado') {
            delayedCount++;
        } else if (d.status === 'Pendente' || d.status === 'Em Andamento') {
            openCount++;
        }
    });
    
    const respCtx = document.getElementById('responsiblesChart').getContext('2d');
    RESPONSIBLES_CHART = new Chart(respCtx, {
        type: 'bar',
        data: {
            labels: ['Concluídas (Último Mês)', 'Em Aberto', 'Atrasadas'],
            datasets: [{
                label: 'Processos',
                data: [completedLastMonth, openCount, delayedCount],
                backgroundColor: ['#10b981', '#3b82f6', '#ef4444'],
                borderColor: ['#0d9488', '#2563eb', '#dc2626'],
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: {
                    display: true,
                    text: 'Comparativo de Processos',
                    color: isDark ? '#f8fafc' : '#0f172a',
                    font: { family: 'Outfit', size: 14, weight: '700' }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: labelColor, font: { family: 'Plus Jakarta Sans', size: 10 } }
                },
                y: {
                    grid: { color: isDark ? '#1e293b' : '#e2e8f0' },
                    ticks: { color: labelColor, precision: 0, font: { family: 'Plus Jakarta Sans', size: 10 } }
                }
            }
        }
    });
}

// ==========================================================================
// LISTAGEM DE DEMANDAS
// ==========================================================================

async function loadDemandsList() {
    const searchVal = document.getElementById('demands-search').value;
    const statusVal = document.getElementById('demands-filter-status').value;
    const myDemandsVal = document.getElementById('demands-filter-my').checked;
    const urgencyVal = document.getElementById('demands-filter-urgency').value;
    
    let url = `${API_BASE_URL}/api/demands?search=${encodeURIComponent(searchVal)}&status=${encodeURIComponent(statusVal)}&my_demands=${myDemandsVal}`;
    
    try {
        const response = await fetch(url, {
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error("Falha ao carregar lista de demandas.");
        
        let demands = await response.json();
        
        // Exclui demandas com status Concluído se nenhum status for especificado nos filtros
        if (!statusVal) {
            demands = demands.filter(d => d.status !== 'Concluído');
        }
        
        // Filtro de urgência client-side
        if (urgencyVal) {
            demands = demands.filter(d => d.urgency === urgencyVal);
        }
        
        CURRENT_DEMANDS = demands;
        sortAndRenderDemands();
        
    } catch (error) {
        console.error("Erro ao carregar demandas:", error);
        showToast("Erro ao carregar lista de demandas.", "error");
    }
}

function renderDemandsTable(demands) {
    const tbody = document.getElementById('demands-table-body');
    const emptyState = document.getElementById('demands-empty-state');
    
    tbody.innerHTML = '';
    
    if (demands.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }
    
    emptyState.classList.add('hidden');
    
    demands.forEach(d => {
        const tr = document.createElement('tr');
        tr.onclick = () => viewDemandDetails(d.id);
        
        const prodataText = d.prodata_number ? `<span class="table-prodata">[${d.prodata_number}]</span>` : '';
        
        // Cores dos badges de status
        let statusBadgeClass = 'badge-neutral';
        if (d.status === 'Pendente') statusBadgeClass = 'badge-yellow';
        else if (d.status === 'Em Andamento') statusBadgeClass = 'badge-blue';
        else if (d.status === 'Concluído') statusBadgeClass = 'badge-green';
        else if (d.status === 'Atrasado') statusBadgeClass = 'badge-red';
        
        // Cores do deadline
        let urgencyClass = 'badge-neutral';
        if (d.status !== 'Concluído') {
            if (d.urgency === 'critical') urgencyClass = 'badge-red';
            else if (d.urgency === 'warning') urgencyClass = 'badge-yellow';
            else urgencyClass = 'badge-green';
        }
        
        tr.innerHTML = `
            <td>
                <div class="table-process">
                    <strong>${d.process_number}</strong>
                    ${prodataText}
                </div>
            </td>
            <td>
                <div>
                    <div><strong>${d.patient_name}</strong></div>
                    <div class="user-role">${d.patient_cpf || 'CPF não informado'}</div>
                </div>
            </td>
            <td>
                <div><strong>${d.title}</strong></div>
                <div class="user-role" style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${d.description || ''}
                </div>
            </td>
            <td>
                <span class="badge ${urgencyClass}">${d.time_left}</span>
            </td>
            <td>
                <span class="font-semibold">${d.current_name}</span>
            </td>
            <td>
                <span class="badge ${statusBadgeClass}">${d.status}</span>
            </td>
            <td>
                <button class="btn btn-secondary-light btn-sm" onclick="event.stopPropagation(); viewDemandDetails(${d.id})">
                    Visualizar <i class="fa-solid fa-arrow-right"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================================================
// CADASTRO DE DEMANDA & PACIENTE AUTOCOMPLETE
// ==========================================================================

function clearNewDemandForm() {
    document.getElementById('new-demand-form').reset();
    clearSelectedPatient();
}

async function handlePatientSearch(e) {
    const query = e.target.value.trim();
    const dropdown = document.getElementById('patient-search-results');
    
    if (query.length < 2) {
        dropdown.innerHTML = '';
        dropdown.classList.add('hidden');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/patients?search=${encodeURIComponent(query)}`, {
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error("Erro na busca de pacientes.");
        
        const patients = await response.json();
        
        if (patients.length === 0) {
            dropdown.innerHTML = `
                <div class="dropdown-item" style="cursor: default; color: var(--text-muted);">
                    Nenhum paciente encontrado. Clique em "Novo Paciente" para cadastrar.
                </div>
            `;
            dropdown.classList.remove('hidden');
            return;
        }
        
        dropdown.innerHTML = '';
        patients.forEach(pat => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.innerHTML = `
                <h5>${pat.name}</h5>
                <p>CPF: ${pat.cpf || 'Não cadastrado'} | Mãe: ${pat.mother_name || 'Não informada'}</p>
            `;
            item.onclick = () => selectPatientForDemand(pat);
            dropdown.appendChild(item);
        });
        
        dropdown.classList.remove('hidden');
        
    } catch (error) {
        console.error("Erro ao buscar paciente:", error);
    }
}

function selectPatientForDemand(patient) {
    SELECTED_PATIENT = patient;
    
    // Atualiza o ID do input hidden para a submissão do form
    document.getElementById('selected-patient-id').value = patient.id;
    
    // Atualizar card de exibição do paciente selecionado
    document.getElementById('sel-patient-name').textContent = patient.name;
    document.getElementById('sel-patient-cpf').textContent = patient.cpf || 'Não cadastrado';
    document.getElementById('sel-patient-cns').textContent = patient.cns || 'Não cadastrado';
    document.getElementById('sel-patient-mother').textContent = patient.mother_name || 'Não informado';
    
    const formattedBirth = patient.birth_date 
        ? new Date(patient.birth_date).toLocaleDateString('pt-BR') 
        : 'Não informado';
    document.getElementById('sel-patient-birth').textContent = formattedBirth;
    
    // Exibe o card e esconde o campo de busca
    document.getElementById('selected-patient-card').classList.remove('hidden');
    document.getElementById('demand-patient-search').value = '';
    document.getElementById('demand-patient-search').classList.add('hidden');
    document.getElementById('btn-quick-new-patient').classList.add('hidden');
    
    // Oculta dropdown
    const dropdown = document.getElementById('patient-search-results');
    dropdown.innerHTML = '';
    dropdown.classList.add('hidden');
}

function clearSelectedPatient() {
    SELECTED_PATIENT = null;
    document.getElementById('selected-patient-id').value = '';
    document.getElementById('selected-patient-card').classList.add('hidden');
    
    const searchInput = document.getElementById('demand-patient-search');
    searchInput.classList.remove('hidden');
    searchInput.value = '';
    document.getElementById('btn-quick-new-patient').classList.remove('hidden');
}

// Handler para criar paciente rapidamente via Modal
async function handleQuickPatientSubmit(e) {
    e.preventDefault();
    
    const payload = {
        name: document.getElementById('quick-pat-name').value.trim(),
        cpf: document.getElementById('quick-pat-cpf').value.trim(),
        cns: document.getElementById('quick-pat-cns').value.trim(),
        mother_name: document.getElementById('quick-pat-mother').value.trim(),
        birth_date: document.getElementById('quick-pat-birth').value
    };
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/patients`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast("Paciente cadastrado com sucesso!", "success");
            closeModal('patient-modal');
            // Auto-selecionar o paciente cadastrado no formulário de demandas
            selectPatientForDemand(data);
        } else {
            showToast(data.message || "Erro ao cadastrar paciente.", "error");
        }
    } catch (error) {
        console.error("Erro ao cadastrar paciente:", error);
        showToast("Erro ao conectar com o servidor.", "error");
    }
}

// Dropdown de usuários responsáveis
async function loadUsersForDropdown(selectElementId, includePrompt = true) {
    const select = document.getElementById(selectElementId);
    select.innerHTML = includePrompt ? '<option value="">Selecione um responsável...</option>' : '';
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/users`, {
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error("Erro ao carregar usuários.");
        
        const users = await response.json();
        users.forEach(user => {
            const opt = document.createElement('option');
            opt.value = user.id;
            opt.textContent = `${user.name} (${user.role})`;
            select.appendChild(opt);
        });
    } catch (error) {
        console.error("Erro ao carregar dropdown de usuários:", error);
    }
}

// Submissão da nova demanda judicial
async function handleNewDemandSubmit(e) {
    e.preventDefault();
    
    const patientId = document.getElementById('selected-patient-id').value;
    if (!patientId) {
        showToast("Você precisa selecionar ou cadastrar um paciente!", "error");
        return;
    }
    
    const deadlineVal = document.getElementById('demand-deadline').value; // Formato: YYYY-MM-DDTHH:MM
    const formattedDeadline = deadlineVal.replace('T', ' ') + ':00';
    
    const receivedVal = document.getElementById('demand-received-at').value;
    const formattedReceived = receivedVal.replace('T', ' ') + ':00';
    
    const payload = {
        process_number: document.getElementById('demand-process-number').value.trim(),
        prodata_number: document.getElementById('demand-prodata-number').value.trim() || null,
        patient_id: parseInt(patientId),
        title: document.getElementById('demand-title').value.trim(),
        description: document.getElementById('demand-description').value.trim(),
        judge: document.getElementById('demand-judge').value.trim(),
        received_at: formattedReceived,
        deadline: formattedDeadline,
        current_user_id: parseInt(document.getElementById('demand-responsible').value)
    };
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/demands`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast("Demanda judicial cadastrada com sucesso!", "success");
            switchView('demands');
        } else {
            showToast(data.message || "Erro ao cadastrar demanda.", "error");
        }
    } catch (error) {
        console.error("Erro ao cadastrar demanda:", error);
        showToast("Erro ao conectar com o servidor.", "error");
    }
}

// ==========================================================================
// TELA DE PACIENTES (CADASTRO E LISTAGEM)
// ==========================================================================

async function loadPatientsList() {
    const searchVal = document.getElementById('patients-list-search').value.trim();
    const url = `${API_BASE_URL}/api/patients?search=${encodeURIComponent(searchVal)}`;
    
    try {
        const response = await fetch(url, {
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error("Erro ao carregar lista de pacientes.");
        
        const patients = await response.json();
        renderPatientsTable(patients);
        
    } catch (error) {
        console.error("Erro ao carregar pacientes:", error);
        showToast("Erro ao carregar pacientes.", "error");
    }
}

function renderPatientsTable(patients) {
    const tbody = document.getElementById('patients-table-body');
    tbody.innerHTML = '';
    
    const isAdmin = CURRENT_USER && CURRENT_USER.role === 'Admin';
    
    if (patients.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="${isAdmin ? 5 : 4}" style="text-align: center; color: var(--text-muted);">Nenhum paciente cadastrado.</td>
            </tr>
        `;
        return;
    }
    
    patients.forEach(pat => {
        const tr = document.createElement('tr');
        const formattedBirth = pat.birth_date 
            ? new Date(pat.birth_date).toLocaleDateString('pt-BR') 
            : 'Não informado';
            
        let actionsTd = '';
        if (isAdmin) {
            actionsTd = `
                <td>
                    <button class="btn btn-secondary-light btn-sm btn-edit-patient" data-id="${pat.id}">
                        <i class="fa-solid fa-user-pen"></i> Editar
                    </button>
                </td>
            `;
        }
            
        tr.innerHTML = `
            <td><strong>${pat.name}</strong></td>
            <td>${pat.cpf || '-'}</td>
            <td>${pat.cns || '-'}</td>
            <td>${formattedBirth}</td>
            ${actionsTd}
        `;
        
        tbody.appendChild(tr);
        
        if (isAdmin) {
            const editBtn = tr.querySelector('.btn-edit-patient');
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openEditPatientModal(pat);
                });
            }
        }
    });
}

// Abre o modal de edição de paciente preenchido
function openEditPatientModal(patient) {
    document.getElementById('edit-pat-id').value = patient.id;
    document.getElementById('edit-pat-name').value = patient.name;
    document.getElementById('edit-pat-cpf').value = patient.cpf ? maskCPF(patient.cpf) : '';
    document.getElementById('edit-pat-cns').value = patient.cns || '';
    document.getElementById('edit-pat-mother').value = patient.mother_name || '';
    document.getElementById('edit-pat-birth').value = patient.birth_date || '';
    openModal('edit-patient-modal');
}

// Salva alterações do paciente (Admin)
async function handleEditPatientSubmit(e) {
    e.preventDefault();
    const patientId = document.getElementById('edit-pat-id').value;
    const payload = {
        name: document.getElementById('edit-pat-name').value.trim(),
        cpf: document.getElementById('edit-pat-cpf').value.trim(),
        cns: document.getElementById('edit-pat-cns').value.trim(),
        mother_name: document.getElementById('edit-pat-mother').value.trim(),
        birth_date: document.getElementById('edit-pat-birth').value
    };
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/patients/${patientId}`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast("Cadastro de paciente atualizado!", "success");
            closeModal('edit-patient-modal');
            loadPatientsList();
        } else {
            showToast(data.message || "Erro ao atualizar paciente.", "error");
        }
    } catch (error) {
        console.error("Erro ao atualizar paciente:", error);
        showToast("Erro ao conectar com o servidor.", "error");
    }
}

// Handler de submissão do formulário na tela de Pacientes
async function handleFullPatientSubmit(e) {
    e.preventDefault();
    
    const payload = {
        name: document.getElementById('pat-name').value.trim(),
        cpf: document.getElementById('pat-cpf').value.trim(),
        cns: document.getElementById('pat-cns').value.trim(),
        mother_name: document.getElementById('pat-mother').value.trim(),
        birth_date: document.getElementById('pat-birth').value
    };
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/patients`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast("Paciente cadastrado com sucesso!", "success");
            document.getElementById('new-patient-form').reset();
            loadPatientsList();
        } else {
            showToast(data.message || "Erro ao cadastrar paciente.", "error");
        }
    } catch (error) {
        console.error("Erro ao cadastrar paciente:", error);
        showToast("Erro ao conectar com o servidor.", "error");
    }
}

// ==========================================================================
// TELA DE DETALHES DA DEMANDA (TIMELINE, COMENTÁRIOS E AÇÕES)
// ==========================================================================

let CURRENT_DETAIL_DEMAND_ID = null;

async function viewDemandDetails(demandId) {
    CURRENT_DETAIL_DEMAND_ID = demandId;
    switchView('demand-details');
    
    // Abrir a primeira aba por padrão
    document.querySelector('.tab-btn[data-tab="comments"]').click();
    
    await loadUsersForDropdown('detail-forward-select', false);
    await reloadDemandDetails();
}

async function reloadDemandDetails() {
    if (!CURRENT_DETAIL_DEMAND_ID) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/demands/${CURRENT_DETAIL_DEMAND_ID}`, {
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error("Erro ao buscar detalhes da demanda.");
        
        const demand = await response.json();
        renderDemandDetailScreen(demand);
        
    } catch (error) {
        console.error("Erro ao carregar detalhes da demanda:", error);
        showToast("Erro ao carregar detalhes da demanda.", "error");
        switchView('demands');
    }
}

function renderDemandDetailScreen(demand) {
    // 1. Informações básicas da demanda
    document.getElementById('det-title').textContent = demand.title;
    document.getElementById('det-description').textContent = demand.description || 'Nenhuma descrição detalhada inserida.';
    document.getElementById('det-process-number').textContent = demand.process_number;
    document.getElementById('det-prodata-number').textContent = demand.prodata_number || 'Não cadastrado';
    document.getElementById('det-judge').textContent = demand.judge || 'Não informado';
    document.getElementById('det-received-at').textContent = new Date(demand.received_at.replace(' ', 'T')).toLocaleString('pt-BR');
    
    // Formatar data do deadline
    const deadlineDate = new Date(demand.deadline.replace(' ', 'T'));
    document.getElementById('det-deadline-date').textContent = deadlineDate.toLocaleString('pt-BR');
    
    document.getElementById('det-current-responsible').textContent = demand.current_name;
    document.getElementById('det-creator').textContent = demand.creator_name;
    document.getElementById('det-created-at').textContent = new Date(demand.created_at.replace(' ', 'T')).toLocaleString('pt-BR');
    
    // Status e Prazo Badges
    const statusBadge = document.getElementById('det-status-badge');
    statusBadge.textContent = demand.status;
    statusBadge.className = 'badge';
    if (demand.status === 'Pendente') statusBadge.classList.add('badge-yellow');
    else if (demand.status === 'Em Andamento') statusBadge.classList.add('badge-blue');
    else if (demand.status === 'Concluído') statusBadge.classList.add('badge-green');
    else if (demand.status === 'Atrasado') statusBadge.classList.add('badge-red');
    
    const deadlineBadge = document.getElementById('det-deadline-badge');
    deadlineBadge.textContent = demand.time_left;
    deadlineBadge.className = 'badge';
    if (demand.status !== 'Concluído') {
        if (demand.urgency === 'critical') deadlineBadge.classList.add('badge-red');
        else if (demand.urgency === 'warning') deadlineBadge.classList.add('badge-yellow');
        else deadlineBadge.classList.add('badge-green');
    } else {
        deadlineBadge.classList.add('badge-neutral');
    }
    
    // Atualizar dropdowns de ação para baterem com o estado atual da demanda
    const statusSelect = document.getElementById('detail-status-select');
    statusSelect.value = demand.status;
    statusSelect.dataset.prevValue = demand.status;
    
    // Habilitar/desabilitar controle de status conforme perfil
    const isAdmin = CURRENT_USER && CURRENT_USER.role === 'Admin';
    const isAssignee = CURRENT_USER && CURRENT_USER.id === demand.current_user_id;
    const isCompleted = demand.status === 'Concluído';
    
    if (isAdmin || (isAssignee && !isCompleted)) {
        statusSelect.removeAttribute('disabled');
    } else {
        statusSelect.setAttribute('disabled', 'true');
    }
    
    const forwardSelect = document.getElementById('detail-forward-select');
    forwardSelect.value = demand.current_user_id;
    forwardSelect.dataset.prevValue = demand.current_user_id;
    
    // Habilitar ou desabilitar encaminhamento baseando-se na permissão (apenas Admin ou responsável atual)
    if (isAdmin || isAssignee) {
        forwardSelect.removeAttribute('disabled');
    } else {
        forwardSelect.setAttribute('disabled', 'true');
    }

    // Ocultar formulário de comentário se o usuário não for o responsável atual
    const addCommentForm = document.getElementById('add-comment-form');
    if (CURRENT_USER && CURRENT_USER.id === demand.current_user_id) {
        addCommentForm.classList.remove('hidden');
    } else {
        addCommentForm.classList.add('hidden');
    }

    // Controlar visibilidade do botão de editar demanda
    const btnEditDemand = document.getElementById('btn-edit-demand');
    if (btnEditDemand) {
        const isAdmin = CURRENT_USER && CURRENT_USER.role === 'Admin';
        const isCreator = CURRENT_USER && CURRENT_USER.id === demand.creator_id;
        const isCompleted = demand.status === 'Concluído';
        
        let canEdit = false;
        if (isAdmin && !isCompleted) {
            canEdit = true;
        } else if (isCreator && !demand.has_been_forwarded && !isCompleted) {
            canEdit = true;
        }
        
        if (canEdit) {
            btnEditDemand.classList.remove('hidden');
        } else {
            btnEditDemand.classList.add('hidden');
        }
    }

    // Controlar visibilidade do botão de excluir demanda (apenas Admin)
    const btnDeleteDemand = document.getElementById('btn-delete-demand');
    if (btnDeleteDemand) {
        if (isAdmin) {
            btnDeleteDemand.classList.remove('hidden');
        } else {
            btnDeleteDemand.classList.add('hidden');
        }
    }

    // 2. Informações do Paciente
    document.getElementById('det-patient-name').textContent = demand.patient_name;
    document.getElementById('det-patient-cpf').textContent = demand.patient_cpf || 'Não informado';
    document.getElementById('det-patient-cns').textContent = demand.patient_cns || 'Não informado';
    document.getElementById('det-patient-mother').textContent = demand.patient_mother || 'Não informado';
    
    // Calcular idade do paciente
    let birthText = 'Não informada';
    if (demand.patient_birth) {
        const birthDate = new Date(demand.patient_birth);
        const age = new Date().getFullYear() - birthDate.getFullYear();
        birthText = `${birthDate.toLocaleDateString('pt-BR')} (${age} anos)`;
    }
    document.getElementById('det-patient-birth').textContent = birthText;

    // 3. Renderizar Comentários
    document.getElementById('det-comments-count').textContent = demand.comments.length;
    renderComments(demand.comments, demand.has_been_forwarded);
    
    // 4. Renderizar Linha do Tempo (Audit Logs)
    renderTimeline(demand.audit_logs);
}

function renderComments(comments, hasBeenForwarded) {
    const listEl = document.getElementById('det-comments-list');
    listEl.innerHTML = '';
    
    if (comments.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; padding: 30px; color: var(--text-muted);">
                Nenhuma observação ou andamento inserido para esta demanda judicial.
            </div>
        `;
        return;
    }
    
    comments.forEach(c => {
        const item = document.createElement('div');
        item.className = 'comment-item';
        
        const dateStr = new Date(c.created_at.replace(' ', 'T')).toLocaleString('pt-BR');
        
        const canEdit = CURRENT_USER && (c.user_id === CURRENT_USER.id) && !hasBeenForwarded;
        const editBtnHtml = canEdit 
            ? `<button class="btn btn-secondary-light btn-sm btn-edit-comment" style="padding: 2px 8px; font-size: 0.75rem;"><i class="fa-solid fa-pen"></i> Editar</button>`
            : '';
        
        item.innerHTML = `
            <div class="comment-header">
                <div class="comment-author">
                    <div class="user-avatar" style="width: 28px; height: 28px; font-size: 0.75rem;">
                        ${c.user_name.substring(0, 2).toUpperCase()}
                    </div>
                    <span class="comment-author-name">${c.user_name} <span class="user-role">(${c.user_role})</span></span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    ${editBtnHtml}
                    <span class="comment-date">${dateStr}</span>
                </div>
            </div>
            <div class="comment-body-wrapper" style="margin-top: 8px;">
                <div class="comment-content">${c.content}</div>
                <div class="comment-edit-form hidden" style="margin-top: 10px;">
                    <textarea class="edit-comment-textarea" rows="2" style="width: 100%; padding: 8px; background-color: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-sm); color: var(--text-primary); resize: none; margin-bottom: 8px;"></textarea>
                    <div style="display: flex; justify-content: flex-end; gap: 8px;">
                        <button class="btn btn-secondary btn-sm btn-cancel-comment-edit" style="padding: 2px 8px; font-size: 0.75rem;">Cancelar</button>
                        <button class="btn btn-primary btn-sm btn-save-comment-edit" style="padding: 2px 8px; font-size: 0.75rem;">Salvar <i class="fa-solid fa-save"></i></button>
                    </div>
                </div>
            </div>
        `;
        listEl.appendChild(item);

        if (canEdit) {
            const editBtn = item.querySelector('.btn-edit-comment');
            const cancelBtn = item.querySelector('.btn-cancel-comment-edit');
            const saveBtn = item.querySelector('.btn-save-comment-edit');
            const contentEl = item.querySelector('.comment-content');
            const editForm = item.querySelector('.comment-edit-form');
            const textarea = item.querySelector('.edit-comment-textarea');

            editBtn.addEventListener('click', () => {
                textarea.value = c.content;
                contentEl.classList.add('hidden');
                editForm.classList.remove('hidden');
                editBtn.classList.add('hidden');
            });

            cancelBtn.addEventListener('click', () => {
                contentEl.classList.remove('hidden');
                editForm.classList.add('hidden');
                editBtn.classList.remove('hidden');
            });

            saveBtn.addEventListener('click', async () => {
                const updatedContent = textarea.value.trim();
                if (!updatedContent) {
                    showToast("O conteúdo da observação não pode ser vazio.", "error");
                    return;
                }
                
                try {
                    const response = await fetch(`${API_BASE_URL}/api/comments/${c.id}`, {
                        method: 'PUT',
                        headers: getHeaders(),
                        body: JSON.stringify({ content: updatedContent })
                    });
                    
                    const data = await response.json();
                    if (response.ok) {
                        showToast("Observação atualizada!", "success");
                        reloadDemandDetails();
                    } else {
                        showToast(data.message || "Erro ao editar observação.", "error");
                    }
                } catch (error) {
                    console.error("Erro ao editar comentário:", error);
                    showToast("Erro ao conectar com o servidor.", "error");
                }
            });
        }
    });
}

function renderTimeline(logs) {
    const timelineEl = document.getElementById('det-history-timeline');
    timelineEl.innerHTML = '';
    
    if (logs.length === 0) {
        timelineEl.innerHTML = `
            <div style="text-align: center; padding: 30px; color: var(--text-muted);">
                Nenhum histórico registrado.
            </div>
        `;
        return;
    }
    
    logs.forEach(l => {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        
        const dateStr = new Date(l.created_at.replace(' ', 'T')).toLocaleString('pt-BR');
        
        item.innerHTML = `
            <div class="timeline-dot action-${l.action_type}"></div>
            <div class="timeline-content">
                <div class="timeline-header">
                    <span class="timeline-user">${l.user_name} <span class="user-role">(${l.user_role})</span></span>
                    <span class="timeline-date">${dateStr}</span>
                </div>
                <div class="timeline-desc">${l.description}</div>
            </div>
        `;
        timelineEl.appendChild(item);
    });
}

// AÇÃO: Alterar Status
function handleDetailStatusChange(e) {
    if (!CURRENT_DETAIL_DEMAND_ID) return;
    
    const select = e.target;
    const newStatus = select.value;
    const prevStatus = select.dataset.prevValue;
    
    if (newStatus === prevStatus) return;
    
    // Configurar a mensagem de confirmação
    document.getElementById('confirm-modal-message').innerHTML = 
        `Tem certeza de que deseja alterar o status desta demanda para <strong>${newStatus}</strong>?`;
    
    openModal('confirm-modal');
    
    CONFIRM_MODAL_CALLBACK = async (confirmed) => {
        if (confirmed) {
            try {
                const response = await fetch(`${API_BASE_URL}/api/demands/${CURRENT_DETAIL_DEMAND_ID}/status`, {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({ status: newStatus })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    showToast(`Status alterado com sucesso para ${newStatus}!`, "success");
                    reloadDemandDetails();
                } else {
                    showToast(data.message || "Erro ao alterar status.", "error");
                    select.value = prevStatus; // Reverte o select
                }
            } catch (error) {
                console.error("Erro ao alterar status:", error);
                showToast("Erro ao conectar com o servidor.", "error");
                select.value = prevStatus; // Reverte o select
            }
        } else {
            // Ação cancelada pelo usuário, reverte o select
            select.value = prevStatus;
        }
    };
}

// Variável global para armazenar callback do modal de confirmação
let CONFIRM_MODAL_CALLBACK = null;

// AÇÃO: Encaminhar Demanda
function handleDetailForwardChange(e) {
    if (!CURRENT_DETAIL_DEMAND_ID) return;
    
    const select = e.target;
    const newUserId = select.value;
    const prevUserId = select.dataset.prevValue;
    
    if (newUserId === prevUserId) return;
    
    const selectedOptionText = select.options[select.selectedIndex].text;
    
    // Configurar a mensagem de confirmação
    document.getElementById('confirm-modal-message').innerHTML = 
        `Tem certeza de que deseja encaminhar esta demanda judicial para <strong>${selectedOptionText}</strong>?<br><br>Essa ação transferirá a posse do processo. Você só poderá inserir novas observações se o processo for encaminhado de volta a você.`;
    
    openModal('confirm-modal');
    
    CONFIRM_MODAL_CALLBACK = async (confirmed) => {
        if (confirmed) {
            try {
                const response = await fetch(`${API_BASE_URL}/api/demands/${CURRENT_DETAIL_DEMAND_ID}/forward`, {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({ new_user_id: parseInt(newUserId) })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    showToast(data.message || "Demanda encaminhada com sucesso!", "success");
                    reloadDemandDetails();
                } else {
                    showToast(data.message || "Erro ao encaminhar demanda.", "error");
                    select.value = prevUserId; // Reverte o select
                }
            } catch (error) {
                console.error("Erro ao encaminhar demanda:", error);
                showToast("Erro ao conectar com o servidor.", "error");
                select.value = prevUserId; // Reverte o select
            }
        } else {
            // Ação cancelada pelo usuário, reverte o select
            select.value = prevUserId;
        }
    };
}

// Abertura do modal de edição de demanda preenchendo todos os campos
async function openEditDemandModal() {
    if (!CURRENT_DETAIL_DEMAND_ID) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/demands/${CURRENT_DETAIL_DEMAND_ID}`, {
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error("Erro ao carregar dados da demanda para edição.");
        
        const demand = await response.json();
        
        // Preencher os campos do formulário
        document.getElementById('edit-demand-id').value = demand.id;
        document.getElementById('edit-demand-process-number').value = demand.process_number;
        document.getElementById('edit-demand-prodata-number').value = demand.prodata_number ? maskProData(demand.prodata_number) : '';
        document.getElementById('edit-demand-judge').value = demand.judge || '';
        document.getElementById('edit-demand-title').value = demand.title;
        document.getElementById('edit-demand-description').value = demand.description || '';
        
        // Formatar data de recebimento
        const receivedDateStr = demand.received_at.replace(' ', 'T').substring(0, 16);
        document.getElementById('edit-demand-received-at').value = receivedDateStr;
        
        // Calcular dias/horas a partir do prazo e data de recebimento
        const receivedDate = new Date(demand.received_at.replace(' ', 'T'));
        const deadlineDate = new Date(demand.deadline.replace(' ', 'T'));
        const diffMs = deadlineDate - receivedDate;
        
        let days = 0;
        let hours = 0;
        if (diffMs > 0) {
            const diffHours = Math.round(diffMs / 3600000);
            days = Math.floor(diffHours / 24);
            hours = diffHours % 24;
        }
        
        document.getElementById('edit-demand-duration-days').value = days;
        document.getElementById('edit-demand-duration-hours').value = hours;
        
        // Formatar prazo limite calculado
        const deadlineDateStr = demand.deadline.replace(' ', 'T').substring(0, 16);
        document.getElementById('edit-demand-deadline').value = deadlineDateStr;
        
        // Pré-selecionar o paciente
        const patient = {
            id: demand.patient_id,
            name: demand.patient_name,
            cpf: demand.patient_cpf
        };
        selectPatientForEditDemand(patient);
        
        openModal('edit-demand-modal');
    } catch (error) {
        console.error("Erro ao abrir modal de edição:", error);
        showToast("Erro ao carregar dados da demanda.", "error");
    }
}

function selectPatientForEditDemand(patient) {
    EDIT_SELECTED_PATIENT = patient;
    
    document.getElementById('edit-selected-patient-id').value = patient.id;
    document.getElementById('edit-sel-patient-name').textContent = patient.name;
    document.getElementById('edit-sel-patient-cpf').textContent = patient.cpf || 'Não cadastrado';
    
    document.getElementById('edit-selected-patient-card').classList.remove('hidden');
    document.getElementById('edit-demand-patient-search').value = '';
    document.getElementById('edit-demand-patient-search').classList.add('hidden');
    
    const dropdown = document.getElementById('edit-patient-search-results');
    dropdown.innerHTML = '';
    dropdown.classList.add('hidden');
}

function clearEditSelectedPatient() {
    EDIT_SELECTED_PATIENT = null;
    document.getElementById('edit-selected-patient-id').value = '';
    document.getElementById('edit-selected-patient-card').classList.add('hidden');
    
    const searchInput = document.getElementById('edit-demand-patient-search');
    searchInput.classList.remove('hidden');
    searchInput.value = '';
    searchInput.focus();
}

async function handleEditPatientSearch(e) {
    const query = e.target.value.trim();
    const dropdown = document.getElementById('edit-patient-search-results');
    
    if (query.length < 2) {
        dropdown.innerHTML = '';
        dropdown.classList.add('hidden');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/patients?search=${encodeURIComponent(query)}`, {
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error("Erro na busca de pacientes.");
        
        const patients = await response.json();
        
        if (patients.length === 0) {
            dropdown.innerHTML = `
                <div class="dropdown-item" style="cursor: default; color: var(--text-muted);">
                    Nenhum paciente encontrado.
                </div>
            `;
            dropdown.classList.remove('hidden');
            return;
        }
        
        dropdown.innerHTML = '';
        patients.forEach(pat => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.innerHTML = `
                <h5>${pat.name}</h5>
                <p>CPF: ${pat.cpf || 'Não cadastrado'} | Mãe: ${pat.mother_name || 'Não informada'}</p>
            `;
            item.onclick = () => selectPatientForEditDemand(pat);
            dropdown.appendChild(item);
        });
        
        dropdown.classList.remove('hidden');
        
    } catch (error) {
        console.error("Erro ao buscar paciente:", error);
    }
}

function calculateEditDemandDeadline() {
    const receivedVal = document.getElementById('edit-demand-received-at').value;
    const daysVal = parseInt(document.getElementById('edit-demand-duration-days').value) || 0;
    const hoursVal = parseInt(document.getElementById('edit-demand-duration-hours').value) || 0;
    const deadlineInput = document.getElementById('edit-demand-deadline');
    
    if (!receivedVal) {
        deadlineInput.value = '';
        return;
    }
    
    const receivedDate = new Date(receivedVal);
    receivedDate.setDate(receivedDate.getDate() + daysVal);
    receivedDate.setHours(receivedDate.getHours() + hoursVal);
    
    const year = receivedDate.getFullYear();
    const month = String(receivedDate.getMonth() + 1).padStart(2, '0');
    const day = String(receivedDate.getDate()).padStart(2, '0');
    const hours = String(receivedDate.getHours()).padStart(2, '0');
    const minutes = String(receivedDate.getMinutes()).padStart(2, '0');
    
    deadlineInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
}

async function handleEditDemandSubmit(e) {
    e.preventDefault();
    
    const demandId = document.getElementById('edit-demand-id').value;
    const patientId = document.getElementById('edit-selected-patient-id').value;
    if (!patientId) {
        showToast("Você precisa selecionar um paciente!", "error");
        return;
    }
    
    const deadlineVal = document.getElementById('edit-demand-deadline').value;
    const formattedDeadline = deadlineVal.replace('T', ' ') + ':00';
    
    const receivedVal = document.getElementById('edit-demand-received-at').value;
    const formattedReceived = receivedVal.replace('T', ' ') + ':00';
    
    const payload = {
        process_number: document.getElementById('edit-demand-process-number').value.trim(),
        prodata_number: document.getElementById('edit-demand-prodata-number').value.trim() || null,
        patient_id: parseInt(patientId),
        title: document.getElementById('edit-demand-title').value.trim(),
        description: document.getElementById('edit-demand-description').value.trim(),
        judge: document.getElementById('edit-demand-judge').value.trim(),
        received_at: formattedReceived,
        deadline: formattedDeadline
    };
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/demands/${demandId}`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast("Demanda judicial atualizada com sucesso!", "success");
            closeModal('edit-demand-modal');
            reloadDemandDetails();
        } else {
            showToast(data.message || "Erro ao editar demanda.", "error");
        }
    } catch (error) {
        console.error("Erro ao editar demanda:", error);
        showToast("Erro ao conectar com o servidor.", "error");
    }
}

// AÇÃO: Enviar Comentário/Observação
async function handleCommentSubmit(e) {
    e.preventDefault();
    if (!CURRENT_DETAIL_DEMAND_ID) return;
    
    const commentInput = document.getElementById('comment-text');
    const content = commentInput.value.trim();
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/demands/${CURRENT_DETAIL_DEMAND_ID}/comments`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ content: content })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast("Observação adicionada!", "success");
            commentInput.value = '';
            reloadDemandDetails();
        } else {
            showToast(data.message || "Erro ao adicionar observação.", "error");
        }
    } catch (error) {
        console.error("Erro ao adicionar observação:", error);
        showToast("Erro ao conectar com o servidor.", "error");
    }
}

// ==========================================================================
// FUNÇÕES DE ORDENAÇÃO DE DEMANDAS (CLIENT-SIDE)
// ==========================================================================

function handleSort(column) {
    if (SORT_COLUMN === column) {
        SORT_DIRECTION = SORT_DIRECTION === 'asc' ? 'desc' : 'asc';
    } else {
        SORT_COLUMN = column;
        SORT_DIRECTION = 'asc';
    }
    
    updateSortIcons();
    sortAndRenderDemands();
}

function updateSortIcons() {
    document.querySelectorAll('th.sortable').forEach(th => {
        const icon = th.querySelector('i');
        if (!icon) return;
        if (th.getAttribute('data-sort') === SORT_COLUMN) {
            if (SORT_DIRECTION === 'asc') {
                icon.className = 'fa-solid fa-sort-up';
            } else {
                icon.className = 'fa-solid fa-sort-down';
            }
        } else {
            icon.className = 'fa-solid fa-sort';
        }
    });
}

function sortAndRenderDemands() {
    if (SORT_COLUMN) {
        CURRENT_DEMANDS.sort((a, b) => {
            let valA = a[SORT_COLUMN];
            let valB = b[SORT_COLUMN];
            
            if (valA === null || valA === undefined) valA = '';
            if (valB === null || valB === undefined) valB = '';
            
            if (SORT_COLUMN === 'deadline') {
                const dateA = new Date(valA.replace(' ', 'T'));
                const dateB = new Date(valB.replace(' ', 'T'));
                return SORT_DIRECTION === 'asc' ? dateA - dateB : dateB - dateA;
            }
            
            if (typeof valA === 'string') {
                return SORT_DIRECTION === 'asc' 
                    ? valA.localeCompare(valB, 'pt-BR', { sensitivity: 'base' })
                    : valB.localeCompare(valA, 'pt-BR', { sensitivity: 'base' });
            }
            
            if (valA < valB) return SORT_DIRECTION === 'asc' ? -1 : 1;
            if (valA > valB) return SORT_DIRECTION === 'asc' ? 1 : -1;
            return 0;
        });
    }
    
    renderDemandsTable(CURRENT_DEMANDS);
}

// ==========================================================================
// SEÇÃO DO PERFIL (MINHA CONTA)
// ==========================================================================

function openProfileModal() {
    if (!CURRENT_USER) return;
    document.getElementById('profile-name-input').value = CURRENT_USER.name;
    document.getElementById('profile-username-input').value = CURRENT_USER.username;
    document.getElementById('profile-password-input').value = '';
    openModal('profile-modal');
}

async function handleProfileFormSubmit(e) {
    e.preventDefault();
    
    const name = document.getElementById('profile-name-input').value.trim();
    const password = document.getElementById('profile-password-input').value;
    
    const payload = { name };
    if (password) {
        payload.password = password;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/profile`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast("Perfil atualizado com sucesso!", "success");
            setAuthToken(data.token);
            CURRENT_USER = data.user;
            setupUserProfile();
            closeModal('profile-modal');
        } else {
            showToast(data.message || "Erro ao atualizar perfil.", "error");
        }
    } catch (error) {
        console.error("Erro ao atualizar perfil:", error);
        showToast("Erro ao conectar com o servidor.", "error");
    }
}

// ==========================================================================
// GERENCIAMENTO DE USUÁRIOS (ADMIN CRUD)
// ==========================================================================

async function loadUsersList() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/users`, {
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error("Erro ao buscar usuários.");
        
        const users = await response.json();
        renderUsersTable(users);
    } catch (error) {
        console.error("Erro ao carregar usuários:", error);
        showToast("Erro ao carregar lista de usuários.", "error");
    }
}

function renderUsersTable(users) {
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = '';
    
    if (users.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; color: var(--text-muted);">Nenhum usuário cadastrado.</td>
            </tr>
        `;
        return;
    }
    
    users.forEach(user => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'default';
        
        tr.innerHTML = `
            <td><strong>${user.name}</strong></td>
            <td>${user.username}</td>
            <td><span class="badge ${user.role === 'Admin' ? 'badge-blue' : 'badge-neutral'}">${user.role}</span></td>
            <td>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary-light btn-sm btn-edit-user">
                        <i class="fa-solid fa-user-pen"></i> Editar
                    </button>
                    <button class="btn btn-secondary-light btn-sm btn-delete-user" style="color: var(--color-danger); border-color: rgba(239, 68, 68, 0.2);">
                        <i class="fa-solid fa-trash"></i> Excluir
                    </button>
                </div>
            </td>
        `;
        
        tbody.appendChild(tr);
        
        tr.querySelector('.btn-edit-user').addEventListener('click', () => startEditUser(user));
        tr.querySelector('.btn-delete-user').addEventListener('click', () => handleDeleteUser(user));
    });
}

function startEditUser(user) {
    document.getElementById('user-id').value = user.id;
    document.getElementById('user-name-input').value = user.name;
    document.getElementById('user-username-input').value = user.username;
    document.getElementById('user-password-input').value = '';
    document.getElementById('user-password-input').placeholder = 'Senha (deixe em branco para manter a atual)';
    document.getElementById('user-role-input').value = user.role;
    
    document.getElementById('user-form-title').innerHTML = `<i class="fa-solid fa-user-pen font-blue"></i> Editar Usuário`;
    document.getElementById('btn-cancel-user-edit').classList.remove('hidden');
}

function cancelUserEdit() {
    document.getElementById('user-id').value = '';
    document.getElementById('user-form').reset();
    document.getElementById('user-password-input').placeholder = 'Senha';
    document.getElementById('user-form-title').innerHTML = `<i class="fa-solid fa-user-plus font-blue"></i> Cadastrar Usuário`;
    document.getElementById('btn-cancel-user-edit').classList.add('hidden');
}

async function handleUserFormSubmit(e) {
    e.preventDefault();
    
    const userId = document.getElementById('user-id').value;
    const name = document.getElementById('user-name-input').value.trim();
    const username = document.getElementById('user-username-input').value.trim();
    const password = document.getElementById('user-password-input').value;
    const role = document.getElementById('user-role-input').value;
    
    const isEdit = !!userId;
    
    if (!isEdit && !password) {
        showToast("A senha é obrigatória para novos usuários!", "error");
        return;
    }
    
    const payload = {
        name,
        username,
        role
    };
    if (password) {
        payload.password = password;
    }
    
    const url = isEdit ? `${API_BASE_URL}/api/users/${userId}` : `${API_BASE_URL}/api/users`;
    const method = isEdit ? 'PUT' : 'POST';
    
    try {
        const response = await fetch(url, {
            method: method,
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast(isEdit ? "Usuário atualizado com sucesso!" : "Usuário cadastrado com sucesso!", "success");
            cancelUserEdit();
            loadUsersList();
        } else {
            showToast(data.message || "Erro ao salvar usuário.", "error");
        }
    } catch (error) {
        console.error("Erro ao salvar usuário:", error);
        showToast("Erro ao conectar com o servidor.", "error");
    }
}

function handleDeleteUser(user) {
    document.getElementById('confirm-modal-message').innerHTML = 
        `Tem certeza de que deseja excluir o usuário <strong>${user.name}</strong> (${user.username})?<br><br>Esta ação não poderá ser desfeita e pode afetar as demandas atribuídas.`;
    
    openModal('confirm-modal');
    
    CONFIRM_MODAL_CALLBACK = async (confirmed) => {
        if (confirmed) {
            try {
                const response = await fetch(`${API_BASE_URL}/api/users/${user.id}`, {
                    method: 'DELETE',
                    headers: getHeaders()
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    showToast("Usuário excluído com sucesso!", "success");
                    loadUsersList();
                } else {
                    showToast(data.message || "Erro ao excluir usuário.", "error");
                }
            } catch (error) {
                console.error("Erro ao excluir usuário:", error);
                showToast("Erro ao conectar com o servidor.", "error");
            }
        }
    };
}

// ==========================================================================
// DEMANDAS CONCLUÍDAS
// ==========================================================================

async function loadCompletedDemandsList() {
    const searchVal = document.getElementById('completed-search').value;
    const myDemandsVal = document.getElementById('completed-filter-my').checked;
    
    let url = `${API_BASE_URL}/api/demands?status=Concluído&search=${encodeURIComponent(searchVal)}&my_demands=${myDemandsVal}`;
    
    try {
        const response = await fetch(url, {
            headers: getHeaders()
        });
        
        if (!response.ok) throw new Error("Falha ao carregar lista de demandas concluídas.");
        
        let demands = await response.json();
        
        COMPLETED_DEMANDS = demands;
        sortAndRenderCompletedDemands();
        
    } catch (error) {
        console.error("Erro ao carregar demandas concluídas:", error);
        showToast("Erro ao carregar lista de demandas concluídas.", "error");
    }
}

function renderCompletedDemandsTable(demands) {
    const tbody = document.getElementById('completed-table-body');
    const emptyState = document.getElementById('completed-empty-state');
    
    tbody.innerHTML = '';
    
    if (demands.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }
    
    emptyState.classList.add('hidden');
    
    demands.forEach(d => {
        const tr = document.createElement('tr');
        tr.onclick = () => viewDemandDetails(d.id);
        
        const prodataText = d.prodata_number ? `<span class="table-prodata">[${d.prodata_number}]</span>` : '';
        
        tr.innerHTML = `
            <td>
                <div class="table-process">
                    <strong>${d.process_number}</strong>
                    ${prodataText}
                </div>
            </td>
            <td>
                <div>
                    <div><strong>${d.patient_name}</strong></div>
                    <div class="user-role">${d.patient_cpf || 'CPF não informado'}</div>
                </div>
            </td>
            <td>
                <div><strong>${d.title}</strong></div>
                <div class="user-role" style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${d.description || ''}
                </div>
            </td>
            <td>
                <span class="badge badge-green">Concluído</span>
            </td>
            <td>
                <span class="font-semibold">${d.current_name}</span>
            </td>
            <td>
                <span class="badge badge-green">${d.status}</span>
            </td>
            <td>
                <button class="btn btn-secondary-light btn-sm" onclick="event.stopPropagation(); viewDemandDetails(${d.id})">
                    Visualizar <i class="fa-solid fa-arrow-right"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function handleSortCompleted(column) {
    if (SORT_COLUMN_COMPLETED === column) {
        SORT_DIRECTION_COMPLETED = SORT_DIRECTION_COMPLETED === 'asc' ? 'desc' : 'asc';
    } else {
        SORT_COLUMN_COMPLETED = column;
        SORT_DIRECTION_COMPLETED = 'asc';
    }
    
    updateSortIconsCompleted();
    sortAndRenderCompletedDemands();
}

function updateSortIconsCompleted() {
    document.querySelectorAll('th.sortable-completed').forEach(th => {
        const col = th.getAttribute('data-sort');
        const icon = th.querySelector('i');
        if (col === SORT_COLUMN_COMPLETED) {
            icon.className = SORT_DIRECTION_COMPLETED === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
        } else {
            icon.className = 'fa-solid fa-sort';
        }
    });
}

function sortAndRenderCompletedDemands() {
    let sorted = [...COMPLETED_DEMANDS];
    
    if (SORT_COLUMN_COMPLETED) {
        sorted.sort((a, b) => {
            let valA = a[SORT_COLUMN_COMPLETED] || '';
            let valB = b[SORT_COLUMN_COMPLETED] || '';
            
            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();
            
            if (valA < valB) return SORT_DIRECTION_COMPLETED === 'asc' ? -1 : 1;
            if (valA > valB) return SORT_DIRECTION_COMPLETED === 'asc' ? 1 : -1;
            return 0;
        });
    }
    
    renderCompletedDemandsTable(sorted);
}

// ==========================================================================
// EXCLUSÃO DE PROCESSO
// ==========================================================================

function handleDeleteDemand() {
    if (!CURRENT_DETAIL_DEMAND_ID) return;
    
    document.getElementById('confirm-modal-message').innerHTML = 
        `Tem certeza de que deseja <strong>EXCLUIR</strong> esta demanda judicial permanentemente?<br><br>` +
        `Esta ação removerá todos os comentários vinculados. O log histórico da auditoria será anonimizado e mantido para fins de relatórios.`;
    
    openModal('confirm-modal');
    
    CONFIRM_MODAL_CALLBACK = async (confirmed) => {
        if (confirmed) {
            try {
                const response = await fetch(`${API_BASE_URL}/api/demands/${CURRENT_DETAIL_DEMAND_ID}`, {
                    method: 'DELETE',
                    headers: getHeaders()
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    showToast("Processo excluído com sucesso!", "success");
                    switchView('demands');
                } else {
                    showToast(data.message || "Erro ao excluir processo.", "error");
                }
            } catch (error) {
                console.error("Erro ao excluir processo:", error);
                showToast("Erro ao conectar com o servidor.", "error");
            }
        }
    };
}

// ==========================================================================
// MÓDULO DE RELATÓRIOS
// ==========================================================================

function setupReportsPage() {
    loadUsersForDropdown('report-user-select', true);
    
    document.getElementById('report-start-date').value = '';
    document.getElementById('report-end-date').value = '';
    document.getElementById('report-type-select').value = 'general';
    document.getElementById('report-status-select').value = '';
    document.getElementById('report-user-select').value = '';
    
    handleReportTypeChange();
    
    document.getElementById('report-empty-state').classList.remove('hidden');
    document.getElementById('report-table').classList.add('hidden');
    document.getElementById('report-print-meta').textContent = '';
}

function handleReportTypeChange() {
    const reportType = document.getElementById('report-type-select').value;
    const statusWrapper = document.getElementById('report-status-filter-wrapper');
    
    if (reportType === 'audit') {
        if (statusWrapper) statusWrapper.style.display = 'none';
    } else {
        if (statusWrapper) statusWrapper.style.display = 'block';
    }
}

async function generateReport() {
    const reportType = document.getElementById('report-type-select').value;
    const startDate = document.getElementById('report-start-date').value;
    const endDate = document.getElementById('report-end-date').value;
    const userId = document.getElementById('report-user-select').value;
    const statusVal = document.getElementById('report-status-select').value;
    
    const tableHead = document.getElementById('report-table-head');
    const tableBody = document.getElementById('report-table-body');
    const emptyState = document.getElementById('report-empty-state');
    const tableEl = document.getElementById('report-table');
    
    const now = new Date();
    const formattedNow = now.toLocaleString('pt-BR');
    let metaText = `Gerado em: ${formattedNow}`;
    
    const filtersUsed = [];
    if (startDate) filtersUsed.push(`Início: ${new Date(startDate + 'T00:00:00').toLocaleDateString('pt-BR')}`);
    if (endDate) filtersUsed.push(`Fim: ${new Date(endDate + 'T23:59:59').toLocaleDateString('pt-BR')}`);
    
    let reportTitle = "";
    
    try {
        if (reportType === 'audit') {
            reportTitle = "Relatório de Auditoria e Histórico";
            
            let url = `${API_BASE_URL}/api/audit-logs?`;
            if (startDate) url += `start_date=${startDate}&`;
            if (endDate) url += `end_date=${endDate}&`;
            if (userId) url += `user_id=${userId}&`;
            
            const response = await fetch(url, { headers: getHeaders() });
            if (!response.ok) throw new Error("Erro ao carregar logs de auditoria.");
            const logs = await response.json();
            
            if (userId) {
                const userSelect = document.getElementById('report-user-select');
                const selectedText = userSelect.options[userSelect.selectedIndex].text;
                filtersUsed.push(`Usuário: ${selectedText}`);
            }
            
            tableHead.innerHTML = `
                <tr>
                    <th style="width: 18%;">Data/Hora</th>
                    <th style="width: 20%;">Usuário</th>
                    <th style="width: 12%;">Perfil</th>
                    <th style="width: 15%;">Ação</th>
                    <th style="width: 35%;">Descrição</th>
                </tr>
            `;
            
            tableBody.innerHTML = '';
            if (logs.length === 0) {
                tableEl.classList.add('hidden');
                emptyState.classList.remove('hidden');
                emptyState.querySelector('p').textContent = "Nenhum log de auditoria encontrado para os filtros aplicados.";
                return;
            }
            
            emptyState.classList.add('hidden');
            tableEl.classList.remove('hidden');
            
            logs.forEach(log => {
                const tr = document.createElement('tr');
                const logDate = new Date(log.created_at.replace(' ', 'T')).toLocaleString('pt-BR');
                const auditClass = getAuditBadgeClass(log.action_type);
                tr.innerHTML = `
                    <td>${logDate}</td>
                    <td><strong>${log.user_name}</strong></td>
                    <td><span class="badge badge-neutral">${log.user_role}</span></td>
                    <td><span class="badge ${auditClass}">${log.action_type}</span></td>
                    <td>${log.description}</td>
                `;
                tableBody.appendChild(tr);
            });
            
        } else {
            let url = `${API_BASE_URL}/api/demands?`;
            if (startDate) url += `start_date=${startDate}&`;
            if (endDate) url += `end_date=${endDate}&`;
            if (statusVal) url += `status=${statusVal}&`;
            
            const response = await fetch(url, { headers: getHeaders() });
            if (!response.ok) throw new Error("Erro ao carregar demandas.");
            let demands = await response.json();
            
            if (userId) {
                demands = demands.filter(d => d.current_user_id == userId);
                const userSelect = document.getElementById('report-user-select');
                const selectedText = userSelect.options[userSelect.selectedIndex].text;
                filtersUsed.push(`Responsável: ${selectedText}`);
            }
            if (statusVal) {
                filtersUsed.push(`Status: ${statusVal}`);
            }
            
            if (reportType === 'general') {
                reportTitle = "Relatório Geral de Demandas";
                
                tableHead.innerHTML = `
                    <tr>
                        <th style="width: 18%;">Processo / ProData</th>
                        <th style="width: 18%;">Paciente</th>
                        <th style="width: 24%;">Título da Demanda</th>
                        <th style="width: 12%;">Recebido em</th>
                        <th style="width: 12%;">Prazo Limite</th>
                        <th style="width: 10%;">Responsável</th>
                        <th style="width: 6%;">Status</th>
                    </tr>
                `;
                
                tableBody.innerHTML = '';
                if (demands.length === 0) {
                    tableEl.classList.add('hidden');
                    emptyState.classList.remove('hidden');
                    emptyState.querySelector('p').textContent = "Nenhuma demanda encontrada para os filtros aplicados.";
                    return;
                }
                
                emptyState.classList.add('hidden');
                tableEl.classList.remove('hidden');
                
                demands.forEach(d => {
                    const tr = document.createElement('tr');
                    const receivedStr = new Date(d.received_at.replace(' ', 'T')).toLocaleString('pt-BR');
                    const deadlineStr = new Date(d.deadline.replace(' ', 'T')).toLocaleString('pt-BR');
                    const statusClass = getStatusBadgeClass(d.status);
                    tr.innerHTML = `
                        <td>
                            <strong>${d.process_number}</strong>
                            ${d.prodata_number ? `<br><small class="text-muted">ProData: ${d.prodata_number}</small>` : ''}
                        </td>
                        <td>${d.patient_name}</td>
                        <td>${d.title}</td>
                        <td>${receivedStr}</td>
                        <td>${deadlineStr}</td>
                        <td><strong>${d.current_name}</strong></td>
                        <td><span class="badge ${statusClass}">${d.status}</span></td>
                    `;
                    tableBody.appendChild(tr);
                });
                
            } else if (reportType === 'deadlines') {
                reportTitle = "Relatório de Prazos e Alertas";
                
                if (!statusVal) {
                    demands = demands.filter(d => d.status !== 'Concluído');
                }
                
                tableHead.innerHTML = `
                    <tr>
                        <th style="width: 18%;">Processo</th>
                        <th style="width: 18%;">Paciente</th>
                        <th style="width: 24%;">Título da Demanda</th>
                        <th style="width: 15%;">Prazo Limite</th>
                        <th style="width: 12%;">Tempo Restante</th>
                        <th style="width: 10%;">Responsável</th>
                        <th style="width: 3%;">Urgência</th>
                    </tr>
                `;
                
                tableBody.innerHTML = '';
                if (demands.length === 0) {
                    tableEl.classList.add('hidden');
                    emptyState.classList.remove('hidden');
                    emptyState.querySelector('p').textContent = "Nenhuma demanda ativa encontrada para os filtros aplicados.";
                    return;
                }
                
                emptyState.classList.add('hidden');
                tableEl.classList.remove('hidden');
                
                demands.forEach(d => {
                    const tr = document.createElement('tr');
                    const deadlineStr = new Date(d.deadline.replace(' ', 'T')).toLocaleString('pt-BR');
                    const urgencyClass = getUrgencyBadgeClass(d.urgency);
                    
                    let timeLeftStr = d.time_left;
                    if (d.status === 'Atrasado') {
                        timeLeftStr = 'Atrasado';
                    }
                    
                    tr.innerHTML = `
                        <td><strong>${d.process_number}</strong></td>
                        <td>${d.patient_name}</td>
                        <td>${d.title}</td>
                        <td>${deadlineStr}</td>
                        <td class="${d.urgency === 'critical' ? 'text-danger font-semibold' : d.urgency === 'warning' ? 'text-warning' : ''}">${timeLeftStr}</td>
                        <td><strong>${d.current_name}</strong></td>
                        <td><span class="badge ${urgencyClass}">${getUrgencyLabel(d.urgency)}</span></td>
                    `;
                    tableBody.appendChild(tr);
                });
            }
        }
        
        document.getElementById('report-print-title').textContent = reportTitle;
        if (filtersUsed.length > 0) {
            metaText += ` | Filtros: ${filtersUsed.join(', ')}`;
        } else {
            metaText += ` | Filtros: Nenhum (Todos)`;
        }
        document.getElementById('report-print-meta').textContent = metaText;
        
    } catch (error) {
        console.error("Erro ao gerar relatório:", error);
        showToast("Erro ao gerar dados do relatório.", "error");
    }
}

function getAuditBadgeClass(action) {
    switch (action) {
        case 'CREATE': return 'badge-green';
        case 'FORWARD': return 'badge-blue';
        case 'STATUS_CHANGE': return 'badge-yellow';
        case 'COMMENT_ADD': return 'badge-neutral';
        case 'DELETE': return 'badge-red';
        default: return 'badge-neutral';
    }
}

function getUrgencyBadgeClass(urgency) {
    switch (urgency) {
        case 'critical': return 'badge-red';
        case 'warning': return 'badge-yellow';
        case 'normal': return 'badge-green';
        default: return 'badge-neutral';
    }
}

function getUrgencyLabel(urgency) {
    switch (urgency) {
        case 'critical': return 'Crítico';
        case 'warning': return 'Atenção';
        case 'normal': return 'Normal';
        default: return 'Neutro';
    }
}

function getStatusBadgeClass(status) {
    switch (status) {
        case 'Pendente': return 'badge-yellow';
        case 'Em Andamento': return 'badge-blue';
        case 'Concluído': return 'badge-green';
        case 'Atrasado': return 'badge-red';
        default: return 'badge-neutral';
    }
}
