/*
 * Script de Lógica Principal del Portal de Afiliados
 * Maneja la interacción con la hoja de cálculo de Google Sheets (a través del servidor)
 * y la llamada a la API de Gemini para el análisis de informes.
 *
 * * MODIFICACIONES CRÍTICAS APLICADAS:
 * 1. Implementación de un selector de fecha dentro de la pestaña "Día Preventivo".
 * 2. Se almacena el historial completo de informes en la variable global `allReports`.
 * 3. Se agregó la función `updateDashboardContent` para manejar el cambio de informe por fecha.
 * 4. El selector de fecha (historial) se movió al inicio de la pestaña "Día Preventivo".
 * 5. Se agregó la fecha del último estudio complementario cargado en la tarjeta de la pestaña Estudios Complementarios.
 */

// --- Variables Globales ---
// Obtenida del HTML (inyectada por server.js). Apunta a http://localhost:4000 en local o la URL de Render en producción.
const ESTUDIOS_API_URL = window.ESTUDIOS_API_URL || 'http://localhost:4000';
// API URL del servicio principal (llama al mismo servidor Node.js que sirve este HTML)
const API_BASE_PATH = '/api';

// --- NUEVAS VARIABLES DE ESTADO ---
// Variable para almacenar todos los informes históricos después de la búsqueda inicial
let allReports = [];
// Variable para almacenar los resultados de estudios complementarios (son estáticos por DNI)
let cachedEstudiosResults = {};
// ---------------------------------


// ==============================================================================
// 1. CONFIGURACIÓN INICIAL (DOMContentLoaded)
// ==============================================================================
document.addEventListener('DOMContentLoaded', () => {
    const btnVerPortal = document.getElementById('btn-ver-portal');

    if (btnVerPortal) {
        btnVerPortal.addEventListener('click', async () => {
            // 1. Solicitar DNI
            const { value: dni } = await Swal.fire({
                title: 'Ingresa tu DNI',
                input: 'text',
                inputLabel: 'Tu número de documento (sin puntos)',
                inputPlaceholder: 'Ej: 12345678',
                showCancelButton: true,
                confirmButtonText: 'Ver mis resultados',
                inputValidator: (value) => {
                    if (!value || isNaN(value)) {
                        return 'Por favor, ingresa un DNI válido.';
                    }
                }
            });

            if (dni) {
                Swal.fire({
                    title: 'Buscando tu informe...',
                    text: 'Recuperando datos, generando análisis de IA y buscando estudios complementarios.',
                    allowOutsideClick: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });

                try {
                    // 2. Buscar datos en el servidor
                    const response = await fetch('/api/buscar-datos', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ dni: dni.trim() })
                    });

                    const dataResult = await response.json();

                    if (!response.ok) {
                        throw new Error(dataResult.error || 'Error desconocido al buscar datos.');
                    }

                    // 2.1. Adaptar la respuesta: asume que el servidor devuelve 'reports' (array) o 'persona' (objeto).
                    let reports = dataResult.reports;

                    if (!reports || reports.length === 0) {
                        if (dataResult.persona) {
                            // Si solo viene un resultado (viejo formato), lo convertimos en un array de un elemento
                            reports = [dataResult.persona];
                        } else {
                            Swal.fire('No Encontrado', 'No se encontraron resultados para el DNI ingresado.', 'error');
                            return;
                        }
                    }

                    // 1. Función para ordenar por fecha (la más reciente primero)
                    const sortedReports = [...reports].sort((a, b) => {
                        const parseDate = (dateStr) => {
                            const parts = dateStr.split('/');
                            // Nota: Asume formato DD/MM/YYYY. Crea la fecha como YYYY-MM-DD para una comparación correcta.
                            return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                        };

                        const dateA = parseDate(a.FECHAX || "01/01/1970"); // Usar fecha de fallback
                        const dateB = parseDate(b.FECHAX || "01/01/1970");
                        return dateB - dateA; // Orden descendente (más nuevo primero)
                    });

                    // 2. Se selecciona automáticamente el informe más reciente
                    const selectedReport = sortedReports[0];

                    // ===============================================================
                    // 	*** ALMACENAMIENTO DE ESTADO GLOBAL ***
                    // ===============================================================
                    allReports = sortedReports;
                    
                    const personaData = selectedReport; // El informe seleccionado se usa como persona
                    const dniToSearch = personaData.DNI;

                    // LLAMADAS PARALELAS ESPECÍFICAS (IA ACTIVADA y Estudios, solo una vez)
                    // NOTA: obtenerLinkEstudios ahora debe devolver { link: ..., fechaResultado: ... }
                    const [
                        resumenAI, // LA IA SIGUE AQUÍ, ACTIVA
                        labResult,
                        mamografiaResult,
                        ecografiaResult,
                        ecomamariaResult,
                        espirometriaResult,
                        enfermeriaResult,
                        densitometriaResult,
                        vccResult,
                        oftalmologiaResult,
                        odontologiaResult,
                        biopsiaResult
                    ] = await Promise.all([
                        obtenerResumenAI(personaData), // La función obtenerResumenAI es llamada
                        obtenerLinkEstudios(dniToSearch, 'laboratorio'),
                        obtenerLinkEstudios(dniToSearch, 'mamografia'),
                        obtenerLinkEstudios(dniToSearch, 'ecografia'),
                        obtenerLinkEstudios(dniToSearch, 'ecomamaria'),
                        obtenerLinkEstudios(dniToSearch, 'espirometria'),
                        obtenerLinkEstudios(dniToSearch, 'enfermeria'),
                        obtenerLinkEstudios(dniToSearch, 'densitometria'),
                        obtenerLinkEstudios(dniToSearch, 'vcc'),
                        obtenerLinkEstudios(dniToSearch, 'oftalmologia'),
                        obtenerLinkEstudios(dniToSearch, 'odontologia'),
                        obtenerLinkEstudios(dniToSearch, 'biopsia')
                    ]);

                    // 4. Cargar el Portal Personal de Salud (Nueva Vista)
                    const estudiosResults = {
                        laboratorio: labResult,
                        mamografia: mamografiaResult,
                        ecografia: ecografiaResult,
                        ecomamaria: ecomamariaResult,
                        espirometria: espirometriaResult,
                        enfermeria: enfermeriaResult,
                        densitometria: densitometriaResult,
                        vcc: vccResult,
                        oftalmologia: oftalmologiaResult,
                        odontologia: odontologiaResult,
                        biopsia: biopsiaResult
                    };
                    
                    cachedEstudiosResults = estudiosResults; // Guardar resultados estáticos

                    cargarPortalPersonal(personaData, resumenAI); // Usará allReports y cachedEstudiosResults

                    Swal.close(); // Cerrar el loading

                } catch (error) {
                    console.error('Error en el proceso de búsqueda:', error);
                    Swal.fire('Error del Sistema', 'Hubo un problema al buscar o analizar tu informe. Intenta más tarde.', 'error');
                }
            }
        });
    }
});

