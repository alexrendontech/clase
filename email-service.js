/**
 * Servicio de notificaciones por correo - Cloudflare Worker Proxy
 * Usa Cloudflare Workers para proteger la API key de Brevo
 * Plan gratuito: 300 correos/día
 * 
 * FIX v3: Los adjuntos SIEMPRE se envían como base64 (content), nunca por URL.
 * Brevo es poco fiable descargando URLs externas (Cloudinary), lo que causaba
 * que los correos llegaran sin adjunto de forma intermitente.
 */

const CLOUDFLARE_WORKER_URL = 'https://spring-field-4fe9.mifestereo.workers.dev';
const MAX_REINTENTOS_EMAIL = 3;
const PAUSA_ENTRE_REINTENTOS_MS = 2000;

/**
 * Descarga un archivo desde una URL y lo convierte a base64.
 * Esto garantiza que el adjunto siempre se envíe como contenido directo.
 */
async function urlABase64(url) {
    try {
        console.log('📥 Descargando archivo para convertir a base64:', url);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Error HTTP ${response.status} al descargar ${url}`);
        }
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                // Extraer solo la parte base64 (sin el prefijo data:...;base64,)
                const base64 = reader.result.split(',')[1];
                if (!base64 || base64.length < 10) {
                    reject(new Error('Conversión a base64 produjo contenido vacío'));
                    return;
                }
                console.log('✅ Archivo convertido a base64 (' + Math.round(base64.length * 0.75 / 1024) + ' KB)');
                resolve(base64);
            };
            reader.onerror = () => reject(new Error('Error al leer blob como base64'));
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('❌ Error al convertir URL a base64:', error);
        throw error;
    }
}

/**
 * Convierte un archivo File del navegador directamente a base64.
 */
async function fileABase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            if (!base64 || base64.length < 10) {
                reject(new Error('Conversión de archivo a base64 produjo contenido vacío'));
                return;
            }
            console.log('✅ Archivo local convertido a base64 (' + Math.round(base64.length * 0.75 / 1024) + ' KB)');
            resolve(base64);
        };
        reader.onerror = () => reject(new Error('Error al leer archivo como base64'));
        reader.readAsDataURL(file);
    });
}

/**
 * Pausa la ejecución por un tiempo determinado.
 */
function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function enviarCorreo({ to, toName, subject, htmlContent, textContent, attachments }) {
    try {
        console.log('📧 Intentando enviar correo a:', to);

        // Si 'to' es un array, enviar a múltiples destinatarios
        let destinatarios = [];
        if (Array.isArray(to)) {
            destinatarios = to.map(email => ({ email: email, name: toName || 'Destinatario' }));
        } else {
            destinatarios = [{ email: to, name: toName }];
        }

        const payload = {
            sender: {
                name: "Sistema Reprogramaciones",
                email: "equipomenacional7@gmail.com"
            },
            to: destinatarios,
            subject: subject,
            htmlContent: htmlContent
        };

        // Agregar versión texto plano si existe (mejora deliverability)
        if (textContent) {
            payload.textContent = textContent;
        }
        
        // ✅ FIX v3: SIEMPRE convertir adjuntos a base64 content (nunca enviar por URL)
        if (attachments && attachments.length > 0) {
            console.log('📎📎📎 PROCESANDO ADJUNTOS (SIEMPRE BASE64) 📎📎📎');
            console.log(`Total adjuntos a procesar: ${attachments.length}`);
            
            const adjuntosProcesados = [];
            
            for (let idx = 0; idx < attachments.length; idx++) {
                const att = attachments[idx];
                // Sanear el nombre del archivo
                const sanitizedName = att.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                
                let base64Content = null;
                
                // PRIORIDAD 1: Si ya tiene contenido base64 directo, usarlo
                if (att.content && att.content.length > 10) {
                    base64Content = att.content;
                    console.log(`Adjunto #${idx + 1}: Usando base64 directo (${sanitizedName})`);
                }
                // PRIORIDAD 2: Si tiene un objeto File del navegador, convertirlo
                else if (att.file && att.file instanceof File) {
                    try {
                        base64Content = await fileABase64(att.file);
                        console.log(`Adjunto #${idx + 1}: Convertido desde File (${sanitizedName})`);
                    } catch (convError) {
                        console.error(`❌ Error convirtiendo File a base64:`, convError);
                    }
                }
                // PRIORIDAD 3: Si tiene URL, descargar y convertir a base64
                else if (att.url) {
                    try {
                        base64Content = await urlABase64(att.url);
                        console.log(`Adjunto #${idx + 1}: Descargado y convertido desde URL (${sanitizedName})`);
                    } catch (dlError) {
                        console.error(`❌ Error descargando URL para adjunto:`, dlError);
                        // Segundo intento tras pausa
                        try {
                            console.log(`🔄 Reintentando descarga de URL...`);
                            await esperar(2000);
                            base64Content = await urlABase64(att.url);
                            console.log(`✅ Reintento exitoso para adjunto #${idx + 1}`);
                        } catch (retryError) {
                            console.error(`❌❌ Segundo intento fallido:`, retryError);
                        }
                    }
                }
                
                // Validar que tenemos contenido válido
                if (base64Content && base64Content.length > 10) {
                    const tamanoKB = Math.round(base64Content.length * 0.75 / 1024);
                    console.log(`✅ Adjunto #${idx + 1} listo: ${sanitizedName} (${tamanoKB} KB)`);
                    
                    if (tamanoKB > 2048) {
                        console.warn(`⚠️ ADVERTENCIA: Archivo grande (${tamanoKB} KB). Límite Brevo ~2MB`);
                    }
                    
                    adjuntosProcesados.push({
                        name: sanitizedName,
                        content: base64Content
                    });
                } else {
                    console.error(`❌ Adjunto #${idx + 1} (${sanitizedName}) NO tiene contenido válido. Se enviará sin este adjunto.`);
                }
            }
            
            if (adjuntosProcesados.length > 0) {
                payload.attachment = adjuntosProcesados;
                console.log(`📎 ${adjuntosProcesados.length}/${attachments.length} adjuntos listos para enviar`);
            } else {
                console.warn('⚠️ Ningún adjunto pudo ser procesado. El correo se enviará sin adjuntos.');
            }
            
            console.log('📎📎📎 FIN PROCESAMIENTO ADJUNTOS 📎📎📎\n');
        }
        
        // ✅ FIX v3: Envío con reintentos automáticos
        let ultimoError = null;
        const tieneAdjuntos = payload.attachment && payload.attachment.length > 0;
        const intentosMax = tieneAdjuntos ? MAX_REINTENTOS_EMAIL : 1;
        
        for (let intento = 1; intento <= intentosMax; intento++) {
            try {
                if (intento > 1) {
                    console.log(`🔄 Reintento ${intento}/${intentosMax} para enviar correo...`);
                    await esperar(PAUSA_ENTRE_REINTENTOS_MS * intento);
                }
                
                const response = await fetch(CLOUDFLARE_WORKER_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();
                
                console.log(`📨 Respuesta Worker (intento ${intento}):`, { status: response.status, data });
                
                if (!response.ok) {
                    console.error('❌ Error Worker completo:', JSON.stringify(data, null, 2));
                    throw new Error(data.message || data.error || `Error ${response.status}: ${JSON.stringify(data)}`);
                }

                console.log('✅ Correo enviado exitosamente a:', to, tieneAdjuntos ? '(CON adjunto)' : '(sin adjunto)');
                return { success: true, messageId: data.messageId };
                
            } catch (intentoError) {
                ultimoError = intentoError;
                console.warn(`⚠️ Intento ${intento}/${intentosMax} falló:`, intentoError.message);
            }
        }
        
        // Si llegamos aquí, todos los reintentos fallaron
        console.error('❌ Todos los reintentos fallaron para enviar correo a:', to);
        return { success: false, error: ultimoError?.message || 'Error desconocido tras reintentos' };
        
    } catch (error) {
        console.error('❌ Error completo al enviar correo:', error);
        console.error('Stack:', error.stack);
        return { success: false, error: error.message };
    }
}

