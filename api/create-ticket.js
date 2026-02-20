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

        // --- File Upload ---
        if (body.fileData && body.fileData.base64) {
            try {
                console.log('📎 Subiendo archivo adjunto a HubSpot...');

                // Decode base64 to buffer
                const buffer = Buffer.from(body.fileData.base64, 'base64');

                // HubSpot Files API v3 requires multipart/form-data
                const formData = new FormData();
                const blob = new Blob([buffer], { type: body.fileData.type });

                formData.append('file', blob, body.fileData.name);
                formData.append('folderPath', '/tickets_portal');
                formData.append('options', JSON.stringify({
                    access: 'PRIVATE', // Keep files private by default
                    overwrite: false,
                    duplicateValidationStrategy: 'NONE',
                    duplicateValidationScope: 'ENTIRE_PORTAL'
                }));

                const fileRes = await fetch('https://api.hubapi.com/files/v3/files', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}`
                        // Don't set Content-Type manually, fetch will set it with boundary
                    },
                    body: formData
                });

                if (fileRes.ok) {
                    const fileData = await fileRes.json();
                    if (fileData && fileData.id) {
                        console.log('✅ Archivo subido con ID:', fileData.id);
                        // Add file ID to ticket properties
                        ticketData.properties.hs_file_upload = fileData.id;
                    }
                } else {
                    const errorText = await fileRes.text();
                    console.error('⚠️ Error al subir archivo a HubSpot:', fileRes.status, errorText);
                    // We continue ticket creation even if file upload fails, to not lose the request
                }
            } catch (err) {
                console.error('⚠️ Excepción subiendo archivo:', err.message);
            }
        }
        // -------------------

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
