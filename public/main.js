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

                    // 3. Datos encontrados con éxito. Iniciar análisis de IA.
                    // Llamar a la IA para obtener el resumen
                    const resumenAI = await obtenerResumenAI(dataResult.persona); 

                    // 4. Cargar el Portal Personal de Salud (Nueva Vista)
                    cargarPortalPersonal(dataResult.persona, resumenAI);
                    
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
// ... (resto del código anterior)

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
        v.includes('sí') || 
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
 */
function cargarPortalPersonal(persona, resumenAI) {
    // 1. Ocultar la vista inicial y mostrar el portal
    document.getElementById('vista-inicial').style.display = 'none';
    document.getElementById('portal-salud-container').style.display = 'block';

    // 2. Cargar el contenido de las pestañas
    cargarDiaPreventivoTab(persona, resumenAI);
    cargarEstudiosTab(); // Carga la lista estática de estudios
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
 */
function cargarDiaPreventivoTab(persona, resumenAI) {
    const nombre = persona['apellido y nombre'] || 'Afiliado';
    const dni = persona['DNI'] || 'N/A';
    const dashboardContenedor = document.getElementById('dashboard-contenido');
    const accionesContenedor = document.getElementById('dashboard-acciones');

    // 1. Construir el HTML del dashboard (Resultado a Resultado)
    let dashboardHTML = `
        <div id="informe-imprimible" class="shadow-xl rounded-lg overflow-hidden bg-white p-6">
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

    // 3. Construir e inyectar los botones de acción
    // Nota: Usamos replace(/'/g, "\\'") para escapar comillas simples dentro de la cadena que pasa a la función
    accionesContenedor.innerHTML = `
        <button onclick="mostrarInformeEscrito('${nombre.replace(/'/g, "\\'")}', \`${resumenAI.replace(/`/g, "\\`")}\`)" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 mr-4">
            <i class="fas fa-file-alt mr-2"></i> Informe Escrito AI (Ver/Imprimir)
        </button>
        <button onclick="descargarPDF('${nombre}', '${dni}')" class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 mr-4">
            <i class="fas fa-file-pdf mr-2"></i> Descargar PDF
        </button>
        <button onclick="compartirDashboard()" class="bg-gray-400 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300">
            <i class="fas fa-share-alt mr-2"></i> Compartir Portal
        </button>
    `;
}

/**
 * Genera el contenido estático de la pestaña Estudios Complementarios.
 */
function cargarEstudiosTab() {
    const contenedor = document.getElementById('estudios-complementarios-lista');

    const estudios = [
        { nombre: 'Laboratorio Bioquímico', icon: 'fas fa-flask', link: '#' },
        { nombre: 'Mamografía', icon: 'fas fa-x-ray', link: '#' },
        { nombre: 'Ecografía', icon: 'fas fa-ultrasound', link: '#' },
        { nombre: 'Espirometría', icon: 'fas fa-lungs', link: '#' },
        { nombre: 'Enfermería', icon: 'fas fa-user-nurse', link: '#' },
        { nombre: 'Densitometría', icon: 'fas fa-bone', link: '#' },
        { nombre: 'Videocolonoscopia (VCC)', icon: 'fas fa-camera', link: '#' },
        { nombre: 'Otros Resultados', icon: 'fas fa-file-medical', link: '#' },
    ];

    let html = '';
    estudios.forEach(estudio => {
        html += `
            <a href="${estudio.link}" target="_blank" class="flex items-center p-4 bg-white rounded-lg shadow hover:shadow-md transition duration-200 border-l-4 border-purple-500">
                <i class="${estudio.icon} text-purple-600 text-2xl mr-4"></i>
                <span class="font-semibold text-lg text-gray-800">${estudio.nombre}</span>
                <i class="fas fa-chevron-right ml-auto text-gray-400"></i>
            </a>
        `;
    });

    contenedor.innerHTML = html;
}

// ==============================================================================
// 5. FUNCIONES DE UTILIDAD (PDF, IMPRIMIR, COMPARTIR, MODAL AI)
// ==============================================================================

/**
 * Función que abre el informe escrito AI en un modal, separada para limpieza.
 */
function mostrarInformeEscrito(nombre, resumenAI) {
    Swal.fire({
        title: `Informe Escrito AI de ${nombre}`,
        // El contenido usa el backtick para manejar saltos de línea y Markdown
        html: `<div class="text-left p-4 leading-relaxed">${resumenAI}</div>`, 
        icon: 'info',
        confirmButtonText: 'Cerrar',
        customClass: {
            popup: 'swal2-popup w-full md:w-3/4 lg:w-4/5',
        },
        // Opcional: Agregar un botón para imprimir el modal
        showDenyButton: true,
        denyButtonText: '<i class="fas fa-print"></i> Imprimir',
        preDeny: () => {
             // Lógica para imprimir solo el modal (usando impresión nativa)
            window.print();
             return false; // Evita que se cierre el modal
        }
    });
}

/**
 * Usa html2pdf.js para convertir el HTML en un archivo PDF descargable.
 */
function descargarPDF(nombre, dni) {
    const element = document.getElementById('informe-imprimible');

    Swal.fire({
        title: 'Generando PDF...',
        text: 'Por favor, espera un momento mientras se crea el documento.',
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    const options = {
        margin: [10, 10, 10, 10], // Margen en mm
        filename: `Informe_IAPOS_${dni}_${nombre.replace(/\s/g, '_')}.pdf`, // Nombre del archivo
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    // La función html2pdf.js para generar el PDF
    html2pdf().set(options).from(element).save().then(() => {
        Swal.close(); // Cierra el loading de SweetAlert2
    }).catch(error => {
        console.error('Error al crear el PDF:', error);
        Swal.fire('Error', 'No se pudo generar el PDF. Intenta nuevamente.', 'error');
    });
}

/**
 * Función auxiliar para compartir el enlace del portal.
 */
function compartirDashboard() {
    const shareText = `¡He revisado mi informe de prevención en IAPOS! Revisa tu portal aquí: ${window.location.href}`;
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