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
 * 6. Limpieza quirúrgica de indicadores técnicos (RAWDATE) en el Dashboard.
 * 7. FILTRO DE SEXO: Oculta estudios femeninos si el paciente es Masculino.
 */

// --- Variables Globales ---
const ESTUDIOS_API_URL = window.ESTUDIOS_API_URL || 'http://localhost:4000';
const API_BASE_PATH = '/api';

let allReports = [];
let cachedEstudiosResults = {};

// 1. CONFIGURACIÓN INICIAL (DOMContentLoaded)
// ==============================================================================
document.addEventListener('DOMContentLoaded', () => {
    const btnVerPortal = document.getElementById('btn-ver-portal');

    if (btnVerPortal) {
        btnVerPortal.addEventListener('click', async () => {
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

                    let reports = dataResult.reports;

                    if (!reports || reports.length === 0) {
                        if (dataResult.persona) {
                            reports = [dataResult.persona];
                        } else {
                            Swal.fire('No Encontrado', 'No se encontraron resultados para el DNI ingresado.', 'error');
                            return;
                        }
                    }

                    const sortedReports = [...reports].sort((a, b) => {
                        const parseDate = (dateStr) => {
                            const parts = dateStr.split('/');
                            return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                        };

                        const dateA = parseDate(a.FECHAX || "01/01/1970");
                        const dateB = parseDate(b.FECHAX || "01/01/1970");
                        return dateB - dateA;
                    });

                    const selectedReport = sortedReports[0];

                    allReports = sortedReports;
                    
                    const personaData = selectedReport;
                    const dniToSearch = personaData.DNI;

                    const [
                        resumenAI,
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
                        obtenerResumenAI(personaData),
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
                    
                    cachedEstudiosResults = estudiosResults;

                    cargarPortalPersonal(personaData, resumenAI);

                    Swal.close();

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

async function obtenerLinkEstudios(dni, studyType) {
    const studyApiUrl = `${ESTUDIOS_API_URL}/api/buscar-estudios?dni=${dni}&tipo=${studyType}`;

    try {
        const response = await fetch(studyApiUrl);
        const data = await response.json();

        if (response.status === 404) {
            return { link: null, error: data.error, tipo: studyType, fechaResultado: null };
        }

        if (response.ok) {
            return { 
                link: data.link || null, 
                datos: data.datos || null, 
                tipo: studyType, 
                mensaje: data.mensaje,
                fechaResultado: data.fechaResultado || (data.datos ? data.datos.fecha : null) || null 
            };
        } else {
            const errorMessage = data.error || `Error del microservicio (${response.status})`;
            throw new Error(errorMessage);
        }
    } catch (error) {
        console.error(`Fallo al buscar estudios complementarios (${studyType}):`, error);
        return { 
            link: null, 
            error: `Servicio no disponible para ${studyType}.`,
            tipo: studyType,
            fechaResultado: null
        };
    }
}
function getRiskLevel(key, value, edad, sexo) {
    const v = String(value || '').toLowerCase().trim();
    // Normalizamos clave: mayúsculas y sin tildes
    const k = key.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
    
    // Detectamos si el valor indica que NO se realizó la práctica de forma robusta
    // Agregamos "no indicado" y validamos que no sea vacío
    const noRealizado = v.includes('no se realiza') || v.includes('no realizado') || v === 'no' || v.includes('no corresponde') || v === '' || v.includes('no indicado');

    // --- DATOS PERSONALES (VIOLETA) ---
    if (k === 'EDAD' || k === 'SEXO') {
        return { color: 'violet', icon: 'info', text: 'Dato Personal', customMsg: 'Información registrada en el sistema.' };
    }

    // ==============================================================================
    // 1. REGLAS CLÍNICAS ESPECÍFICAS
    // ==============================================================================

    // --- OSTEOPOROSIS ---
    if (k.includes('OSTEOPOROSIS') || k.includes('DENSITOMETRIA') || k.includes('OSEA') || k.includes('DMO')) {
        if (noRealizado) {
            if ((sexo === 'femenino' && edad >= 64) || (sexo === 'masculino' && edad >= 70)) {
                return { color: 'red', icon: 'exclamation', text: 'Pendiente', customMsg: 'Por tu edad, este estudio es fundamental para prevenir fracturas. ¡Consúltalo!' };
            } else {
                return { color: 'gray', icon: 'info', text: 'No Corresponde', customMsg: 'Este estudio se realiza para prevenir osteoporosis en mujeres mayores de 64 años y hombres mayores de 70.' };
            }
        }
    }

    // --- ANEURISMA ---
    if (k.includes('ANEURISMA') || k.includes('AORTA')) {
        if (noRealizado) {
            if (sexo === 'masculino' && edad >= 75) {
                return { color: 'red', icon: 'exclamation', text: 'Atención', customMsg: 'Indicado en varones mayores de 75 (especialmente fumadores). Por tu edad sugerimos consultarlo.' };
            } else {
                return { color: 'gray', icon: 'info', text: 'No Corresponde', customMsg: 'Indicado solo en varones mayores de 75 años fumadores o ex fumadores.' };
            }
        }
    }

    // --- EPOC ---
    if (k.includes('EPOC') || k.includes('ESPIROMETRIA')) {
        if (noRealizado) {
            return { color: 'gray', icon: 'info', text: 'Condicional', customMsg: 'Este estudio se realiza solo en fumadores para detectar EPOC.' };
        }
    }

    // --- ASPIRINA ---
    if (k.includes('ASPIRINA')) {
        if (noRealizado) {
            return { color: 'gray', icon: 'info', text: 'Informativo', customMsg: 'Se indica en personas con riesgo cardiovascular alto. Si no es su caso, debe quedarse tranquilo/a.' };
        }
    }

    // --- CÁNCER DE MAMA ---
    if (k.includes('MAMOGRAFIA') || k.includes('MAMOGRAFÍA') || k.includes('ECO MAMARIA')) {
         if (noRealizado) {
            if (edad >= 40) {
                 return { color: 'red', icon: 'exclamation', text: 'Pendiente', customMsg: 'Se realiza a partir de los 40 años para la detección temprana.' };
            } else {
                 return { color: 'gray', icon: 'info', text: 'A futuro', customMsg: 'Se realiza a partir de los 40 años.' };
            }
         }
    }

    // --- SOMF / COLON ---
    if (k.includes('SOMF') || k.includes('SANGRE OCULTA') || k.includes('COLON')) {
        if (noRealizado) {
            if (edad >= 50) {
                return { color: 'red', icon: 'exclamation', text: 'Pendiente', customMsg: 'Se realiza a partir de los 50 años para la detección temprana del cáncer de colon.' };
            } else {
                return { color: 'gray', icon: 'info', text: 'A futuro', customMsg: 'Se realiza a partir de los 50 años.' };
            }
        }
    }

    // --- PAP / HPV ---
    if (k.includes('PAP') || k.includes('PAPA')) {
        if (noRealizado) {
            if (edad > 21) {
                return { color: 'red', icon: 'exclamation', text: 'Pendiente', customMsg: 'Se realiza en mujeres mayores de 21 años.' };
            } else {
                return { color: 'gray', icon: 'info', text: 'No Corresponde', customMsg: 'Se realiza en mujeres mayores de 21 años.' };
            }
        }
    }
    if (k.includes('HPV') || k.includes('VPH')) {
        if (noRealizado) {
            if (edad > 30) {
                return { color: 'red', icon: 'exclamation', text: 'Pendiente', customMsg: 'Se indica en mujeres mayores de 30 años.' };
            } else {
                return { color: 'gray', icon: 'info', text: 'No Corresponde', customMsg: 'Se indica en mujeres mayores de 30 años.' };
            }
        }
    }

    // --- ÁCIDO FÓLICO ---
    if (k.includes('ACIDO FOLICO') || k.includes('FOLICO')) {
        if (noRealizado) {
            return { color: 'gray', icon: 'info', text: 'Informativo', customMsg: 'Indicado en mujeres que planean embarazo en los próximos meses.' };
        }
    }

    // ==============================================================================
    // 2. LÓGICA GENERAL DE COLORES
    // ==============================================================================

    if (['PROFESIONAL', 'FECHAX', 'DNI', 'MARCA TEMPORAL'].includes(k)) {
        return { color: 'gray', icon: 'info', text: 'Informativo' };
    }

    // --- VERDE (CORREGIDO PARA INCLUIR "SI/SÍ/BUENA") ---
    if (v === 'si' || v === 'sí' || v === 'buena' ||
        v.includes('no presenta') || v.includes('normal') || v.includes('adecuada') || 
        v.includes('no abusa') || v.includes('no se verifica') || v.includes('no fuma') || 
        v.includes('cumple') || v.includes('bajo') || 
        (v.includes('realiza') && !v.includes('no')) || 
        v.includes('completo') || v.includes('negativo') || v.includes('riesgo bajo')) {
        return { color: 'green', icon: 'check', text: 'Calma' };
    }

    // --- ROJO ---
    if (v.includes('sí presenta') || v.includes('presenta') || v.includes('elevado') || 
        v.includes('anormal') || v.includes('alto') || v.includes('no control') || 
        v.includes('no realiza') || v.includes('pendiente') || v.includes('riesgo alto') || 
        v.includes('positivo') || v.includes('incompleto') || v.includes('obesidad') || 
        v.includes('hipertensión')) {
        return { color: 'red', icon: 'times', text: 'Alerta' };
    }

    // --- AMARILLO ---
    if (k.includes('IMC') && (v.includes('sobrepeso') || v.includes('bajo peso'))) {
        return { color: 'yellow', icon: 'exclamation', text: 'Atención' };
    }
    if (v.includes('mejorar') || v.includes('moderar') || v.includes('a vigilar') || 
        v.includes('límite') || v.includes('riesgo moderado')) {
        return { color: 'yellow', icon: 'exclamation', text: 'Atención' };
    }

    return { color: 'gray', icon: 'question', text: 'Sin Dato' };
}
// ==============================================================================
// 3. FUNCIONES DEL PORTAL PERSONAL DE SALUD (Dashboard y Pestañas)
// ==============================================================================

function cargarPortalPersonal(persona, resumenAI) {
    document.getElementById('vista-inicial').style.display = 'none';
    document.getElementById('portal-salud-container').style.display = 'block';

    // Guardamos el sexo en una variable global para acceso rápido en las pestañas
    window.pacienteSexo = String(persona['Sexo'] || persona['sexo'] || '').toLowerCase().trim();

    cargarDiaPreventivoTab(persona, resumenAI); 
    cargarEstudiosTab(cachedEstudiosResults); 

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

    document.querySelectorAll('.tab-btn').forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.id.replace('btn-tab-', 'tab-');
            mostrarPestana(targetId);
        });
    });

    mostrarPestana('tab-dia-preventivo');
    window.scrollTo(0, 0);
}


function mostrarPestana(tabId) {
    document.querySelectorAll('.tab-pane').forEach(tab => {
        tab.style.display = 'none';
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-blue-600', 'text-white', 'border-blue-500');
        btn.classList.add('text-gray-700', 'hover:bg-gray-100');
    });

    document.getElementById(tabId).style.display = 'block';

    const activeBtn = document.getElementById('btn-' + tabId);
    if (activeBtn) {
        activeBtn.classList.add('active', 'bg-blue-600', 'text-white');
        activeBtn.classList.remove('text-gray-700', 'hover:bg-gray-100');
    }
}

// ==============================================================================
// 4. CONTENIDO DE LAS PESTAÑAS
// ==============================================================================
function cargarDiaPreventivoTab(persona, resumenAI) {
    const nombre = persona['apellido y nombre'] || 'Afiliado';
    const dni = persona['DNI'] || 'N/A';
    const fechaInforme = persona['FECHAX'] || 'N/A';
    
    // --- NUEVO: OBTENCIÓN DE EDAD SEGURA ---
    // Buscamos la clave 'Edad' (o 'edad') y la convertimos a número
    const keyEdad = Object.keys(persona).find(k => k.toLowerCase() === 'edad');
    let edadPaciente = 0;
    if (keyEdad && persona[keyEdad]) {
        // Extraemos solo los números por si dice "25 años"
        const edadMatch = String(persona[keyEdad]).match(/\d+/);
        edadPaciente = edadMatch ? parseInt(edadMatch[0]) : 0;
    }
    
    const sexo = String(window.pacienteSexo || '').toLowerCase().trim(); 
    const dashboardContenedor = document.getElementById('dashboard-contenido');
    const accionesContenedor = document.getElementById('dashboard-acciones');

    let resumenAILimpio = resumenAI.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    let summaryContent;

    if (!resumenAI || resumenAI.includes("ERROR CRÍTICO DE GEMINI") || resumenAI.includes("ERROR del servidor")) {
        summaryContent = `
            <div class="p-4 bg-red-100 border-l-4 border-red-500 rounded-lg shadow-sm">
                <strong class="text-red-700">❌ Error en el Resumen de IA:</strong> 
                Hubo un problema al contactar o procesar la respuesta de la Inteligencia Artificial.
            </div>
        `;
    } else {
        summaryContent = `<p class="text-base leading-relaxed">${resumenAILimpio}</p>`;
    }

    // (Aquí va el código del selector de fecha igual que antes... lo abrevio para no ocupar tanto espacio, asume que está aquí)
    let dateSelectorHTML = ''; 
    if (allReports.length > 1) { /* ... Código del selector de fechas ... */ }

    // (Encabezado del HTML igual que antes)
    let dashboardHTML = `
        <h1 class="text-2xl font-bold mb-6 text-gray-800">
            <i class="fas fa-heartbeat mr-2 text-blue-600"></i> Mis resultados del Día Preventivo
        </h1>
        ${dateSelectorHTML || ''}
        <div class="mb-4 p-4 bg-blue-50 border-l-4 border-blue-400 rounded-lg shadow-sm">
            <p class="font-semibold text-blue-700">
                <i class="fas fa-calendar-alt mr-2"></i> Fecha del Informe Activo: 
                <span class="font-bold text-blue-900">${fechaInforme}</span>
                ${edadPaciente > 0 ? `<span class="ml-4 text-sm text-gray-600">(Edad registrada: ${edadPaciente} años)</span>` : ''}
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

    // --- BUCLE DE INDICADORES ---
    for (const [key, value] of Object.entries(persona)) {
        if (['DNI', 'ID', 'apellido y nombre', 'Efector', 'Tipo', 'Marca temporal', 'FECHAX', 'Profesional', 'Edad', 'Sexo'].includes(key)) {
            continue;
        }

        const safeValue = String(value || '');
        const keyUpper = key.toUpperCase();
        const isRawDate = keyUpper === 'RAWDATE' || safeValue.includes('RAWDATE');
        const isIsoDate = safeValue.includes('T') && safeValue.includes('Z') && safeValue.length > 15;

        if (isRawDate || isIsoDate || safeValue.trim() === '') {
            continue;
        }

        // --- FILTRO SEXO (Ya lo tenías, lo mantenemos) ---
        const keyNormalized = keyUpper.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const terminosFemeninos = ['MAMOGRAFIA', 'ECO_MAMARIA', 'ECO MAMARIA', 'HPV', 'PAP', 'ACIDO FOLICO', 'UTERINO'];
        const terminosMasculinos = ['PROSTATA', 'PSA'];

        if (sexo === 'masculino' && terminosFemeninos.some(t => keyNormalized.includes(t))) continue;
        if ((sexo === 'femenino' || sexo === 'mujer') && terminosMasculinos.some(t => keyNormalized.includes(t))) continue;

        // --- 🚀 LLAMADA A LA LÓGICA INTELIGENTE (Pasamos edad y sexo) ---
        const risk = getRiskLevel(key, safeValue, edadPaciente, sexo);

        const colorMap = {
            red: 'bg-red-100 border-red-500 text-red-700',
            yellow: 'bg-yellow-100 border-yellow-500 text-yellow-700',
            green: 'bg-green-100 border-green-500 text-green-700',
            gray: 'bg-gray-100 border-gray-400 text-gray-600',
            violet: 'bg-purple-100 border-purple-500 text-purple-700'
        };
        const iconMap = {
            times: 'fas fa-times-circle',
            exclamation: 'fas fa-exclamation-triangle',
            check: 'fas fa-check-circle',
            question: 'fas fa-question-circle',
            info: 'fas fa-info-circle',
        };

        // Definimos el mensaje final: Si getRiskLevel nos dio un 'customMsg', usamos ese. Si no, usamos el genérico.
        const mensajeFinal = risk.customMsg 
            ? risk.customMsg 
            : (key.includes('Observaciones') ? safeValue : (risk.text === 'Calma' ? 'Buen estado. ¡A mantener!' : 'Revisar en el informe profesional.'));

        dashboardHTML += `
            <div class="p-4 border-l-4 ${colorMap[risk.color]} rounded-md shadow-sm transition hover:shadow-lg">
                <div class="flex items-center justify-between mb-1">
                    <h3 class="font-bold text-md">${key}</h3> <span class="font-semibold text-sm px-2 py-0.5 rounded-full bg-white border border-gray-200 shadow-sm text-gray-700 whitespace-nowrap ml-2">
                        ${risk.text}
                    </span>
                </div>
                <p class="text-sm italic mb-2 text-gray-800 mt-2">${safeValue}</p>
                <div class="text-xs flex items-center mt-3 border-t pt-2 border-${risk.color}-200 opacity-90 font-medium">
                    <i class="${iconMap[risk.icon]} mr-2"></i>
                    ${mensajeFinal}
                </div>
            </div>
        `;
    }

    dashboardHTML += `</div> </div>`;
    dashboardContenedor.innerHTML = dashboardHTML;

    if (allReports.length > 1) {
        document.getElementById('report-date-selector').addEventListener('change', async (event) => {
            const selectedId = event.target.value;
            await updateDashboardContent(selectedId);
        });
    }

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
            <button onclick="mostrarInformeEscrito('${nombre.replace(/'/g, "\\'")}', \`${resumenAI.replace(/`/g, "\\`")}\`)" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 mx-2 mt-2">
                <i class="fas fa-file-alt mr-2"></i> Informe Escrito AI (Ver/Imprimir)
            </button>

            <button onclick="compartirDashboard()" class="bg-gray-400 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 mx-2 mt-2">
                <i class="fas fa-share-alt mr-2"></i> Compartir Portal
            </button>
        </div>
    `;

    accionesContenedor.innerHTML = accionesHTML;
}
function cargarEstudiosTab(estudiosResults) {
    const contenedor = document.getElementById('estudios-complementarios-lista');
    if (!contenedor) return;
    
    const sexo = window.pacienteSexo;
    const estudiosConfig = [
        { nombre: 'Laboratorio', key: 'laboratorio' },
        { nombre: 'Mamografía', key: 'mamografia', femenino: true },
        { nombre: 'Ecografía', key: 'ecografia' },
        { nombre: 'Eco Mamaria', key: 'ecomamaria', femenino: true },
        { nombre: 'Espirometría', key: 'espirometria' },
        { nombre: 'Densitometría', key: 'densitometria' },
        { nombre: 'VCC', key: 'vcc' }
    ];

    let html = '';
    estudiosConfig.forEach(e => {
        // FILTRO QUIRÚRGICO EN PESTAÑA ESTUDIOS
        if (sexo === 'masculino' && e.femenino) return;

        const res = estudiosResults[e.key];
        const link = res && res.link;
        const fecha = res && res.fechaResultado ? ` (${res.fechaResultado})` : '';
        
        html += `
            <div class="flex justify-between items-center p-4 border-b hover:bg-gray-50">
                <span class="font-semibold text-gray-700">${e.nombre}${fecha}</span>
                ${link ? `<a href="${link}" target="_blank" class="bg-blue-600 text-white px-4 py-1 rounded shadow">VER</a>` : `<span class="text-gray-400 italic">Pendiente</span>`}
            </div>
        `;
    });
    contenedor.innerHTML = html;
}

