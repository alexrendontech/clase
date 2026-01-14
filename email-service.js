/**
 * Servicio de notificaciones por correo - Cloudflare Worker Proxy
 * Usa Cloudflare Workers para proteger la API key de Brevo
 * Plan gratuito: 300 correos/día
 */

const CLOUDFLARE_WORKER_URL = 'https://spring-field-4fe9.mifestereo.workers.dev';

async function enviarCorreo({ to, toName, subject, htmlContent }) {
    try {
        console.log('📧 Intentando enviar correo a:', to);
        
        const response = await fetch(CLOUDFLARE_WORKER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sender: {
                    name: "Sistema Reprogramaciones",
                    email: "equipomenacional7@gmail.com"
                },
                to: [{ email: to, name: toName }],
                subject: subject,
                htmlContent: htmlContent
            })
        });

        const data = await response.json();
        
        console.log('📨 Respuesta Worker:', { status: response.status, data });
        
        if (!response.ok) {
            console.error('❌ Error Worker completo:', JSON.stringify(data, null, 2));
            throw new Error(data.message || data.error || `Error ${response.status}: ${JSON.stringify(data)}`);
        }

        console.log('✅ Correo enviado exitosamente a:', to);
        return { success: true, messageId: data.messageId };
        
    } catch (error) {
        console.error('❌ Error completo al enviar correo:', error);
        console.error('Stack:', error.stack);
        return { success: false, error: error.message };
    }
}

