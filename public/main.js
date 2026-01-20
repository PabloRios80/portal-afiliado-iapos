// --- Variables Globales ---
const ESTUDIOS_API_URL = window.ESTUDIOS_API_URL || 'http://localhost:4000';
const API_BASE_PATH = '/api';
// Variable global para guardar quién entró
let usuarioActual = null;
let allReports = [];
let cachedEstudiosResults = {};

// --- VARIABLES DE AUTENTICACIÓN ---
let authToken = localStorage.getItem('iapos_token'); // Intentamos recuperar sesión
let currentUser = JSON.parse(localStorage.getItem('iapos_user'));

// ==============================================================================
// GESTIÓN DE UI LOGIN / REGISTRO
// ==============================================================================

function mostrarLogin() {
    document.getElementById('auth-modal').classList.remove('hidden');
    document.getElementById('form-login').classList.remove('hidden');
    document.getElementById('form-registro').classList.add('hidden');
}

function mostrarRegistro() {
    document.getElementById('auth-modal').classList.remove('hidden');
    document.getElementById('form-login').classList.add('hidden');
    document.getElementById('form-registro').classList.remove('hidden');
}

function cerrarAuthModal() {
    document.getElementById('auth-modal').classList.add('hidden');
}

// ==============================================================================
// LÓGICA DE REGISTRO
// ==============================================================================
const btnReg = document.getElementById('btn-reg-submit');
if (btnReg) {
    btnReg.addEventListener('click', async () => {
        const dni = document.getElementById('reg-dni').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-pass').value.trim();

        if (!dni || !email || !password) {
            Swal.fire('Faltan datos', 'Por favor completa todos los campos.', 'warning');
            return;
        }

        Swal.showLoading();
        try {
            const response = await fetch('/api/auth/registro', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dni, email, password })
            });
            const data = await response.json();

            if (response.ok) {
                Swal.fire('¡Éxito!', data.message, 'success');
                mostrarLogin(); // Llevamos al usuario al login
            } else {
                Swal.fire('Error', data.error || 'No se pudo registrar.', 'error');
            }
        } catch (error) {
            Swal.fire('Error', 'Error de conexión con el servidor.', 'error');
        }
    });
}
// ==============================================================================
// LÓGICA DE LOGIN
// ==============================================================================
const btnLogin = document.getElementById('btn-login-submit');
if (btnLogin) {
    btnLogin.addEventListener('click', async () => {
        const dni = document.getElementById('login-dni').value.trim();
        const password = document.getElementById('login-pass').value.trim();

        if (!dni || !password) {
            Swal.fire('Atención', 'Ingresa DNI y contraseña.', 'warning');
            return;
        }

        Swal.showLoading();
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dni, password })
            });
            const data = await response.json();
            if (response.ok) {
                // Guardar sesión
                localStorage.setItem('iapos_token', data.token);
                localStorage.setItem('iapos_user', JSON.stringify(data.usuario));
                authToken = data.token;
                currentUser = data.usuario;

                Swal.close();
                cerrarAuthModal(); // Cierra el modal de login

                // LÓGICA DE ROLES MEJORADA
                if (currentUser.rol === 'admin') {
                    // SI ES ADMIN: ¡Abrir buscador DIRECTAMENTE!
                    const searchContainer = document.getElementById('search-container');
                    if (searchContainer) {
                        searchContainer.style.display = 'flex'; // Usamos flex para centrar
                        document.getElementById('dni-input').focus(); // Poner el cursor listo para escribir
                    }
                    // Ocultamos vista inicial
                    const vistaInicial = document.getElementById('vista-inicial');
                    if(vistaInicial) vistaInicial.style.display = 'none';

                } else {
                    // SI ES USUARIO: Cargar sus datos
                    if(document.getElementById('search-container')) {
                        document.getElementById('search-container').style.display = 'none';
                    }
                    iniciarPortal(currentUser.dni);
                }
            } else {
                Swal.fire('Acceso Denegado', data.error, 'error');
            }
        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'No se pudo conectar al servidor.', 'error');
        }
    });
}
// ==============================================================================
// FUNCIÓN PRINCIPAL DE CARGA (SEGURA CON TOKEN)
// ==============================================================================
async function iniciarPortal(dniParaBuscar) {
    Swal.fire({
        title: 'Ingresando...',
        text: 'Autenticando y recuperando historial médico...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        // 1. Aseguramos que currentUser tenga datos
        if (!currentUser) {
            currentUser = JSON.parse(localStorage.getItem('iapos_user'));
        }

        // 2. Si sigue sin haber usuario, paramos para evitar error
        if (!currentUser) {
            throw new Error('No se identificó la sesión. Por favor ingresa de nuevo.');
        }

        const response = await fetch('/api/buscar-datos', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}` 
            },
            // 👇👇 AQUÍ ESTÁ EL CAMBIO QUE NECESITAS 👇👇
            body: JSON.stringify({ 
                dniBuscado: dniParaBuscar,      
                usuarioSolicitante: currentUser // <--- ¡ESTA ES LA LÍNEA MÁGICA!
            })
            // 👆👆 SIN ESTO, EL SERVIDOR FALLA 👆👆
        });

        const dataResult = await response.json();

        // ... (El resto del código sigue igual) ...
        
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                localStorage.removeItem('iapos_token');
                Swal.fire('Atención', dataResult.error || 'Sesión expirada.', 'warning');
                return;
            }
            throw new Error(dataResult.error || 'Error al buscar datos.');
        }

        // Procesamiento de reportes
        let reports = dataResult.reports;
        if (!reports || reports.length === 0) {
            if (dataResult.persona) reports = [dataResult.persona];
            else { 
                Swal.fire('Sin Datos', 'No hay registros para este DNI.', 'info'); 
                return; 
            }
        }

        // Ordenar y seleccionar (Tu lógica original)
        const sortedReports = [...reports].sort((a, b) => {
            const parseDate = (dateStr) => {
                if(!dateStr) return new Date(0);
                const parts = dateStr.split('/');
                return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
            };
            return parseDate(b.FECHAX) - parseDate(a.FECHAX);
        });

        allReports = sortedReports;
        const selectedReport = sortedReports[0];
        const dniToSearch = selectedReport.DNI;

        // Carga de estudios (Tu lógica original)
        const [
            resumenAI, labResult, mamografiaResult, ecografiaResult, ecomamariaResult,
            espirometriaResult, enfermeriaResult, densitometriaResult,
            vccResult, oftalmologiaResult, odontologiaResult, biopsiaResult
        ] = await Promise.all([
            obtenerResumenAI(selectedReport),
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

        cachedEstudiosResults = {
            laboratorio: labResult, mamografia: mamografiaResult, ecografia: ecografiaResult,
            ecomamaria: ecomamariaResult, espirometria: espirometriaResult, enfermeria: enfermeriaResult,
            densitometria: densitometriaResult, vcc: vccResult, oftalmologia: oftalmologiaResult,
            odontologia: odontologiaResult, biopsia: biopsiaResult
        };

        // Cargar UI
        cargarPortalPersonal(selectedReport, resumenAI);
        
        // Ocultar vista inicial
        const vistaInicial = document.getElementById('vista-inicial');
        if(vistaInicial) vistaInicial.style.display = 'none';

        // --- MANEJO DE ADMIN UI ---
        // 1. Ocultar el buscador grande (porque ya encontramos al paciente)
        const searchContainer = document.getElementById('search-container');
        if (searchContainer) searchContainer.style.display = 'none';

        // 2. Si soy admin, mostrar el botón flotante "Buscar Otro"
        if (currentUser && currentUser.rol === 'admin') {
            const btnNueva = document.getElementById('btn-nueva-busqueda');
            if (btnNueva) btnNueva.style.display = 'block';
        }

        Swal.close();

    } catch (error) {
        console.error(error);
        Swal.fire('Error', error.message, 'error');
    }
}

// CHECKEO DE SESIÓN AL INICIO
document.addEventListener('DOMContentLoaded', () => {
    // Si ya hay token guardado, podemos intentar loguear directo o mostrar botón "Ir a mi portal"
    if (authToken && currentUser) {
        console.log("Sesión detectada para:", currentUser.dni);
    }
});
// ==============================================================================
// 2. FUNCIONES DE CONEXIÓN Y LÓGICA DE RIESGO
// ==============================================================================
async function obtenerResumenAI(persona) {
    const textoGuardado = persona['REPORTE_MEDICO']; 
    if (textoGuardado && textoGuardado.trim().length > 10) {
        return textoGuardado;
    }
    return null; // Esto es vital para que aparezca el botón
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
    const k = key.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
    
    // Detectamos si el valor indica que NO se realizó
    const noRealizado = v.includes('no se realiza') || v.includes('no realizado') || v === 'no' || 
                        v.includes('no corresponde') || v === '' || v.includes('no indicado') || 
                        v.includes('no aplica') || v.includes('pendiente');

    // --- DATOS PERSONALES (VIOLETA) ---
    if (k === 'EDAD' || k === 'SEXO') {
        return { color: 'violet', icon: 'info', text: 'Dato Personal', customMsg: 'Información registrada en el sistema.' };
    }

    // ==============================================================================
    // 1. REGLAS CLÍNICAS ESPECÍFICAS
    // ==============================================================================

    // --- PRÓSTATA (PSA) ---
    if (k.includes('PROSTATA') || k.includes('PSA')) {
        // CASO 1: Si el resultado es NORMAL -> VERDE
        if (v.includes('normal') || v.includes('bajo') || v.includes('negativo') || v.includes('adecuado')) {
            return { color: 'green', icon: 'check', text: 'Calma', customMsg: '¡Excelente! Los valores están dentro de lo normal.' };
        }
        // CASO 2: Si es "No aplica", "Pendiente", "No realizado"
        if (noRealizado) {
            if (edad >= 50) {
                return { color: 'red', icon: 'exclamation', text: 'Pendiente', customMsg: 'A partir de los 50 años el control de PSA es fundamental. Te sugerimos realizarlo.' };
            } else {
                return { color: 'gray', icon: 'info', text: 'A futuro', customMsg: 'Este estudio se indica generalmente a partir de los 50 años. Por ahora no es necesario.' };
            }
        }
    }

    // --- ALIMENTACIÓN SALUDABLE ---
    if (k.includes('ALIMENTACION') || k.includes('NUTRICION')) {
        if (v === 'no' || v.includes('mala') || v.includes('inadecuada')) {
            return { color: 'red', icon: 'exclamation', text: 'Alerta', customMsg: 'Se recomienda mejorar hábitos alimenticios e incorporar variedad de nutrientes.' };
        }
        if (v === 'si' || v === 'sí' || v.includes('buena')) {
            return { color: 'green', icon: 'check', text: 'Calma', customMsg: '¡Muy bien! Mantener una buena alimentación es clave.' };
        }
    }

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

    // --- VERDE ---
    if (v === 'si' || v === 'sí' || v === 'buena' ||
        v.includes('no presenta') || v.includes('normal') || v.includes('adecuada') || 
        v.includes('no abusa') || v.includes('no se verifica') || v.includes('no fuma') || 
        v.includes('cumple') || v.includes('bajo') || 
        (v.includes('realiza') && !v.includes('no')) || 
        v.includes('completo') || v.includes('negativo') || v.includes('riesgo bajo')) {
        return { color: 'green', icon: 'check', text: 'Calma' };
    }

    // --- ROJO ---
    if (v === 'no' || v === 'No' ||
        v.includes('sí presenta') || v.includes('presenta') || v.includes('elevado') || 
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
// 4. CONTENIDO DE LAS PESTAÑAS (VERSIÓN CON ADMIN TOOLS)
// ==============================================================================
function cargarDiaPreventivoTab(persona, resumenAI) {
    const nombre = persona['apellido y nombre'] || 'Afiliado';
    const fechaInforme = persona['FECHAX'] || 'N/A';
    
    // --- OBTENCIÓN DE EDAD SEGURA ---
    const keyEdad = Object.keys(persona).find(k => k.toLowerCase() === 'edad');
    let edadPaciente = 0;
    if (keyEdad && persona[keyEdad]) {
        const edadMatch = String(persona[keyEdad]).match(/\d+/);
        edadPaciente = edadMatch ? parseInt(edadMatch[0]) : 0;
    }
    
    const sexo = String(window.pacienteSexo || '').toLowerCase().trim(); 
    const dashboardContenedor = document.getElementById('dashboard-contenido');
    const accionesContenedor = document.getElementById('dashboard-acciones');

    // 1. SELECTOR DE FECHAS (Historial)
    let dateSelectorHTML = ''; 
    if (allReports.length > 1) { 
        const dateOptions = allReports.map(report => {
            const date = report.FECHAX;
            const id = report.ID || date;
            return { date, id };
        });
        const optionsHtml = dateOptions.map(opt => `
            <option value="${opt.id}" ${opt.date === fechaInforme ? 'selected' : ''}>
                Día Preventivo del ${opt.date} ${opt.date === fechaInforme ? ' (Actual)' : ''}
            </option>
        `).join('');
        dateSelectorHTML = `
            <div class="mb-6 p-4 bg-yellow-50 border-l-4 border-yellow-500 rounded-lg shadow-md">
                <label for="report-date-selector" class="block text-md font-bold text-yellow-800 mb-2">
                    <i class="fas fa-history mr-2"></i> Historial de Informes Previos
                </label>
                <select id="report-date-selector" class="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-yellow-500 focus:border-yellow-500 sm:text-sm rounded-md shadow-inner transition duration-150">
                    ${optionsHtml}
                </select>
            </div>
        `;
    }

    // 2. CONSTRUCCIÓN DEL HTML BASE
    // NOTA: En lugar de pegar el resumen directo, ponemos un DIV vacío con ID "ai-summary-dynamic"
    let dashboardHTML = `
        <h1 class="text-2xl font-bold mb-6 text-gray-800">
            <i class="fas fa-heartbeat mr-2 text-blue-600"></i> Mis resultados del Día Preventivo
        </h1>
        ${dateSelectorHTML}
        <div class="mb-4 p-4 bg-blue-50 border-l-4 border-blue-400 rounded-lg shadow-sm">
            <p class="font-semibold text-blue-700">
                <i class="fas fa-calendar-alt mr-2"></i> Fecha del Informe Activo: 
                <span class="font-bold text-blue-900">${fechaInforme}</span>
                ${edadPaciente > 0 ? `<span class="ml-4 text-sm text-gray-600">(Edad registrada: ${edadPaciente} años)</span>` : ''}
            </p>
        </div>

        <div id="informe-imprimible" class="shadow-xl rounded-lg overflow-hidden bg-white p-6">
            <h2 class="text-xl font-semibold mb-3 text-gray-800 border-b pb-2">Tu Resumen de Salud (Generado por IA)</h2>
            
            <div id="ai-summary-dynamic" class="mb-6 rounded-lg">
                </div>
            <h2 class="text-xl font-semibold mb-3 text-gray-800 border-b pb-2">Detalle de Indicadores</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    `;

    // 3. BUCLE DE INDICADORES (TARJETAS DE COLORES)
    for (const [key, value] of Object.entries(persona)) {
        if (['DNI', 'ID', 'apellido y nombre', 'Efector', 'Tipo', 'Marca temporal', 'FECHAX', 'Profesional', 'REPORTE_MEDICO'].includes(key)) {
            continue;
        }

        const safeValue = String(value || '');
        const keyUpper = key.toUpperCase();
        
        // Filtros de fechas y vacíos
        const isRawDate = keyUpper === 'RAWDATE' || safeValue.includes('RAWDATE');
        const isIsoDate = safeValue.includes('T') && safeValue.includes('Z') && safeValue.length > 15;
        if (isRawDate || isIsoDate || safeValue.trim() === '') continue;

        // Filtro Sexo
        const keyNormalized = keyUpper.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const terminosFemeninos = ['MAMOGRAFIA', 'ECO_MAMARIA', 'ECO MAMARIA', 'HPV', 'PAP', 'ACIDO FOLICO', 'UTERINO'];
        const terminosMasculinos = ['PROSTATA', 'PSA'];

        if (sexo === 'masculino' && terminosFemeninos.some(t => keyNormalized.includes(t))) continue;
        if ((sexo === 'femenino' || sexo === 'mujer') && terminosMasculinos.some(t => keyNormalized.includes(t))) continue;

        // Riesgos
        const risk = getRiskLevel(key, safeValue, edadPaciente, sexo);
        const colorMap = {
            red: 'bg-red-100 border-red-500 text-red-700',
            yellow: 'bg-yellow-100 border-yellow-500 text-yellow-700',
            green: 'bg-green-100 border-green-500 text-green-700',
            gray: 'bg-gray-100 border-gray-400 text-gray-600',
            violet: 'bg-purple-100 border-purple-500 text-purple-700'
        };
        const iconMap = {
            times: 'fas fa-times-circle', exclamation: 'fas fa-exclamation-triangle',
            check: 'fas fa-check-circle', question: 'fas fa-question-circle', info: 'fas fa-info-circle',
        };

        const finalColorClass = colorMap[risk.color] || colorMap['gray'];
        const mensajeFinal = risk.customMsg ? risk.customMsg : (key.includes('Observaciones') ? safeValue : risk.text);

        dashboardHTML += `
            <div class="p-4 border-l-4 ${finalColorClass} rounded-md shadow-sm transition hover:shadow-lg">
                <div class="flex items-center justify-between mb-1">
                    <h3 class="font-bold text-md">${key}</h3> 
                    <span class="font-semibold text-sm px-2 py-0.5 rounded-full bg-white border border-gray-200 shadow-sm text-gray-700 whitespace-nowrap ml-2">
                        ${risk.text}
                    </span>
                </div>
                <p class="text-sm italic mb-2 text-gray-800 mt-2">${safeValue}</p>
                <div class="text-xs flex items-center mt-3 border-t pt-2 border-${risk.color}-200 opacity-90 font-medium">
                    <i class="${iconMap[risk.icon]} mr-2"></i> ${mensajeFinal}
                </div>
            </div>
        `;
    }

    dashboardHTML += `</div> </div>`;
    
    // 4. INYECTAR EL HTML EN LA PÁGINA
    dashboardContenedor.innerHTML = dashboardHTML;

    // =========================================================================
    // 5. LÓGICA DE INFORME IA (Aquí es donde insertamos los botones)
    // =========================================================================
    const containerAI = document.getElementById('ai-summary-dynamic');
    
    // Verificamos si resumenAI tiene contenido real (más de 10 letras) o es un error/vacío
    const tieneInformeGuardado = resumenAI && resumenAI.length > 10 && !resumenAI.includes("ERROR");

    if (tieneInformeGuardado) {
        // CASO A: YA EXISTE UN INFORME (Se muestra limpio)
        containerAI.innerHTML = `
            <div class="prose max-w-none p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <p class="text-base leading-relaxed" style="white-space: pre-line;">${resumenAI.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
                ${currentUser.rol === 'admin' ? '<div class="mt-2 text-right"><span class="text-xs text-green-600 font-bold"><i class="fas fa-check-circle"></i> Informe validado y guardado en Excel</span></div>' : ''}
            </div>
        `;
    } else if (currentUser && currentUser.rol === 'admin') {
        // CASO B: SOY ADMIN Y NO HAY INFORME -> MOSTRAR HERRAMIENTAS
        containerAI.innerHTML = `
            <div class="bg-yellow-50 p-6 rounded-lg border border-yellow-200 text-center">
                <p class="text-yellow-800 font-bold mb-4"><i class="fas fa-exclamation-circle"></i> Este paciente aún no tiene un informe validado.</p>
                
                <button id="btn-generar-ia" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-full shadow-lg transition transform hover:scale-105">
                    <i class="fas fa-robot mr-2"></i> Generar Borrador con IA
                </button>

                <div id="editor-borrador" style="display: none;" class="mt-6 text-left bg-white p-4 rounded-lg shadow-inner border border-gray-200">
                    <h4 class="font-bold text-gray-700 mb-2">📝 Editar Borrador:</h4>
                    <textarea id="texto-borrador" class="w-full h-64 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-sans text-sm"></textarea>
                    
                    <div class="mt-4 flex justify-end space-x-3">
                        <button id="btn-cancelar" class="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg">
                            Cancelar
                        </button>
                        <button id="btn-guardar-excel" class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg shadow-md flex items-center">
                            <i class="fas fa-save mr-2"></i> APROBAR Y GUARDAR
                        </button>
                    </div>
                </div>
            </div>
        `;

        // LÓGICA DE LOS BOTONES
        setTimeout(() => {
            const btnGenerar = document.getElementById('btn-generar-ia');
            const divEditor = document.getElementById('editor-borrador');
            const txtArea = document.getElementById('texto-borrador');
            const btnGuardar = document.getElementById('btn-guardar-excel');
            const btnCancelar = document.getElementById('btn-cancelar');

            if (btnGenerar) {
                // GENERAR
                btnGenerar.onclick = async () => {
                    btnGenerar.disabled = true;
                    btnGenerar.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Analizando datos...';
                    
                    try {
                        // 👇👇 AQUÍ ESTABA EL ERROR: CORREGIMOS LA RUTA Y EL DATO 👇👇
                        const resp = await fetch('/api/analizar-informe', { // Antes decía 'analizar-paciente'
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ persona: persona }) // Antes decía 'paciente: persona'
                        });
                        // 👆👆 AHORA COINCIDE CON TU SERVIDOR 👆👆

                        const result = await resp.json();
                        
                        // Si el servidor devuelve error controlado
                        if (!resp.ok) throw new Error(result.error || 'Error en la IA');

                        // Usamos 'result.resumen' porque así lo devuelve tu API original
                        txtArea.value = result.resumen || "Error al recibir texto.";
                        
                        divEditor.style.display = 'block';
                        btnGenerar.style.display = 'none'; 

                    } catch (e) {
                        console.error(e);
                        Swal.fire('Error', 'No se pudo conectar con la IA: ' + e.message, 'error');
                        btnGenerar.disabled = false;
                        btnGenerar.innerHTML = '<i class="fas fa-robot mr-2"></i> Reintentar';
                    }
                };

                // CANCELAR
                btnCancelar.onclick = () => {
                    divEditor.style.display = 'none';
                    btnGenerar.style.display = 'inline-block';
                    btnGenerar.disabled = false;
                    btnGenerar.innerHTML = '<i class="fas fa-robot mr-2"></i> Generar Borrador con IA';
                };

                // GUARDAR
                btnGuardar.onclick = async () => {
                    const textoFinal = txtArea.value.trim();
                    if (!textoFinal) return Swal.fire('Atención', 'El informe está vacío.', 'warning');
                    
                    btnGuardar.disabled = true;
                    btnGuardar.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Guardando...';

                    try {
                        const resp = await fetch('/api/guardar-reporte', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ 
                                dni: persona.DNI,       // <--- ¿Esto está?
                                nombre: persona['apellido y nombre'], // <--- ¡ESTO ES NUEVO! ¿Lo agregaste?
                                reporteTexto: textoFinal 
                            })
                        });
                        
                        if (resp.ok) {
                            Swal.fire({
                                icon: 'success',
                                title: '¡Guardado!',
                                text: 'El informe ha sido validado y guardado en el Excel.',
                                showConfirmButton: false,
                                timer: 2000
                            }).then(() => window.location.reload());
                        } else {
                            throw new Error('Error al guardar');
                        }
                    } catch (error) {
                        Swal.fire('Error', 'Fallo al guardar: ' + error.message, 'error');
                        btnGuardar.disabled = false;
                        btnGuardar.innerHTML = '<i class="fas fa-save mr-2"></i> APROBAR Y GUARDAR';
                    }
                };
            }
        }, 100);

    } else {
        // CASO C: SOY PACIENTE Y NO HAY INFORME
        containerAI.innerHTML = `
            <div class="bg-gray-100 p-6 rounded-lg text-center border border-gray-200">
                <i class="fas fa-user-md text-4xl text-gray-400 mb-3"></i>
                <p class="text-gray-600 text-lg">El equipo médico está procesando sus resultados para generar un informe detallado.</p>
                <p class="text-gray-500 text-sm mt-2">Por favor, vuelva a consultar a la brevedad.</p>
            </div>
        `;
    }


    // 6. LISTENERS DE UI GENERAL (Fecha, botones inferiores)
    if (allReports.length > 1) {
        document.getElementById('report-date-selector').addEventListener('change', async (event) => {
            const selectedId = event.target.value;
            // Nota: updateDashboardContent no está en el código que me diste, 
            // asegúrate de tener esa función o recargar la página con el nuevo ID
            if (typeof updateDashboardContent === 'function') {
                await updateDashboardContent(selectedId);
            } else {
                console.warn("Función updateDashboardContent no encontrada.");
            }
        });
    }

    // Botones de acción inferior
    let accionesHTML = `
        <div class="mt-4 p-4 border border-blue-200 bg-blue-50 rounded-lg shadow-md text-left w-full md:w-3/4 mx-auto mb-6">
            <p class="font-bold text-lg text-blue-800 mb-2"><i class="fas fa-phone-square-alt mr-2"></i> Contacto Directo del Programa Día Preventivo</p>
            <p class="text-gray-700 mb-1"><span class="font-semibold">Teléfono Consultas:</span> <a href="tel:3424071702" class="text-blue-600 font-medium">342 407-1702</a></p>
            <p class="text-gray-700"><span class="font-semibold">Mail de Consultas:</span> <a href="mailto:diapreventivoiapos@diapreventivo.com" class="text-blue-600 font-medium">diapreventivoiapos@diapreventivo.com</a></p>
        </div>
        <div class="flex flex-wrap items-center justify-center py-4">
            <button onclick="mostrarInformeEscrito('${nombre.replace(/'/g, "\\'")}', \`${(resumenAI || '').replace(/`/g, "\\`")}\`)" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 mx-2 mt-2">
                <i class="fas fa-file-alt mr-2"></i> Informe Escrito (Ver/Imprimir)
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
            return; 
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
// =======================================================
// LÓGICA DE INTERFAZ DE ADMINISTRADOR
// =======================================================

// 1. Botón "BUSCAR" (El del cuadro grande)
const btnBuscar = document.getElementById('btn-buscar');
const inputBuscar = document.getElementById('dni-input');

if (btnBuscar && inputBuscar) {
    // Buscar al hacer clic
    btnBuscar.addEventListener('click', () => {
        const dniEscrito = inputBuscar.value.trim();
        if (dniEscrito) {
            iniciarPortal(dniEscrito);
        } else {
            Swal.fire('Atención', 'Escribe un DNI para buscar.', 'warning');
        }
    });

    // Buscar al presionar ENTER
    inputBuscar.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            btnBuscar.click();
        }
    });
}

// 2. Botón flotante "BUSCAR OTRO PACIENTE"
const btnNuevaBusqueda = document.getElementById('btn-nueva-busqueda');
if (btnNuevaBusqueda) {
    btnNuevaBusqueda.addEventListener('click', () => {
        // Volvemos a mostrar el buscador grande
        document.getElementById('search-container').style.display = 'flex';
        // Limpiamos el campo para el nuevo DNI
        document.getElementById('dni-input').value = '';
        document.getElementById('dni-input').focus();
    });
}

// 3. Botón "X" para cerrar buscador (por si te arrepientes)
const btnCerrarBusqueda = document.getElementById('btn-cerrar-busqueda');
if (btnCerrarBusqueda) {
    btnCerrarBusqueda.addEventListener('click', () => {
        document.getElementById('search-container').style.display = 'none';
    });
}