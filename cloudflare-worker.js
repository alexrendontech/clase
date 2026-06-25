/**
 * Cloudflare Worker - Proxy para Brevo API
 * Despliega este código en: https://dash.cloudflare.com/workers
 * 
 * INSTRUCCIONES:
 * 1. Ve a Cloudflare Dashboard > Workers & Pages
 * 2. Edita tu worker: spring-field-4fe9
 * 3. Copia y pega este código
 * 4. Agrega la variable de entorno BREVO_API_KEY con tu clave real
 * 5. Guarda y despliega
 */

// Configuración CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    // Manejar preflight CORS (IMPORTANTE)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    // Solo permitir método POST
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ 
        error: 'Método no permitido. Solo POST.' 
      }), {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    try {
      // Verificar que existe la API key
      if (!env.BREVO_API_KEY) {
        return new Response(JSON.stringify({ 
          error: 'BREVO_API_KEY no está configurada en las variables de entorno',
          hint: 'Ve a Settings > Variables y agrega BREVO_API_KEY'
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }

      // Obtener datos del request
      const requestData = await request.json();

      // Validar datos requeridos
      if (!requestData.to || !requestData.subject || !requestData.htmlContent) {
        return new Response(JSON.stringify({ 
          error: 'Faltan datos requeridos',
          required: ['to', 'subject', 'htmlContent'],
          received: Object.keys(requestData)
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }

      console.log('📧 Enviando correo a través de Brevo...');
      console.log('� Destinatarios:', requestData.to);
      console.log('📧 Asunto:', requestData.subject);
      
      if (requestData.attachment && requestData.attachment.length > 0) {
        console.log('\n🔍🔍🔍 WORKER - DIAGNÓSTICO ADJUNTOS 🔍🔍🔍');
        console.log(`Total adjuntos recibidos: ${requestData.attachment.length}`);
        requestData.attachment.forEach((att, idx) => {
          console.log(`\nAdjunto #${idx + 1}:`);
          console.log(`  - name: ${att.name}`);
          console.log(`  - type: ${att.type || 'NO ESPECIFICADO'}`);
          console.log(`  - content length: ${att.content ? att.content.length : 'VACÍO'} caracteres`);
          console.log(`  - content primeros 30: ${att.content ? att.content.substring(0, 30) : 'N/A'}...`);
        });
        console.log('🔍🔍🔍 FIN DIAGNÓSTICO WORKER 🔍🔍🔍\n');
      } else {
        console.log('⚠️ NO SE RECIBIERON ADJUNTOS EN EL WORKER');
      }

      // Llamar a Brevo API
      console.log('📤 Enviando a Brevo API...');
      const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': env.BREVO_API_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify(requestData)
      });

      const brevoData = await brevoResponse.json();

      console.log('\n📨📨📨 RESPUESTA DE BREVO 📨📨📨');
      console.log('Status:', brevoResponse.status);
      console.log('Data completa:', JSON.stringify(brevoData, null, 2));
      console.log('📨📨📨 FIN RESPUESTA 📨📨📨\n');
      
      if (!brevoResponse.ok) {
        console.error('❌❌❌ ERROR DE BREVO:', brevoData);
      }

      // Retornar respuesta de Brevo con headers CORS
      return new Response(JSON.stringify(brevoData), {
        status: brevoResponse.status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });

    } catch (error) {
      console.error('❌ Error en Worker:', error);
      
      return new Response(JSON.stringify({ 
        error: 'Error interno del servidor',
        message: error.message,
        stack: error.stack
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  }
};

