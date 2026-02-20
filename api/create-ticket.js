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
        console.log('📩 Creando ticket:', body.subject);

        const ticketData = {
            properties: {
                subject: body.subject || 'Sin asunto',
                content: body.description || '',
                hs_pipeline: '866504349',
                hs_pipeline_stage: '1297561004',
                area_de_atencion: body.category || '',
                source_portal: 'portal_cliente',
                source_type: 'FORM'
            },
        };

        let contactId = null;

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

                if (contactSearch.status >= 200 && contactSearch.status < 300 && contactSearch.data && contactSearch.data.total > 0) {
                    contactId = contactSearch.data.results[0].id;
                    console.log('✅ Contacto encontrado:', contactId);
                } else {
                    console.log('⚠️  No se encontró contacto para el correo:', body.email);
                    return res.status(400).json({
                        error: 'Lo sentimos, su e-mail no se encuentra registrado en nuestro sistema. Por favor verifique si está correcto o comuníquese directamente con nuestra Mesa de Ayuda al 800 400 110'
                    });
                }
            } catch (e) {
                console.log('⚠️  Error al buscar contacto:', e.message);
                return res.status(500).json({
                    error: 'Error interno al verificar el usuario.'
                });
            }
        }

        const result = await hubspotRequest('POST', '/crm/v3/objects/tickets', ticketData);

        if (result.status >= 200 && result.status < 300) {
            console.log('✅ Ticket creado:', result.data.id);

            // Try to associate contact by id
            if (contactId) {
                try {
                    await hubspotRequest(
                        'PUT',
                        `/crm/v3/objects/tickets/${result.data.id}/associations/contacts/${contactId}/ticket_to_contact`,
                        {}
                    );
                    console.log('🔗 Contacto asociado:', contactId);
                } catch (e) {
                    console.log('⚠️  No se pudo asociar contacto:', e.message);
                }
            }

            return res.status(200).json({ ticketId: result.data.id });
        } else {
            console.error('❌ Error HubSpot:', result.data);
            return res.status(result.status).json({
                error: result.data.message || 'Error al crear ticket en HubSpot',
            });
        }
    } catch (err) {
        console.error('💥 Server error:', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}
