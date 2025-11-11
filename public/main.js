document.addEventListener('DOMContentLoaded', () => {
    // 1. Encontrar el botón para disparar la acción
    const btnVerPortal = document.getElementById('btn-ver-portal');

    if (btnVerPortal) {
        btnVerPortal.addEventListener('click', async () => {
            // 2. Pedir el DNI al usuario usando SweetAlert2
            const { value: dni } = await Swal.fire({
                title: 'Ingresá tu DNI',
                input: 'text',
                inputLabel: 'Número de Documento (sin puntos)',
                inputPlaceholder: 'Ej: 12345678',
                showCancelButton: true,
                confirmButtonText: 'Buscar mis datos',
                cancelButtonText: 'Cancelar',
                // Validación mejorada
                inputValidator: (value) => {
                    if (!value) {
                        return '¡Necesitas ingresar tu DNI!';
                    }
                    if (!/^\d{7,8}$/.test(value.trim())) { // Valida 7 u 8 dígitos numéricos
                        return 'El DNI debe ser de 7 u 8 dígitos y solo contener números.';
                    }
                }
            });

            // Si el usuario ingresó un DNI y confirmó
            if (dni) { // <-- ¡IMPORTANTE! Envuelve la lógica principal en el 'if (dni)'
                const dniLimpio = dni.trim();

                // 3. Mostrar un mensaje de carga (Loading) para la búsqueda de datos
                Swal.fire({
                    title: 'Buscando información...',
                    text: 'Conectando con la base de datos de IAPOS. Esto puede tardar unos segundos.',
                    allowOutsideClick: false,
                    showConfirmButton: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });

                try {
                    // 4. Llama al endpoint de tu servidor para buscar por DNI
                    const dataResponse = await fetch(`/api/informe/${dniLimpio}`);
                    const dataResult = await dataResponse.json();

                    if (!dataResponse.ok) {
                        throw new Error(dataResult.error || dataResult.message || 'Error desconocido al buscar el DNI.');
                    }

                    // 5. Datos encontrados con éxito. Iniciar análisis de IA.
                    // Llamar a la IA para obtener el resumen
                    const resumenAI = await obtenerResumenAI(dataResult.persona); 

                    // 6. Mostrar ambos, datos brutos y resumen de IA
                    mostrarResultados(dataResult.persona, resumenAI);

                } catch (error) {
                    // Manejo de errores 404, 500, etc.
                    Swal.fire({
                        icon: 'error',
                        title: 'Error en la búsqueda',
                        html: `No pudimos obtener tus datos.<br>
                                <strong>${error.message.includes('No se encontraron') ? 'No se encontraron datos para el DNI ingresado.' : 'Hubo un problema de conexión con el servidor. Intenta de nuevo.'}</strong>
                                <br><br>
                                Si el problema persiste, contacta a soporte.`,
                        confirmButtonText: 'Entendido'
                    });
                    console.error('Error al obtener datos del afiliado:', error);
                }
            } // Cierre del if (dni)
        });
    }
}); // <-- CIERRE CORRECTO del document.addEventListener


// =================================================================
// === FUNCIONES AUXILIARES (DEBEN IR FUERA DEL DOMContentLoaded) ===
// =================================================================


/**
 * Función para llamar al endpoint del servidor y obtener el resumen de IA.
 * @param {object} persona - El objeto con los datos del afiliado.
 */
