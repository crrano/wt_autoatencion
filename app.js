/* ======================================================
   Wisetrack — Portal de Soporte · Application Logic
   ====================================================== */

(function () {
    'use strict';


    /* ───────── Configuration ───────── */
    const CONFIG = {
        // ══════════════════════════════════════════════════════
        //  Proxy local → HubSpot (ejecuta: node server.js)
        //  Cambia DEMO_MODE a true para probar sin backend.
        // ══════════════════════════════════════════════════════
        DEMO_MODE: false,

        // Proxy local (server.js)
        CREATE_TICKET_URL: '/api/create-ticket',
        CHECK_STATUS_URL: '/api/check-status',

        // Tiempos
        DEBOUNCE_MS: 300,
        LOADING_MIN_MS: 800, // Tiempo mínimo de loading para UX
    };

    /* ───────── DOM References ───────── */
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // Tabs
    const tabBtns = $$('.tabs__btn');
    const panels = $$('.panel');

    // Create form
    const formCreate = $('#form-create');
    const inputEmail = $('#create-email');
    const inputSubject = $('#create-subject');
    const inputCategory = $('#create-category');
    const inputDesc = $('#create-description');
    const btnCreate = $('#btn-create');

    // Status form
    const formStatus = $('#form-status');
    const inputTicketId = $('#status-ticket');
    const inputStatusEmail = $('#status-email');
    const btnStatus = $('#btn-status');

    // Status result
    const statusResult = $('#status-result');
    const resultBadge = $('#result-badge');
    const resultId = $('#result-id');
    const resultSubject = $('#result-subject');
    const resultOwner = $('#result-owner');
    const resultCategory = $('#result-category');
    const resultCreated = $('#result-created');
    const resultUpdated = $('#result-updated');

    // Modal
    const modalOverlay = $('#modal-overlay');
    const modalIcon = $('#modal-icon');
    const modalTitle = $('#modal-title');
    const modalMessage = $('#modal-message');
    const modalClose = $('#modal-close');

    /* ───────── Tab Switching ───────── */
    function switchTab(tabName) {
        tabBtns.forEach(btn => {
            const isActive = btn.dataset.tab === tabName;
            btn.classList.toggle('tabs__btn--active', isActive);
            btn.setAttribute('aria-selected', isActive);
        });

        panels.forEach(panel => {
            const panelTab = panel.id.replace('panel-', '');
            const isActive = panelTab === tabName;
            panel.classList.toggle('panel--active', isActive);
            panel.hidden = !isActive;
        });

        // Hide status result when switching tabs
        if (statusResult) statusResult.hidden = true;
    }

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });


    /* ───────── Validation ───────── */
    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function showFieldError(fieldId, message) {
        const errorEl = $(`#${fieldId}-error`);
        if (errorEl) errorEl.textContent = message;
        const input = $(`#${fieldId}`);
        if (input) input.classList.add('form__input--invalid');
    }

    function clearFieldError(fieldId) {
        const errorEl = $(`#${fieldId}-error`);
        if (errorEl) errorEl.textContent = '';
        const input = $(`#${fieldId}`);
        if (input) input.classList.remove('form__input--invalid');
    }

    function clearAllErrors(formId) {
        const form = $(`#${formId}`);
        if (!form) return;
        form.querySelectorAll('.form__error').forEach(el => el.textContent = '');
        form.querySelectorAll('.form__input--invalid').forEach(el => el.classList.remove('form__input--invalid'));
    }

    // Clear error on input
    ['create-email', 'create-subject', 'create-category', 'create-description',
        'status-ticket', 'status-email'].forEach(id => {
            const el = $(`#${id}`);
            if (el) {
                el.addEventListener('input', () => clearFieldError(id));
                el.addEventListener('change', () => clearFieldError(id));
            }
        });

    function validateCreateForm() {
        let valid = true;
        clearAllErrors('form-create');

        if (!inputEmail.value.trim()) {
            showFieldError('create-email', 'El correo electrónico es obligatorio.');
            valid = false;
        } else if (!isValidEmail(inputEmail.value.trim())) {
            showFieldError('create-email', 'Ingresa un correo electrónico válido.');
            valid = false;
        }

        if (!inputSubject.value.trim()) {
            showFieldError('create-subject', 'El asunto es obligatorio.');
            valid = false;
        }

        if (!inputCategory.value) {
            showFieldError('create-category', 'Selecciona una categoría.');
            valid = false;
        }

        if (!inputDesc.value.trim()) {
            showFieldError('create-description', 'La descripción es obligatoria.');
            valid = false;
        }

        return valid;
    }

    function validateStatusForm() {
        let valid = true;
        clearAllErrors('form-status');

        if (!inputTicketId.value.trim()) {
            showFieldError('status-ticket', 'El número de ticket es obligatorio.');
            valid = false;
        }

        if (!inputStatusEmail.value.trim()) {
            showFieldError('status-email', 'El correo electrónico es obligatorio.');
            valid = false;
        } else if (!isValidEmail(inputStatusEmail.value.trim())) {
            showFieldError('status-email', 'Ingresa un correo electrónico válido.');
            valid = false;
        }

        return valid;
    }

    /* ───────── Loading State ───────── */
    function setLoading(btn, loading) {
        btn.disabled = loading;
        btn.classList.toggle('btn--loading', loading);
    }

    /* ───────── Modal ───────── */
    function showModal(type, title, message) {
        modalIcon.className = 'modal__icon';
        if (type === 'success') {
            modalIcon.classList.add('modal__icon--success');
            modalIcon.innerHTML = '✓';
        } else {
            modalIcon.classList.add('modal__icon--error');
            modalIcon.innerHTML = '✕';
        }
        modalTitle.textContent = title;
        modalMessage.innerHTML = message;
        modalOverlay.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function hideModal() {
        modalOverlay.hidden = true;
        document.body.style.overflow = '';
    }

    modalClose.addEventListener('click', hideModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) hideModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modalOverlay.hidden) hideModal();
    });

    /* ───────── API Helpers ───────── */
    async function apiPost(url, data) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!res.ok) {
            let errorMsg = `Error ${res.status}`;
            try {
                const text = await res.text();
                if (text) {
                    try {
                        const errObj = JSON.parse(text);
                        errorMsg = errObj.error || text;
                    } catch (e) {
                        errorMsg = text;
                    }
                }
            } catch (e) {
                // ignore
            }
            throw new Error(errorMsg);
        }

        return res.json();
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /* ───────── Demo Data ───────── */
    function generateDemoTicketId() {
        return Math.floor(Math.random() * 9000000000 + 1000000000).toString();
    }

    const DEMO_STATUSES = {
        open: { label: 'Abierto', css: 'open' },
        in_progress: { label: 'En Progreso', css: 'in-progress' },
        waiting: { label: 'En Espera', css: 'waiting' },
        closed: { label: 'Cerrado', css: 'closed' },
    };

    const CATEGORY_LABELS = {
        soporte: 'Soporte',
        facturacion: 'Finanzas',
        consulta_general: 'Comercial',
    };

    function getDemoStatusResponse(ticketId) {
        const statuses = Object.keys(DEMO_STATUSES);
        const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
        const now = new Date();
        const created = new Date(now.getTime() - Math.random() * 7 * 24 * 60 * 60 * 1000);

        return {
            ticketId: ticketId,
            status: randomStatus,
            subject: 'Problema con acceso al sistema GPS',
            category: 'Soporte',
            createdAt: created.toISOString(),
            updatedAt: now.toISOString(),
        };
    }

    /* ───────── Create Ticket ───────── */
    formCreate.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!validateCreateForm()) return;

        setLoading(btnCreate, true);

        const payload = {
            email: inputEmail.value.trim(),
            subject: inputSubject.value.trim(),
            category: inputCategory.value,
            description: inputDesc.value.trim(),
        };

        try {
            let result;

            if (CONFIG.DEMO_MODE) {
                await delay(CONFIG.LOADING_MIN_MS);
                result = { ticketId: generateDemoTicketId() };
            } else {
                const [res] = await Promise.all([
                    apiPost(CONFIG.CREATE_TICKET_URL, payload),
                    delay(CONFIG.LOADING_MIN_MS),
                ]);
                result = res;
            }

            const ticketId = result.ticketId || result.id || result.objectId || 'N/A';

            showModal(
                'success',
                '¡Solicitud Enviada!',
                `Tu ticket ha sido creado exitosamente.<br><br>
                 <strong style="font-size:1.1em; color:var(--clr-primary)">Nº de Ticket: ${ticketId}</strong><br><br>
                 Te notificaremos por correo electrónico cuando haya una actualización.`
            );

            formCreate.reset();

        } catch (err) {
            console.error('Error creating ticket:', err);

            let displayMessage = 'No se pudo crear el ticket. Por favor, intenta nuevamente.<br><br>' +
                `<small style="color:var(--clr-text-muted)">${err.message}</small>`;
            let displayTitle = 'Error al Enviar';

            if (err.message.includes('Lo sentimos, su e-mail no se encuentra registrado')) {
                displayMessage = err.message;
                displayTitle = 'Atención';
            }

            showModal(
                'error',
                displayTitle,
                displayMessage
            );
        } finally {
            setLoading(btnCreate, false);
        }
    });

    /* ───────── Check Status ───────── */
    formStatus.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!validateStatusForm()) return;

        setLoading(btnStatus, true);
        statusResult.hidden = true;

        const payload = {
            ticketId: inputTicketId.value.trim(),
            email: inputStatusEmail.value.trim(),
        };

        try {
            let result;

            if (CONFIG.DEMO_MODE) {
                await delay(CONFIG.LOADING_MIN_MS);
                result = getDemoStatusResponse(payload.ticketId);
            } else {
                const [res] = await Promise.all([
                    apiPost(CONFIG.CHECK_STATUS_URL, payload),
                    delay(CONFIG.LOADING_MIN_MS),
                ]);
                result = res;
            }

            // Display result
            displayStatusResult(result);

        } catch (err) {
            console.error('Error checking status:', err);
            showModal(
                'error',
                'Error al Consultar',
                'No se pudo obtener el estado del ticket. Verifica los datos e intenta nuevamente.<br><br>' +
                `<small style="color:var(--clr-text-muted)">${err.message}</small>`
            );
        } finally {
            setLoading(btnStatus, false);
        }
    });

    function displayStatusResult(data) {
        // Badge
        const statusKey = data.status || 'open';
        const statusInfo = DEMO_STATUSES[statusKey] || DEMO_STATUSES.open;

        resultBadge.textContent = statusInfo.label;
        resultBadge.className = `status-result__badge status-result__badge--${statusInfo.css}`;

        // ID
        resultId.textContent = `Ticket #${data.ticketId || data.id || '—'}`;

        // Details
        resultOwner.textContent = data.owner || 'Sin asignar';
        resultSubject.textContent = data.subject || '—';
        resultCategory.textContent = data.category || '—';
        resultCreated.textContent = formatDate(data.createdAt);
        resultUpdated.textContent = formatDate(data.updatedAt);

        statusResult.hidden = false;
    }

    function formatDate(isoStr) {
        if (!isoStr) return '—';
        try {
            const d = new Date(isoStr);
            return d.toLocaleDateString('es-CL', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch {
            return isoStr;
        }
    }

    /* ───────── Init ───────── */
    console.log(
        '%c🚀 Wisetrack Portal de Soporte v2.0',
        'color: #00838f; font-weight: bold; font-size: 14px;'
    );

    if (CONFIG.DEMO_MODE) {
        console.log(
            '%c⚠️ Modo Demo activo. Configura los webhooks en CONFIG para conectar con HubSpot.',
            'color: #f59e0b; font-weight: bold;'
        );
    }

    /* ───────── Auto-load from URL Parameters ───────── */
    const urlParams = new URLSearchParams(window.location.search);
    const qTicketId = urlParams.get('ticketId') || urlParams.get('ticket');
    const qEmail = urlParams.get('email');

    if (qTicketId && qEmail) {
        // Switch to status tab automatically
        switchTab('status');

        // Fill input fields
        if (inputTicketId) inputTicketId.value = qTicketId;
        if (inputStatusEmail) inputStatusEmail.value = qEmail;

        // Auto-submit the form after a small delay to ensure DOM is ready
        setTimeout(() => {
            if (formStatus) {
                // Dispatching a submit event ensures all validations and loading states trigger correctly
                formStatus.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            }
        }, 300);
    } else if (window.location.hash === '#status' || urlParams.get('tab') === 'status') {
        switchTab('status');
    }

})();
