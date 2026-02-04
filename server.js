require('dotenv').config();
console.log("-----------------------------------------");
console.log("🔍 DIAGNÓSTICO DE VARIABLES DE ENTORNO:");
console.log("Puerto:", process.env.PORT || "❌ NO DETECTADO");
console.log("Hoja Cálculo:", process.env.SPREADSHEET_ID ? "✅ OK" : "❌ NO DETECTADO");
console.log("API Key IA:", process.env.GEMINI_API_KEY ? "✅ OK" : "❌ NO DETECTADO");

if (!process.env.GEMINI_API_KEY) {
    console.error("🚨 ERROR CRÍTICO: El archivo .env no se está leyendo.");
    console.error("👉 Asegúrate de que el archivo se llame solo '.env' y no '.env.txt'");
}
console.log("-----------------------------------------");
const express = require('express');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const bcrypt = require('bcryptjs'); 

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001;

// ----------------------------------------------------------------------
// 🔑 CLAVE API
// ----------------------------------------------------------------------
const GENAI_API_KEY = process.env.GEMINI_API_KEY; 
if (!GENAI_API_KEY) console.error("❌ ERROR: Falta GEMINI_API_KEY en .env");

// ----------------------------------------------------------------------
// CONFIGURACIÓN EXCEL
// ----------------------------------------------------------------------
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
let CLIENT_ID = process.env.CLIENT_ID;
let CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3001/oauth2callback';

if (fs.existsSync('credentials.json')) {
    try {
        const keys = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));
        const keyData = keys.web || keys.installed;
        if (keyData) {
            CLIENT_ID = keyData.client_id;
            CLIENT_SECRET = keyData.client_secret;
        }
    } catch (e) { console.error("Error credenciales", e); }
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TOKEN_PATH = path.join(__dirname, 'token.json');

async function loadTokens() {
    try {
        if (fs.existsSync(TOKEN_PATH)) {
            oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')));
            return true;
        }
    } catch (err) {}
    console.log('⚠️ Falta Auth Excel. Ve a /auth');
    return false;
}
function saveTokens(tokens) { fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens)); }
oauth2Client.on('tokens', (tokens) => {
    if (fs.existsSync(TOKEN_PATH)) saveTokens({ ...JSON.parse(fs.readFileSync(TOKEN_PATH)), ...tokens });
    else saveTokens(tokens);
});

app.get('/auth', (req, res) => res.redirect(oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES })));
app.get('/oauth2callback', async (req, res) => {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    oauth2Client.setCredentials(tokens);
    saveTokens(tokens);
    res.send('<h1>Conectado</h1>');
});