async function obtenerResumenAI(persona) {
    try {
        // Mostrar Loading de la IA
        Swal.fire({
            title: 'Analizando tus datos de salud...',
            text: 'Generando tu informe personalizado de prevención. ¡Ya casi está!',
            allowOutsideClick: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
        
        const response = await fetch('/api/analizar-informe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(persona) // Enviamos el objeto completo de la persona
        });
        
        const result = await response.json();
        Swal.close(); // Cerrar loading de la IA

        if (!response.ok) {
            throw new Error(result.error || 'Fallo al generar el resumen.');
        }

        return result.resumen; // Devuelve el texto generado por la IA
        
    } catch (error) {
        console.error('Error en la llamada a la IA:', error);
        // Devolvemos un mensaje de error como resumen si la IA falla
        return "⚠️ **Lo sentimos, hubo un error al generar el análisis personalizado de IA.** Por favor, intenta nuevamente más tarde.";
    }
}

/**
 * Función para formatear y mostrar los datos del afiliado y el resumen de IA en un pop-up.
 * @param {object} persona - El objeto que contiene todas las columnas de la hoja de cálculo.
 * @param {string} resumenAI - El resumen de salud generado por la IA.
 */
function mostrarResultados(persona, resumenAI) {
    const nombre = persona['apellido y nombre'] || 'Afiliado'; 
    const dni = persona['DNI'] || 'N/A';
    
    // --- 1. Definición de la sección de contacto ---
    const TE = '3424 07-1702';
    const EMAIL = 'diapreventivoiapos@diapreventivo.com';

    const contactoHTML = `
        <div class="bg-blue-100 p-4 rounded-lg text-center mt-6 border border-blue-300">
            <h5 class="font-bold text-lg text-blue-800 mb-2">📞 Consulta con un Profesional</h5>
            <p class="text-gray-700">Puedes solicitar un turno o tele-orientación para revisar tu informe:</p>
            <p class="font-semibold mt-2">
                <i class="fas fa-phone-alt mr-2 text-blue-600"></i> Teléfono: <a href="tel:${TE.replace(/\s/g, '')}" class="text-blue-600 hover:text-blue-800">${TE}</a>
                <br>
                <i class="fas fa-envelope mr-2 text-blue-600"></i> Correo: <a href="mailto:${EMAIL}" class="text-blue-600 hover:text-blue-800">${EMAIL}</a>
            </p>
        </div>
    `;

    // --- 2. Generación del contenido HTML completo ---
    let contenidoHTML = `
        <div id="informe-imprimible">
            <div class="text-left p-4 border border-green-300 bg-green-50 rounded-lg mb-6 leading-relaxed">
                ${resumenAI}
            </div>

            ${contactoHTML}

            <h5 class="text-lg font-bold text-gray-700 mt-6 mb-3 border-b pb-2">📋 Ficha de Datos Brutos</h5>
            <p class="text-sm text-gray-500 mb-4">Detalle completo para referencias médicas.</p>
            
            <table class="w-full text-left table-auto border-collapse border border-gray-300 rounded-lg overflow-hidden">
                <tbody class="divide-y divide-gray-200">
        `;

    // Bucle de datos brutos
    for (const [key, value] of Object.entries(persona)) {
        const safeValue = String(value || ''); 
        if (safeValue.trim() === '') continue; 

        contenidoHTML += `
            <tr class="hover:bg-gray-100">
                <th class="py-2 px-4 bg-gray-50 font-semibold text-gray-700 w-1/3">${key}:</th>
                <td class="py-2 px-4 text-gray-800 font-medium">${safeValue}</td>
            </tr>
        `;
    }

    contenidoHTML += `
                </tbody>
            </table>
        </div> `;

    // --- 3. Mostrar la información con SweetAlert2 y botones de acción ---
    Swal.fire({
        title: `¡Hola, ${nombre}! 👋 Tu Portal de Prevención`,
        html: contenidoHTML,
        icon: 'success',
        // Usamos solo un botón de confirmación, y botones HTML personalizados
        showConfirmButton: true,
        confirmButtonText: 'Cerrar',
        
        // Botones de acción personalizados
        showCancelButton: true,
        cancelButtonText: '<i class="fas fa-share-alt"></i> Compartir',
        showDenyButton: true,
        denyButtonText: '<i class="fas fa-print"></i> Imprimir/PDF',
        
        customClass: {
            container: 'swal2-container',
            popup: 'swal2-popup w-full md:w-3/4 lg:w-4/5',
        },
        
        // 🚨 NUEVA LÓGICA: Usamos el parámetro didOpen para agregar un listener de clic
        didOpen: () => {
            const printButton = Swal.getDenyButton(); // Es el botón de Imprimir/PDF
            const shareButton = Swal.getCancelButton(); // Es el botón de Compartir

            // Listener para Imprimir/PDF
            if (printButton) {
                printButton.onclick = () => {
                    const contenido = document.getElementById('informe-imprimible').innerHTML;
                    imprimirContenido(contenido, nombre, dni);
                };
            }

            // Listener para Compartir
            if (shareButton) {
                shareButton.onclick = () => {
                    const shareText = `Revisa mi Informe de Día Preventivo IAPOS: ${window.location.href}`;
                    navigator.clipboard.writeText(shareText);
                    Swal.showValidationMessage('Link al Portal copiado al portapapeles.');
                };
            }
        },
        
        // El resto de los parámetros de SweetAlert2 se mantiene por defecto
    });
}

// La función imprimirContenido debe estar fuera de mostrarResultados
function imprimirContenido(htmlContent, nombre, dni) {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Informe IAPOS: ${nombre} (${dni})</title>
            <style>
                /* Estilos básicos para impresión */
                body { font-family: Arial, sans-serif; margin: 40px; }
                h1 { color: #1e40af; border-bottom: 2px solid #1e40af; padding-bottom: 10px; margin-bottom: 20px; }
                .resumen { background-color: #ecfdf5; border: 1px solid #059669; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                .contacto { background-color: #bfdbfe; padding: 15px; border-radius: 5px; text-align: center; margin-top: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f3f4f6; }
                /* Ocultar elementos que no deben imprimirse, si los hubiera */
                @media print {
                   /* Ocultar cualquier botón o elemento de navegación */
                }
            </style>
        </head>
        <body>
            <h1>Portal del Afiliado - IAPOS Día Preventivo</h1>
            <div class="resumen">
                <h3>Resumen de Salud Personalizado</h3>
                ${htmlContent}
            </div>
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print(); // Dispara la ventana de impresión/PDF
}