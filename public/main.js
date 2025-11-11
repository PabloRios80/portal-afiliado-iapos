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
 * Función para formatear y mostrar los datos del afiliado en un pop-up.
 * @param {object} persona - El objeto que contiene todas las columnas de la hoja de cálculo.
 * @param {string} resumenAI - El resumen de salud generado por la IA.
 */
function mostrarResultados(persona, resumenAI) {
    // 🚀 CORRECCIÓN CLAVE: Usamos la clave correcta 'apellido y nombre'
    const nombre = persona['apellido y nombre'] || 'Afiliado'; 
    const dni = persona['DNI'] || 'N/A';
    
    // Contenido inicial - Agregamos el resumen de IA al principio
    let contenidoHTML = `
        <div class="text-left p-4 border border-green-300 bg-green-50 rounded-lg mb-6">
            ${resumenAI}
        </div>
        
        <h5 class="text-lg font-bold text-gray-700 mt-6 mb-3">Datos Brutos Encontrados</h5>
        <p class="text-sm text-gray-500 mb-4">Para referencias de tu profesional, aquí está el detalle completo de tu ficha.</p>
        
        <table class="w-full text-left table-auto border-collapse border border-gray-300 rounded-lg overflow-hidden">
            <tbody class="divide-y divide-gray-200">
    `;

    // 🚀 Iteramos sobre TODOS los pares clave-valor de la persona.
    for (const [key, value] of Object.entries(persona)) {
        
        // CORRECCIÓN DE TYPERROR: Convierte el valor a cadena y maneja null/undefined
        const safeValue = String(value || ''); 
        
        // Opcional: Ignorar campos vacíos
        if (safeValue.trim() === '') continue; 

        contenidoHTML += `
            <tr class="hover:bg-gray-100">
                <th class="py-2 px-4 bg-gray-50 font-semibold text-gray-700 w-1/3">${key.toUpperCase()}:</th>
                <td class="py-2 px-4 text-gray-800 font-medium">${safeValue}</td>
            </tr>
        `;
    }

    contenidoHTML += `
            </tbody>
        </table>
    `;

    // Mostrar la información final con SweetAlert2
    Swal.fire({
        title: `¡Hola, ${nombre}! 👋 Tu Portal de Prevención`,
        html: contenidoHTML,
        icon: 'success',
        confirmButtonText: 'Cerrar',
        customClass: {
            container: 'swal2-container',
            popup: 'swal2-popup w-full md:w-3/4 lg:w-4/5', 
        },
    });
}