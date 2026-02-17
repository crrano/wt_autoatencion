/* ======================================================
   Wisetrack — HubSpot Proxy Server
   Servidor local que conecta el portal con la API de HubSpot
   
   USO:  node server.js
   URL:  http://localhost:3001
   ====================================================== */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;

// Read HUBSPOT_TOKEN from .env.local
function loadEnv() {
    try {
        const envPath = path.join(__dirname, '.env.local');
        const lines = fs.readFileSync(envPath, 'utf8').split('\n');
        for (const line of lines) {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) process.env[match[1].trim()] = match[2].trim();
        }
    } catch { /* .env.local not found, use process.env */ }
}
loadEnv();

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
if (!HUBSPOT_TOKEN) {
    console.error('❌ HUBSPOT_TOKEN no encontrado. Agrégalo a .env.local');
    process.exit(1);
}

// ── MIME types for static files ──
const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
};

// ── Parse request body ──
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch { resolve({}); }
        });
        req.on('error', reject);
    });
}

// ── HubSpot API call ──
function hubspotRequest(method, apiPath, data) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.hubapi.com',
            path: apiPath,
            method: method,
            headers: {
                'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
                'Content-Type': 'application/json',
            },
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(body) });
                } catch {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });

        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

// ── Audit Log ──
const AUDIT_LOG_PATH = path.join(__dirname, 'audit.log');

function getClientIp(req) {
    // X-Forwarded-For for proxies like Render
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.socket?.remoteAddress || 'unknown';
}

function auditLog(req, action, data) {
    const entry = {
        timestamp: new Date().toISOString(),
        ip: getClientIp(req),
        action,
        ...data,
    };
    const line = JSON.stringify(entry) + '\n';
    fs.appendFile(AUDIT_LOG_PATH, line, (err) => {
        if (err) console.error('⚠️  Error escribiendo audit log:', err.message);
    });
    console.log(`📋 AUDIT: ${action} | ${data.email || '-'} | ticket:${data.ticketId || '-'} | IP:${entry.ip}`);
}

// ── Helpers ──
function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, statusCode, data) {
    setCors(res);
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function serveStaticFile(res, filePath) {
    const ext = path.extname(filePath);
    const mimeType = MIME[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('File not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': mimeType });
        res.end(data);
    });
}