async function updateDashboardContent(reportId) {
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
        const resumenAI = await obtenerResumenAI(newReport);
        cargarDiaPreventivoTab(newReport, resumenAI);
        mostrarPestana('tab-dia-preventivo'); 
        Swal.close();
        window.scrollTo(0, 0);

    } catch (error) {
        console.error('Error al actualizar el informe histórico:', error);
        Swal.fire('Error', 'Hubo un problema al cargar el informe histórico.', 'error');
    }
}

function cargarEstudiosTab(estudiosResults) {
    const contenedor = document.getElementById('estudios-complementarios-lista');
    if (!contenedor) return;

    const sexo = window.pacienteSexo;

    const estudiosMaestros = [
        { nombre: 'Laboratorio Bioquímico', icon: 'fas fa-flask', key: 'laboratorio' },
        { nombre: 'Mamografía', icon: 'fas fa-x-ray', key: 'mamografia', soloMujeres: true },
        { nombre: 'Ecografía', icon: 'fas fa-ultrasound', key: 'ecografia' },
        { nombre: 'Espirometría', icon: 'fas fa-lungs', key: 'espirometria' },
        { nombre: 'Enfermería', icon: 'fas fa-user-nurse', key: 'enfermeria' },
        { nombre: 'Densitometría', icon: 'fas fa-bone', key: 'densitometria' },
        { nombre: 'Videocolonoscopia (VCC)', icon: 'fas fa-camera', key: 'vcc' },
        { nombre: 'Eco mamaria', icon: 'fas fa-ultrasound', key: 'ecomamaria', soloMujeres: true },
        { nombre: 'Odontología', icon: 'fas fa-tooth', key: 'odontologia' }, 
        { nombre: 'Biopsia', icon: 'fas fa-microscope', key: 'biopsia' }, 
        { nombre: 'Oftalmología', icon: 'fas fa-eye', key: 'oftalmologia' },
        { nombre: 'Otros Resultados', icon: 'fas fa-file-medical', key: 'otros' },
    ];

    let html = '';
    window._cachedEnfermeriaData = null;

    estudiosMaestros.forEach(estudio => {
        // FILTRO QUIRÚRGICO DE SEXO
        if (sexo === 'masculino' && estudio.soloMujeres) {
            return; // No renderiza la tarjeta si es masculino y el estudio es femenino
        }

        const result = estudiosResults[estudio.key];
        const isAvailable = result && (result.link || result.datos);
        
        let clickAction = '';
        
        if (isAvailable) {
            if (estudio.key === 'enfermeria') {
                window._cachedEnfermeriaData = result.datos;
                clickAction = `onclick="abrirModalEnfermeria(window._cachedEnfermeriaData); return false;"`;
            } else {
                clickAction = `onclick="window.open('${result.link}', '_blank')"`;
            }
        }

        const lastResultDate = result && result.fechaResultado ? result.fechaResultado : null;

        const subtitleHtml = lastResultDate
            ? `<p class="text-xs text-gray-500 mt-1">Última fecha de estudio: <span class="font-medium text-green-700">${lastResultDate}</span></p>`
            : `<p class="text-xs text-gray-500 mt-1"></p>`;

        const linkClasses = isAvailable 
            ? 'border-green-500 hover:border-green-700 bg-green-50 hover:bg-green-100 cursor-pointer'
            : 'border-purple-500 opacity-70 cursor-default';
        
        const iconClasses = isAvailable ? 'text-green-600' : 'text-purple-600';

        const onClickHandler = isAvailable 
            ? clickAction 
            : `onclick="Swal.fire('Aún No Disponible', 'Este estudio no tiene resultados cargados todavía.', 'info')"`;

        html += `
            <div ${onClickHandler}
                class="flex items-center p-4 bg-white rounded-lg shadow hover:shadow-md transition duration-200 border-l-4 ${linkClasses}">
                <i class="${estudio.icon} ${iconClasses} text-2xl mr-4"></i>
                <div class="flex-grow">
                    <span class="font-semibold text-lg text-gray-800">${estudio.nombre}</span>
                    ${subtitleHtml} 
                </div>
                <span class="ml-auto text-sm font-medium text-right ${isAvailable ? 'text-green-600 font-bold' : 'text-gray-400'}">
                    ${isAvailable ? 'VER RESULTADO' : 'PENDIENTE'}
                </span>
                <i class="fas fa-chevron-right ml-2 text-gray-400"></i>
            </div>
        `;
    });
    contenedor.innerHTML = html;
}