// ==============================================================================
// 2. FUNCIONES DE CONEXIÓN Y LÓGICA DE RIESGO
// ==============================================================================

/**
 * Llama al servidor para obtener el resumen de IA. (MANTENIDO ACTIVO)
 * @param {Object} persona Datos del paciente (el informe seleccionado).
 */
async function obtenerResumenAI(persona) {
    try {
        const response = await fetch('/api/analizar-informe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ persona: persona })
        });

        const result = await response.json();

        if (response.ok && result.resumen) {
            return result.resumen;
        } else {
            console.error('Error al generar resumen AI:', result.error);
            return `ERROR del servidor: La IA no pudo generar el resumen. ${result.error || 'Verifica la conexión.'}`;
        }
    } catch (error) {
        console.error('Fallo de red al llamar a la IA:', error);
        return 'ERROR CRÍTICO DE GEMINI: Fallo de red o tiempo de espera agotado al contactar la IA.';
    }
}


/**
 * Llama al microservicio de Estudios Complementarios (puerto 4000) para un 
 * estudio ESPECÍFICO (ej. 'laboratorio' o 'mamografia').
 * Se asume que el microservicio devuelve el resultado más reciente y su fecha.
 * * @param {string} dni El DNI del paciente.
 * @param {string} studyType El tipo de estudio a buscar ('laboratorio', 'mamografia').
 * @returns {Promise<Object>} El enlace, la fecha del último resultado o un objeto de error.
 */
async function obtenerLinkEstudios(dni, studyType) {
    // La URL ahora incluye el parámetro 'tipo'
    const studyApiUrl = `${ESTUDIOS_API_URL}/api/buscar-estudios?dni=${dni}&tipo=${studyType}`;

    try {
        const response = await fetch(studyApiUrl);
        const data = await response.json();

        // El microservicio ahora devuelve 404 si el DNI o el link no se encontraron.
        if (response.status === 404) {
            // Error de No Encontrado o sin resultados
            return { link: null, error: data.error, tipo: studyType, fechaResultado: null };
        }

        if (response.ok && data.link) {
            // Éxito: link encontrado. Se asume que 'data' ahora incluye 'fechaResultado' (DD/MM/YYYY)
            // Si el servidor no lo provee, 'fechaResultado' será undefined y se tratará como null.
            return { 
                link: data.link, 
                tipo: studyType, 
                mensaje: data.mensaje,
                fechaResultado: data.fechaResultado || null // Asumimos que el servidor lo provee
            };
        } else {
             // Esto captura si el microservicio devuelve 500 o si la respuesta no es .ok
            const errorMessage = data.error || `Error del microservicio de Estudios (${response.status} - ${studyType})`;
            throw new Error(errorMessage);
        }
    } catch (error) {
        console.error(`Fallo al buscar estudios complementarios (${studyType}):`, error);
        // Devolvemos un objeto de error para mostrar un mensaje informativo
        return { 
            link: null, 
            error: `El servicio de Estudios Complementarios falló o no está disponible para ${studyType}.`,
            tipo: studyType,
            fechaResultado: null
        };
    }
}