// --- Rutas Login y Datos ---
app.post('/api/auth/login', async (req, res) => {
    try {
        const { dni, password } = req.body;
        const accessToken = (await oauth2Client.getAccessToken()).token;
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Usuarios&tq=${encodeURIComponent(`select * where A = '${dni}'`)}`;
        const response = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        const dataJson = JSON.parse(response.data.replace(/.*setResponse\((.*)\);/s, '$1'));
        if (!dataJson.table?.rows.length) return res.status(400).json({ error: 'Usuario no encontrado' });
        const row = dataJson.table.rows[0];
        if (await bcrypt.compare(password, row.c[1]?.v)) res.json({ success: true, usuario: { dni, rol: row.c[2]?.v || 'user' } });
        else res.status(400).json({ error: 'Contraseña incorrecta' });
    } catch (e) { res.status(500).json({ error: 'Error Login' }); }
});
// ======================================================================
// 🔍 BUSCAR DATOS (CON ORDEN CRONOLÓGICO Y FECHAS ARREGLADAS)
// ======================================================================
app.post('/api/buscar-datos', async (req, res) => {
    try {
        const { dniBuscado } = req.body;
        const accessToken = (await oauth2Client.getAccessToken()).token;
        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

        // 1. Datos médicos (Hoja Integrado)
        const resMed = await axios.get(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Integrado&tq=${encodeURIComponent(`select * where C = '${dniBuscado}'`)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        
        // Limpiamos el JSON de Google
        const jsonMed = JSON.parse(resMed.data.replace(/.*setResponse\((.*)\);/s, '$1'));

        if (!jsonMed.table?.rows.length) return res.status(404).json({ error: 'No hay datos' });

        // 2. Informes IA (API Oficial)
        const resInformes = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "'Informes IA'!A:C" 
        });

        const filasInformes = resInformes.data.values || [];
        
        // Buscamos ignorando la comilla '
        const filaEncontrada = filasInformes.find(fila => {
            const dniExcel = fila[0]?.toString().replace("'", "").trim();
            return dniExcel == dniBuscado.toString().trim();
        });

        const reporte = filaEncontrada ? filaEncontrada[2] : null;

        // --- FUNCIÓN HELPER PARA ARREGLAR FECHAS ---
        function procesarFecha(googleDateString) {
            if (!googleDateString) return { fechaObjeto: new Date(0), fechaTexto: "" };
            
            // El formato viene como "Date(2023,9,5)" -> Año, Mes(0-11), Día
            const match = googleDateString.match(/Date\((\d+),(\d+),(\d+)\)/);
            
            if (match) {
                const anio = parseInt(match[1]);
                const mes = parseInt(match[2]); // OJO: Google usa meses 0-11
                const dia = parseInt(match[3]);
                
                // Creamos fecha real para ordenar (Mes va tal cual para JS)
                const fechaObj = new Date(anio, mes, dia);
                
                // Creamos texto bonito (Aquí SUMAMOS 1 al mes para humanos)
                const mesHumano = (mes + 1).toString().padStart(2, '0');
                const diaHumano = dia.toString().padStart(2, '0');
                const fechaTxt = `${diaHumano}/${mesHumano}/${anio}`;
                
                return { fechaObjeto: fechaObj, fechaTexto: fechaTxt };
            }
            // Si no es formato Date(...), devolvemos tal cual
            return { fechaObjeto: new Date(0), fechaTexto: googleDateString };
        }

        // 3. Procesamos y Ordenamos
        let reports = jsonMed.table.rows.map(row => {
            const d = {}; 
            let fechaParaOrdenar = new Date(0); // Fecha por defecto antigua

            jsonMed.table.cols.forEach((c, i) => { 
                if(c.label) {
                    let valor = row.c[i]?.v || '';
                    
                    // Si la columna es FECHAX (o parece una fecha de Google)
                    if (c.label === 'FECHAX' || (typeof valor === 'string' && valor.startsWith('Date('))) {
                        const procesado = procesarFecha(valor);
                        d[c.label] = procesado.fechaTexto; // Guardamos el texto bonito (5/10/23)
                        
                        // Si es la columna clave de fecha, guardamos el objeto para ordenar después
                        if (c.label === 'FECHAX') {
                            fechaParaOrdenar = procesado.fechaObjeto;
                        }
                    } else {
                        d[c.label] = valor;
                    }
                } 
            });
            
            d['REPORTE_MEDICO'] = reporte;
            d['_fechaOrden'] = fechaParaOrdenar; // Campo oculto temporal para ordenar
            return d;
        });

        // 4. ORDENAR: El más nuevo primero (Descendente)
        reports.sort((a, b) => b._fechaOrden - a._fechaOrden);

        // (Opcional) Limpiamos el campo temporal _fechaOrden antes de enviar
        reports.forEach(r => delete r._fechaOrden);

        res.json({ reports });

    } catch (e) { 
        console.error("Error al buscar datos:", e);
        res.status(500).json({ error: 'Error Datos' }); 
    }
});

// --- Guardar Reporte ---
app.post('/api/guardar-reporte', async (req, res) => {
    console.log("💾 Intentando guardar reporte...");
    try {
        const { dni, nombre, reporteTexto } = req.body;
        if (!dni || !reporteTexto) return res.status(400).json({ error: 'Faltan datos' });

        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
        
        const resDNI = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'Informes IA'!A:A` });
        const rows = resDNI.data.values || [];
        
        const rowIndex = rows.findIndex(r => {
            const dniExcel = r[0]?.toString().replace("'", "").trim();
            return dniExcel == dni.toString().trim();
        });

        if (rowIndex !== -1) {
            console.log(`🔄 Actualizando reporte existente para DNI ${dni}`);
            await sheets.spreadsheets.values.update({ 
                spreadsheetId: SPREADSHEET_ID, 
                range: `'Informes IA'!C${rowIndex + 1}`, 
                valueInputOption: 'RAW', 
                resource: { values: [[reporteTexto]] } 
            });
        } else {
            console.log(`✨ Creando nuevo reporte para DNI ${dni}`);
            await sheets.spreadsheets.values.append({ 
                spreadsheetId: SPREADSHEET_ID, 
                range: `'Informes IA'!A:C`, 
                valueInputOption: 'RAW', 
                resource: { values: [[`'${dni}`, nombre, reporteTexto]] } 
            });
        }
        res.json({ success: true });
    } catch (e) { 
        console.error("❌ ERROR AL GUARDAR:", e.message);
        res.status(500).json({ error: 'Error Excel: ' + e.message }); 
    }
});
// ======================================================================
// 🧠 CEREBRO IAPOS (REGLAS + FORMATO FINAL)
// ======================================================================
const REGLAS_IAPOS = `
ERES UN ASISTENTE MÉDICO DEL PROGRAMA "DÍA PREVENTIVO" DE IAPOS.
TU OBJETIVO: Generar un informe HTML visualmente atractivo, cálido y profesional.

REGLAS MÉDICAS (SÍGUELAS ESTRICTAMENTE):
1. **Frecuencia:** Anual.
2. **Cáncer de Mama:** Mamografía ≥ 40 años.
3. **Cáncer de Colon (SOMF/VCC):**
   - **Regla de Oro:** El rastreo comienza a los 50 años.
   - **Si SOMF es POSITIVO (+):** ALERTA ROJA. Indicar VCC obligatoria y explicar importancia de detectar pólipos a tiempo.
   - **Si SOMF es NEGATIVO (-):**
     * **Entre 50 y 60 años:** Felicitar por el negativo, PERO aclarar: "Es conveniente considerar una Colonoscopía (VCC) cada 5 años aunque el SOMF sea negativo, ya que es el estudio más preciso". (Tono sugerencia, sin urgencia).
     * **Mayores de 60 años (que nunca se hicieron VCC):** ALERTA ROJA/AMARILLA. Indicar: "Más allá del SOMF negativo, por tu edad es fundamental realizar una Colonoscopía si nunca la hiciste".
     * **Menores de 50:** Resultado normal, sin acciones extra.
4. **Próstata:** PSA hombres ≥ 50 años.
5. **Salud Mujer (HPV / PAP) - LÓGICA CRUZADA OBLIGATORIA:**
   - **Primero mira el HPV:**
     * **Si HPV es NEGATIVO (Normal):** El PAP NO ES NECESARIO. La tarjeta debe ser verde. Mensaje: "Al tener HPV negativo, no necesitas PAP por 3-5 años según criterio médico". ¡No marques el PAP como falta!
     * **Si HPV es POSITIVO (Patológico):**
        - Si tiene PAP Normal: "Excelente, situación controlada".
        - Si NO tiene PAP o está pendiente: **ALERTA ROJA**. Mensaje: "El HPV positivo es riesgo. Consulta urgente para realizar el PAP".
   - **Reglas por edad (solo si no hay dato de HPV):**
     * < 26 años: Recomendar vacuna, no estudios.
     * > 30 años: El test de HPV es la prioridad.
6. **Alertas:** Fumar, Alcohol, Seguridad Vial (No cumple), Violencia, Depresión.

ESTRUCTURA VISUAL OBLIGATORIA (HTML TAILWIND):
1.  **CUADRO RESUMEN (AL PRINCIPIO):**
    Crea una tabla con bordes suaves que diga: Fecha del Examen, Profesional Responsable, Efector (Lugar), DNI, Paciente (Nombre Completo).
    Usa clases: <div class="overflow-x-auto mb-6"><table class="min-w-full text-sm text-left text-gray-600 border border-gray-200 rounded-lg">...

2.  **SALUDO E INTRODUCCIÓN (TEXTUAL):**
    "Hola [Nombre Pila],"
    "Te felicitamos por haberte decidido a hacer el Día Preventivo y pensar en la prevención de manera seria y responsable."
    "Este es un resumen de tu Día Preventivo, confeccionado con asistencia de Inteligencia Artificial pero basado estrictamente en el informe de tu médico preventivista, el/la Dr./Dra. [Apellido Médico], quien ha analizado todos tus resultados."

3.  **CUERPO DEL INFORME:**
    - Usa tarjetas de colores para los resultados (Verde/Amarillo/Rojo/Azul).
    - Usa Iconos/Emojis.

4.  **CIERRE:**
    "Saludos cordiales del Equipo IAPOS." (SIN FIRMA DEL MÉDICO ABAJO).
`;

