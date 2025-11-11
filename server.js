require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001; // Usamos un puerto diferente para no chocar con el otro proyecto

// --- CONFIGURACIÓN DE AUTENTICACIÓN (IDÉNTICA A TU OTRA APP) ---
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const REDIRECT_URI = 'http://localhost:3001/oauth2callback'; // Ojo al puerto 3001

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const TOKEN_PATH = path.join(__dirname, 'token.json');
app.use(express.static(path.join(__dirname, 'public')));

// 🚀 INICIALIZACIÓN DE GEMINI (Después de cargar dotenv)
const ai = new GoogleGenAI({}); // Lee la clave del .env automáticamente

// --- FUNCIONES PARA MANEJAR EL TOKEN (IDÉNTICAS A TU OTRA APP) ---
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

async function getAuthenticatedClient() {
    const areTokensLoaded = await loadTokens();
    if (!areTokensLoaded) {
        throw new Error('Tokens no cargados. Por favor, autentícate primero en /auth.');
    }
    return oauth2Client;
}

// --- RUTAS DE AUTENTICACIÓN (IDÉNTICAS A TU OTRA APP) ---
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
// --- RUTA PRINCIPAL OPTIMIZADA CON GOOGLE QUERY API ---
app.get('/api/informe/:dni', async (req, res) => {
    try {
        // La autenticación (loadTokens) es solo para el API de Google Sheets oficial,
        // la API de Query (gviz/tq) funciona si la hoja está compartida como "Lector".
        
        const dniBuscado = req.params.dni.trim();
        const sheetName = 'Integrado'; 
        
        // 🚀 AJUSTE CLAVE: La consulta ahora busca en la columna 'C'.
        // La consulta trae TODAS las columnas (select *), donde la columna C es igual al DNI.
        const query = encodeURIComponent(`select * where C = '${dniBuscado}' limit 1`);
        
        const queryUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${sheetName}&tq=${query}`;

        console.log(`Consultando API de Query para DNI: ${dniBuscado} (Columna C)...`);

        // Hacemos la petición HTTP para obtener SOLO la fila que necesitamos
        const response = await axios.get(queryUrl);

        // La respuesta es un string que incluye JSON con metadatos. Hay que parsearlo.
        // Esta expresión regular extrae el JSON limpio del cuerpo de la respuesta.
        const dataText = response.data.replace(/.*google.visualization.Query.setResponse\((.*)\);/s, '$1');
        const dataJson = JSON.parse(dataText);

        if (dataJson.errors || !dataJson.table || dataJson.table.rows.length === 0) {
            console.log(`No se encontraron resultados para DNI: ${dniBuscado}`);
            return res.status(404).json({ message: 'No se encontraron datos para el DNI proporcionado.' });
        }

        const rows = dataJson.table.rows;
        const cols = dataJson.table.cols;

        // Mapeamos los datos usando los encabezados
        const headers = cols.map(col => col.label || col.id);
        const personaData = rows[0].c; // 'c' contiene los datos de la fila

        const persona = {};
        headers.forEach((header, index) => {
            // El formato 'v' contiene el valor formateado de la celda
            persona[header] = personaData[index]?.v || ''; 
        });

        console.log(`Datos encontrados para DNI: ${dniBuscado}`);
        res.json({ persona });

    } catch (error) {
        // Error de Axios, conexión o de la API de Query
        console.error('Error al buscar el DNI con Google Query:', error.message);
        res.status(500).json({ error: 'Error interno del servidor al consultar la hoja.' });
    }
});

/**
 * Función para construir la instrucción detallada para el modelo de IA.
 * @param {string} datosJson - El informe del afiliado en formato JSON.
 */
function construirPrompt(datosJson) {
    // ⚠️ ATENCIÓN: Esta lista guía a la IA. Puedes ajustarla con más campos de riesgo.
    const camposDeRiesgo = [
        "Dislipemias", "Diabetes", "Presión Arterial", "IMC",
        "Alimentación saludable", "Actividad física", "Tabaco",
        "Estratificación riesgo CV"
    ];

    return `
        Eres un Asistente de Salud de IAPOS, tu tono debe ser amable, profesional, positivo y enfocado en la prevención.
        
        Tu tarea es generar un informe de devolución para el afiliado, basado en el informe de salud a continuación.
        
        ### Instrucciones para el Informe:
        1. **Identificación de Riesgos:** Analiza y busca resultados negativos en los campos: ${camposDeRiesgo.join(', ')}. Los valores como 'presenta', 'sí', 'alto', o una observación negativa indican riesgo.
        2. **Estructura (Usa Markdown):**
            * Título, Saludo y Mensaje Positivo Inicial.
            * Sección **PUNTOS A ATENDER** (Si hay riesgos) o **PUNTOS DE FUERZA** (Si no hay riesgos).
            * Proporciona 3-4 recomendaciones CLARAS y de prevención específicas para los riesgos identificados.
        3. **Llamado a la Acción Estandarizado (Obligatorio al final):**
            "**Tu salud es nuestra prioridad.** Te invitamos a utilizar nuestro servicio de Tele-orientación para discutir este informe con uno de nuestros profesionales de IAPOS. Podemos ayudarte a definir el camino de prevención más adecuado para ti. [Haga clic aquí para solicitar una conexión inmediata]."
            
        **INFORME DE SALUD A ANALIZAR:**
        ${datosJson}
    `;
}

// --- RUTA PARA EL ANÁLISIS DE IA ---
app.post('/api/analizar-informe', async (req, res) => {
    
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Faltan datos del informe en el cuerpo de la solicitud.' });
    }
    
    const informeCompleto = req.body;
    const datosParaAI = JSON.stringify(informeCompleto, null, 2);
    const prompt = construirPrompt(datosParaAI);
    
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
        console.error('Error al llamar a la IA:', error);
        res.status(500).json({ error: 'Fallo al generar el resumen personalizado con IA.' });
    }
});

// --- Iniciar el servidor ---
async function startServer() {
    await loadTokens();
    app.listen(PORT, () => {
        console.log(`Servidor del Portal de Afiliados escuchando en http://localhost:${PORT}`);
        console.log('Si es la primera vez, visita http://localhost:3001/auth para autenticarte.');
    });
}

startServer();