/**
 * Mapea un valor de columna a un nivel de riesgo (color/ícono).
 * Criterios actualizados por el cliente.
 */
function getRiskLevel(key, value) {
    const v = String(value || '').toLowerCase().trim();
    const k = key.toLowerCase().trim();

    // 0. Regla de NEUTRO (Gris) - Máxima Prioridad para variables informativas
    if (['edad', 'sexo', 'profesional', 'fechax', 'dni'].includes(k)) {
        return { color: 'gray', icon: 'info', text: 'Informativo' };
    }

    // 1. Reglas de CALMA (Verde) - Ausencia de Riesgo (Prioridad Alta)
    if (v.includes('no presenta') || 
        v.includes('normal') || 
        v.includes('adecuada') || 
        v.includes('no abusa') || // Abuso Alcohol
        v.includes('no se verifica') || // Violencia, Depresión, etc.
        v.includes('no fuma') || 
        v.includes('cumple') || // Seguridad Vial
        v.includes('no indicado') || // Ácido Fólico
        v.includes('no aplica') || // No Aplica
        v.includes('bajo') || 
        v.includes('realiza') ||
        v.includes('completo') || // Inmunizaciones 
        v.includes('sí') ||
        v.includes('riesgo bajo') || 
        v.includes('negativo')) {
        return { color: 'green', icon: 'check', text: 'Calma' };
    }

    // 2. Reglas universales de ALERTA (Rojo)
    // Se ejecuta si NO pasó la regla Verde, buscando presencia de riesgo.
    if (v.includes('sí presenta') || 
        v.includes('presenta') || 
        v.includes('elevado') || 
        v.includes('anormal') || 
        v.includes('alto') || 
        v.includes('no control') || 
        v.includes('no realiza') || 
        v.includes('pendiente') || 
        v.includes('riesgo alto') || 
        v.includes('positivo') ||
        v.includes('incompleto') || // Inmunizaciones
        v.includes('obesidad') || // IMC
        v.includes('hipertensión') || // Presión Arterial
        v.includes('hipertension') // Presión Arterial (sin acento)
        ) {
        return { color: 'red', icon: 'times', text: 'Alerta' };
    }

    // 3. Reglas específicas o de ATENCIÓN (Amarillo)
    if (k.includes('imc') && (v.includes('sobrepeso') || v.includes('bajo peso'))) {
        return { color: 'yellow', icon: 'exclamation', text: 'Atención' };
    }
    if (v.includes('mejorar') || 
        v.includes('moderar') || 
        v.includes('a vigilar') || 
        v.includes('límite') || 
        v.includes('riesgo moderado')) {
        return { color: 'yellow', icon: 'exclamation', text: 'Atención' };
    }

    // Si el valor no es claro pero existe, por defecto es atención.
    if (v.length > 0) {
        return { color: 'gray', icon: 'question', text: 'Sin Dato' };
    }

    // Si el valor está vacío o no mapeado
    return { color: 'gray', icon: 'question', text: 'Sin Dato' };
}


// ==============================================================================
// 3. FUNCIONES DEL PORTAL PERSONAL DE SALUD (Dashboard y Pestañas)
// ==============================================================================

/**
 * Carga el Portal Personal de Salud y configura la navegación.
 * @param {Object} persona Datos del paciente (el informe seleccionado, el más reciente por defecto).
 * @param {string} resumenAI Resumen generado por la IA para ese informe.
 */
