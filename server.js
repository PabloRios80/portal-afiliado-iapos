require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001;


// ----------------------------------------------------------------------
// CONFIGURACIÓN DE URL DEL MICROSERVICIO DE ESTUDIOS (CRÍTICO)
// ----------------------------------------------------------------------
const ESTUDIOS_API_URL = process.env.ESTUDIOS_API_URL || 'http://localhost:4000';
console.log(`📡 URL de Microservicio de Estudios configurada: ${ESTUDIOS_API_URL}`);
// ----------------------------------------------------------------------


// --- CONFIGURACIÓN DE AUTENTICACIÓN ---
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const REDIRECT_URI = 'http://localhost:3001/oauth2callback';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const TOKEN_PATH = path.join(__dirname, 'token.json');


// 🚀 INICIALIZACIÓN DE GEMINI
const ai = new GoogleGenAI({}); 

// --- FUNCIONES PARA MANEJAR EL TOKEN ---
async function loadTokens() {
    try {
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
        oauth2Client.setCredentials(tokens);
        console.log('Tokens cargados con éxito.');
        return true;
    } catch (err) {
        console.log('No se encontraron tokens. Se requiere autenticación.');
        return false;
    }
}

function saveTokens(tokens) {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('Tokens guardados en token.json.');
}

// --- RUTAS DE AUTENTICACIÓN ---
app.get('/auth', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
    });
    res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
    try {
        const { tokens } = await oauth2Client.getToken(req.query.code);
        oauth2Client.setCredentials(tokens);
        saveTokens(tokens);
        res.send('Autenticación exitosa. Ahora puedes cerrar esta pestaña.');
    } catch (err) {
        console.error('Error al obtener tokens:', err);
        res.status(500).send('Error de autenticación.');
    }
});

// ----------------------------------------------------------------------
// FUNCIONES AUXILIARES PARA PROCESAR HOJA DE CÁLCULO
// ----------------------------------------------------------------------

/**
 * Convierte el formato de fecha de Google Query (date(YYYY, M-1, D)) a un objeto Date.
 * @param {string} dateString - Cadena de fecha de Google Query.
 * @returns {Date | null}
 */
function parseGoogleQueryDate(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    const match = dateString.match(/date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)/);
    if (match) {
        // En JavaScript, los meses son de 0 a 11, pero Google Query usa 0-11.
        // Por eso, la cadena ya viene con el mes indexado desde 0.
        // Ejemplo: date(2023, 11, 25) es 25 de Diciembre de 2023.
        const year = parseInt(match[1]);
        const month = parseInt(match[2]); // Ya está en formato 0-11
        const day = parseInt(match[3]);
        return new Date(year, month, day);
    }
    // Si no es el formato date(...), intenta parsear como string estándar
    try {
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date;
    } catch (e) {
        return null;
    }
}

/**
 * Procesa todas las filas de la respuesta de Google Query, las mapea con los headers,
 * y retorna el registro más reciente y el historial de fechas.
 * @param {Array<Object>} rows - Array de objetos 'rows' de la respuesta JSON.
 * @param {Array<Object>} cols - Array de objetos 'cols' para obtener los headers.
 * @returns {{reportePrincipal: Object | null, historialFechas: Array<{fecha: string, isLatest: boolean}>}}
 */
