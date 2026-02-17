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
                    hs_ticket_category: body.category || '',
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
                `/crm/v3/objects/tickets/${ticketId}?properties=subject,content,createdate,hs_lastmodifieddate,hs_pipeline_stage,hs_ticket_category,hubspot_owner_id,hs_all_owner_ids`
            );

            if (result.status >= 200 && result.status < 300) {
                const p = result.data.properties || {};

                // Map HubSpot Autoatencion pipeline stages to our status keys
                const stageMap = {
                    '1297561004': 'open',          // Nuevo
                    '1297561005': 'in_progress',   // En proceso
                    '1297561006': 'waiting',       // Esperando Cliente
                    '1297561007': 'closed',        // Resuelto
                    '1297561008': 'closed',        // Cerrado
                };

                // Map HubSpot category codes to friendly labels
                const categoryMap = {
                    'PRODUCT_ISSUE': 'Problema con Producto',
                    'BILLING_ISSUE': 'Facturación',
                    'FEATURE_REQUEST': 'Solicitud de Funcionalidad',
                    'GENERAL_INQUIRY': 'Consulta General',
                };

                // Resolve owner name
                // NOTE: The token lacks crm.objects.owners.read scope so we
                //       can't call /crm/v3/owners/. Instead we maintain a map.
                //       Add new owners here as { 'ownerId': 'Nombre' }.
                const OWNER_MAP = {
                    '86373870': 'Rodrigo Serrano',
                };

                const ownerId = p.hubspot_owner_id || p.hs_all_owner_ids;
                let ownerName = 'Sin asignar';
                if (ownerId) {
                    ownerName = OWNER_MAP[ownerId] || `ID ${ownerId}`;
                }

                console.log('✅ Ticket encontrado, estado:', p.hs_pipeline_stage, '| propietario:', ownerName);
                sendJson(res, 200, {
                    ticketId: result.data.id,
                    status: stageMap[p.hs_pipeline_stage] || 'open',
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