function cargarPortalPersonal(persona, resumenAI) {
    // 1. Ocultar la vista inicial y mostrar el portal
    document.getElementById('vista-inicial').style.display = 'none';
    document.getElementById('portal-salud-container').style.display = 'block';

    // 2. Cargar el contenido de las pestañas
    // La pestaña de Estudios no cambia al cambiar la fecha del informe, usa los datos cacheados.
    cargarDiaPreventivoTab(persona, resumenAI); 
    cargarEstudiosTab(cachedEstudiosResults); 
    // cargarOtrosServiciosTab(); // Función pendiente

    // 3. Construir la navegación (Botones)
    const navContenedor = document.getElementById('portal-navegacion');
    navContenedor.innerHTML = `
        <button id="btn-tab-dia-preventivo" class="tab-btn active bg-blue-600 text-white font-bold py-3 px-6 rounded-t-lg transition-colors duration-300">
            <i class="fas fa-heartbeat mr-2"></i> Día Preventivo
        </button>
        <button id="btn-tab-estudios" class="tab-btn text-gray-700 hover:bg-gray-100 font-bold py-3 px-6 rounded-t-lg transition-colors duration-300">
            <i class="fas fa-x-ray mr-2"></i> Estudios Complementarios
        </button>
        <button id="btn-tab-servicios" class="tab-btn text-gray-700 hover:bg-gray-100 font-bold py-3 px-6 rounded-t-lg transition-colors duration-300">
            <i class="fas fa-headset mr-2"></i> Otros Servicios
        </button>
    `;

    // 4. Configurar Listeners y Mostrar la primera pestaña
    document.querySelectorAll('.tab-btn').forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.id.replace('btn-tab-', 'tab-');
            mostrarPestana(targetId);
        });
    });

    mostrarPestana('tab-dia-preventivo'); // Mostrar la pestaña principal por defecto
    window.scrollTo(0, 0);
}


/**
 * Función para manejar el cambio entre pestañas.
 */
function mostrarPestana(tabId) {
    // Ocultar todas las pestañas
    document.querySelectorAll('.tab-pane').forEach(tab => {
        tab.style.display = 'none';
    });

    // Desactivar todos los botones
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-blue-600', 'text-white', 'border-blue-500');
        btn.classList.add('text-gray-700', 'hover:bg-gray-100');
    });

    // Mostrar la pestaña seleccionada
    document.getElementById(tabId).style.display = 'block';

    // Activar el botón correspondiente
    const activeBtn = document.getElementById('btn-' + tabId);
    if (activeBtn) {
        activeBtn.classList.add('active', 'bg-blue-600', 'text-white');
        activeBtn.classList.remove('text-gray-700', 'hover:bg-gray-100');
    }
}

// ==============================================================================
// 4. CONTENIDO DE LAS PESTAÑAS
// ==============================================================================

/**
 * Genera el contenido para la pestaña Día Preventivo (Dashboard Visual + Botones de IA).
 * @param {Object} persona Datos del paciente (el informe seleccionado).
 * @param {string} resumenAI Resumen generado por la IA.
 */