// ── Server ──
const server = http.createServer(async (req, res) => {
    setCors(res);

    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    try {
        // ═══ API: CREATE TICKET ═══
        if (req.url === '/api/create-ticket' && req.method === 'POST') {
            const body = await parseBody(req);
            console.log('📩 Creando ticket:', body.subject);

            const ticketData = {
                properties: {
                    subject: body.subject || 'Sin asunto',
                    content: body.description || '',
                    hs_pipeline: '866504349',
                    hs_pipeline_stage: '1297561004',
                    area_de_atencion: body.category || '',
                    source_portal: 'portal_cliente',
                    source_type: 'FORM',
                },
            };

            const result = await hubspotRequest('POST', '/crm/v3/objects/tickets', ticketData);

            if (result.status >= 200 && result.status < 300) {
                console.log('✅ Ticket creado:', result.data.id);

                // Try to associate contact by email
                if (body.email) {
                    try {
                        const contactSearch = await hubspotRequest('POST', '/crm/v3/objects/contacts/search', {
                            filterGroups: [{
                                filters: [{
                                    propertyName: 'email',
                                    operator: 'EQ',
                                    value: body.email,
                                }],
                            }],
                        });

                        if (contactSearch.data && contactSearch.data.total > 0) {
                            const contactId = contactSearch.data.results[0].id;
                            await hubspotRequest(
                                'PUT',
                                `/crm/v3/objects/tickets/${result.data.id}/associations/contacts/${contactId}/ticket_to_contact`,
                                {}
                            );
                            console.log('🔗 Contacto asociado:', contactId);
                        }
                    } catch (e) {
                        console.log('⚠️  No se pudo asociar contacto:', e.message);
                    }
                }

                auditLog(req, 'CREATE_TICKET', {
                    email: body.email || '',
                    ticketId: result.data.id,
                    subject: body.subject || '',
                    category: body.category || '',
                });
                sendJson(res, 200, { ticketId: result.data.id });
            } else {
                console.error('❌ Error HubSpot:', result.data);
                sendJson(res, result.status, {
                    error: result.data.message || 'Error al crear ticket en HubSpot',
                });
            }
        }

        // ═══ API: CHECK STATUS ═══
        else if (req.url === '/api/check-status' && req.method === 'POST') {
            const body = await parseBody(req);
            const ticketId = body.ticketId;
            console.log('🔍 Consultando ticket:', ticketId);

            if (!ticketId) {
                return sendJson(res, 400, { error: 'El número de ticket es obligatorio' });
            }

            const result = await hubspotRequest(
                'GET',
                `/crm/v3/objects/tickets/${ticketId}?properties=subject,content,createdate,hs_lastmodifieddate,hs_pipeline_stage,hs_ticket_category,hubspot_owner_id,hs_all_owner_ids,closed_date`
            );

            if (result.status >= 200 && result.status < 300) {
                const p = result.data.properties || {};

                // Map ALL HubSpot pipeline stages to portal status keys
                const stageMap = {
                    // ── Servicio al Cliente ──
                    '68493207': 'open',          // Nueva solicitud
                    '68493208': 'in_progress',   // Asignada
                    '68493209': 'in_progress',   // En evaluación
                    '68493210': 'in_progress',   // En resolución
                    '68499521': 'in_progress',   // Derivado a otra area
                    '68499522': 'in_progress',   // Validando resolución
                    '70440825': 'closed',        // Entregado
                    // ── Ticket Bodega ──
                    '144262973': 'open',         // Recibido
                    '144262974': 'in_progress',  // En ejecución
                    '1035414591': 'in_progress', // Preparado
                    '144262975': 'closed',       // Resuelto
                    '145752654': 'closed',       // Rechazado
                    // ── Ticket Capacitaciones ──
                    '71149428': 'open',          // Recibido
                    '1005134935': 'in_progress', // Contactado
                    '71149429': 'in_progress',   // Cliente agendado
                    '71149430': 'closed',        // Capacitación realizada
                    '145752617': 'closed',       // Rechazado
                    '260468294': 'closed',       // Cliente no asiste
                    // ── Ticket Comercial ──
                    '147570346': 'open',         // Recibido
                    '147570348': 'in_progress',  // En Ejecución
                    '147570349': 'closed',       // Resuelto
                    // ── Ticket Desarrollo ──
                    '99686657': 'open',          // Recibido
                    '1069164548': 'in_progress', // Planificado
                    '99686658': 'in_progress',   // En ejecución
                    '1069147160': 'in_progress', // En QA
                    '1069159723': 'in_progress', // En QA Funcional
                    '1069159724': 'in_progress', // Paso a Producción
                    '1069184947': 'in_progress', // Validar en Producción
                    '99686659': 'closed',        // Resuelto
                    '145785515': 'closed',       // Rechazado
                    // ── Tickets Fábrica ──
                    '144316782': 'open',         // Recibido
                    '144316783': 'in_progress',  // En ejecución
                    '144316784': 'closed',       // Resuelto
                    '145785486': 'closed',       // Rechazado
                    // ── Ticket Finanzas ──
                    '71129972': 'open',          // Recibido
                    '71129973': 'in_progress',   // En ejecución
                    '71129974': 'closed',        // Resuelto
                    '145752666': 'closed',       // Rechazado
                    // ── Ticket Infraestructura ──
                    '99227971': 'open',          // Recibido
                    '99227972': 'in_progress',   // En ejecución
                    '99705958': 'closed',        // Resuelto
                    '145735534': 'closed',       // Rechazado
                    // ── Ticket Producto/Ingeniería ──
                    '99705960': 'open',          // Recibido
                    '1192675130': 'in_progress', // Asignado
                    '99705961': 'in_progress',   // En ejecución
                    '99705962': 'closed',        // Resuelto
                    '145785508': 'closed',       // Rechazado
                    // ── Ticket Resolución Operativa ──
                    '99686661': 'open',          // Recibido
                    '1135170575': 'in_progress', // Asignado
                    '99686662': 'in_progress',   // En ejecución
                    '1138238262': 'in_progress', // Enviado a QA
                    '145752636': 'closed',       // Resuelto
                    '99686663': 'closed',        // Rechazado
                    // ── Operaciones ──
                    '106187291': 'in_progress',  // Infraestructura
                    '106187292': 'in_progress',  // Ingeniería
                    '106187293': 'in_progress',  // Fábrica
                    '106195979': 'in_progress',  // Bodega MP
                    '106195980': 'in_progress',  // Fabricación y Rotulación
                    '106282801': 'in_progress',  // Bodega ProdTer
                    '106282802': 'in_progress',  // Coordinación
                    '106282803': 'in_progress',  // Servicio Técnico
                    '106282804': 'in_progress',  // Soporte
                    '106187294': 'closed',       // Cerrados
                    // ── Tickets Coordinación ──
                    '150127021': 'open',         // Recibido
                    '150127022': 'in_progress',  // En coordinación
                    '1154516813': 'waiting',     // En espera de cliente
                    '1154516814': 'in_progress', // En proceso de instalación
                    '150127023': 'closed',       // Instalado
                    '150127024': 'closed',       // Rechazado
                    // ── Mesa de Ayuda Perú ──
                    '166376230': 'open',         // Nueva Solicitud
                    '166376231': 'in_progress',  // Asignada
                    '166376232': 'in_progress',  // En evaluación
                    '219351877': 'in_progress',  // En resolución
                    '219351878': 'in_progress',  // Derivado a otra area
                    '219351879': 'in_progress',  // Validando resolución
                    '166376233': 'closed',       // Entregado
                    // ── Bodega/Fábrica Perú ──
                    '206590125': 'open',         // Recibido
                    '206590126': 'in_progress',  // En Ejecución
                    '206590128': 'closed',       // Resuelto
                    '206590127': 'closed',       // Rechazado
                    // ── Finanzas Perú ──
                    '219338901': 'open',         // Recibido
                    '219338902': 'in_progress',  // En Ejecución
                    '219338903': 'closed',       // Resuelto
                    '219338904': 'closed',       // Rechazado
                    // ── Capacitaciones Perú ──
                    '220152760': 'open',         // Recibido
                    '1003059981': 'in_progress', // Contactado
                    '220152761': 'in_progress',  // Cliente agendado
                    '220152832': 'closed',       // Capacitación realizada
                    '220152833': 'closed',       // Rechazado
                    // ── Coordinación Perú ──
                    '1000634720': 'open',        // Recibido
                    '1000634721': 'in_progress', // En Coordinación
                    '1000634722': 'closed',      // Instalado
                    '1000634723': 'closed',      // Rechazado
                    // ── Autoatencion ──
                    '1297561004': 'open',        // Nuevo
                    '1297561005': 'in_progress', // En proceso
                    '1297561006': 'waiting',     // Esperando Cliente
                    '1297561007': 'closed',      // Resuelto
                    '1297561008': 'closed',      // Cerrado
                };

                // Fallback: if stage not in map, check closed_date
                let status = stageMap[p.hs_pipeline_stage];
                if (!status) {
                    status = p.closed_date ? 'closed' : 'open';
                }

                // Map HubSpot category codes to friendly labels
                const categoryMap = {
                    'PRODUCT_ISSUE': 'Problema con Producto',
                    'BILLING_ISSUE': 'Facturación',
                    'FEATURE_REQUEST': 'Solicitud de Funcionalidad',
                    'GENERAL_INQUIRY': 'Consulta General',
                };

                // Resolve owner name dynamically via HubSpot API
                const ownerId = p.hubspot_owner_id || p.hs_all_owner_ids;
                let ownerName = 'Sin asignar';
                if (ownerId) {
                    try {
                        const ownerResult = await hubspotRequest('GET', `/crm/v3/owners/${ownerId}`);
                        if (ownerResult.status >= 200 && ownerResult.status < 300) {
                            const o = ownerResult.data;
                            ownerName = `${o.firstName || ''} ${o.lastName || ''}`.trim() || o.email || ownerName;
                        }
                    } catch (e) {
                        console.log('⚠️  No se pudo obtener propietario:', e.message);
                    }
                }

                auditLog(req, 'CHECK_STATUS', {
                    email: body.email || '',
                    ticketId,
                    status,
                    owner: ownerName,
                });
                console.log('✅ Ticket encontrado, estado:', p.hs_pipeline_stage, '| propietario:', ownerName);
                sendJson(res, 200, {
                    ticketId: result.data.id,
                    status: status,
                    owner: ownerName,
                    subject: p.subject || '',
                    category: categoryMap[p.hs_ticket_category] || p.hs_ticket_category || '',
                    createdAt: p.createdate || '',
                    updatedAt: p.hs_lastmodifieddate || '',
                });
            } else {
                const msg = result.status === 404
                    ? 'Ticket no encontrado. Verifica el número e intenta nuevamente.'
                    : (result.data.message || 'Error al consultar ticket');
                console.error('❌', msg);
                sendJson(res, result.status, { error: msg });
            }
        }

        // ═══ AUDIT LOG (GET) ═══
        else if (req.url === '/api/audit-log' && req.method === 'GET') {
            try {
                const raw = fs.readFileSync(AUDIT_LOG_PATH, 'utf8');
                const entries = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
                sendJson(res, 200, { total: entries.length, entries: entries.reverse() });
            } catch {
                sendJson(res, 200, { total: 0, entries: [] });
            }
        }

        // ═══ HEALTH CHECK ═══
        else if (req.url === '/api/health') {
            sendJson(res, 200, { status: 'ok', service: 'Wisetrack HubSpot Proxy' });
        }

        // ═══ STATIC FILES (serve portal) ═══
        else {
            let filePath = req.url === '/' ? '/index.html' : req.url;
            filePath = path.join(__dirname, filePath);

            // Security: prevent directory traversal
            if (!filePath.startsWith(__dirname)) {
                res.writeHead(403);
                return res.end('Forbidden');
            }

            serveStaticFile(res, filePath);
        }

    } catch (err) {
        console.error('💥 Server error:', err);
        sendJson(res, 500, { error: 'Error interno del servidor' });
    }
});

server.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║  🚀 Wisetrack Portal de Soporte             ║');
    console.log('  ║                                              ║');
    console.log(`  ║  Portal:  http://localhost:${PORT}              ║`);
    console.log('  ║  API:     /api/create-ticket                 ║');
    console.log('  ║           /api/check-status                  ║');
    console.log('  ║                                              ║');
    console.log('  ║  HubSpot: Conectado ✓                       ║');
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('');
});