function procesarYObtenerUltimo(rows, cols) {
    if (!rows || rows.length === 0) {
        return { reportePrincipal: null, historialFechas: [] };
    }

    const headers = cols.map(col => col.label || col.id);
    const registrosCompletos = rows.map(row => {
        const registro = {};
        row.c.forEach((cell, index) => {
            const header = headers[index];
            // Preferimos el valor formateado 'f' si existe, sino el valor crudo 'v'.
            registro[header] = cell?.f || cell?.v || '';
            // Guardamos el valor crudo de la fecha para el sorting si es una fecha.
            if (header === "FECHAX" && cell?.v) {
                 registro.rawDate = parseGoogleQueryDate(cell.v);
            }
        });
        return registro;
    });

    // 1. Ordenar los registros por fecha (rawDate)
    const sortedRecords = registrosCompletos
        .filter(r => r.rawDate) // Solo registros con fecha válida
        .sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime()); // Orden descendente (más reciente primero)

    const reportePrincipal = sortedRecords[0] || null;

    // 2. Crear la lista de fechas históricas
    const historialFechas = sortedRecords.map((record, index) => ({
        dni: record["DNI"],
        fecha: record["FECHAX"], // Usamos el valor formateado para mostrar
        fechaRaw: record.rawDate.toISOString().split('T')[0], // YYYY-MM-DD para la consulta
        isLatest: index === 0,
    }));

    return { reportePrincipal, historialFechas };
}


// ----------------------------------------------------------------------
// RUTA DE BÚSQUEDA DEL DNI (MODIFICADA)
// ----------------------------------------------------------------------
app.post('/api/buscar-datos', async (req, res) => {
    try {
        const dniBuscado = req.body.dni.trim();
        const sheetName = 'Integrado'; 
        
        // CAMBIO CLAVE: Se elimina 'limit 1' para obtener todos los registros del DNI.
        const query = encodeURIComponent(`select * where C = '${dniBuscado}'`); 
        
        const queryUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${sheetName}&tq=${query}`;

        console.log(`Consultando API de Query para DNI: ${dniBuscado} (Columna C)...`);

        const response = await axios.get(queryUrl);

        const dataText = response.data.replace(/.*google.visualization.Query.setResponse\((.*)\);/s, '$1');
        const dataJson = JSON.parse(dataText);

        if (dataJson.errors || !dataJson.table || dataJson.table.rows.length === 0) {
            console.log(`No se encontraron resultados para DNI: ${dniBuscado}`);
            return res.status(404).json({ message: 'No se encontraron datos para el DNI proporcionado.' });
        }

        // CAMBIO CLAVE: Procesamos todos los registros para encontrar el último
        const rows = dataJson.table.rows;
        const cols = dataJson.table.cols;

        const { reportePrincipal, historialFechas } = procesarYObtenerUltimo(rows, cols);

        if (!reportePrincipal) {
            console.log(`Datos encontrados, pero no se pudo determinar el registro principal (posible error de FECHAX)`);
            return res.status(404).json({ message: 'No se pudo procesar el informe principal por fecha.' });
        }

        console.log(`Reporte principal encontrado para DNI: ${dniBuscado}, Fecha: ${reportePrincipal.FECHAX}`);

        // La respuesta incluye el informe principal y el historial de fechas
        res.json({ 
            persona: reportePrincipal, // Mantengo el nombre 'persona' para compatibilidad con la ruta /api/analizar-informe
            historialFechas: historialFechas 
        });

    } catch (error) {
        console.error('Error al buscar el DNI con Google Query:', error.message);
        res.status(500).json({ error: 'Error interno del servidor al consultar la hoja.' });
    }
});

// ----------------------------------------------------------------------
// NUEVA RUTA: BÚSQUEDA DE UN INFORME HISTÓRICO POR FECHA
// ----------------------------------------------------------------------
app.post('/api/buscar-datos-por-fecha', async (req, res) => {
    try {
        const { dni, fechaRaw } = req.body;
        if (!dni || !fechaRaw) {
            return res.status(400).json({ error: 'Faltan DNI o fecha para la consulta histórica.' });
        }
        
        // Se asume que fechaRaw está en formato AAAA-MM-DD
        const [year, month, day] = fechaRaw.split('-').map(Number);
        // Google Query usa formato date(YYYY, M-1, D).
        // Si el mes es 1 (Enero), Google Query espera 0.
        const gvizDate = `date(${year}, ${month - 1}, ${day})`;
        
        const sheetName = 'Integrado'; 
        
        // Nueva consulta: DNI (C) Y FECHA (G) coincidan exactamente
        const query = encodeURIComponent(`select * where C = '${dni}' and G = ${gvizDate} limit 1`);
        
        const queryUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${sheetName}&tq=${query}`;

        console.log(`Consultando registro histórico para DNI: ${dni}, Fecha: ${fechaRaw}...`);

        const response = await axios.get(queryUrl);
        const dataText = response.data.replace(/.*google.visualization.Query.setResponse\((.*)\);/s, '$1');
        const dataJson = JSON.parse(dataText);

        if (dataJson.errors || !dataJson.table || dataJson.table.rows.length === 0) {
            console.log(`No se encontró registro histórico para DNI: ${dni} en la fecha ${fechaRaw}`);
            return res.status(404).json({ message: 'No se encontró el registro histórico solicitado.' });
        }

        const rows = dataJson.table.rows;
        const cols = dataJson.table.cols;
        const headers = cols.map(col => col.label || col.id);
        const personaData = rows[0].c; 

        const persona = {};
        headers.forEach((header, index) => {
            persona[header] = personaData[index]?.f || personaData[index]?.v || ''; 
        });

        console.log(`Registro histórico encontrado para DNI: ${dni} en la fecha ${fechaRaw}`);
        res.json({ persona });

    } catch (error) {
        console.error('Error al buscar el DNI con Google Query por fecha:', error.message);
        res.status(500).json({ error: 'Error interno del servidor al consultar la hoja por fecha.' });
    }
});


