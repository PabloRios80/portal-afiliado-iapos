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

// --- CONFIGURACIÓN DE AUTENTICACIÓN ---
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const REDIRECT_URI = 'http://localhost:3001/oauth2callback';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const TOKEN_PATH = path.join(__dirname, 'token.json');

// Servir archivos estáticos (index.html, main.js, etc.)
app.use(express.static(path.join(__dirname, 'public')));

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
// RUTA DE BÚSQUEDA DEL DNI
// ----------------------------------------------------------------------
app.post('/api/buscar-datos', async (req, res) => {
    try {
        const dniBuscado = req.body.dni.trim();
        const sheetName = 'Integrado'; 
        
        // La consulta trae TODAS las columnas (select *), donde la columna C es igual al DNI.
        const query = encodeURIComponent(`select * where C = '${dniBuscado}' limit 1`);
        
        const queryUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${sheetName}&tq=${query}`;

        console.log(`Consultando API de Query para DNI: ${dniBuscado} (Columna C)...`);

        const response = await axios.get(queryUrl);

        const dataText = response.data.replace(/.*google.visualization.Query.setResponse\((.*)\);/s, '$1');
        const dataJson = JSON.parse(dataText);

        if (dataJson.errors || !dataJson.table || dataJson.table.rows.length === 0) {
            console.log(`No se encontraron resultados para DNI: ${dniBuscado}`);
            return res.status(404).json({ message: 'No se encontraron datos para el DNI proporcionado.' });
        }

        const rows = dataJson.table.rows;
        const cols = dataJson.table.cols;

        const headers = cols.map(col => col.label || col.id);
        const personaData = rows[0].c; 

        const persona = {};
        headers.forEach((header, index) => {
            // El formato 'v' contiene el valor formateado de la celda
            persona[header] = personaData[index]?.v || ''; 
        });

        console.log(`Datos encontrados para DNI: ${dniBuscado}`);
        res.json({ persona });

    } catch (error) {
        console.error('Error al buscar el DNI con Google Query:', error.message);
        res.status(500).json({ error: 'Error interno del servidor al consultar la hoja.' });
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
// --- Iniciar el servidor ---
async function startServer() {
    app.listen(PORT, () => {
        console.log(`Servidor del Portal de Afiliados escuchando en http://localhost:${PORT}`);
        console.log('Si tienes problemas, ¡revisa la CONSOLA del servidor! El error de la IA aparecerá allí.');
    });
}

startServer();