function construirPrompt(datosPersona) {
    const datosJson = JSON.stringify(datosPersona, null, 2);
    // Intentamos obtener datos del médico y lugar para el cuadro
    const nombreMedico = datosPersona['Profesional'] || 'Equipo Médico IAPOS';
    const efector = datosPersona['Efector'] || 'IAPOS';
    const fecha = datosPersona['FECHAX'] || new Date().toLocaleDateString();
    
    let partesNombre = (datosPersona['apellido y nombre'] || 'Afiliado').split(' ');
    let nombrePila = partesNombre.length > 1 ? partesNombre[1] : partesNombre[0];
    nombrePila = nombrePila.replace(/['"]/g, "");

    return `Actúa como asistente de IAPOS.
    
    CONTEXTO Y REGLAS:
    ${REGLAS_IAPOS}

    TU TAREA:
    Genera el **cuerpo del informe en HTML puro**.
    
    DATOS PARA EL CUADRO RESUMEN:
    - Fecha: ${fecha}
    - Profesional: ${nombreMedico}
    - Efector: ${efector}
    - Paciente: ${datosPersona['apellido y nombre']}
    - DNI: ${datosPersona['DNI']}

    DATOS CLÍNICOS A PROCESAR:
    ${datosJson}`;
}
function limpiarRespuesta(texto) {
    // 1. Quitar los bloques de código Markdown (```html, ```)
    let limpio = texto.replace(/```html/gi, "").replace(/```/g, "");
    
    // 2. Quitar encabezados molestos si la IA los pone
    limpio = limpio.replace(/DATOS DEL PACIENTE/gi, "");
    limpio = limpio.replace(/REPORTE TÉCNICO/gi, "");
    
    // 3. (IMPORTANTE) A veces la IA pone el DOCTYPE o la etiqueta html, los quitamos
    limpio = limpio.replace(/<!DOCTYPE html>/gi, "").replace(/<html>/gi, "").replace(/<\/html>/gi, "").replace(/<body>/gi, "").replace(/<\/body>/gi, "");

    return limpio.trim();
}
// ======================================================================
// 🧠 RUTA IA: CÓDIGO DE RENDER + SEGURIDAD MÉDICA
// ======================================================================

app.post('/api/analizar-informe', async (req, res) => {
    // 1. Validación rápida
    if (!req.body.persona) return res.status(400).json({ error: 'Faltan datos' });
    
    console.log(`🧠 Generando informe para: ${req.body.persona['apellido y nombre']}...`);

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        // Usamos el mismo modelo que en Render
        const model = genAI.getGenerativeModel({ 
            model: "gemini-flash-latest",
            // 👇 ESTO ES LO ÚNICO AGREGADO (Vital para medicina)
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            ]
        });

        const prompt = construirPrompt(req.body.persona);
        const result = await model.generateContent(prompt);
        const response = await result.response;
        
        let cleanText = limpiarRespuesta(response.text());
        res.json({ resumen: cleanText });

    } catch (error) {
        console.error('🚨 ERROR IA:', error); // Muestra el error real si pasa algo
        res.status(500).json({ error: 'Error al generar informe: ' + error.message });
    }
});
// ======================================================================
// 🔐 RUTA CAMBIAR CONTRASEÑA (NUEVO)
// ======================================================================
app.post('/api/auth/cambiar-password', async (req, res) => {
    console.log("🔐 Intentando cambiar contraseña...");
    try {
        const { dni, nuevaClave } = req.body;
        
        if (!dni || !nuevaClave) {
            return res.status(400).json({ error: 'Faltan datos' });
        }

        // 1. Encriptamos la nueva clave para que sea segura
        const hash = await bcrypt.hash(nuevaClave, 10);

        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
        
        // 2. Buscamos al usuario en la hoja "Usuarios"
        // NOTA: Asumimos que la hoja se llama "Usuarios" y la Columna A es el DNI
        const resUsuarios = await sheets.spreadsheets.values.get({ 
            spreadsheetId: SPREADSHEET_ID, 
            range: `'Usuarios'!A:A` 
        });
        
        const rows = resUsuarios.data.values || [];
        // Buscamos la fila del DNI (ignorando comillas si las hubiera)
        const rowIndex = rows.findIndex(r => r[0]?.toString().replace("'", "").trim() == dni.toString().trim());

        if (rowIndex === -1) {
            return res.status(404).json({ error: 'Usuario no encontrado en la base de datos.' });
        }

        // 3. Guardamos la NUEVA clave encriptada en la Columna B (que es la 2da columna)
        // rowIndex + 1 porque Excel empieza en fila 1, no 0
        await sheets.spreadsheets.values.update({ 
            spreadsheetId: SPREADSHEET_ID, 
            range: `'Usuarios'!B${rowIndex + 1}`, 
            valueInputOption: 'RAW', 
            resource: { values: [[hash]] } 
        });

        console.log(`✅ Contraseña actualizada para DNI ${dni}`);
        res.json({ success: true });

    } catch (e) { 
        console.error("❌ ERROR AL CAMBIAR CLAVE:", e.message);
        res.status(500).json({ error: 'Error al actualizar: ' + e.message }); 
    }
});

// START
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
async function start() { await loadTokens(); app.listen(PORT, () => console.log(`🚀 Servidor listo: http://localhost:${PORT}`)); }
start();