// ==============================================================================
// 5. FUNCIONES DE UTILIDAD (PDF, IMPRIMIR, COMPARTIR, MODAL AI)
// ==============================================================================

function mostrarInformeEscrito(nombre, resumenAI) {
    const contactoHtml = `
        <p class="mt-6 text-sm text-gray-700 border-t pt-4 italic">
            Si desea mayor precisión sobre los resultados o hablar con un profesional del programa, no dude en conectarse a estos medios.
        </p>
        <div class="mt-2 text-sm">
            <p><span class="font-semibold">Teléfono:</span> 342 407-1702</p>
            <p><span class="font-semibold">Mail:</span> diapreventivoiapos@diapreventivo.com</p>
        </div>
    `;

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
            container: 'z-50',
            popup: 'shadow-2xl'
        },
        focusConfirm: false,
        preConfirm: () => {
            imprimirContenido('modal-informe-ai', `Informe AI - ${nombre}`);
            return false;
        }
    });
}

function imprimirContenido(elementId, title) {
    const printContent = document.getElementById(elementId).innerHTML;
    const printWindow = window.open('', '_blank', 'height=600,width=800');
    printWindow.document.write('<html><head><title>' + title + '</title>');
    printWindow.document.write('<script src="https://cdn.tailwindcss.com"></script>');
    printWindow.document.write('<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.3/css/all.min.css">');
    printWindow.document.write('</head><body class="p-10">');
    printWindow.document.write('<div class="prose max-w-none">' + printContent + '</div>');
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    
    setTimeout(() => {
        printWindow.focus();
        printWindow.print();
    }, 500);
}