async function notificarSupervisorNuevaReprogramacion(data) {
    const { supervisorEmail, supervisorNombre, auxiliarNombre, archivoNombre, totalRegistros, fechaSubida } = data;
    
    const fecha = new Date(fechaSubida).toLocaleDateString('es-CO', {
        day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const htmlContent = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <meta name="format-detection" content="telephone=no"/>
    <meta name="format-detection" content="date=no"/>
    <meta name="format-detection" content="address=no"/>
    <meta name="format-detection" content="email=no"/>
    <title>Nueva Reprogramacion Pendiente</title>
    <!--[if mso]>
    <style type="text/css">
        body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
    </style>
    <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f4f4;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <!-- Contenedor principal -->
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <!-- Header con gradiente -->
                    <tr>
                        <td align="center" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); padding: 40px 30px; border-radius: 8px 8px 0 0;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td align="center" style="font-size: 48px; line-height: 1; padding-bottom: 12px;">📋</td>
                                </tr>
                                <tr>
                                    <td align="center" style="color: #ffffff; font-size: 26px; font-weight: 700; line-height: 1.3;">Nueva Reprogramación Pendiente</td>
                                </tr>
                                <tr>
                                    <td align="center" style="color: rgba(255,255,255,0.9); font-size: 14px; padding-top: 8px;">Sistema de Gestión de Reprogramaciones</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <!-- Contenido -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <!-- Saludo -->
                                <tr>
                                    <td style="color: #1f2937; font-size: 16px; line-height: 1.5; padding-bottom: 20px;">
                                        Hola <strong style="color: #111827;">${supervisorNombre}</strong>,
                                    </td>
                                </tr>
                                <!-- Alerta -->
                                <tr>
                                    <td style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px 20px; border-radius: 4px; margin-bottom: 24px;">
                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr>
                                                <td style="color: #92400e; font-size: 15px; font-weight: 600; line-height: 1.5;">
                                                    Tienes una nueva reprogramación que requiere tu atención
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                <!-- Texto -->
                                <tr>
                                    <td style="color: #4b5563; font-size: 15px; line-height: 1.6; padding: 20px 0;">
                                        <strong style="color: #1f2937;">${auxiliarNombre}</strong> ha enviado una reprogramación para su revisión y aprobación.
                                    </td>
                                </tr>
                                <!-- Tarjeta de información -->
                                <tr>
                                    <td style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; margin: 24px 0;">
                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr>
                                                <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                        <tr>
                                                            <td style="color: #6b7280; font-size: 13px; font-weight: 500;">📄 Archivo</td>
                                                            <td align="right" style="color: #1f2937; font-size: 14px; font-weight: 600;">${archivoNombre}</td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                        <tr>
                                                            <td style="color: #6b7280; font-size: 13px; font-weight: 500;">📊 Total de registros</td>
                                                            <td align="right" style="color: #1f2937; font-size: 14px; font-weight: 600;">${totalRegistros} registros</td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                        <tr>
                                                            <td style="color: #6b7280; font-size: 13px; font-weight: 500;">👤 Enviado por</td>
                                                            <td align="right" style="color: #1f2937; font-size: 14px; font-weight: 600;">${auxiliarNombre}</td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 12px 0;">
                                                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                        <tr>
                                                            <td style="color: #6b7280; font-size: 13px; font-weight: 500;">📅 Fecha de envío</td>
                                                            <td align="right" style="color: #1f2937; font-size: 14px; font-weight: 600;">${fecha}</td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                <!-- Mensaje final -->
                                <tr>
                                    <td style="color: #4b5563; font-size: 15px; line-height: 1.6; padding: 20px 0;">
                                        Por favor, ingresa al sistema para revisar y completar esta reprogramación a la brevedad posible.
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 24px 30px; border-top: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td align="center" style="color: #9ca3af; font-size: 12px; line-height: 1.5; padding-bottom: 8px;">
                                        Este es un mensaje automático del Sistema de Reprogramaciones
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="color: #9ca3af; font-size: 12px; line-height: 1.5;">
                                        Por favor no responder a este correo electrónico
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="color: #d1d5db; font-size: 11px; padding-top: 16px;">
                                        © 2026 Sistema de Reprogramaciones. Todos los derechos reservados.
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

    return await enviarCorreo({
        to: supervisorEmail,
        toName: supervisorNombre,
        subject: `📋 Nueva Reprogramación de ${auxiliarNombre}`,
        htmlContent: htmlContent
    });
}

async function notificarAuxiliarReprogramacionCompletada(data) {
    const { auxiliarEmail, auxiliarNombre, supervisorNombre, archivoNombre, totalRegistros, fechaRespuesta } = data;
    
    const fecha = new Date(fechaRespuesta).toLocaleDateString('es-CO', {
        day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const htmlContent = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <meta name="format-detection" content="telephone=no"/>
    <meta name="format-detection" content="date=no"/>
    <meta name="format-detection" content="address=no"/>
    <meta name="format-detection" content="email=no"/>
    <title>Reprogramacion Completada</title>
    <!--[if mso]>
    <style type="text/css">
        body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
    </style>
    <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f4f4;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <!-- Contenedor principal -->
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <!-- Header con gradiente verde -->
                    <tr>
                        <td align="center" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 30px; border-radius: 8px 8px 0 0;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td align="center" style="font-size: 48px; line-height: 1; padding-bottom: 12px;">✅</td>
                                </tr>
                                <tr>
                                    <td align="center" style="color: #ffffff; font-size: 26px; font-weight: 700; line-height: 1.3;">Reprogramación Completada</td>
                                </tr>
                                <tr>
                                    <td align="center" style="color: rgba(255,255,255,0.9); font-size: 14px; padding-top: 8px;">Sistema de Gestión de Reprogramaciones</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <!-- Contenido -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <!-- Saludo -->
                                <tr>
                                    <td style="color: #1f2937; font-size: 16px; line-height: 1.5; padding-bottom: 20px;">
                                        Hola <strong style="color: #111827;">${auxiliarNombre}</strong>,
                                    </td>
                                </tr>
                                <!-- Alerta de éxito -->
                                <tr>
                                    <td style="background-color: #d1fae5; border-left: 4px solid #10b981; padding: 16px 20px; border-radius: 4px; margin-bottom: 24px;">
                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr>
                                                <td style="color: #065f46; font-size: 15px; font-weight: 600; line-height: 1.5;">
                                                    Tu reprogramación ha sido revisada y completada exitosamente
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                <!-- Texto -->
                                <tr>
                                    <td style="color: #4b5563; font-size: 15px; line-height: 1.6; padding: 20px 0;">
                                        <strong style="color: #1f2937;">${supervisorNombre}</strong> ha revisado y completado tu reprogramación. Ya puedes descargar el archivo actualizado desde el sistema.
                                    </td>
                                </tr>
                                <!-- Tarjeta de información -->
                                <tr>
                                    <td style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; margin: 24px 0;">
                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr>
                                                <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                        <tr>
                                                            <td style="color: #6b7280; font-size: 13px; font-weight: 500;">📄 Archivo</td>
                                                            <td align="right" style="color: #1f2937; font-size: 14px; font-weight: 600;">${archivoNombre}</td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                        <tr>
                                                            <td style="color: #6b7280; font-size: 13px; font-weight: 500;">📊 Total de registros</td>
                                                            <td align="right" style="color: #1f2937; font-size: 14px; font-weight: 600;">${totalRegistros} registros</td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                        <tr>
                                                            <td style="color: #6b7280; font-size: 13px; font-weight: 500;">👤 Revisado por</td>
                                                            <td align="right" style="color: #1f2937; font-size: 14px; font-weight: 600;">${supervisorNombre}</td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 12px 0;">
                                                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                        <tr>
                                                            <td style="color: #6b7280; font-size: 13px; font-weight: 500;">📅 Fecha de respuesta</td>
                                                            <td align="right" style="color: #1f2937; font-size: 14px; font-weight: 600;">${fecha}</td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                <!-- Mensaje final -->
                                <tr>
                                    <td style="color: #4b5563; font-size: 15px; line-height: 1.6; padding: 20px 0;">
                                        Gracias por tu colaboración en el proceso de reprogramación.
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 24px 30px; border-top: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td align="center" style="color: #9ca3af; font-size: 12px; line-height: 1.5; padding-bottom: 8px;">
                                        Este es un mensaje automático del Sistema de Reprogramaciones
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="color: #9ca3af; font-size: 12px; line-height: 1.5;">
                                        Por favor no responder a este correo electrónico
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="color: #d1d5db; font-size: 11px; padding-top: 16px;">
                                        © 2026 Sistema de Reprogramaciones. Todos los derechos reservados.
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

    return await enviarCorreo({
        to: auxiliarEmail,
        toName: auxiliarNombre,
        subject: `✅ ${supervisorNombre} completó tu reprogramación`,
        htmlContent: htmlContent
    });
}

// Exportar funciones globalmente
window.notificarSupervisorNuevaReprogramacion = notificarSupervisorNuevaReprogramacion;
window.notificarAuxiliarReprogramacionCompletada = notificarAuxiliarReprogramacionCompletada;
