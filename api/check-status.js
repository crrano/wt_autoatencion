const { hubspotRequest, setCors } = require('./_utils');

export default async function handler(req, res) {
    setCors(res);

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const body = req.body || {};
        const ticketId = body.ticketId;
        console.log('🔍 Consultando ticket:', ticketId);

        if (!ticketId) {
            return res.status(400).json({ error: 'El número de ticket es obligatorio' });
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

            console.log('✅ Ticket encontrado, estado:', p.hs_pipeline_stage, '| propietario:', ownerName);
            return res.status(200).json({
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
            return res.status(result.status).json({ error: msg });
        }
    } catch (err) {
        console.error('💥 Server error:', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}
