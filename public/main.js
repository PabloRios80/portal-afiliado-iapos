/**
 * Script de Lógica Principal del Portal de Afiliados
 * Maneja la interacción con la hoja de cálculo de Google Sheets (a través del servidor)
 * y la llamada a la API de Gemini para el análisis de informes.
 * * NOTA: La búsqueda de Estudios Complementarios se realiza a un microservicio separado en el puerto 4000.
 */

// --- Variables Globales ---
// Obtenida del HTML (inyectada por server.js). Apunta a http://localhost:4000 en local o la URL de Render en producción.
const ESTUDIOS_API_URL = window.ESTUDIOS_API_URL || 'http://localhost:4000'; 
// API URL del servicio principal (llama al mismo servidor Node.js que sirve este HTML)
const API_BASE_PATH = '/api'; 

// ==============================================================================
// 1. CONFIGURACIÓN INICIAL (DOMContentLoaded)
// ==============================================================================
document.addEventListener('DOMContentLoaded', () => {
    const btnVerPortal = document.getElementById('btn-ver-portal');

    if (btnVerPortal) {
        btnVerPortal.addEventListener('click', async () => {
            // 1. Solicitar DNI (punto de futura seguridad)
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

                    if (!dataResult.persona) {
                        Swal.fire('No Encontrado', 'No se encontraron resultados para el DNI ingresado.', 'error');
                        return;
                    }

                    // 3. Datos encontrados con éxito. Iniciar análisis de IA y Estudios.
                    
                    // Llamadas paralelas a IA y Estudios Complementarios (puerto 4000)
                    const [resumenAI, estudiosResult] = await Promise.all([
                        obtenerResumenAI(dataResult.persona), 
                        obtenerLinkEstudios(dataResult.persona.DNI) // Usamos el DNI del resultado
                    ]);

                    // 4. Cargar el Portal Personal de Salud (Nueva Vista)
                    // Pasamos los resultados de los estudios aquí
                    cargarPortalPersonal(dataResult.persona, resumenAI, estudiosResult);
                    
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
 * Llama al servidor para obtener el resumen de IA.
 * @param {Object} persona Datos del paciente.
 */
async function obtenerResumenAI(persona) {
    const response = await fetch('/api/analizar-informe', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(persona)
    });

    if (!response.ok) {
        throw new Error('Fallo al obtener el resumen de IA.');
    }

    const data = await response.json();
    return data.resumen;
}

/**
 * Llama al nuevo microservicio de Estudios Complementarios (puerto 4000).
 * @param {string} dni El DNI del paciente.
 * @returns {Promise<Object>} El enlace del estudio o un error 404.
 */
async function obtenerLinkEstudios(dni) {
    const studyApiUrl = `http://localhost:4000/api/buscar-estudios?dni=${dni}`;

    try {
        const response = await fetch(studyApiUrl);
        const data = await response.json();

        if (response.status === 404) {
            // DNI no encontrado en la hoja de Laboratorio
            return { link: null, error: data.error };
        }

        if (response.ok) {
            // Éxito: devuelve el link o null si la celda G estaba vacía
            return data;
        } else {
            // Manejar otros errores HTTP del microservicio de Estudios
            throw new Error(data.error || `Error del microservicio de Estudios (${response.status})`);
        }
    } catch (error) {
        console.error("Fallo al buscar estudios complementarios:", error);
        // Devolvemos un objeto de error para mostrar un mensaje informativo
        return { 
            link: null, 
            error: `El servicio de Estudios Complementarios (puerto 4000) no está disponible o falló.` 
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
        v.includes('Completo') || // Inmunizaciones 
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
        v.includes('No realiza') || 
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
        return { color: 'yellow', icon: 'exclamation', text: 'Atención' };
    }
    
    // Si el valor está vacío o no mapeado
    return { color: 'gray', icon: 'question', text: 'Sin Dato' };
}
// ==============================================================================
// 3. FUNCIONES DEL PORTAL PERSONAL DE SALUD (Dashboard y Pestañas)
// ==============================================================================

/**
 * Carga el Portal Personal de Salud y configura la navegación.
 * @param {Object} persona Datos del paciente.
 * @param {string} resumenAI Resumen generado por la IA.
 * @param {Object} estudiosResult Resultado de la búsqueda de estudios.
 */
function cargarPortalPersonal(persona, resumenAI, estudiosResult) {
    // 1. Ocultar la vista inicial y mostrar el portal
    document.getElementById('vista-inicial').style.display = 'none';
    document.getElementById('portal-salud-container').style.display = 'block';

    // 2. Cargar el contenido de las pestañas
    cargarDiaPreventivoTab(persona, resumenAI);
    // *** AHORA PASAMOS EL RESULTADO DINÁMICO A LA FUNCIÓN DE LA PESTAÑA DE ESTUDIOS ***
    cargarEstudiosTab(estudiosResult); 
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
 * @param {Object} persona Datos del paciente.
 * @param {string} resumenAI Resumen generado por la IA (puede contener un error).
 */
function cargarDiaPreventivoTab(persona, resumenAI) {
    const nombre = persona['apellido y nombre'] || 'Afiliado';
    const dni = persona['DNI'] || 'N/A';
    const dashboardContenedor = document.getElementById('dashboard-contenido');
    const accionesContenedor = document.getElementById('dashboard-acciones');

    // --- MANEJO DE FALLO DE LA IA (ROBUSTEZ) ---
    let resumenAILimpio = resumenAI.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    let summaryContent;

    if (!resumenAI || resumenAI.includes("ERROR CRÍTICO DE GEMINI") || resumenAI.includes("ERROR del servidor")) {
        summaryContent = `
            <div class="p-4 bg-red-100 border-l-4 border-red-500 rounded-lg shadow-sm">
                <strong class="text-red-700">🚨 Error Temporal de Análisis:</strong> 
                El servicio de Inteligencia Artificial (IA) para generar el resumen está temporalmente sobrecargado o no pudo procesar la solicitud. 
                <br>Por favor, revisa el detalle de indicadores a continuación, e intenta acceder al resumen escrito más tarde.
            </div>
        `;
    } else {
        summaryContent = `<p class="text-base leading-relaxed">${resumenAILimpio}</p>`;
    }
    // ------------------------------------------

    // 1. Construir el HTML del dashboard (Resultado a Resultado)
    let dashboardHTML = `
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

    // 3. Contacto Directo del Programa Día Preventivo (Ajustado)
    // *** ESTE ES EL BLOQUE CORREGIDO: SE ELIMINA EL BOTÓN DESCARGAR PDF ***
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
            
            <!-- EL BOTÓN DESCARGAR PDF HA SIDO ELIMINADO PARA EVITAR EL ReferenceError -->

            <button onclick="compartirDashboard()" class="bg-gray-400 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 mx-2 mt-2">
                <i class="fas fa-share-alt mr-2"></i> Compartir Portal
            </button>
        </div>
    `;

    // 4. Inyectar el HTML de Acciones y Contacto
    accionesContenedor.innerHTML = accionesHTML;
}

/**
 * Genera el contenido estático/dinámico de la pestaña Estudios Complementarios.
 * Ahora incluye la integración con el microservicio de Laboratorio.
 * @param {Object} estudiosResult Resultado de la búsqueda de estudios (link o error).
 */
function cargarEstudiosTab(estudiosResult) {
    const contenedor = document.getElementById('estudios-complementarios-lista');

    const estudios = [
        // El primer elemento es el que puede ser dinámico
        { nombre: 'Laboratorio Bioquímico', icon: 'fas fa-flask', link: '#', available: false },
        { nombre: 'Mamografía', icon: 'fas fa-x-ray', link: '#', available: false },
        { nombre: 'Ecografía', icon: 'fas fa-ultrasound', link: '#', available: false },
        { nombre: 'Espirometría', icon: 'fas fa-lungs', link: '#', available: false },
        { nombre: 'Enfermería', icon: 'fas fa-user-nurse', link: '#', available: false },
        { nombre: 'Densitometría', icon: 'fas fa-bone', link: '#', available: false },
        { nombre: 'Videocolonoscopia (VCC)', icon: 'fas fa-camera', link: '#', available: false },
        { nombre: 'Otros Resultados', icon: 'fas fa-file-medical', link: '#', available: false },
    ];

    let html = '';
    
    // 1. Integración del resultado dinámico del laboratorio (si existe)
    let laboratorioDisponible = false;
    if (estudiosResult && estudiosResult.link) {
        laboratorioDisponible = true;
        // Encuentra la entrada de Laboratorio Bioquímico y actualiza sus propiedades
        const labIndex = estudios.findIndex(e => e.nombre === 'Laboratorio Bioquímico');
        if (labIndex !== -1) {
            estudios[labIndex].link = estudiosResult.link;
            estudios[labIndex].available = true;
        }
    } 
    
    // 2. Mostrar mensaje de error si el microservicio falló o el DNI no fue encontrado
    if (estudiosResult && estudiosResult.error) {
        let alertClass = 'bg-yellow-100 border-yellow-400 text-yellow-700';
        let icon = 'fas fa-info-circle';

        // Si es un error de conexión, mostrar en rojo/advertencia
        if (estudiosResult.error.includes("disponible o falló")) {
            alertClass = 'bg-red-100 border-red-400 text-red-700';
            icon = 'fas fa-exclamation-triangle';
        }
        
        html += `
            <div class="${alertClass} p-3 rounded-lg my-4 text-sm border-l-4" role="alert">
                <i class="${icon} mr-2"></i> 
                <strong>Mensaje del Servicio:</strong> ${estudiosResult.error}
            </div>
        `;
    }

    // 3. Construir el listado de estudios
    estudios.forEach(estudio => {
        const isAvailable = estudio.available;
        // Clases dinámicas: verde si disponible, morado por defecto si pendiente
        const linkClasses = isAvailable 
            ? 'border-green-500 hover:border-green-700 bg-green-50 hover:bg-green-100'
            : 'border-purple-500 opacity-70 cursor-default';
        const iconClasses = isAvailable ? 'text-green-600' : 'text-purple-600';
        
        const href = isAvailable ? estudio.link : 'javascript:void(0)';
        
        // Manejador de click para enlaces no disponibles
        const onClickHandler = isAvailable 
            ? '' 
            : 'onclick="Swal.fire(\'Aún No Disponible\', \'Este estudio no tiene resultados cargados todavía.\', \'info\')"';

        html += `
            <a href="${href}" ${isAvailable ? 'target="_blank" rel="noopener noreferrer"' : ''} ${onClickHandler}
                class="flex items-center p-4 bg-white rounded-lg shadow hover:shadow-md transition duration-200 border-l-4 ${linkClasses}">
                <i class="${estudio.icon} ${iconClasses} text-2xl mr-4"></i>
                <span class="font-semibold text-lg text-gray-800">${estudio.nombre}</span>
                <span class="ml-auto text-sm font-medium ${isAvailable ? 'text-green-600 font-bold' : 'text-gray-400'}">
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
            Si desea mayor precisión sobre los resultados o hablar con un profesional del programa no dude en conectarse al te: 3424071702 o al mail diapreventivoiapos@diapreventivo.com
        </p>
    `;

    Swal.fire({
        title: `Informe Escrito AI de ${nombre}`,
        // Contenido con el resumen de la IA más la nota de contacto
        html: `<div class="text-left p-4 leading-relaxed">${resumenAI}${contactoHtml}</div>`, 
        icon: 'info',
        confirmButtonText: 'Cerrar',
        customClass: {
            popup: 'swal2-popup w-full md:w-3/4 lg:w-4/5',
        },
        // Botón para imprimir
        showDenyButton: true,
        denyButtonText: '<i class="fas fa-print"></i> Imprimir Informe',
        preDeny: () => {
             // Imprime solo el contenido del modal de SweetAlert2
             // Nota: En un entorno de desarrollo con iframe, esto puede imprimir la página entera.
             // En una ventana de navegador real, el modal se maneja mejor.
            window.print();
             return false; // Evita que el modal se cierre inmediatamente después de imprimir
        }
    });
}

/**
 * Función auxiliar para compartir el enlace del portal.
 */
function compartirDashboard() {
    const shareText = `¡Ingresa para ver el informe del Dia Preventivo IAPOS! Revisa tu portal aquí: ${window.location.href}`;
    // Usar document.execCommand('copy') como fallback seguro para entornos iframe
    try {
        const tempTextArea = document.createElement('textarea');
        tempTextArea.value = shareText;
        document.body.appendChild(tempTextArea);
        tempTextArea.select();
        document.execCommand('copy');
        document.body.removeChild(tempTextArea);
        Swal.fire('¡Copiado!', 'El enlace al portal ha sido copiado al portapapeles.', 'success');
    } catch (err) {
        console.error('Fallo al copiar:', err);
        Swal.fire('Error', 'No se pudo copiar el enlace automáticamente. Por favor, cópialo manualmente.', 'error');
    }
}

// *** IMPORTANTE: LA FUNCIÓN descargarPDF HA SIDO ELIMINADA DE ESTE ARCHIVO. ***