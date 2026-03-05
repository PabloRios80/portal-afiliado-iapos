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

// ======================================================================
// 🧠 SISTEMA DE CACHÉ EN MEMORIA (CARGA 20.000+ REGISTROS)
// ======================================================================
let cachePacientes = []; // Aquí vivirá tu base de datos en RAM
let cacheInformes = [];  // Aquí vivirán los informes
let ultimaSincronizacion = null;
let estaSincronizando = false;

// Sacamos esta función afuera para poder usarla al sincronizar
function procesarFecha(googleDateString) {
    if (!googleDateString) return { fechaObjeto: new Date(0), fechaTexto: "" };
    const match = googleDateString.match(/Date\((\d+),(\d+),(\d+)\)/);
    if (match) {
        const anio = parseInt(match[1]);
        const mes = parseInt(match[2]); 
        const dia = parseInt(match[3]);
        const fechaObj = new Date(anio, mes, dia);
        const mesHumano = (mes + 1).toString().padStart(2, '0');
        const diaHumano = dia.toString().padStart(2, '0');
        return { fechaObjeto: fechaObj, fechaTexto: `${diaHumano}/${mesHumano}/${anio}` };
    }
    return { fechaObjeto: new Date(0), fechaTexto: googleDateString };
}

// ESTA FUNCIÓN VIAJA A GOOGLE Y SE APRENDE EL EXCEL DE MEMORIA
async function sincronizarBaseDeDatos() {
    if (estaSincronizando) return;
    estaSincronizando = true;
    console.log("🔄 Iniciando descarga masiva de la base de datos a memoria...");

    try {
        const accessToken = (await oauth2Client.getAccessToken()).token;
        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

        // 1. Bajar TODO 'Integrado' (sin el "where C = ...")
        const resMed = await axios.get(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Integrado`, { 
            headers: { Authorization: `Bearer ${accessToken}` } 
        });
        const jsonMed = JSON.parse(resMed.data.replace(/.*setResponse\((.*)\);/s, '$1'));

        const todosLosPacientes = [];
        if (jsonMed.table && jsonMed.table.rows) {
            jsonMed.table.rows.forEach(row => {
                const d = {}; 
                let fechaParaOrdenar = new Date(0);
                
                // Extraemos el DNI de la columna C (índice 2)
                let dniBuscable = row.c[2]?.v?.toString().replace(/'/g, "").trim() || "";

                jsonMed.table.cols.forEach((c, i) => { 
                    if (c && c.label) {
                        let valor = row.c[i]?.v || '';
                        if (c.label === 'FECHAX' || (typeof valor === 'string' && valor.startsWith('Date('))) {
                            const procesado = procesarFecha(valor);
                            d[c.label] = procesado.fechaTexto;
                            if (c.label === 'FECHAX') fechaParaOrdenar = procesado.fechaObjeto;
                        } else {
                            d[c.label] = valor;
                        }
                    } 
                });
                d['_dniBuscable'] = dniBuscable;
                d['_fechaOrden'] = fechaParaOrdenar;
                todosLosPacientes.push(d);
            });
        }
        cachePacientes = todosLosPacientes;

        // 2. Bajar TODO 'Informes IA'
        const resInformes = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "'Informes IA'!A:C" 
        });
        cacheInformes = resInformes.data.values || [];

        ultimaSincronizacion = new Date();
        console.log(`✅ Base de datos lista en memoria. Total de registros: ${cachePacientes.length}`);
    } catch (error) {
        console.error("❌ Error al sincronizar la base de datos:", error.message);
    } finally {
        estaSincronizando = false;
    }
}

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
// 🚀 BUSCAR DATOS (VERSIÓN ULTRARRÁPIDA CON CACHÉ)
// ======================================================================
app.post('/api/buscar-datos', async (req, res) => {
    try {
        const { dniBuscado } = req.body;
        const dniStr = dniBuscado.toString().trim();

        if (cachePacientes.length === 0) {
            return res.status(503).json({ error: 'Servidor iniciando. Aguarde unos segundos y vuelva a intentar.' });
        }

        // 1. Buscamos en RAM (Tarda 0.001 segundos)
        const registrosPaciente = cachePacientes.filter(p => p['_dniBuscable'] === dniStr);

        if (registrosPaciente.length === 0) {
            return res.status(404).json({ error: 'No hay datos' });
        }

        // 2. Buscamos el informe
        const filaEncontrada = cacheInformes.find(fila => {
            const dniExcel = fila[0]?.toString().replace("'", "").trim();
            return dniExcel === dniStr;
        });
        const reporte = filaEncontrada ? filaEncontrada[2] : null;

        // 3. Empaquetamos y ordenamos
        let reports = registrosPaciente.map(p => {
            const copia = { ...p }; // Clonamos para no editar la memoria
            copia['REPORTE_MEDICO'] = reporte;
            return copia;
        });

        reports.sort((a, b) => b._fechaOrden - a._fechaOrden);
        reports.forEach(r => delete r._fechaOrden); // Limpiamos campos ocultos
        reports.forEach(r => delete r._dniBuscable);

        res.json({ reports });

    } catch (e) { 
        console.error("Error al buscar datos:", e);
        res.status(500).json({ error: 'Error Datos' }); 
    }
});

// ======================================================================
// 🔄 RUTA MANUAL DE SINCRONIZACIÓN (BOTÓN DE PÁNICO)
// ======================================================================
app.post('/api/admin/sincronizar', async (req, res) => {
    if (estaSincronizando) {
        return res.status(429).json({ error: 'Ya hay una sincronización en curso. Aguarde un momento.' });
    }
    
    // Forzamos la descarga
    await sincronizarBaseDeDatos();
    
    res.json({ 
        success: true, 
        totalRegistros: cachePacientes.length,
        ultimaSincronizacion: ultimaSincronizacion
    });
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
   -- **SOMF (-):**
     * **Mayores de 60 años (sin VCC):** ALERTA AMARILLA (PRECAUCIÓN). No lo retes, pero explícale con firmeza: "Tu SOMF dio bien, pero a tu edad la Colonoscopía es el estudio que te da seguridad total. Piénsalo".
     * **Entre 50-60 años:** SUGERENCIA. "Considera la VCC para mayor tranquilidad".
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
7. **Agudeza Visual:**
    - Si dice "Alterada" o "Disminuida": ALERTA AMARILLA. No es una emergencia. Recomendar: "Controlar periódicamente la salud visual con tu oftalmólogo".

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
// ======================================================================
// 📝 GUARDAR INFORME (USANDO OAUTH2 EXISTENTE - SIN CAMBIAR .ENV)
// ======================================================================
app.post('/api/actualizar-informe-ia', async (req, res) => {
    try {
        const { dni, nuevoInforme, nombre } = req.body;

        if (!dni) return res.status(400).json({ error: 'Falta el DNI' });

        console.log(`💾 Guardando en 'Informes IA' para DNI: ${dni} usando OAuth2...`);

        // 1. Usamos el cliente que YA funciona en tu app
        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

        // 2. Primero leemos la columna A de la pestaña "Informes IA" para buscar el DNI
        // Asumimos: Columna A = DNI, Columna B = Nombre, Columna C = Reporte HTML
        const respuesta = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "'Informes IA'!A:A", // Leemos solo la columna de DNIs
        });

        const filas = respuesta.data.values || [];
        
        // Buscamos en qué fila está el DNI (sumamos 1 porque el array empieza en 0 pero Excel en 1)
        let indiceFila = -1;
        for (let i = 0; i < filas.length; i++) {
            // Comparamos como texto para evitar errores
            if (filas[i][0] && filas[i][0].toString().trim() === String(dni).trim()) {
                indiceFila = i + 1; // Encontrado
                break;
            }
        }

        if (indiceFila !== -1) {
            // --- CASO A: ACTUALIZAR (El paciente existe) ---
            // Vamos a escribir en la Columna C (que es la del reporte) de esa fila
            console.log(`✅ Paciente encontrado en fila ${indiceFila}. Actualizando...`);
            
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `'Informes IA'!C${indiceFila}`, // Columna C = Reporte
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[nuevoInforme]] // El dato a guardar
                }
            });

        } else {
            // --- CASO B: CREAR NUEVO (El paciente no estaba en esta hoja) ---
            console.log("⚠️ Paciente nuevo en Informes IA. Creando fila...");
            
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: "'Informes IA'!A:C",
                valueInputOption: 'RAW',
                requestBody: {
                    values: [[dni, nombre || 'Paciente', nuevoInforme]]
                }
            });
        }

        res.json({ ok: true, mensaje: "Guardado correctamente" });

    } catch (error) {
        console.error('🚨 Error guardando con OAuth:', error);
        // Si el error es de tokens, intentamos avisar
        if (error.code === 401 || error.code === 403) {
            return res.status(401).json({ error: 'Error de permisos. El token del servidor puede estar vencido.' });
        }
        res.status(500).json({ error: error.message });
    }
});

// ======================================================================
// ⚡ ALTA RÁPIDA DE USUARIO (SOLO ADMIN)
// ======================================================================
app.post('/api/admin/crear-usuario-rapido', async (req, res) => {
    try {
        const { dni } = req.body;
        if (!dni) return res.status(400).json({ error: 'Falta el DNI' });

        // 1. Generar contraseña aleatoria amigable
        // Ej: IAPOS-4829
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const passwordPlana = `IAPOS-${randomNum}`;

        // 2. Encriptar contraseña
        const hashedPassword = await bcrypt.hash(passwordPlana, 10);

        // 3. Guardar en Google Sheets (Hoja "Usuarios")
        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
        
        // Verificamos si ya existe (opcional, pero recomendado)
        const checkRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "'Usuarios'!A:A",
        });
        const dnis = checkRes.data.values ? checkRes.data.values.flat() : [];
        
        if (dnis.includes(String(dni))) {
            return res.status(400).json({ error: 'Este DNI ya tiene usuario creado.' });
        }

        // 4. Agregar fila nueva: DNI | PASSWORD | ROL | EMAIL(vacio)
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: "'Usuarios'!A:D",
            valueInputOption: 'RAW',
            requestBody: {
                values: [[dni, hashedPassword, 'user', '']]
            }
        });

        console.log(`⚡ Usuario creado: ${dni} pass: ${passwordPlana}`);
        
        // Devolvemos la contraseña PLANA para que la puedas compartir por WhatsApp
        res.json({ success: true, dni, password: passwordPlana });

    } catch (error) {
        console.error('Error creando usuario:', error);
        res.status(500).json({ error: error.message });
    }
});
// START
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function start() { 
    // 1. Primero cargamos las llaves de Google
    await loadTokens(); 
    
    // 2. Prendemos el servidor
    app.listen(PORT, () => console.log(`🚀 Servidor listo: http://localhost:${PORT}`)); 
    
    // 3. AHORA SÍ: Como ya tenemos las llaves, descargamos la base de datos a la RAM
    sincronizarBaseDeDatos();
    
    // 4. Lo programamos para que se repita cada 24 horas
    setInterval(sincronizarBaseDeDatos, 24 * 60 * 60 * 1000); 
}

start();