// --- Variables Globales ---

// 1. Detectamos si estamos trabajando en local (tu PC)
const esEntornoLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// 2. Elegimos la URL correcta automáticamente
const ESTUDIOS_API_URL = esEntornoLocal 
    ? 'http://localhost:4000'                  // 🏠 Si estás en tu casa
    : 'https://estudios-complementarios-dp.onrender.com'; // ☁️ Si estás en la nube
const API_BASE_PATH = '/api';

// Variables de Estado
let usuarioActual = null;
let allReports = []; // Historial completo
let cachedEstudiosResults = {};
let reporteSeleccionado = null; // El reporte que se está mirando AHORA
// Variable global temporal para guardar el borrador mientras se edita
let borradorTemporalIA = "";

// --- VARIABLES DE AUTENTICACIÓN ---
let authToken = localStorage.getItem('iapos_token'); 
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
                mostrarLogin(); 
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
                localStorage.setItem('iapos_token', data.token);
                localStorage.setItem('iapos_user', JSON.stringify(data.usuario));
                authToken = data.token;
                currentUser = data.usuario;

                Swal.close();
                cerrarAuthModal(); 

                if (currentUser.rol === 'admin') {
                    const searchContainer = document.getElementById('search-container');
                    if (searchContainer) {
                        searchContainer.style.display = 'flex'; 
                        document.getElementById('dni-input').focus(); 
                    }
                    const vistaInicial = document.getElementById('vista-inicial');
                    if(vistaInicial) vistaInicial.style.display = 'none';

                } else {
                    if(document.getElementById('search-container')) {
                        document.getElementById('search-container').style.display = 'none';
                    }
                    iniciarPortal(currentUser.dni);
                }
            } else {
                Swal.fire('Acceso Denegado', data.error, 'error');
            }
            if (currentUser.rol === 'admin') {
                document.getElementById('panel-admin-seccion').classList.remove('hidden');
            } else {
                document.getElementById('panel-admin-seccion').classList.add('hidden');
            }
        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'No se pudo conectar al servidor.', 'error');
        }
    });
}
// ==============================================================================
// 1. FUNCIÓN PRINCIPAL DE CARGA (VELOCIDAD MÁXIMA + CARGA PROGRESIVA)
// ==============================================================================
async function iniciarPortal(dniParaBuscar) {
    Swal.fire({
        title: 'Ingresando...',
        text: 'Recuperando historial médico...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        if (!currentUser) currentUser = JSON.parse(localStorage.getItem('iapos_user'));
        if (!currentUser) throw new Error('No se identificó la sesión.');

        const response = await fetch('/api/buscar-datos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ dniBuscado: dniParaBuscar, usuarioSolicitante: currentUser })
        });

        const dataResult = await response.json();
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) localStorage.removeItem('iapos_token');
            throw new Error(dataResult.error || 'Error al buscar datos.');
        }

        let reports = dataResult.reports;
        if (!reports || reports.length === 0) {
            if (dataResult.persona) reports = [dataResult.persona];
            else return Swal.fire('Sin Datos', 'No hay registros para este DNI.', 'info'); 
        }

        allReports = [...reports]; 
        const selectedReport = allReports[0]; 
        const dniToSearch = selectedReport.DNI || selectedReport.dni || dniParaBuscar;

        // 1. Carga de reporte local
        const resumenAI = await obtenerResumenAI(selectedReport);
        
        // 2. Limpiamos la memoria de estudios anteriores
        cachedEstudiosResults = {};
        
        // 3. Dibujamos la pantalla INMEDIATAMENTE
        cargarPortalPersonal(selectedReport, resumenAI);
        
        // 4. Ocultar paneles de búsqueda
        const vistaInicial = document.getElementById('vista-inicial');
        if(vistaInicial) vistaInicial.style.display = 'none';
        const searchContainer = document.getElementById('search-container');
        if (searchContainer) searchContainer.style.display = 'none';
        if (currentUser && currentUser.rol === 'admin') {
            const btnNueva = document.getElementById('btn-nueva-busqueda');
            if (btnNueva) btnNueva.style.display = 'block';
        }

        Swal.close(); // El usuario ya puede operar

        // 5. BUSCAMOS LOS PDFs UNO POR UNO (Los 404 son normales aquí)
        const estudiosList = ['laboratorio', 'mamografia', 'ecografia', 'ecomamaria', 'espirometria', 'enfermeria', 'densitometria', 'vcc', 'oftalmologia', 'odontologia', 'biopsia'];
        
        estudiosList.forEach(tipo => {
            obtenerLinkEstudios(dniToSearch, tipo).then(res => {
                cachedEstudiosResults[tipo] = res;
                cargarEstudiosTab(cachedEstudiosResults); // Actualiza la grilla al instante
            }).catch(e => console.log("Búsqueda finalizada sin PDF en:", tipo));
        });

    } catch (error) {
        console.error(error);
        Swal.fire('Error', error.message, 'error');
    }
}

// ==============================================================================
// 2. FUNCIONES DEL PORTAL PERSONAL (BLINDADO CONTRA ERRORES)
// ==============================================================================
function cargarPortalPersonal(persona, resumenAI) {
    document.getElementById('vista-inicial').style.display = 'none';
    document.getElementById('portal-salud-container').style.display = 'block';

    reporteSeleccionado = persona;
    
    // Extracción segura del sexo
    window.pacienteSexo = String(persona['Sexo'] || persona['sexo'] || '').toLowerCase().trim();
    if (window.pacienteSexo.includes('masc') || window.pacienteSexo.includes('varon') || window.pacienteSexo === 'm') window.pacienteSexo = 'masculino';
    if (window.pacienteSexo.includes('fem') || window.pacienteSexo.includes('mujer') || window.pacienteSexo === 'f') window.pacienteSexo = 'femenino';

    // 1. CONFIGURAMOS LAS PESTAÑAS PRIMERO (Asegura que siempre funcionen)
    const navContenedor = document.getElementById('portal-navegacion');
    if (navContenedor) {
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
    }

    // 2. CARGAMOS EL CONTENIDO EN BLOQUES SEGUROS
    try {
        cargarDiaPreventivoTab(persona, resumenAI); 
        cargarEstudiosTab(cachedEstudiosResults);
    } catch(e) {
        console.error("Error renderizando contenido:", e);
    }

    mostrarPestana('tab-dia-preventivo');
    window.scrollTo(0, 0);
}

// ==============================================================================
// 3. DISEÑO ORIGINAL DE ESTUDIOS COMPLEMENTARIOS
// ==============================================================================
function cargarEstudiosTab(estudiosResults) {
    const contenedor = document.getElementById('estudios-complementarios-lista');
    if (!contenedor) return;
    
    estudiosResults = estudiosResults || {};
    const sexo = window.pacienteSexo || '';
    
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

    let html = '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">';
    window._cachedEnfermeriaData = null;

    estudiosMaestros.forEach(estudio => {
        if (sexo === 'masculino' && estudio.soloMujeres) return; 

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
            ? `<p class="text-xs text-gray-500 mt-1">Última fecha: <span class="font-medium text-green-700">${lastResultDate}</span></p>`
            : `<p class="text-xs text-gray-400 mt-1"></p>`;

        const linkClasses = isAvailable 
            ? 'border-green-500 hover:border-green-700 bg-green-50 hover:bg-green-100 cursor-pointer'
            : 'border-gray-300 opacity-60 bg-gray-50 cursor-default'; 
        
        const iconClasses = isAvailable ? 'text-green-600' : 'text-gray-400';

        const onClickHandler = isAvailable 
            ? clickAction 
            : `onclick="Swal.fire('Pendiente', 'Este estudio no registra resultados en el servidor.', 'info')"`;

        html += `
            <div ${onClickHandler} class="flex items-center p-4 rounded-lg shadow hover:shadow-md transition duration-200 border-l-4 ${linkClasses}">
                <i class="${estudio.icon} ${iconClasses} text-2xl mr-4"></i>
                <div class="flex-grow">
                    <span class="font-semibold text-lg text-gray-800">${estudio.nombre}</span>
                    ${subtitleHtml} 
                </div>
                <span class="ml-auto text-sm font-medium text-right ${isAvailable ? 'text-green-600 font-bold' : 'text-gray-500'}">
                    ${isAvailable ? 'VER RESULTADO' : 'PENDIENTE'}
                </span>
                <i class="fas fa-chevron-right ml-2 ${isAvailable ? 'text-green-500' : 'text-gray-300'}"></i>
            </div>
        `;
    });
    
    html += '</div>';
    contenedor.innerHTML = html;
}