function cargarDiaPreventivoTab(persona, resumenAI) {
    const nombre = persona['apellido y nombre'] || 'Afiliado';
    const dni = persona['DNI'] || 'N/A';
    const fechaInforme = persona['FECHAX'] || 'N/A'; // Obtener la fecha del informe seleccionado
    const dashboardContenedor = document.getElementById('dashboard-contenido');
    const accionesContenedor = document.getElementById('dashboard-acciones');

    // --- MANEJO DE FALLO DE LA IA (ROBUSTEZ) ---
    let resumenAILimpio = resumenAI.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    let summaryContent;

    if (!resumenAI || resumenAI.includes("ERROR CRÍTICO DE GEMINI") || resumenAI.includes("ERROR del servidor")) {
        // Mensaje si la IA falló, pero NO por desactivación
        summaryContent = `
            <div class="p-4 bg-red-100 border-l-4 border-red-500 rounded-lg shadow-sm">
                <strong class="text-red-700">❌ Error en el Resumen de IA:</strong> 
                Hubo un problema al contactar o procesar la respuesta de la Inteligencia Artificial.
                <br>Por favor, revisa el detalle de indicadores a continuación y contacta soporte si el problema persiste.
            </div>
        `;
    } else {
        summaryContent = `<p class="text-base leading-relaxed">${resumenAILimpio}</p>`;
    }
    // ------------------------------------------

    // 0. DROPDOWN DE SELECCIÓN DE FECHA (Si hay múltiples informes)
    let dateSelectorHTML = '';
    if (allReports.length > 1) {
        // Usamos allReports que ya está ordenado
        const dateOptions = allReports.map(report => {
            const date = report.FECHAX;
            // Usamos FECHAX o un ID como valor, ya que es lo que identifica el registro en allReports
            const id = report.ID || date; 
            return { date, id };
        });

        const optionsHtml = dateOptions.map(opt => `
            <option value="${opt.id}" ${opt.date === fechaInforme ? 'selected' : ''}>
                Día Preventivo del ${opt.date} ${opt.date === fechaInforme ? ' (Actual)' : ''}
            </option>
        `).join('');

        // *** BLOQUE MOVIDO PARA SER INSERTADO ANTES DEL DASHBOARD-CONTENIDO ***
        dateSelectorHTML = `
            <div class="mb-6 p-4 bg-yellow-50 border-l-4 border-yellow-500 rounded-lg shadow-md">
                <label for="report-date-selector" class="block text-md font-bold text-yellow-800 mb-2">
                    <i class="fas fa-history mr-2"></i> 
                    Historial de Informes Previos (${allReports.length} encontrados)
                </label>
                <select id="report-date-selector" class="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm rounded-md shadow-inner transition duration-150">
                    ${optionsHtml}
                </select>
            </div>
        `;
    }

    // 1. Construir el HTML del dashboard (Resultado a Resultado)
    let dashboardHTML = `
        <h1 class="text-2xl font-bold mb-6 text-gray-800">
            <i class="fas fa-heartbeat mr-2 text-blue-600"></i> Mis resultados del Día Preventivo
        </h1>
        
        <!-- INSERCIÓN DEL SELECTOR DE FECHA AQUÍ (MOVIDO) -->
        ${dateSelectorHTML}

        <div class="mb-4 p-4 bg-blue-50 border-l-4 border-blue-400 rounded-lg shadow-sm" id="informe-general-container">
            <p class="font-semibold text-blue-700">
                <i class="fas fa-calendar-alt mr-2"></i> Fecha del Informe Activo: 
                <span class="font-bold text-blue-900">${fechaInforme}</span>
            </p>
        </div>
        <div id="informe-imprimible" class="shadow-xl rounded-lg overflow-hidden bg-white p-6">
            <h2 class="text-xl font-semibold mb-3 text-gray-800 border-b pb-2">Tu Resumen de Salud (Generado por IA)</h2>
            <div class="prose max-w-none p-4 bg-gray-50 mb-6 rounded-lg border">
                ${summaryContent}
            </div>

            <h2 class="text-xl font-semibold mb-3 text-gray-800 border-b pb-2">Detalle de Indicadores</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    `;

    // 1.1. Bucle para generar las tarjetas de riesgo
    for (const [key, value] of Object.entries(persona)) {
        // Ignorar campos de identificación/log
        if (['DNI', 'ID', 'apellido y nombre', 'Efector', 'Tipo', 'Marca temporal', 'FECHAX', 'Profesional'].includes(key)) {
            continue; 
        }

        const safeValue = String(value || ''); 
        if (safeValue.trim() === '') continue; // Ignorar campos vacíos

        const risk = getRiskLevel(key, safeValue);

        // Mapeo de colores Tailwind CSS
        const colorMap = {
            red: 'bg-red-100 border-red-500 text-red-700',
            yellow: 'bg-yellow-100 border-yellow-500 text-yellow-700',
            green: 'bg-green-100 border-green-500 text-green-700',
            gray: 'bg-gray-100 border-gray-400 text-gray-600',
        };
        const iconMap = {
            times: 'fas fa-times-circle',
            exclamation: 'fas fa-exclamation-triangle',
            check: 'fas fa-check-circle',
            question: 'fas fa-question-circle',
            info: 'fas fa-info-circle',
        };

        dashboardHTML += `
            <div class="p-4 border-l-4 ${colorMap[risk.color]} rounded-md shadow-sm transition hover:shadow-lg">
                <div class="flex items-center justify-between mb-1">
                    <h3 class="font-bold text-md">${key.toUpperCase()}</h3>
                    <span class="font-semibold text-sm px-2 py-0.5 rounded-full bg-${risk.color}-500 text-white">${risk.text}</span>
                </div>
                <p class="text-sm italic mb-2">Resultado: ${safeValue}</p>
                <div class="text-xs flex items-center mt-2">
                    <i class="${iconMap[risk.icon]} mr-2"></i>
                    ${key.includes('Observaciones') ? safeValue : (risk.text === 'Calma' ? 'Buen estado. ¡A mantener!' : 'Revisar en el informe profesional.')}
                </div>
            </div>
        `;
    }

    dashboardHTML += `
            </div> </div> `;

    // 2. Inyectar el HTML del Dashboard
    dashboardContenedor.innerHTML = dashboardHTML;
    
    // 3. Configurar Listener del Dropdown (SOLO SI EXISTE)
    if (allReports.length > 1) {
        // El listener debe agregarse DESPUÉS de inyectar el HTML en el DOM
        document.getElementById('report-date-selector').addEventListener('change', async (event) => {
            const selectedId = event.target.value;
            // Llamar a la función principal de actualización
            await updateDashboardContent(selectedId); 
        });
    }


    // 4. Contacto Directo del Programa Día Preventivo (Ajustado)
    let accionesHTML = `
        <div class="mt-4 p-4 border border-blue-200 bg-blue-50 rounded-lg shadow-md text-left w-full md:w-3/4 mx-auto mb-6">
            <p class="font-bold text-lg text-blue-800 mb-2"><i class="fas fa-phone-square-alt mr-2"></i> Contacto Directo del Programa Día Preventivo</p>
            <p class="text-gray-700 mb-1">
                <span class="font-semibold">Teléfono Consultas:</span> 
                <a href="tel:3424071702" class="text-blue-600 hover:text-blue-800 font-medium">342 407-1702</a>
            </p>
            <p class="text-gray-700">
                <span class="font-semibold">Mail de Consultas:</span> 
                <a href="mailto:diapreventivoiapos@diapreventivo.com" class="text-blue-600 hover:text-blue-800 font-medium">diapreventivoiapos@diapreventivo.com</a>
            </p>
            <p class="text-xs text-gray-500 mt-2 italic">Si desea mayor precisión sobre los resultados o hablar con un profesional del programa, no dude en conectarse a estos medios.</p>
        </div>

        <div class="flex flex-wrap items-center justify-center py-4">
            <!-- ESTE BOTÓN LLAMA A LA FUNCIÓN mostrarInformeEscrito, QUE USA SweetAlert2 Y window.print() -->
            <button onclick="mostrarInformeEscrito('${nombre.replace(/'/g, "\\'")}', \`${resumenAI.replace(/`/g, "\\`")}\`)" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 mx-2 mt-2">
                <i class="fas fa-file-alt mr-2"></i> Informe Escrito AI (Ver/Imprimir)
            </button>

            <button onclick="compartirDashboard()" class="bg-gray-400 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 mx-2 mt-2">
                <i class="fas fa-share-alt mr-2"></i> Compartir Portal
            </button>
        </div>
    `;

    // 5. Inyectar el HTML de Acciones y Contacto
    accionesContenedor.innerHTML = accionesHTML;
}