async function notificarSupervisorNuevaReprogramacion(data) {
    const { supervisorEmail, supervisorNombre, auxiliarNombre, zona, archivoNombre, totalRegistrosReprogramacion, totalRegistrosPendientes, fechaSubida, excelBase64, excelUrl, excelFile } = data;
    
    const totalRegistros = totalRegistrosReprogramacion + totalRegistrosPendientes;
    
    const fecha = new Date(fechaSubida).toLocaleDateString('es-CO', {
        day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const htmlContent = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <meta name="x-apple-disable-message-reformatting" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="format-detection" content="telephone=no"/>
    <meta name="format-detection" content="date=no"/>
    <meta name="format-detection" content="address=no"/>
    <meta name="format-detection" content="email=no"/>
    <meta name="color-scheme" content="light"/>
    <meta name="supported-color-schemes" content="light"/>
    <title>Nueva Reprogramacion Pendiente - Sistema de Gestion</title>
    <!--[if mso]>
    <style type="text/css">
        body, table, td, p, a, li {font-family: Arial, Helvetica, sans-serif !important;}
    </style>
    <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;">
    <!-- Preheader oculto para mejor preview -->
    <div style="display: none; max-height: 0px; overflow: hidden; font-size: 1px; line-height: 1px; color: #f4f4f4;">
        ${auxiliarNombre} ha enviado una nueva reprogramación con ${totalRegistros} registros para tu revisión.
    </div>
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f4f4; min-width: 100%;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <!-- Contenedor principal -->
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
                    <!-- Header profesional -->
                    <tr>
                        <td align="center" style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 40px 30px; border-radius: 8px 8px 0 0;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td align="center" style="padding-bottom: 16px;">
                                        <div style="width: 56px; height: 56px; background-color: rgba(255,255,255,0.2); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                                            <span style="font-size: 28px; line-height: 1;">📋</span>
                                        </div>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="color: #ffffff; font-size: 24px; font-weight: 700; line-height: 1.3; padding-bottom: 8px;">
                                        Nueva Reprogramación Pendiente
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="color: rgba(255,255,255,0.95); font-size: 14px; line-height: 1.5;">
                                        Sistema de Gestión de Reprogramaciones
                                    </td>
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
                                        Estimado/a <strong style="color: #111827;">${supervisorNombre}</strong>,
                                    </td>
                                </tr>
                                <!-- Alerta importante -->
                                <tr>
                                    <td style="padding-bottom: 24px;">
                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 6px;">
                                            <tr>
                                                <td style="padding: 16px 20px;">
                                                    <p style="margin: 0; color: #92400e; font-size: 15px; font-weight: 600; line-height: 1.5;">
                                                        Se ha recibido una nueva reprogramación que requiere su atención
                                                    </p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                <!-- Descripción -->
                                <tr>
                                    <td style="color: #4b5563; font-size: 15px; line-height: 1.6; padding-bottom: 24px;">
                                        <strong style="color: #1f2937;">${auxiliarNombre}</strong> ha enviado reprogramaciones/pendientes para la zona <strong style="color: #1f2937;">${zona}</strong> para su revisión y aprobación. Los detalles se encuentran a continuación:
                                    </td>
                                </tr>
                                <!-- Tarjeta de información -->
                                <tr>
                                    <td style="padding-bottom: 24px;">
                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
                                            <tr>
                                                <td style="padding: 24px;">
                                                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                        <tr>
                                                            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                                    <tr>
                                                                        <td style="color: #6b7280; font-size: 13px; font-weight: 500; padding-bottom: 4px;">Archivo</td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td style="color: #1f2937; font-size: 14px; font-weight: 600;">${archivoNombre}</td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                        <tr>
                                                            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                                    <tr>
                                                                        <td style="color: #6b7280; font-size: 13px; font-weight: 500; padding-bottom: 4px;">Reprogramaciones</td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td style="color: #1f2937; font-size: 14px; font-weight: 600;">${totalRegistrosReprogramacion} registros</td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                        <tr>
                                                            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                                    <tr>
                                                                        <td style="color: #6b7280; font-size: 13px; font-weight: 500; padding-bottom: 4px;">Pendientes</td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td style="color: #1f2937; font-size: 14px; font-weight: 600;">${totalRegistrosPendientes} registros</td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                        <tr>
                                                            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                                    <tr>
                                                                        <td style="color: #6b7280; font-size: 13px; font-weight: 500; padding-bottom: 4px;">Enviado por</td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td style="color: #1f2937; font-size: 14px; font-weight: 600;">${auxiliarNombre}</td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                        <tr>
                                                            <td style="padding: 12px 0;">
                                                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                                    <tr>
                                                                        <td style="color: #6b7280; font-size: 13px; font-weight: 500; padding-bottom: 4px;">Fecha de envío</td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td style="color: #1f2937; font-size: 14px; font-weight: 600;">${fecha}</td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                <!-- Botón de descarga directa si existe la URL -->
                                ${excelUrl ? `
                                <tr>
                                    <td align="center" style="padding: 10px 0 30px 0;">
                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                                            <tr>
                                                <td align="center" bgcolor="#4f46e5" style="border-radius: 6px;">
                                                    <a href="${excelUrl}" target="_blank" style="display: inline-block; padding: 14px 28px; font-family: sans-serif; font-size: 15px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 6px; border: 1px solid #4f46e5;">
                                                        📥 Descargar Archivo Excel Original
                                                    </a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                ` : ''}
                                <!-- Acción requerida -->
                                <tr>
                                    <td style="color: #4b5563; font-size: 15px; line-height: 1.6; padding-bottom: 12px;">
                                        Por favor, acceda al sistema para revisar y completar esta reprogramación a la brevedad posible.
                                    </td>
                                </tr>
                                <!-- Nota de cortesía -->
                                <tr>
                                    <td style="color: #6b7280; font-size: 14px; line-height: 1.5; font-style: italic;">
                                        Gracias por su colaboración en el proceso.
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <!-- Separador -->
                    <tr>
                        <td style="padding: 0 30px;">
                            <div style="border-top: 1px solid #e5e7eb;"></div>
                        </td>
                    </tr>
                    <!-- Footer profesional -->
                    <tr>
                        <td style="background-color: #fafafa; padding: 30px; border-radius: 0 0 8px 8px;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td align="center" style="padding-bottom: 12px;">
                                        <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 1.5;">
                                            Sistema de Gestión de Reprogramaciones
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="padding-bottom: 8px;">
                                        <p style="margin: 0; color: #9ca3af; font-size: 12px; line-height: 1.5;">
                                            Este es un mensaje automático, por favor no responder directamente a este correo.
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center">
                                        <p style="margin: 0; color: #d1d5db; font-size: 11px; line-height: 1.5;">
                                            © ${new Date().getFullYear()} Sistema de Reprogramaciones. Todos los derechos reservados.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
                <!-- Espaciador final -->
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px;">
                    <tr>
                        <td style="padding-top: 20px;">
                            <p style="margin: 0; text-align: center; color: #9ca3af; font-size: 11px; line-height: 1.5;">
                                Si tiene problemas para visualizar este correo, contacte al administrador del sistema.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

    const textContent = `NUEVA REPROGRAMACIÓN PENDIENTE

Estimado/a ${supervisorNombre},

Se ha recibido una nueva reprogramación que requiere su atención.

${auxiliarNombre} ha enviado reprogramaciones/pendientes para la zona ${zona} para su revisión y aprobación.

DETALLES:
- Archivo: ${archivoNombre}
- Reprogramaciones: ${totalRegistrosReprogramacion} registros
- Pendientes: ${totalRegistrosPendientes} registros
- Zona: ${zona}
- Enviado por: ${auxiliarNombre}
- Fecha de envío: ${fecha}

Por favor, acceda al sistema para revisar y completar esta reprogramación a la brevedad posible.

Gracias por su colaboración en el proceso.

---
Sistema de Gestión de Reprogramaciones
Este es un mensaje automático, por favor no responder directamente a este correo.
© ${new Date().getFullYear()} Sistema de Reprogramaciones. Todos los derechos reservados.`;

    // ✅ FIX v3: Construir adjuntos priorizando base64 sobre URL
    const attachments = [];
    if (excelBase64) {
        // PRIORIDAD 1: base64 directo (más fiable)
        attachments.push({ content: excelBase64, name: archivoNombre });
    } else if (excelFile && excelFile instanceof File) {
        // PRIORIDAD 2: objeto File del navegador
        attachments.push({ file: excelFile, name: archivoNombre });
    } else if (excelUrl) {
        // PRIORIDAD 3: URL (se descargará y convertirá a base64 en enviarCorreo)
        attachments.push({ url: excelUrl, name: archivoNombre });
    }

    return await enviarCorreo({
        to: supervisorEmail,
        toName: supervisorNombre,
        subject: `Nueva Reprogramación Zona ${zona} - ${auxiliarNombre} (${totalRegistrosReprogramacion + totalRegistrosPendientes} registros)`,
        htmlContent: htmlContent,
        textContent: textContent,
        attachments: attachments.length > 0 ? attachments : undefined
    });
}

async function notificarAuxiliarReprogramacionCompletada(data) {
    // ✅ Recibe UN email individual, no un array
    const { auxiliarEmail, auxiliarNombre, supervisorNombre, zona, archivoNombre, totalRegistros, fechaRespuesta, excelBase64, excelUrl } = data;
    
    console.log('📧 notificarAuxiliarReprogramacionCompletada llamada con:', {
        auxiliarEmail,
        auxiliarNombre,
        supervisorNombre,
        zona,
        archivoNombre,
        totalRegistros
    });
    
    // Validar que auxiliarEmail sea un string
    if (typeof auxiliarEmail !== 'string') {
        console.error('❌ auxiliarEmail debe ser un string, recibido:', typeof auxiliarEmail);
        throw new Error('auxiliarEmail debe ser un string individual, no un array');
    }
    
    const fecha = new Date(fechaRespuesta).toLocaleDateString('es-CO', {
        day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const htmlContent = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <meta name="x-apple-disable-message-reformatting" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="format-detection" content="telephone=no"/>
    <meta name="format-detection" content="date=no"/>
    <meta name="format-detection" content="address=no"/>
    <meta name="format-detection" content="email=no"/>
    <meta name="color-scheme" content="light"/>
    <meta name="supported-color-schemes" content="light"/>
    <title>Reprogramacion Zona ${zona} Completada - Sistema de Gestion</title>
    <!--[if mso]>
    <style type="text/css">
        body, table, td, p, a, li {font-family: Arial, Helvetica, sans-serif !important;}
    </style>
    <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;">
    <!-- Preheader oculto para mejor preview -->
    <div style="display: none; max-height: 0px; overflow: hidden; font-size: 1px; line-height: 1px; color: #f4f4f4;">
        ${supervisorNombre} ha completado tu reprogramación de ${archivoNombre}. Ya puedes descargar el archivo actualizado.
    </div>
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f4f4; min-width: 100%;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <!-- Contenedor principal -->
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
                    <!-- Header profesional verde -->
                    <tr>
                        <td align="center" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 30px; border-radius: 8px 8px 0 0;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td align="center" style="padding-bottom: 16px;">
                                        <div style="width: 56px; height: 56px; background-color: rgba(255,255,255,0.2); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                                            <span style="font-size: 28px; line-height: 1;">✓</span>
                                        </div>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="color: #ffffff; font-size: 24px; font-weight: 700; line-height: 1.3; padding-bottom: 8px;">
                                        Reprogramación Completada
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="color: rgba(255,255,255,0.95); font-size: 14px; line-height: 1.5;">
                                        Sistema de Gestión de Reprogramaciones
                                    </td>
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
                                        Estimado/a <strong style="color: #111827;">${auxiliarNombre}</strong>,
                                    </td>
                                </tr>
                                <!-- Alerta de éxito -->
                                <tr>
                                    <td style="padding-bottom: 24px;">
                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #d1fae5; border-left: 4px solid #10b981; border-radius: 6px;">
                                            <tr>
                                                <td style="padding: 16px 20px;">
                                                    <p style="margin: 0; color: #065f46; font-size: 15px; font-weight: 600; line-height: 1.5;">
                                                        Su reprogramación ha sido revisada y completada exitosamente
                                                    </p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                <!-- Descripción -->
                                <tr>
                                    <td style="color: #4b5563; font-size: 15px; line-height: 1.6; padding-bottom: 24px;">
                                        <strong style="color: #1f2937;">${supervisorNombre}</strong> ha revisado y completado su reprogramación. El archivo actualizado ya está disponible en el sistema para su descarga.
                                    </td>
                                </tr>
                                <!-- Tarjeta de información -->
                                <tr>
                                    <td style="padding-bottom: 24px;">
                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
                                            <tr>
                                                <td style="padding: 24px;">
                                                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                        <tr>
                                                            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                                    <tr>
                                                                        <td style="color: #6b7280; font-size: 13px; font-weight: 500; padding-bottom: 4px;">Archivo</td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td style="color: #1f2937; font-size: 14px; font-weight: 600;">${archivoNombre}</td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                        <tr>
                                                            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                                    <tr>
                                                                        <td style="color: #6b7280; font-size: 13px; font-weight: 500; padding-bottom: 4px;">Total de registros procesados</td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td style="color: #1f2937; font-size: 14px; font-weight: 600;">${totalRegistros} registros</td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                        <tr>
                                                            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                                    <tr>
                                                                        <td style="color: #6b7280; font-size: 13px; font-weight: 500; padding-bottom: 4px;">Revisado por</td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td style="color: #1f2937; font-size: 14px; font-weight: 600;">${supervisorNombre}</td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                        <tr>
                                                            <td style="padding: 12px 0;">
                                                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                                    <tr>
                                                                        <td style="color: #6b7280; font-size: 13px; font-weight: 500; padding-bottom: 4px;">Fecha de respuesta</td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td style="color: #1f2937; font-size: 14px; font-weight: 600;">${fecha}</td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                <!-- Próximos pasos -->
                                <tr>
                                    <td style="color: #4b5563; font-size: 15px; line-height: 1.6; padding-bottom: 12px;">
                                        Puede acceder al sistema para descargar el archivo actualizado con los resultados procesados.
                                    </td>
                                </tr>
                                <!-- Nota de cortesía -->
                                <tr>
                                    <td style="color: #6b7280; font-size: 14px; line-height: 1.5; font-style: italic;">
                                        Gracias por su colaboración en el proceso de reprogramación.
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <!-- Separador -->
                    <tr>
                        <td style="padding: 0 30px;">
                            <div style="border-top: 1px solid #e5e7eb;"></div>
                        </td>
                    </tr>
                    <!-- Footer profesional -->
                    <tr>
                        <td style="background-color: #fafafa; padding: 30px; border-radius: 0 0 8px 8px;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td align="center" style="padding-bottom: 12px;">
                                        <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 1.5;">
                                            Sistema de Gestión de Reprogramaciones
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="padding-bottom: 8px;">
                                        <p style="margin: 0; color: #9ca3af; font-size: 12px; line-height: 1.5;">
                                            Este es un mensaje automático, por favor no responder directamente a este correo.
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center">
                                        <p style="margin: 0; color: #d1d5db; font-size: 11px; line-height: 1.5;">
                                            © ${new Date().getFullYear()} Sistema de Reprogramaciones. Todos los derechos reservados.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
                <!-- Espaciador final -->
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px;">
                    <tr>
                        <td style="padding-top: 20px;">
                            <p style="margin: 0; text-align: center; color: #9ca3af; font-size: 11px; line-height: 1.5;">
                                Si tiene problemas para visualizar este correo, contacte al administrador del sistema.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

    const textContent = `REPROGRAMACIÓN COMPLETADA

Estimado/a ${auxiliarNombre},

Su reprogramación ha sido revisada y completada exitosamente.

${supervisorNombre} ha revisado y completado su reprogramación. El archivo actualizado ya está disponible en el sistema para su descarga.

DETALLES:
- Archivo: ${archivoNombre}
- Total de registros procesados: ${totalRegistros}
- Revisado por: ${supervisorNombre}
- Fecha de respuesta: ${fecha}

Puede acceder al sistema para descargar el archivo actualizado con los resultados procesados.

Gracias por su colaboración en el proceso de reprogramación.

---
Sistema de Gestión de Reprogramaciones
Este es un mensaje automático, por favor no responder directamente a este correo.
© ${new Date().getFullYear()} Sistema de Reprogramaciones. Todos los derechos reservados.`;

    // ✅ FIX v3: Construir adjuntos priorizando base64 sobre URL
    const attachments = [];
    if (excelBase64) {
        // PRIORIDAD 1: base64 directo (más fiable)
        attachments.push({ content: excelBase64, name: archivoNombre });
    } else if (excelUrl) {
        // PRIORIDAD 3: URL (se descargará y convertirá a base64 en enviarCorreo)
        attachments.push({ url: excelUrl, name: archivoNombre });
    }

    return await enviarCorreo({
        to: auxiliarEmail,
        toName: auxiliarNombre,
        subject: `Reprogramación Zona ${zona} completada por ${supervisorNombre} - ${archivoNombre}`,
        htmlContent: htmlContent,
        textContent: textContent,
        attachments: attachments.length > 0 ? attachments : undefined
    });
}

// Función para notificar a todas las auxiliares cuando se sube una nueva reprogramación
async function notificarAuxiliaresNuevaReprogramacion(data) {
    console.log('🔧 notificarAuxiliaresNuevaReprogramacion llamada con:', data);
    
    const { auxiliarNombre, zona, archivoNombre, totalRegistrosReprogramacion, totalRegistrosPendientes, fechaSubida } = data;
    
    console.log('📊 Datos extraídos:', { auxiliarNombre, zona, archivoNombre, totalRegistrosReprogramacion, totalRegistrosPendientes, fechaSubida });
    
    const totalRegistros = totalRegistrosReprogramacion + totalRegistrosPendientes;
    
    const fecha = new Date(fechaSubida).toLocaleDateString('es-CO', {
        day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const htmlContent = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <meta name="x-apple-disable-message-reformatting" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="format-detection" content="telephone=no"/>
    <meta name="format-detection" content="date=no"/>
    <meta name="format-detection" content="address=no"/>
    <meta name="format-detection" content="email=no"/>
    <meta name="color-scheme" content="light"/>
    <meta name="supported-color-schemes" content="light"/>
    <title>Nueva Reprogramación Cargada - Sistema de Gestion</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f4f4; min-width: 100%;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
                    <tr>
                        <td align="center" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 30px; border-radius: 8px 8px 0 0;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td align="center" style="padding-bottom: 16px;">
                                        <div style="width: 56px; height: 56px; background-color: rgba(255,255,255,0.2); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                                            <span style="font-size: 28px; line-height: 1;">📋</span>
                                        </div>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="color: #ffffff; font-size: 24px; font-weight: 700; line-height: 1.3; padding-bottom: 8px;">
                                        Nueva Reprogramación Cargada
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="color: rgba(255,255,255,0.95); font-size: 14px; line-height: 1.5;">
                                        Sistema de Gestión de Reprogramaciones
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 40px 30px;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td style="color: #1f2937; font-size: 16px; line-height: 1.5; padding-bottom: 20px;">
                                        Estimada Auxiliar,
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding-bottom: 24px;">
                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #ecfdf5; border-left: 4px solid #10b981; border-radius: 6px;">
                                            <tr>
                                                <td style="padding: 16px 20px;">
                                                    <p style="margin: 0; color: #047857; font-size: 15px; font-weight: 600; line-height: 1.5;">
                                                        Se ha cargado una nueva solicitud de reprogramación
                                                    </p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="color: #4b5563; font-size: 15px; line-height: 1.6; padding-bottom: 24px;">
                                        <strong style="color: #1f2937;">${auxiliarNombre}</strong> ha cargado una nueva reprogramación para la zona <strong style="color: #1f2937;">${zona}</strong>. Los detalles se encuentran a continuación:
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding-bottom: 24px;">
                                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
                                            <tr>
                                                <td style="padding: 20px;">
                                                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                        <tr>
                                                            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                                    <tr>
                                                                        <td style="color: #6b7280; font-size: 13px; font-weight: 500; padding-bottom: 4px;">Archivo cargado</td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td style="color: #1f2937; font-size: 14px; font-weight: 600;">${archivoNombre}</td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                        <tr>
                                                            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                                    <tr>
                                                                        <td style="color: #6b7280; font-size: 13px; font-weight: 500; padding-bottom: 4px;">Zona</td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td style="color: #1f2937; font-size: 14px; font-weight: 600;">${zona}</td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                        <tr>
                                                            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                                                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                                    <tr>
                                                                        <td style="color: #6b7280; font-size: 13px; font-weight: 500; padding-bottom: 4px;">Reprogramaciones</td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td style="color: #1f2937; font-size: 14px; font-weight: 600;">${totalRegistrosReprogramacion} registros</td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                        <tr>
                                                            <td style="padding: 12px 0;">
                                                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                                                    <tr>
                                                                        <td style="color: #6b7280; font-size: 13px; font-weight: 500; padding-bottom: 4px;">Pendientes</td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td style="color: #1f2937; font-size: 14px; font-weight: 600;">${totalRegistrosPendientes} registros</td>
                                                                    </tr>
                                                                </table>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="color: #4b5563; font-size: 15px; line-height: 1.6; padding-bottom: 12px;">
                                        Puede acceder al sistema para ver el progreso y descargar el archivo una vez que los supervisores lo procesen.
                                    </td>
                                </tr>
                                <tr>
                                    <td style="color: #6b7280; font-size: 14px; line-height: 1.5; font-style: italic;">
                                        Gracias por su atención a este proceso.
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 30px;">
                            <div style="border-top: 1px solid #e5e7eb;"></div>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #fafafa; padding: 30px; border-radius: 0 0 8px 8px;">
                            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td align="center" style="padding-bottom: 12px;">
                                        <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 1.5;">
                                            Sistema de Gestión de Reprogramaciones
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="padding-bottom: 8px;">
                                        <p style="margin: 0; color: #9ca3af; font-size: 12px; line-height: 1.5;">
                                            Este es un mensaje automático, por favor no responder directamente a este correo.
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center">
                                        <p style="margin: 0; color: #d1d5db; font-size: 11px; line-height: 1.5;">
                                            © ${new Date().getFullYear()} Sistema de Reprogramaciones. Todos los derechos reservados.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px;">
                    <tr>
                        <td style="padding-top: 20px;">
                            <p style="margin: 0; text-align: center; color: #9ca3af; font-size: 11px; line-height: 1.5;">
                                Si tiene problemas para visualizar este correo, contacte al administrador del sistema.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

    const textContent = `NUEVA REPROGRAMACIÓN CARGADA

Estimada Auxiliar,

Se ha cargado una nueva solicitud de reprogramación.

${auxiliarNombre} ha cargado una nueva reprogramación para la zona ${zona}.

DETALLES:
- Archivo: ${archivoNombre}
- Zona: ${zona}
- Reprogramaciones: ${totalRegistrosReprogramacion} registros
- Pendientes: ${totalRegistrosPendientes} registros
- Cargado por: ${auxiliarNombre}
- Fecha de carga: ${fecha}

Puede acceder al sistema para ver el progreso y descargar el archivo una vez que los supervisores lo procesen.

Gracias por su atención a este proceso.

---
Sistema de Gestión de Reprogramaciones
Este es un mensaje automático, por favor no responder directamente a este correo.
© ${new Date().getFullYear()} Sistema de Reprogramaciones. Todos los derechos reservados.`;

    // Esta función debe ser llamada con el email de cada auxiliar
    // Se implementará en auxiliar.html donde se obtienen todas las auxiliares
    const resultado = {
        htmlContent,
        textContent,
        subject: `Nueva Reprogramación Zona ${zona} - ${auxiliarNombre} (${totalRegistrosReprogramacion + totalRegistrosPendientes} registros)`
    };
    
    console.log('✅ notificarAuxiliaresNuevaReprogramacion retornando:', {
        tieneSubject: !!resultado.subject,
        tieneHtml: !!resultado.htmlContent,
        tieneText: !!resultado.textContent,
        subject: resultado.subject
    });
    
    return resultado;
}

// Exportar funciones globalmente
window.notificarSupervisorNuevaReprogramacion = notificarSupervisorNuevaReprogramacion;
window.notificarAuxiliarReprogramacionCompletada = notificarAuxiliarReprogramacionCompletada;
window.notificarAuxiliaresNuevaReprogramacion = notificarAuxiliaresNuevaReprogramacion;