/**
 * Función para construir la instrucción detallada para el modelo de IA.
 * @param {object} datosPersona - El informe del afiliado como objeto.
 */
function construirPrompt(datosPersona) {
    const nombreProfesional = datosPersona["Profesional"] || "Desconocido";
    const fechaInforme = datosPersona["FECHAX"] || "la fecha de tu último chequeo";

    const datosJson = JSON.stringify(datosPersona, null, 2);

    const camposDeRiesgo = [
        "Dislipemias", "Diabetes", "Presión Arterial", "IMC",
        "Alimentación saludable", "Actividad física", "Tabaco",
        "Estratificación riesgo CV", "Audición", "Agudeza visual"
    ];

    const encabezadoDinamico = `
        ---
        **ESTE ES UN INFORME PROFESIONAL**
        
        Este análisis fue realizado exclusivamente para usted por el Profesional **${nombreProfesional}**, médico preventivista del programa **Día Preventivo de IAPOS**, en base a los estudios, preguntas y resultados que surgen de su participación en este programa el día **${fechaInforme}**.
        
        ---
    `;

    return `
        Eres un Asistente de Salud de IAPOS, tu tono debe ser amable, profesional, positivo, empático y 100% enfocado en la **prevención**.
        
        Tu tarea es generar un informe de devolución para el afiliado, basado en los datos de su último chequeo.
        
        ### Instrucciones de Estilo y Formato:
        1. **Usa Markdown:** Emplea negritas, listas y saltos de línea para que el texto sea aireado y fácil de leer.
        2. **Usa Emojis:** Utiliza emojis para clasificar el estado de salud:
            * **Riesgo/Negativo:** 🔴 (Círculo rojo), 🚨 (Alerta), 🛑 (Alto).
            * **A Vigilar/Mejora:** 🟡 (Círculo amarillo), ⚠️ (Advertencia).
            * **Positivo/Bien:** 🟢 (Círculo verde), ✅ (Check).
        3. **Formato:** NO uses títulos de nivel 1 (#). Empieza directamente con el saludo.
        
        ### Estructura del Informe Requerido:
        1. **Encabezado Específico:** Incluye el siguiente texto (mantén los saltos de línea y negritas para una buena presentación):
            ${encabezadoDinamico}
        
        2. **Saludo y Resumen Positivo Inicial:** Reconoce los aspectos que están bien o son neutros.
        3. **Sección de Atención y Prevención (Clave):**
            * Identifica **CLARAMENTE** los riesgos o resultados a mejorar listados en los campos de riesgo (${camposDeRiesgo.join(', ')}).
            * **Lista de Riesgos:** Usa un emoji rojo (🔴) o amarillo (🟡) para cada punto de riesgo.
            * **Recomendaciones Específicas:** Proporciona 3-4 recomendaciones CLARAS y de prevención específicas para esos riesgos.
        4. **Llamado a la Acción Estandarizado (Obligatorio al final):**
            ---
            **Próximo Paso: Conexión con Nuestros Profesionales**
            Tu salud es nuestra prioridad. Te invitamos a utilizar nuestro servicio de Tele-orientación o a sacar un turno presencial para discutir este informe con un profesional médico de IAPOS. Ellos te guiarán para definir el camino de prevención más adecuado para ti.
        
        **INFORME DE SALUD A ANALIZAR (Datos Brutos):**
        ${datosJson}
    `;
}