/**
 * Actualiza el contenido del dashboard del Día Preventivo al seleccionar
 * una fecha diferente del historial en el dropdown.
 * @param {string} reportId El ID (o FECHAX como fallback) del informe a mostrar.
 */
async function updateDashboardContent(reportId) {
    // Buscar el informe seleccionado en la lista global
    const newReport = allReports.find(r => (r.ID || r.FECHAX) === reportId);

    if (!newReport) {
        Swal.fire('Error', 'No se encontró el informe para la fecha seleccionada.', 'error');
        return;
    }

    Swal.fire({
        title: 'Cargando informe anterior...',
        text: `Recuperando datos del ${newReport.FECHAX} y re-generando análisis de IA.`,
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    try {
        // 1. Generar nuevo resumen de IA para el informe seleccionado
        const resumenAI = await obtenerResumenAI(newReport);
        
        // 2. Actualizar el contenido de la pestaña Día Preventivo con el nuevo informe
        cargarDiaPreventivoTab(newReport, resumenAI);
        
        // 3. Asegurar que la pestaña activa sea la del Día Preventivo
        mostrarPestana('tab-dia-preventivo'); 
        
        Swal.close();
        window.scrollTo(0, 0); // Mover al inicio para ver el cambio

    } catch (error) {
        console.error('Error al actualizar el informe histórico:', error);
        Swal.fire('Error', 'Hubo un problema al cargar el informe histórico.', 'error');
    }
}


/**
 * Genera el contenido estático/dinámico de la pestaña Estudios Complementarios.
 * @param {Object} estudiosResults Objeto con los resultados de estudios específicos.
 */
function cargarEstudiosTab(estudiosResults) {
    const contenedor = document.getElementById('estudios-complementarios-lista');

    // Definición maestra de todos los estudios
    const estudiosMaestros = [
        { nombre: 'Laboratorio Bioquímico', icon: 'fas fa-flask', key: 'laboratorio' },
        { nombre: 'Mamografía', icon: 'fas fa-x-ray', key: 'mamografia' },
        { nombre: 'Ecografía', icon: 'fas fa-ultrasound', key: 'ecografia' },
        { nombre: 'Espirometría', icon: 'fas fa-lungs', key: 'espirometria' },
        { nombre: 'Enfermería', icon: 'fas fa-user-nurse', key: 'enfermeria' },
        { nombre: 'Densitometría', icon: 'fas fa-bone', key: 'densitometria' },
        { nombre: 'Videocolonoscopia (VCC)', icon: 'fas fa-camera', key: 'vcc' },
        { nombre: 'Eco mamaria', icon: 'fas fa-ultrasound', key: 'ecomamaria' },
        { nombre: 'Odontología', icon: 'fas fa-tooth', key: 'odontologia' }, 
        { nombre: 'Biopsia', icon: 'fas fa-microscope', key: 'biopsia' }, 
        { nombre: 'Oftalmología', icon: 'fas fa-eye', key: 'oftalmologia' },
        { nombre: 'Otros Resultados', icon: 'fas fa-file-medical', key: 'otros' },
    ];

    let html = '';
        // **LÓGICA DE PROCESAMIENTO MULTIPLE**
    estudiosMaestros.forEach(estudio => {
        // Busca el resultado en el objeto que pasamos (estudiosResults) usando la clave ('laboratorio', 'mamografia', etc.)
        const result = estudiosResults[estudio.key];

        // 1. Determinar si hay un link disponible
        const isAvailable = result && result.link;
        const link = isAvailable ? result.link : 'javascript:void(0)';
        
        // --- CAMBIO CLAVE: Determinar el texto de estado y la fecha ---
        // 1.1. lastResultDate es null si no hay fecha, como lo definiste
        const lastResultDate = result && result.fechaResultado ? result.fechaResultado : null;

        // 1.2. Generar el subtítulo que se mostrará. Si hay fecha, muestra el texto completo; si no, solo PENDIENTE
        const subtitleHtml = lastResultDate
            ? `<p class="text-xs text-gray-500 mt-1">Última fecha de estudio: <span class="font-medium ${isAvailable ? 'text-green-700' : 'text-gray-500'}">${lastResultDate}</span></p>`
            : `<p class="text-xs text-gray-500 mt-1"></p>`;
        
        // La variable statusText no se utiliza en la plantilla final, así que la removemos para limpieza
        // const statusText = isAvailable ? `<span class="font-bold">VER RESULTADO</span> (último: ${lastResultDate})` : 'PENDIENTE o Sin Resultados Cargados';
        // -----------------------------------------------------------

        // 2. Clases dinámicas: verde si disponible, morado por defecto si pendiente
        const linkClasses = isAvailable 
            ? 'border-green-500 hover:border-green-700 bg-green-50 hover:bg-green-100'
            : 'border-purple-500 opacity-70 cursor-default';
        const iconClasses = isAvailable ? 'text-green-600' : 'text-purple-600';

        // 3. Manejador de click: Si no está disponible, muestra el error de la búsqueda o un mensaje genérico
        const defaultErrorMessage = 'Este estudio no tiene resultados cargados todavía.';
        const errorMessage = result && result.error ? `Error en la búsqueda: ${result.error}` : defaultErrorMessage;

        const onClickHandler = isAvailable 
            ? '' 
            : `onclick="Swal.fire('Aún No Disponible', '${errorMessage.replace(/'/g, "\\'")}', 'info')"`;

        html += `
            <a href="${link}" ${isAvailable ? 'target="_blank" rel="noopener noreferrer"' : ''} ${onClickHandler}
                class="flex items-center p-4 bg-white rounded-lg shadow hover:shadow-md transition duration-200 border-l-4 ${linkClasses}">
                <i class="${estudio.icon} ${iconClasses} text-2xl mr-4"></i>
                <div class="flex-grow">
                    <span class="font-semibold text-lg text-gray-800">${estudio.nombre}</span>
                    <!-- CORRECCIÓN: Usar la variable subtitleHtml calculada -->
                    ${subtitleHtml} 
                </div>
                <span class="ml-auto text-sm font-medium text-right ${isAvailable ? 'text-green-600 font-bold' : 'text-gray-400'}">
                    ${isAvailable ? 'VER RESULTADO' : 'PENDIENTE'}
                </span>
                <i class="fas fa-chevron-right ml-2 text-gray-400"></i>
            </a>
        `;
    });

    contenedor.innerHTML = html;
}
// ==============================================================================
// 5. FUNCIONES DE UTILIDAD (PDF, IMPRIMIR, COMPARTIR, MODAL AI)
// ==============================================================================

/**
 * Función que abre el informe escrito AI en un modal, separada para limpieza, 
 * con opción directa de imprimir el contenido del modal.
 */
function mostrarInformeEscrito(nombre, resumenAI) {
    // Nota del programa Día Preventivo
    const contactoHtml = `
        <p class="mt-6 text-sm text-gray-700 border-t pt-4 italic">
            Si desea mayor precisión sobre los resultados o hablar con un profesional del programa, no dude en conectarse a estos medios.
        </p>
        <div class="mt-2 text-sm">
            <p><span class="font-semibold">Teléfono:</span> 342 407-1702</p>
            <p><span class="font-semibold">Mail:</span> diapreventivoiapos@diapreventivo.com</p>
        </div>
    `;

    // Contenido del modal que se desea imprimir
    const printableContent = `
        <div class="p-6">
            <h1 class="text-2xl font-bold mb-4 text-blue-800 border-b pb-2">Informe de Salud Generado por IA</h1>
            <p class="mb-4 text-lg font-semibold">Paciente: ${nombre}</p>
            <div class="prose max-w-none p-4 bg-gray-50 rounded-lg border leading-relaxed">
                ${resumenAI.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}
            </div>
            ${contactoHtml}
        </div>
    `;

    // Mostrar el modal
    Swal.fire({
        title: 'Informe Escrito de la Inteligencia Artificial',
        html: `
            <div id="modal-informe-ai" class="text-left">${printableContent}</div>
        `,
        width: '80%',
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-print"></i> Imprimir Informe',
        cancelButtonText: 'Cerrar',
        customClass: {
            container: 'z-50', // Asegura que esté por encima de otros elementos
            popup: 'shadow-2xl'
        },
        focusConfirm: false,
        preConfirm: () => {
            // Acción de Imprimir
            imprimirContenido('modal-informe-ai', `Informe AI - ${nombre}`);
            return false; // Evita que el modal se cierre automáticamente después de la acción
        }
    });
}


/**
 * Inicia la impresión de un elemento específico.
 * Crea una ventana de impresión con el HTML de un elemento dado.
 * @param {string} elementId ID del elemento a imprimir.
 * @param {string} title Título para la ventana de impresión.
 */
function imprimirContenido(elementId, title) {
    const printContent = document.getElementById(elementId).innerHTML;
    // const originalContent = document.body.innerHTML; // No usado, solo para referencia

    // Crear contenido de impresión con estilos básicos para el informe
    const printWindow = window.open('', '_blank', 'height=600,width=800');
    printWindow.document.write('<html><head><title>' + title + '</title>');
    // Incluir Tailwind CDN para mantener los estilos básicos de las clases
    printWindow.document.write('<script src="https://cdn.tailwindcss.com"></script>');
    // Incluir Font Awesome
    printWindow.document.write('<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.3/css/all.min.css">');
    printWindow.document.write('</head><body class="p-10">');
    printWindow.document.write('<div class="prose max-w-none">' + printContent + '</div>');
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    
    // Esperar un momento para que Tailwind se cargue y aplique los estilos antes de imprimir
    setTimeout(() => {
        printWindow.focus();
        printWindow.print();
        // No cerramos la ventana automáticamente; el usuario puede hacerlo.
        // printWindow.close();
    }, 500); // 500ms de espera
}

/**
 * Función genérica para compartir el dashboard.
 */
function compartirDashboard() {
    // Idealmente, se usaría la API Navigator.share, pero requiere HTTPS y es para apps nativas.
    // Usamos un modal informativo de cómo compartir.
    Swal.fire({
        title: 'Compartir Portal de Salud',
        html: `
            <p class="text-gray-700 mb-4">Para compartir tu informe con un profesional, puedes copiar y enviar el enlace de esta página o utilizar la función de impresión para generar un PDF.</p>
            <div class="flex flex-col space-y-3">
                <button onclick="copyCurrentUrl()" class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg transition duration-200">
                    <i class="fas fa-link mr-2"></i> Copiar Enlace del Portal
                </button>
                <button onclick="Swal.close(); mostrarInformeEscrito('${document.querySelector('#portal-salud-container h1')?.textContent || 'Afiliado'}', \`${document.querySelector('.prose')?.innerHTML || 'No disponible'}\`)" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition duration-200">
                    <i class="fas fa-file-pdf mr-2"></i> Generar PDF (a través de Imprimir)
                </button>
            </div>
        `,
        showConfirmButton: false,
        showCloseButton: true,
        customClass: {
            container: 'z-50'
        }
    });
}

/**
 * Copia la URL actual al portapapeles.
 */
function copyCurrentUrl() {
    // Usar execCommand ya que navigator.clipboard puede fallar en entornos iframe
    const el = document.createElement('textarea');
    el.value = window.location.href;
    document.body.appendChild(el);
    el.select();
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            Swal.fire({
                icon: 'success',
                title: '¡Enlace Copiado!',
                text: 'El enlace de esta página se ha copiado a tu portapapeles.',
                showConfirmButton: false,
                timer: 1500
            });
        } else {
            throw new Error('Fallback copy failed.');
        }
    } catch (err) {
        Swal.fire({
            icon: 'error',
            title: 'Error al Copiar',
            text: 'Por favor, copia la URL manualmente: ' + window.location.href,
            showConfirmButton: true
        });
    } finally {
        document.body.removeChild(el);
    }
}