document.addEventListener('DOMContentLoaded', () => {
    if (authToken && currentUser) {
        console.log("Sesión detectada para:", currentUser.dni);
    }
});

// ==============================================================================
// FUNCIONES DE CONEXIÓN Y LÓGICA DE RIESGO
// ==============================================================================
async function obtenerResumenAI(persona) {
    const textoGuardado = persona['REPORTE_MEDICO']; 
    if (textoGuardado && textoGuardado.trim().length > 10) return textoGuardado;
    return null; 
}

async function obtenerLinkEstudios(dni, studyType) {
    const studyApiUrl = `${ESTUDIOS_API_URL}/api/buscar-estudios?dni=${dni}&tipo=${studyType}`;
    try {
        const response = await fetch(studyApiUrl);
        const data = await response.json();
        if (response.status === 404) return { link: null, error: data.error, tipo: studyType, fechaResultado: null };

        if (response.ok) {
            return { 
                link: data.link || null, 
                datos: data.datos || null, 
                tipo: studyType, 
                mensaje: data.mensaje,
                fechaResultado: data.fechaResultado || (data.datos ? data.datos.fecha : null) || null 
            };
        } else {
            throw new Error(data.error || `Error microservicio (${response.status})`);
        }
    } catch (error) {
        return { link: null, error: `Servicio no disponible.`, tipo: studyType, fechaResultado: null };
    }
}