async function testConexionEnfermeria(dni) {
    console.log("🔍 Probando conexión para DNI:", dni);
    try {
        const response = await fetch('/api/buscar-enfermeria', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dni: dni })
        });

        const result = await response.json();

        if (response.ok) {
            console.log("⭐ ¡ÉXITO! Respuesta del servidor:");
            console.table(result.raw); 
            console.log("DNI en tabla:", result.dni_detectado);
            console.log("Nombre en tabla:", result.nombre_detectado);
            alert(`Conexión OK: Detectado ${result.nombre_detectado}`);
        } else {
            console.error("❌ Error en la respuesta:", result.error);
        }
    } catch (err) {
        console.error("❌ Error de red:", err);
    }
}

function abrirModalEnfermeria(datosRaw) {
    if (!datosRaw) {
        console.error("Error: No se proporcionaron datos para el modal.");
        return;
    }

    const d = datosRaw.datos ? datosRaw.datos : datosRaw;
    const oldModal = document.getElementById('modal-enfermeria-v3');
    if (oldModal) oldModal.remove();

    const modalHTML = `
    <div id="modal-enfermeria-v3" style="position: fixed; inset: 0; z-index: 999999; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.85); font-family: sans-serif; padding: 15px;">
        <div style="background: white; width: 100%; max-width: 500px; border-radius: 20px; overflow: hidden; position: relative; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
            <div style="background: #1e293b; color: white; padding: 20px; display: flex; justify-content: space-between; align-items: center;">
                <h2 style="margin: 0; font-size: 1.2rem; font-weight: 800; letter-spacing: 0.5px;">🏥 FICHA ENFERMERÍA</h2>
                <button onclick="document.getElementById('modal-enfermeria-v3').remove()" 
                        style="background: #ef4444; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 14px;">
                    CERRAR [X]
                </button>
            </div>
            <div style="padding: 25px; max-height: 70vh; overflow-y: auto; background: #f8fafc;">
                <div style="background: #f1f5f9; padding: 15px; border-radius: 12px; margin-bottom: 20px; border-left: 5px solid #3b82f6;">
                    <div style="font-size: 0.7rem; color: #64748b; font-weight: bold; text-transform: uppercase;">Paciente</div>
                    <div style="font-size: 1.4rem; font-weight: 900; color: #0f172a;">${d.nombre || ''} ${d.apellido || ''}</div>
                    <div style="font-size: 0.9rem; color: #3b82f6; font-weight: bold;">DNI: ${d.dni || '---'}</div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                    <div style="background: #fff1f2; padding: 15px; border-radius: 15px; text-align: center; border: 1px solid #fecdd3;">
                        <div style="font-size: 0.7rem; color: #e11d48; font-weight: bold;">PRESIÓN ARTERIAL</div>
                        <div style="font-size: 1.5rem; font-weight: 900; color: #9f1239;">${d.presion || '---'}</div>
                        <div style="font-size: 0.6rem; color: #fb7185;">mmHg</div>
                    </div>
                    <div style="background: #f0fdf4; padding: 15px; border-radius: 15px; text-align: center; border: 1px solid #bbf7d0;">
                        <div style="font-size: 0.7rem; color: #166534; font-weight: bold;">AGUDEZA VISUAL</div>
                        <div style="font-size: 1.5rem; font-weight: 900; color: #14532d;">${d.agudeza || '---'}</div>
                    </div>
                </div>
                <div style="background: #1e293b; color: white; padding: 20px; border-radius: 15px; display: grid; grid-template-columns: 1fr 1fr 1fr; text-align: center; margin-bottom: 20px;">
                    <div>
                        <div style="font-size: 0.6rem; color: #94a3b8;">PESO</div>
                        <div style="font-size: 1.1rem; font-weight: bold;">${d.peso || '---'} kg</div>
                    </div>
                    <div style="border-left: 1px solid #334155; border-right: 1px solid #334155;">
                        <div style="font-size: 0.6rem; color: #94a3b8;">ALTURA</div>
                        <div style="font-size: 1.1rem; font-weight: bold;">${d.altura || '---'} cm</div>
                    </div>
                    <div>
                        <div style="font-size: 0.6rem; color: #94a3b8;">CINTURA</div>
                        <div style="font-size: 1.1rem; font-weight: bold;">${d.cintura || '---'} cm</div>
                    </div>
                </div>
                <div style="background: white; padding: 15px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
                    <div style="font-size: 0.7rem; color: #64748b; font-weight: bold; margin-bottom: 5px;">ESTADO DE VACUNACIÓN</div>
                    <div style="font-size: 0.9rem; color: #1e293b; line-height: 1.4;">💉 ${d.vacunas || 'No hay vacunas registradas.'}</div>
                </div>
                <div style="font-size: 0.7rem; color: #94a3b8; display: flex; justify-content: space-between;">
                    <span>Registrado por: <b>${d.enfermera || '---'}</b></span>
                    <span>Fecha: <b>${d.fecha || '---'}</b></span>
                </div>
            </div>
            <div style="padding: 15px; background: #f8fafc; border-top: 1px solid #e2e8f0;">
                <button onclick="document.getElementById('modal-enfermeria-v3').remove()" 
                        style="width: 100%; background: #0f172a; color: white; border: none; padding: 15px; border-radius: 10px; font-weight: 800; cursor: pointer; text-transform: uppercase;">
                    ENTENDIDO
                </button>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function compartirDashboard() {
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

function copyCurrentUrl() {
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