// --- RUTA PARA EL ANÁLISIS DE IA ---
app.post('/api/analizar-informe', async (req, res) => {
    
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Faltan datos del informe en el cuerpo de la solicitud.' });
    }
    
    const informeCompleto = req.body;
    
    const prompt = construirPrompt(informeCompleto);
    
    console.log(`Enviando ${Object.keys(informeCompleto).length} campos a Gemini para su análisis...`);

    try {
        // Llamada a la API de Gemini
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });

        const resumenAI = response.text.trim();
        
        res.json({ resumen: resumenAI });

    } catch (error) {
        // 🚨 CAMBIO CLAVE: REGISTRO DETALLADO DEL ERROR
        console.error('🚨 ERROR CRÍTICO DE GEMINI:', error.message);
        console.error('STACK TRACE:', error.stack);
        // El cliente recibe un mensaje de error detallado
        res.status(500).json({ error: 'Fallo al generar el resumen personalizado con IA. Revisa la CONSOLA DEL SERVIDOR para el mensaje de error de la API de Gemini.' });
    }
});

// =========================================================================
// RUTA DE INYECCIÓN CRÍTICA: SIRVE index.html DINÁMICAMENTE
// =========================================================================
app.get('/', (req, res) => {
    // 1. Apunta al archivo index.html dentro del directorio 'public'
    const filePath = path.join(__dirname, 'public', 'index.html');

    try {
        // 2. Leer el contenido del archivo index.html
        let htmlContent = fs.readFileSync(filePath, 'utf8');

        // 3. Definir el código JavaScript de inyección
        // Usamos el valor de la variable de entorno ESTUDIOS_API_URL.
        const injectionScript = `
        <script>
            // CRÍTICO: Inyectando la URL del servicio de Estudios para el frontend.
            window.ESTUDIOS_API_URL = '${ESTUDIOS_API_URL}';
            console.log('API de Estudios configurada en:', window.ESTUDIOS_API_URL);
        </script>
        `;

        // 4. Insertar el script de inyección justo antes de la etiqueta </head>
        htmlContent = htmlContent.replace('</head>', `${injectionScript}</head>`);
        
        // 5. Enviar el HTML modificado al cliente
        res.send(htmlContent);
    } catch (error) {
        console.error("Error al servir o modificar index.html:", error);
        res.status(500).send("Error interno al cargar la aplicación.");
    }
});

// Servir el resto de archivos estáticos (como main.js, styles.css, etc.)
// NOTA: Esta línea debe ir DESPUÉS de app.get('/') para que la ruta dinámica la anule
app.use(express.static(path.join(__dirname, 'public')));

// --- Iniciar el servidor ---
async function startServer() {
    app.listen(PORT, () => {
        console.log(`Servidor del Portal de Afiliados escuchando en http://localhost:${PORT}`);
        console.log('Si tienes problemas, ¡revisa la CONSOLA del servidor! El error de la IA aparecerá allí.');
    });
}

startServer();