// ==============================================================================
// 🔴 LÓGICA DE RIESGO 
// ==============================================================================
function getRiskLevel(key, value, edad, sexo, allData = {}) {
    const v = String(value || '').toLowerCase().trim();
    const k = key.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
    
    const noRealizado = v.includes('no se realiza') || v.includes('no realizado') || v === 'no' || 
                        v.includes('no corresponde') || v === '' || v.includes('no indicado') || 
                        v.includes('no aplica') || v.includes('pendiente');

    if (k === 'EDAD' || k === 'SEXO') {
        return { color: 'violet', icon: 'info', text: 'Dato Personal', customMsg: 'Información registrada en el sistema.' };
    }

    if (k.includes('EPOC')) {
        const claveTabaco = Object.keys(allData).find(x => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().includes('TABACO'));
        const valorTabaco = claveTabaco ? String(allData[claveTabaco]).toLowerCase().trim() : '';
        const noFuma = valorTabaco.includes('no fuma') || valorTabaco.includes('nunca') || valorTabaco.includes('ex') || valorTabaco === 'no';
        const esFumador = (valorTabaco.includes('fuma') && !noFuma) || valorTabaco === 'si';

        if (v.includes('no se verifica')) {
            if (esFumador) return { color: 'green', icon: 'check', text: 'Normal', customMsg: 'No se verifica EPOC. Recomendación IMPERIOSA: Dejar de fumar.' };
            return { color: 'green', icon: 'check', text: 'Normal', customMsg: 'Sin hallazgos patológicos.' };
        } 
        else if (v.includes('se verifica')) return { color: 'red', icon: 'exclamation', text: 'Atención', customMsg: 'EPOC Verificado. Se recomienda buscar ayuda médica.' };
        else {
            if (esFumador) return { color: 'yellow', icon: 'exclamation', text: 'Pendiente', customMsg: 'Al ser fumador, es fundamental realizar una espirometría.' };
            return { color: 'gray', icon: 'info', text: 'No Requerido', customMsg: 'Paciente no fumador. La espirometría no es estrictamente necesaria.' };
        }
    }

    if (k.includes('ANEURISMA') || k.includes('AORTA')) {
        if (v.includes('no se verifica') || v.includes('normal') || v.includes('negativo')) return { color: 'green', icon: 'check', text: 'Normal', customMsg: 'Aorta abdominal sin alteraciones.' };
        else if (v.includes('se verifica') || v.includes('detectad') || v.includes('positivo')) return { color: 'red', icon: 'exclamation', text: 'Alerta', customMsg: 'Patología detectada. Requiere derivación urgente.' };
        else if (noRealizado) {
            if (edad >= 65) return { color: 'yellow', icon: 'exclamation', text: 'Pendiente', customMsg: 'Ecografía de aorta recomendada por edad.' };
            return { color: 'gray', icon: 'info', text: 'No Corresponde', customMsg: 'Estudio no indicado para su rango de edad (menor a 65).' };
        }
    }

    if (k.includes('OSTEOPOROSIS') || k.includes('DENSITOMETRIA')) {
        if (v.includes('no se verifica') || v.includes('normal') || v.includes('negativo')) return { color: 'green', icon: 'check', text: 'Normal', customMsg: 'Densidad ósea normal.' };
        else if (v.includes('se verifica') || v.includes('osteopenia') || v.includes('osteoporosis')) return { color: 'red', icon: 'exclamation', text: 'Alerta', customMsg: 'Densidad ósea reducida. Importante prevenir caídas.' };
        else if (noRealizado) {
            if (edad >= 65) return { color: 'yellow', icon: 'exclamation', text: 'Pendiente', customMsg: 'Densitometría ósea recomendada a partir de los 65 años.' };
            return { color: 'gray', icon: 'info', text: 'No Corresponde', customMsg: 'Estudio indicado a partir de los 65 años.' };
        }
    }

    if (k.includes('PAP') || k.includes('PAPA')) {
        const keyHPV = Object.keys(allData).find(x => x.toUpperCase().includes('HPV') || x.toUpperCase().includes('VPH'));
        const valorHPV = keyHPV ? String(allData[keyHPV]).toLowerCase() : '';
        const hpvEsNormal = valorHPV.includes('negativo') || valorHPV.includes('no se detecta') || valorHPV.includes('normal') || valorHPV.includes('no detectado');
        const hpvEsPatologico = valorHPV.includes('positivo') || valorHPV.includes('detectado') || valorHPV.includes('se verifica') || valorHPV.includes('patologic') || valorHPV.includes('lesion');

        if (hpvEsNormal) return { color: 'green', icon: 'check', text: 'No Requerido', customMsg: 'Al tener HPV Negativo, no es necesario realizar PAP por 3 a 5 años.' };
        if (hpvEsPatologico) {
            if (v.includes('normal') || v.includes('negativo') || v.includes('sin lesion')) return { color: 'green', icon: 'check', text: 'Controlado', customMsg: 'HPV positivo controlado. PAP normal.' };
            return { color: 'red', icon: 'exclamation', text: 'ACCIÓN REQUERIDA', customMsg: 'ALERTA: Test HPV de Alto Riesgo. Consulte URGENTE para realizar PAP.' };
        }
        if (noRealizado) {
            if (edad > 21) return { color: 'red', icon: 'exclamation', text: 'Pendiente', customMsg: 'Estudio de tamizaje pendiente.' };
            return { color: 'gray', icon: 'info', text: 'No Corresponde', customMsg: 'Aún no tiene edad de screening.' };
        }
    }

    if (k.includes('HPV') || k.includes('VPH')) {
        if (v.includes('patologic') || v.includes('anormal') || v.includes('lesion') || v.includes('positivo') || v.includes('detectado')) return { color: 'red', icon: 'times', text: 'Alerta', customMsg: 'Resultado positivo. Requiere seguimiento estricto (PAP).' };
        if (v.includes('negativo') || v.includes('no detectado') || v.includes('normal')) return { color: 'green', icon: 'check', text: 'Excelente', customMsg: 'Virus no detectado. Control habitual.' };
        if (noRealizado) {
            if (edad > 30) return { color: 'red', icon: 'exclamation', text: 'Pendiente', customMsg: 'Test de VPH indicado mayores de 30 años.' };
            return { color: 'gray', icon: 'info', text: 'No Corresponde', customMsg: 'Se indica a partir de los 30 años.' };
        }
    }

    if (k.includes('ALCOHOL')) {
        if (v.includes('no abusa') || v.includes('no') || v.includes('sin riesgo')) return { color: 'green', icon: 'check', text: 'Calma', customMsg: 'Mantiene un consumo responsable o nulo.' };
        if (v.includes('abusa') || v.includes('si') || v.includes('riesgo')) return { color: 'red', icon: 'times', text: 'Alerta', customMsg: 'Consumo de riesgo detectado. Busque asesoramiento profesional.' };
    }

    if (k.includes('TABACO') || k.includes('FUMA')) {
        if (v.includes('no fuma') || v.includes('no')) return { color: 'green', icon: 'check', text: 'Calma', customMsg: 'Vivir libre de humo es la mejor decisión.' };
        if (v.includes('fuma') || v.includes('si') || v.includes('fumador')) return { color: 'red', icon: 'times', text: 'Alerta', customMsg: 'El tabaquismo daña su salud. Consultar programas de cesación.' };
    }

    if (k.includes('VIOLENCIA')) {
        if (v.includes('no se verifica') || v.includes('no presenta') || v === 'no') return { color: 'green', icon: 'check', text: 'Calma', customMsg: 'No se detectan indicadores de riesgo.' };
        if (v.includes('se verifica') || v.includes('si') || v.includes('detectada')) return { color: 'red', icon: 'exclamation', text: 'Alerta', customMsg: 'Situación de riesgo. IAPOS cuenta con equipos de contención.' };
    }

    if (k.includes('DEPRESION')) {
        if (v.includes('no se verifica') || v.includes('no presenta') || v === 'no') return { color: 'green', icon: 'check', text: 'Calma', customMsg: 'Estado de ánimo estable según el tamizaje.' };
        if (v.includes('se verifica') || v.includes('si') || v.includes('detectada')) return { color: 'red', icon: 'exclamation', text: 'Alerta', customMsg: 'Signos detectados. La salud mental es prioridad, consulte.' };
    }

    if (k.includes('CAIDA')) {
        if (v.includes('no se verifica') || v.includes('no presenta') || v === 'no') return { color: 'green', icon: 'check', text: 'Calma', customMsg: 'Sin riesgo elevado de caídas detectado.' };
        if (v.includes('se verifica') || v.includes('presenta') || v.includes('si')) return { color: 'red', icon: 'exclamation', text: 'Alerta', customMsg: 'Riesgo de caídas detectado. Evalúe el entorno.' };
    }

    if (k.includes('SEGURIDAD') && k.includes('VIAL')) {
        if (v.includes('no cumple')) return { color: 'red', icon: 'exclamation', text: 'Alerta', customMsg: 'Riesgo alto. Use cinturón/casco y respete las normas.' };
        if (v.includes('cumple')) return { color: 'green', icon: 'check', text: 'Calma', customMsg: 'Cumple con las normas de seguridad.' };
    }

    if (k.includes('ESTRATIFICACION') || k.includes('RIESGO CV') || k.includes('GLOBAL')) {
        if (v.includes('alto') || v.includes('muy alto')) return { color: 'red', icon: 'exclamation', text: 'Alerta', customMsg: 'Riesgo Cardiovascular ALTO. Seguimiento estricto necesario.' };
        if (v.includes('medio') || v.includes('moderado')) return { color: 'yellow', icon: 'exclamation', text: 'Precaución', customMsg: 'Riesgo Moderado. Se sugieren controles periódicos.' };
        if (v.includes('bajo')) return { color: 'green', icon: 'check', text: 'Calma', customMsg: 'Riesgo Bajo. ¡Sigue cuidándote así!' };
    }

    if (k.includes('ANEURISMA') || k.includes('AORTA')) {
        if (v.includes('se verifica') || v.includes('detectado') || v.includes('presente') || v === 'si') return { color: 'red', icon: 'times', text: 'Alerta', customMsg: 'Patología detectada. Requiere derivación urgente.' };
        if (noRealizado) {
            if (sexo === 'masculino' && edad >= 75) return { color: 'red', icon: 'exclamation', text: 'Atención', customMsg: 'Indicado en varones mayores de 75.' };
            return { color: 'gray', icon: 'info', text: 'No Corresponde', customMsg: 'Indicado solo en varones mayores de 75 años.' };
        }
    }

    if (k.includes('EPOC') || k.includes('ESPIROMETRIA')) {
        if (v.includes('se verifica') || v.includes('detectado') || v.includes('obstruccion') || v === 'si') return { color: 'red', icon: 'times', text: 'Alerta', customMsg: 'Signos de EPOC detectados. Requiere tratamiento.' };
        if (noRealizado) return { color: 'gray', icon: 'info', text: 'Condicional', customMsg: 'Este estudio se realiza solo en fumadores.' };
    }

    if (k.includes('ERC') || k.includes('RENAL') || k.includes('RIÑON')) {
        if (v.includes('patologic') || v.includes('anormal') || v.includes('alterad') || v.includes('estadio')) return { color: 'red', icon: 'times', text: 'Alerta', customMsg: 'Función renal alterada. Consulte a su médico.' };
    }

    if (k.includes('AGUDEZA') || k.includes('VISUAL')) {
        if (v.includes('alterada') || v.includes('disminuida') || v.includes('anormal')) return { color: 'yellow', icon: 'eye', text: 'Atención', customMsg: 'Visión con alteraciones leves. Control oftalmológico periódico.' };
    }

    if (k.includes('ODONTO') || k.includes('BUCAL')) {
        if (v === 'riesgo' || v.includes('alto riesgo')) return { color: 'red', icon: 'times', text: 'Alerta', customMsg: 'Riesgo detectado. Solicitar turno urgente.' };
        if (v.includes('medio') || v.includes('moderado')) return { color: 'yellow', icon: 'exclamation', text: 'Precaución', customMsg: 'Riesgo medio. Requiere control.' };
    }

    if (k.includes('ASPIRINA')) {
        if (v.includes('no indicad') || noRealizado) return { color: 'green', icon: 'check', text: 'Calma', customMsg: 'No requerida. Riesgo cardiovascular no indica medicación.' };
        if (v.includes('indicad')) return { color: 'red', icon: 'exclamation', text: 'Alerta', customMsg: 'Indicada por riesgo CV. No suspender sin orden médica.' };
    }

    if (k.includes('ACIDO FOLICO') || k.includes('FOLICO')) {
        if (v.includes('indicad') && !v.includes('no')) return { color: 'red', icon: 'exclamation', text: 'Recordatorio', customMsg: 'Importante si busca embarazo.' };
        if (noRealizado || v.includes('no indicad')) return { color: 'gray', icon: 'info', text: 'Informativo', customMsg: 'Se indica en mujeres que planean embarazo.' };
    }

    if (k.includes('OSTEOPOROSIS') || k.includes('DENSITOMETRIA') || k.includes('OSEA') || k.includes('DMO')) {
        if (v.includes('se verifica') || v.includes('osteoporosis') || v.includes('osteopenia') || v === 'si') return { color: 'red', icon: 'times', text: 'Alerta', customMsg: 'Densidad ósea reducida. Importante prevenir caídas.' };
        if (noRealizado) {
            if ((sexo === 'femenino' && edad >= 64) || (sexo === 'masculino' && edad >= 70)) return { color: 'red', icon: 'exclamation', text: 'Pendiente', customMsg: 'Por tu edad, este estudio es fundamental.' };
            return { color: 'gray', icon: 'info', text: 'No Corresponde', customMsg: 'Estudio preventivo para mayores de 64 años.' };
        }
    }

    if (k.includes('MAMOGRAFIA') || k.includes('MAMOGRAFÍA') || k.includes('ECO MAMARIA')) {
        if (v.includes('patologic') || v.includes('anormal') || v.includes('birads 4') || v.includes('birads 5') || v.includes('sospech')) return { color: 'red', icon: 'times', text: 'Alerta', customMsg: 'Hallazgo detectado. Requiere consulta ginecológica.' };
        if (noRealizado) {
            if (edad >= 40) return { color: 'red', icon: 'exclamation', text: 'Pendiente', customMsg: 'Se realiza a partir de los 40 años.' };
            return { color: 'gray', icon: 'info', text: 'A futuro', customMsg: 'Se realiza a partir de los 40 años.' };
        }
    }

    if (k.includes('SOMF') || k.includes('SANGRE OCULTA') || k.includes('COLON')) {
        const keyVCC = Object.keys(allData).find(x => x.toUpperCase().includes('VCC') || x.toUpperCase().includes('COLONOSCOPIA'));
        const valorVCC = keyVCC ? String(allData[keyVCC]).toLowerCase() : '';
        const vccHecha = valorVCC.includes('si') || valorVCC.includes('realizad') || valorVCC.includes('normal') || valorVCC.includes('patologic') || valorVCC.includes('polipo');

        if (v.includes('positivo') || v.includes('detectada') || v.includes('anormal') || v.includes('sangre')) {
            return { color: 'red', icon: 'exclamation', text: 'ALERTA', customMsg: 'SOMF Positivo. La VCC es necesaria para descartar lesiones.' };
        }
        if (v.includes('negativo') || v.includes('no se detecta') || v.includes('normal')) {
            if (edad > 60 && !vccHecha) return { color: 'yellow', icon: 'info', text: 'Sugerencia', customMsg: 'SOMF Normal. Es recomendable programar VCC si nunca la realizó.' };
            if (edad > 50) return { color: 'yellow', icon: 'info', text: 'Bien', customMsg: 'Normal. Recuerde que la VCC cada 5 años es el método ideal.' };
            return { color: 'green', icon: 'check', text: 'Normal', customMsg: 'Valor normal.' };
        }
        if (noRealizado) {
            if (edad > 60 && !vccHecha) return { color: 'red', icon: 'exclamation', text: 'Pendiente', customMsg: 'Mayor de 60 años: La VCC es prioridad.' };
            if (edad >= 50) return { color: 'red', icon: 'exclamation', text: 'Pendiente', customMsg: 'A partir de los 50 años el rastreo es obligatorio.' };
            return { color: 'gray', icon: 'info', text: 'A futuro', customMsg: 'Rastreo indicado a partir de los 50 años.' };
        }
    }

    if (k.includes('PAP') || k.includes('PAPA') || k.includes('HPV') || k.includes('VPH')) {
        if (v.includes('patologic') || v.includes('anormal') || v.includes('lesion') || v.includes('sil') || v.includes('cin') || v.includes('positivo')) return { color: 'red', icon: 'times', text: 'Alerta', customMsg: 'Resultado patológico. Requiere consulta ginecológica.' };
        if (noRealizado) {
            if (k.includes('HPV') && edad > 30) return { color: 'red', icon: 'exclamation', text: 'Pendiente', customMsg: 'Test de VPH indicado mayores de 30 años.' };
            if (k.includes('PAP') && edad > 21) return { color: 'red', icon: 'exclamation', text: 'Pendiente', customMsg: 'PAP indicado mayores de 21 años.' };
            return { color: 'gray', icon: 'info', text: 'No Corresponde', customMsg: 'Aún no tiene edad de screening.' };
        }
    }

    if (k.includes('PROSTATA') || k.includes('PSA')) {
        if (v.includes('normal') || v.includes('bajo') || v.includes('negativo') || v.includes('adecuado')) return { color: 'green', icon: 'check', text: 'Calma', customMsg: 'Los valores están dentro de lo normal.' };
        if (!noRealizado && (v.includes('elevado') || v.includes('alto') || v.includes('patologic'))) return { color: 'red', icon: 'times', text: 'Alerta', customMsg: 'Valor elevado. Consultar con urología.' };
        if (noRealizado) {
            if (edad >= 50) return { color: 'red', icon: 'exclamation', text: 'Pendiente', customMsg: 'A partir de los 50 años el control es fundamental.' };
            return { color: 'gray', icon: 'info', text: 'A futuro', customMsg: 'Se indica a partir de los 50 años.' };
        }
    }

    if (k.includes('INMUNIZACIONES') || k.includes('VACUNAS')) {
        if (v.includes('incompleto') || v.includes('falta')) return { color: 'red', icon: 'times', text: 'Alerta', customMsg: 'Esquema incompleto. Acuda al vacunatorio.' };
    }

    if (k.includes('ALIMENTACION') || k.includes('NUTRICION')) {
        if (v === 'no' || v.includes('mala')) return { color: 'red', icon: 'exclamation', text: 'Alerta', customMsg: 'Mejorar hábitos.' };
        if (v === 'si' || v.includes('buena')) return { color: 'green', icon: 'check', text: 'Calma', customMsg: '¡Muy bien!' };
    }

    if (['PROFESIONAL', 'FECHAX', 'DNI', 'MARCA TEMPORAL'].includes(k)) return { color: 'gray', icon: 'info', text: 'Informativo' };

    if (v === 'si' || v === 'sí' || v === 'buena' || v.includes('normal') || v.includes('adecuada') || 
        v.includes('no presenta') || v.includes('no se verifica') || v.includes('no fuma') || 
        v.includes('cumple') || v.includes('bajo') || (v.includes('realiza') && !v.includes('no')) || 
        v.includes('completo') || v.includes('negativo')) {
        return { color: 'green', icon: 'check', text: 'Calma' };
    }

    if (v === 'no' || v === 'No' || v.includes('presenta') || v.includes('elevado') || v.includes('anormal') || 
        v.includes('alto') || v.includes('no control') || v.includes('no realiza') || v.includes('pendiente') || 
        v.includes('riesgo alto') || v.includes('positivo') || v.includes('incompleto') || 
        v.includes('obesidad') || v.includes('hipertensión') || v.includes('patologic')) {
        return { color: 'red', icon: 'times', text: 'Alerta' };
    }

    if (k.includes('IMC') && (v.includes('sobrepeso') || v.includes('bajo peso'))) return { color: 'yellow', icon: 'exclamation', text: 'Atención' };
    if (v.includes('mejorar') || v.includes('moderar') || v.includes('a vigilar') || v.includes('límite') || v.includes('riesgo moderado')) return { color: 'yellow', icon: 'exclamation', text: 'Atención' };

    if (v === 'si' || v.includes('normal')) return { color: 'green', icon: 'check', text: 'Bien' };
    if (v === 'no' || v.includes('anormal')) return { color: 'red', icon: 'times', text: 'Alerta' };

    return { color: 'gray', icon: 'question', text: 'Sin Dato' };
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

async function updateDashboardContent(selectedIndex) {
    const nuevoReporte = allReports[selectedIndex];
    if (!nuevoReporte) return;
    reporteSeleccionado = nuevoReporte;
    const resumenAIFecha = await obtenerResumenAI(nuevoReporte);
    cargarDiaPreventivoTab(nuevoReporte, resumenAIFecha);
}
// 4. CONTENIDO DE LAS PESTAÑAS (AQUÍ CAPTURAMOS SI ES "PENDIENTE")
// ==============================================================================
function cargarDiaPreventivoTab(persona) {
    const fechaInforme = persona['FECHAX'] || 'N/A';
    const dashboardContenedor = document.getElementById('dashboard-contenido');
    const accionesContenedor = document.getElementById('dashboard-acciones');

    const keyEdad = Object.keys(persona).find(k => k.toLowerCase() === 'edad');
    let edadPaciente = keyEdad && persona[keyEdad] ? parseInt(String(persona[keyEdad]).match(/\d+/)?.[0] || 0) : 0;

    const keySexo = Object.keys(persona).find(k => k.toLowerCase() === 'sexo' || k.toLowerCase() === 'género' || k.toLowerCase() === 'genero');
    let sexo = '';
    if (keySexo && persona[keySexo]) {
        sexo = String(persona[keySexo]).toLowerCase().trim();
    } else {
        sexo = String(window.pacienteSexo || '').toLowerCase().trim(); 
    }
    if (sexo.includes('masc') || sexo.includes('varon') || sexo === 'm') sexo = 'masculino';
    if (sexo.includes('fem') || sexo.includes('mujer') || sexo === 'f') sexo = 'femenino';
    
    let dateSelectorHTML = ''; 
    if (typeof allReports !== 'undefined' && allReports.length > 1) { 
        const optionsHtml = allReports.map((report, index) => `
            <option value="${index}" ${report.FECHAX === fechaInforme ? 'selected' : ''}>Día Preventivo del ${report.FECHAX} ${index === 0 ? ' (Más Reciente)' : ''}</option>
        `).join('');
        dateSelectorHTML = `<div class="mb-6 p-4 bg-yellow-50 border-l-4 border-yellow-500 rounded-lg shadow-md"><label for="report-date-selector" class="block text-md font-bold text-yellow-800 mb-2"><i class="fas fa-history mr-2"></i> Historial de Informes Previos</label><select id="report-date-selector" class="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none sm:text-sm rounded-md shadow-inner">${optionsHtml}</select></div>`;
    }

    let tarjetasHTML = '';
    let resultadosParaMotorLocal = [];

    for (const [key, value] of Object.entries(persona)) {
        const vLimpio = String(value || '').trim();
        if (!vLimpio || (vLimpio.length === 1 && isNaN(vLimpio))) continue;
        const basura = ['-', '--', '.', '..', '/', 'n/a', 's/d', 'sd', 'sin dato', 'no aplica'];
        if (basura.includes(vLimpio.toLowerCase())) continue;
        if (['DNI', 'ID', 'apellido y nombre', 'Efector', 'Tipo', 'Marca temporal', 'FECHAX', 'Profesional', 'REPORTE_MEDICO'].includes(key)) continue;

        const safeValue = String(value || '');
        const keyUpper = key.toUpperCase();
        const isRawDate = keyUpper === 'RAWDATE' || safeValue.includes('RAWDATE');
        const isIsoDate = safeValue.includes('T') && safeValue.includes('Z') && safeValue.length > 15;
        if (isRawDate || isIsoDate || safeValue.trim() === '') continue;

        const keyNormalized = keyUpper.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const terminosFemeninos = ['MAMOGRAFIA', 'ECO_MAMARIA', 'ECO MAMARIA', 'HPV', 'PAP', 'ACIDO FOLICO', 'UTERINO', 'CERVICO'];
        const terminosMasculinos = ['PROSTATA', 'PSA'];

        if (sexo === 'masculino' && terminosFemeninos.some(t => keyNormalized.includes(t))) continue;
        if ((sexo === 'femenino' || sexo === 'mujer') && terminosMasculinos.some(t => keyNormalized.includes(t))) continue;

        const risk = getRiskLevel(key, safeValue, edadPaciente, sexo, persona);
        
        if (risk.color !== 'violet' && risk.color !== 'gray') {
            // AHORA GUARDAMOS EL ESTADO (Para saber si es PENDIENTE o PATOLÓGICO)
            resultadosParaMotorLocal.push({ 
                indicador: key, 
                color: risk.color, 
                estado: risk.text,  // <-- Esto es clave para la biblioteca
                valor: safeValue,
                customMsg: risk.customMsg || risk.text 
            });
        }

        const colorMap = { red: 'bg-red-100 border-red-500 text-red-700', yellow: 'bg-yellow-100 border-yellow-500 text-yellow-700', green: 'bg-green-100 border-green-500 text-green-700', gray: 'bg-gray-100 border-gray-400 text-gray-600', violet: 'bg-purple-100 border-purple-500 text-purple-700' };
        const iconMap = { times: 'fas fa-times-circle', exclamation: 'fas fa-exclamation-triangle', check: 'fas fa-check-circle', question: 'fas fa-question-circle', info: 'fas fa-info-circle' };

        tarjetasHTML += `
            <div class="p-4 border-l-4 ${colorMap[risk.color] || colorMap.gray} rounded-md shadow-sm transition hover:shadow-lg">
                <div class="flex items-center justify-between mb-1">
                    <h3 class="font-bold text-md">${key}</h3>
                    <span class="font-semibold text-sm px-2 py-0.5 rounded-full bg-white border border-gray-200 shadow-sm text-gray-700 whitespace-nowrap ml-2">${risk.text}</span>
                </div>
                <p class="text-sm italic mb-2 text-gray-800 mt-2">${safeValue}</p>
                <div class="text-xs flex items-center mt-3 border-t pt-2 border-${risk.color}-200 opacity-90 font-medium">
                    <i class="${iconMap[risk.icon] || iconMap.info} mr-2"></i> ${risk.customMsg || safeValue}
                </div>
            </div>`;
    }

    const informeFinalHTML = persona['REPORTE_MEDICO'] ? persona['REPORTE_MEDICO'] : generarResumenMedicoLocal(persona, resultadosParaMotorLocal);

    window.datosImpresionActual = {
        nombre: persona['apellido y nombre'] || 'Afiliado',
        texto: informeFinalHTML
    };

    dashboardContenedor.innerHTML = `
        ${dateSelectorHTML} 
        <div id="informe-imprimible" class="shadow-xl rounded-lg overflow-hidden bg-white p-6">
            <div id="ai-summary-dynamic" class="mb-6 rounded-lg"></div>
            <h2 class="text-xl font-semibold mb-3 mt-8 text-gray-800 border-b pb-2">Detalle Clínico de Indicadores</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">${tarjetasHTML}</div>
        </div>
    `;

    configurarEditorInformeLocal(persona, informeFinalHTML);

    if (typeof allReports !== 'undefined' && allReports.length > 1) {
        document.getElementById('report-date-selector')?.addEventListener('change', (e) => updateDashboardContent(e.target.value));
    }

    accionesContenedor.innerHTML = `
        <div class="mt-4 p-4 border border-blue-200 bg-blue-50 rounded-lg shadow-md text-left w-full md:w-3/4 mx-auto mb-6">
            <p class="font-bold text-lg text-blue-800 mb-2"><i class="fas fa-phone-square-alt mr-2"></i> Contacto Directo del Programa</p>
            <p class="text-gray-700 mb-1"><span class="font-semibold">Teléfono:</span> <a href="tel:3424071702" class="text-blue-600 font-medium">342 407-1702</a></p>
            <p class="text-gray-700"><span class="font-semibold">Mail:</span> <a href="mailto:diapreventivoiapos@diapreventivo.com" class="text-blue-600 font-medium">diapreventivoiapos@diapreventivo.com</a></p>
        </div>
        <div class="flex flex-wrap items-center justify-center py-4">
            <button onclick="mostrarInformeEscrito()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition mx-2 mt-2"><i class="fas fa-file-alt mr-2"></i> Informe Escrito (Ver/Imprimir)</button>
            <button onclick="compartirDashboard()" class="bg-gray-400 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg shadow-md transition mx-2 mt-2"><i class="fas fa-share-alt mr-2"></i> Compartir Portal</button>
        </div>
    `;
}
// ==============================================================================
// 5. BARRA DE HERRAMIENTAS DEL INFORME
// ==============================================================================
function configurarEditorInformeLocal(persona, informeHTML) {
    const containerAI = document.getElementById('ai-summary-dynamic');
    containerAI.innerHTML = ""; 

    const tabContainer = document.createElement('div');
    tabContainer.className = "flex border-b border-gray-300 mb-4";
    const tabVista = document.createElement('button');
    tabVista.className = "py-2 px-6 text-blue-600 border-b-2 border-blue-600 font-bold focus:outline-none bg-white hover:bg-gray-50 rounded-t-md transition";
    tabVista.innerHTML = '<i class="fas fa-file-medical text-lg mr-2"></i> Informe del Paciente';
    tabContainer.appendChild(tabVista);
    containerAI.appendChild(tabContainer);

    const divInforme = document.createElement('div');
    divInforme.id = "contenido-informe-visual";
    divInforme.className = "bg-white p-2 min-h-[200px]";
    divInforme.innerHTML = informeHTML; 
    containerAI.appendChild(divInforme);
    
    if (currentUser && currentUser.rol === 'admin') {
        const barraHerramientas = document.createElement('div');
        barraHerramientas.className = "mt-6 flex justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-200";
        
        barraHerramientas.innerHTML = `
            <div class="text-xs text-gray-500 font-medium">
                <i class="fas fa-edit text-blue-500"></i> Opciones de Médico
            </div>
            <div>
                <button id="btn-editar-visual" class="bg-white text-blue-700 border border-blue-300 px-4 py-2 rounded shadow-sm hover:bg-blue-50 transition font-medium text-sm mr-2">
                    <i class="fas fa-pen mr-2"></i>Editar Texto
                </button>
                <button id="btn-guardar-visual" class="bg-green-600 text-white px-6 py-2 rounded shadow hover:bg-green-700 transition font-bold text-sm">
                    <i class="fas fa-check mr-2"></i>Guardar / Confirmar
                </button>
                <button id="btn-cancelar-visual" class="hidden bg-gray-400 text-white px-3 py-2 rounded shadow hover:bg-gray-500 transition font-medium text-sm ml-2">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        containerAI.appendChild(barraHerramientas);

        const btnEditar = document.getElementById('btn-editar-visual');
        const btnGuardar = document.getElementById('btn-guardar-visual');
        const btnCancelar = document.getElementById('btn-cancelar-visual');

        btnEditar.onclick = () => alternarEdicionVisual(true, divInforme);

        btnGuardar.onclick = async () => {
            const textoFinal = divInforme.innerHTML;
            const btnTextoOriginal = btnGuardar.innerHTML;
            btnGuardar.disabled = true;
            btnGuardar.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Guardando...';

            try {
                const response = await fetch('/api/actualizar-informe-ia', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        dni: persona.DNI || persona.dni,
                        nombre: persona['apellido y nombre'], 
                        nuevoInforme: textoFinal 
                    })
                });

                if (!response.ok) throw new Error("Error al guardar");

                window.datosImpresionActual.texto = textoFinal;
                Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: '¡Informe Guardado!', showConfirmButton: false, timer: 2000 });
                alternarEdicionVisual(false, divInforme);

            } catch (error) {
                console.error("Error:", error);
                Swal.fire('Error', 'No se pudo guardar.', 'error');
            } finally {
                btnGuardar.disabled = false;
                btnGuardar.innerHTML = btnTextoOriginal;
            }
        };

        btnCancelar.onclick = () => {
            divInforme.innerHTML = informeHTML; 
            window.datosImpresionActual.texto = informeHTML;
            alternarEdicionVisual(false, divInforme);
        };
    }
}

function alternarEdicionVisual(activar, elementoTexto) {
    const btnEditar = document.getElementById('btn-editar-visual');
    const btnGuardar = document.getElementById('btn-guardar-visual');
    const btnCancelar = document.getElementById('btn-cancelar-visual');
    
    if (activar) {
        elementoTexto.contentEditable = "true";
        elementoTexto.style.outline = "2px dashed #3b82f6";
        elementoTexto.style.backgroundColor = "#ffffff";
        elementoTexto.focus();

        if(btnEditar) btnEditar.classList.add('hidden');
        if(btnCancelar) btnCancelar.classList.remove('hidden');
        if(btnGuardar) btnGuardar.innerHTML = '<i class="fas fa-save mr-2"></i>Guardar Cambios';

    } else {
        elementoTexto.contentEditable = "false";
        elementoTexto.style.outline = "none";
        elementoTexto.style.backgroundColor = "transparent";

        if(btnEditar) btnEditar.classList.remove('hidden');
        if(btnCancelar) btnCancelar.classList.add('hidden');
        if(btnGuardar) btnGuardar.innerHTML = '<i class="fas fa-check mr-2"></i>Guardar / Confirmar';
    }
}

// ==============================================================================
// 7. FUNCIONES DE UTILIDAD 
// ==============================================================================
function mostrarInformeEscrito() {
    let datos = window.datosImpresionActual;
    
    if (!datos || !datos.texto) {
        const divContenido = document.getElementById('ai-summary-dynamic');
        if (divContenido && !divContenido.innerHTML.includes('<textarea')) {
            datos = {
                nombre: reporteSeleccionado ? reporteSeleccionado['apellido y nombre'] : 'Paciente',
                texto: divContenido.innerHTML 
            };
        }
    }

    if (!datos || !datos.texto || datos.texto.length < 10) {
        return Swal.fire('Atención', 'No hay un informe generado disponible para imprimir.', 'warning');
    }

    const nombre = datos.nombre;
    let resumenAI = datos.texto; 

    if (resumenAI.includes('btn-editar-existente')) {
        resumenAI = resumenAI.split('<div class="mt-2 text-right border-t pt-2">')[0];
    }

    const contactoHtml = `
        <div class="mt-8 border-t-2 border-gray-300 pt-4">
            <p class="text-sm text-gray-700 italic mb-2">
                Este informe es un resumen preventivo. Para consultas específicas:
            </p>
            <div class="flex justify-between text-sm font-semibold text-blue-900">
                <span><i class="fas fa-phone"></i> 342 407-1702</span>
                <span><i class="fas fa-envelope"></i> diapreventivoiapos@diapreventivo.com</span>
            </div>
        </div>
    `;

    const printableContent = `
        <div class="p-8 bg-white">
            <div class="text-center mb-6 border-b-2 border-blue-500 pb-4">
                <h1 class="text-3xl font-bold text-blue-900">Informe de Salud Preventiva</h1>
                <p class="text-lg text-gray-600 mt-2">Paciente: <b>${nombre}</b></p>
            </div>
            
            <div class="text-left text-gray-800 leading-relaxed">
                ${resumenAI}
            </div>

            ${contactoHtml}
        </div>
    `;

    Swal.fire({
        html: `<div id="modal-informe-ai">${printableContent}</div>`,
        width: '800px', 
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-print"></i> Imprimir',
        cancelButtonText: 'Cerrar',
        confirmButtonColor: '#2563EB',
        showCloseButton: true,
        focusConfirm: false,
        preConfirm: () => {
            imprimirContenido('modal-informe-ai', `Informe IAPOS - ${nombre}`);
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
                <button onclick="Swal.close(); mostrarInformeEscrito()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition duration-200">
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

const btnBuscar = document.getElementById('btn-buscar');
const inputBuscar = document.getElementById('dni-input');

if (btnBuscar && inputBuscar) {
    btnBuscar.addEventListener('click', () => {
        const dniEscrito = inputBuscar.value.trim();
        if (dniEscrito) {
            iniciarPortal(dniEscrito);
        } else {
            Swal.fire('Atención', 'Escribe un DNI para buscar.', 'warning');
        }
    });

    inputBuscar.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            btnBuscar.click();
        }
    });
}

async function cambiarClave() {
    const usuarioLogueadoStr = localStorage.getItem('iapos_user');
    
    if (!usuarioLogueadoStr) {
        Swal.fire('Alto ahí ✋', 'Debes iniciar sesión primero para cambiar tu clave.', 'warning');
        return;
    }

    const usuarioLogueado = JSON.parse(usuarioLogueadoStr);

    const { isConfirmed } = await Swal.fire({
        title: '🔒 Cambio de Seguridad',
        html: `Vas a cambiar la contraseña del usuario:<br>
                <b>DNI: ${usuarioLogueado.dni}</b><br>
                <small>(Si no eres tú, cancela y cierra sesión)</small>`,
        icon: 'info',
        showCancelButton: true,
        confirmButtonText: 'Sí, continuar',
        cancelButtonText: 'Cancelar'
    });

    if (!isConfirmed) return;

    const { value: nueva } = await Swal.fire({
        title: 'Nueva Contraseña',
        input: 'password',
        inputLabel: 'Ingresa la nueva clave',
        inputPlaceholder: 'Mínimo 4 caracteres',
        showCancelButton: true
    });

    if (!nueva) return;

    if (nueva.length < 4) {
        Swal.fire('Muy corta', 'La contraseña debe tener al menos 4 caracteres.', 'warning');
        return;
    }

    const { value: confirmacion } = await Swal.fire({
        title: 'Confirma la Contraseña',
        input: 'password',
        inputLabel: 'Escríbela de nuevo',
        showCancelButton: true
    });

    if (nueva !== confirmacion) {
        Swal.fire('Error', 'Las contraseñas no coinciden. Intenta de nuevo.', 'error');
        return;
    }

    try {
        Swal.showLoading(); 
        
        const response = await fetch('/api/auth/cambiar-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                dni: usuarioLogueado.dni, 
                nuevaClave: nueva 
            })
        });

        const data = await response.json();

        if (data.success) {
            Swal.fire('¡Listo! 🚀', 'Tu contraseña se cambió correctamente.', 'success');
        } else {
            Swal.fire('Error', data.error || 'No se pudo cambiar.', 'error');
        }

    } catch (error) {
        console.error("Error cambiarClave:", error);
        Swal.fire('Error', 'Error de conexión.', 'error');
    }
}

const btnNuevaBusqueda = document.getElementById('btn-nueva-busqueda');
if (btnNuevaBusqueda) {
    btnNuevaBusqueda.addEventListener('click', () => {
        document.getElementById('search-container').style.display = 'flex';
        document.getElementById('dni-input').value = '';
        document.getElementById('dni-input').focus();
    });
}

const btnCerrarBusqueda = document.getElementById('btn-cerrar-busqueda');
if (btnCerrarBusqueda) {
    btnCerrarBusqueda.addEventListener('click', () => {
        document.getElementById('search-container').style.display = 'none';
    });
}

async function crearUsuarioRapido() {
    const dniInput = document.getElementById('admin-dni-input');
    const dni = dniInput.value.trim();

    if (!dni || dni.length < 6) return Swal.fire('Error', 'Ingresa un DNI válido', 'warning');

    const btn = event.currentTarget; 
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        const response = await fetch('/api/admin/crear-usuario-rapido', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dni })
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('admin-resultado').classList.remove('hidden');
            document.getElementById('admin-pass-display').innerText = data.password;

            let nombrePaciente = "";
            if (window.datosImpresionActual && window.datosImpresionActual.nombre) {
                nombrePaciente = window.datosImpresionActual.nombre; 
            }

            const saludo = nombrePaciente ? `Hola *${nombrePaciente}*! 👋` : `Hola! 👋`;
            const mensaje = `${saludo} Desde el Programa Día Preventivo IAPOS te enviamos tus credenciales de acceso para que puedas acceder a tu Portal Personal de Salud donde encontrarás los resultados de tus estudios y las recomendaciones de tu equipo de salud! Gracias por hacerte el Día Preventivo y te esperamos pronto.\n\n🆔 *Usuario (DNI):* ${data.dni}\n🔒 *Clave Provisoria:* ${data.password}\n\nIngresa ahora para ver tus estudios: https://portal-afiliado-iapos.onrender.com/`;
            
            const linkWhatsapp = `https://wa.me/?text=${encodeURIComponent(mensaje)}`;
            document.getElementById('btn-whatsapp-share').href = linkWhatsapp;

            Swal.fire({
                toast: true, position: 'top-end', icon: 'success', 
                title: 'Usuario Generado', showConfirmButton: false, timer: 1500
            });
            
            dniInput.value = ''; 

        } else {
            Swal.fire('Error', data.error || 'No se pudo crear', 'error');
        }

    } catch (error) {
        console.error(error);
        Swal.fire('Error', 'Fallo de conexión', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function resetearPanelAltaRapida() {
    const resultadoContainer = document.getElementById('admin-resultado');
    if (resultadoContainer) resultadoContainer.classList.add('hidden');

    const dniInput = document.getElementById('admin-dni-input');
    if (dniInput) dniInput.value = '';

    const passwordDisplay = document.getElementById('admin-pass-display');
    if (passwordDisplay) passwordDisplay.innerText = '...';
}  

const botonBuscarOtro = document.getElementById('btn-nueva-busqueda');
if (botonBuscarOtro) {
    botonBuscarOtro.addEventListener('click', () => {
        resetearPanelAltaRapida();
    });
}
// ==============================================================================
// 🧠 MOTOR DE SÍNTESIS CLÍNICA LOCAL (SISTEMA DE TRIAGE + BIBLIOTECA)
// ==============================================================================

function generarResumenMedicoLocal(persona, resultadosEvaluados) {
    const nombreCompleto = persona['apellido y nombre'] || persona['Nombre'] || 'Paciente';
    
    let primerNombre = "Paciente";
    if (nombreCompleto !== 'Paciente') {
        if (nombreCompleto.includes(',')) {
            primerNombre = nombreCompleto.split(',')[1].trim().split(' ')[0];
        } else {
            const partes = nombreCompleto.trim().split(' ');
            primerNombre = partes.length > 1 ? partes[1] : partes[0];
        }
        primerNombre = primerNombre.charAt(0).toUpperCase() + primerNombre.slice(1).toLowerCase();
    }

    const dni = persona['DNI'] || persona['dni'] || 'S/D';
    const fecha = persona['FECHAX'] || 'S/D';
    const profesional = persona['Profesional'] || persona['PROFESIONAL'] || 'tu equipo médico';
    const efector = persona['Efector'] || persona['EFECTOR'] || 'IAPOS';

    let html = `
        <div class="overflow-x-auto mb-8 mt-4">
            <table class="min-w-full bg-gray-50 rounded-lg overflow-hidden text-sm text-left text-gray-700 shadow-sm border border-gray-200">
                <thead class="bg-gray-100 text-gray-600 font-semibold border-b border-gray-200">
                    <tr>
                        <th class="py-3 px-4">Fecha</th>
                        <th class="py-3 px-4">Profesional Responsable</th>
                        <th class="py-3 px-4">Efector (Lugar)</th>
                        <th class="py-3 px-4">DNI</th>
                        <th class="py-3 px-4">Paciente</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td class="py-3 px-4">${fecha}</td>
                        <td class="py-3 px-4 font-medium">${profesional}</td>
                        <td class="py-3 px-4">${efector}</td>
                        <td class="py-3 px-4">${dni}</td>
                        <td class="py-3 px-4 font-bold text-blue-700">${nombreCompleto}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <h2 class="text-3xl font-bold text-gray-800 mb-3">Hola ${primerNombre},</h2>
        <p class="text-gray-600 mb-8 leading-relaxed text-lg">
            Te felicitamos por haberte decidido a hacer el <strong>Día Preventivo</strong> y pensar en tu salud de manera seria y responsable. 
            Este es tu informe personal, elaborado estrictamente en base a la evaluación clínica de <strong>${profesional}</strong>. 
            A continuación, hemos organizado tus resultados por nivel de prioridad para ayudarte a tomar las mejores decisiones.
        </p>
    `;

    const rojos = resultadosEvaluados.filter(r => r.color === 'red');
    const amarillos = resultadosEvaluados.filter(r => r.color === 'yellow');
    const verdes = resultadosEvaluados.filter(r => r.color === 'green');

    // CAJA ROJA
    if (rojos.length > 0) {
        html += `
        <div class="bg-red-50 border-l-8 border-red-600 p-6 rounded-lg mb-8 shadow-md">
            <div class="flex items-center mb-4">
                <i class="fas fa-exclamation-circle text-red-600 text-3xl mr-3"></i>
                <h3 class="text-2xl font-bold text-red-800">Prioridad Alta: Foco Inmediato</h3>
            </div>
            <p class="text-red-700 font-medium mb-5 text-lg">
                Vamos a hacer foco en los temas de tu salud de los que nos gustaría que te ocupes de manera pronta. Por favor, revisa lo siguiente:
            </p>
            <div class="space-y-4">
        `;
        
        rojos.forEach(item => {
            // Llama a tu biblioteca externa. Si por algún error no carga, usa el texto normal.
            const textoLargo = typeof traducirMensajeParaPaciente === 'function' 
                ? traducirMensajeParaPaciente(item) 
                : item.customMsg;

            // Diferenciamos visualmente si es una patología o solo un estudio pendiente
            const esPendiente = item.estado && item.estado.toUpperCase().includes('PENDIENTE');
            const iconoItem = esPendiente ? 'fa-clock text-red-500' : 'fa-notes-medical text-red-700';

            html += `
                <div class="bg-white p-4 rounded border border-red-200 shadow-sm">
                    <h4 class="font-bold text-red-700 text-lg mb-1"><i class="fas ${iconoItem} mr-2"></i>${item.indicador}</h4>
                    <p class="text-gray-800">${textoLargo}</p>
                </div>
            `;
        });
        html += `</div></div>`;
    }

    // CAJA AMARILLA
    if (amarillos.length > 0) {
        html += `
        <div class="bg-yellow-50 border-l-8 border-yellow-500 p-6 rounded-lg mb-8 shadow-md">
            <div class="flex items-center mb-4">
                <i class="fas fa-exclamation-triangle text-yellow-600 text-3xl mr-3"></i>
                <h3 class="text-2xl font-bold text-yellow-800">Para ocuparse! no te dejes estar</h3>
            </div>
            <p class="text-yellow-700 font-medium mb-5 text-lg">
                Estos indicadores no representan una emergencia ahora, pero es importante que te ocupes de ellos a mediano plazo:
            </p>
            <div class="space-y-4">
        `;
        
        amarillos.forEach(item => {
            const textoLargo = typeof traducirMensajeParaPaciente === 'function' 
                ? traducirMensajeParaPaciente(item) 
                : item.customMsg;

            html += `
                <div class="bg-white p-4 rounded border border-yellow-200 shadow-sm">
                    <h4 class="font-bold text-yellow-700 text-lg mb-1">${item.indicador}</h4>
                    <p class="text-gray-800">${textoLargo}</p>
                </div>
            `;
        });
        html += `</div></div>`;
    }

    // CAJA VERDE
    if (verdes.length > 0) {
        const nombresVerdes = verdes.map(v => v.indicador).join(', ');
        html += `
        <div class="bg-green-50 border-l-8 border-green-500 p-6 rounded-lg mb-8 shadow-md">
            <div class="flex items-center mb-4">
                <i class="fas fa-check-circle text-green-600 text-3xl mr-3"></i>
                <h3 class="text-2xl font-bold text-green-800">¡A seguir cuidándose así!</h3>
            </div>
            <p class="text-green-800 font-medium mb-3 text-lg">
                ¡Queremos felicitarte! En este chequeo hemos evaluado <strong>${verdes.length} variables</strong> y los resultados indican parámetros normales o hábitos saludables. 
            </p>
            <p class="text-green-700 text-sm italic mb-4">
                (Entre ellos: ${nombresVerdes}).
            </p>
            <p class="text-green-900 font-bold bg-green-200 p-3 rounded text-center">
                Te animamos a que sigas manteniendo este compromiso con tu salud. ¡Nos vemos en tu próximo control anual!
            </p>
        </div>
        `;
    }

    if (rojos.length === 0 && amarillos.length === 0 && verdes.length === 0) {
        html += `
        <div class="bg-gray-100 border-l-8 border-gray-400 p-6 rounded-lg mb-8 shadow-md text-center">
            <p class="text-gray-600 font-medium text-lg">
                No tenemos suficientes datos clínicos cargados en tu Día Preventivo para generar una conclusión.
            </p>
        </div>`;
    }

    return html;
}

async function sincronizarBaseManual() {
    Swal.fire({
        title: 'Sincronizando...',
        text: 'Descargando datos actualizados desde Google Sheets. Aguarde por favor...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const response = await fetch('/api/admin/sincronizar', { method: 'POST' });
        const data = await response.json();

        if (response.ok) {
            Swal.fire('¡Base Actualizada!', `Se han sincronizado ${data.totalRegistros} pacientes en la memoria ultrarrápida.`, 'success');
        } else {
            throw new Error(data.error || 'Error al sincronizar');
        }
    } catch (error) {
        Swal.fire('Error', error.message, 'error');
    }
}