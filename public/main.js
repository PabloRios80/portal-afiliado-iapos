document.addEventListener('DOMContentLoaded', () => {

    const verPortalBtn = document.getElementById('btn-ver-portal');

    verPortalBtn.addEventListener('click', () => {
        Swal.fire({
            title: 'Consulta tu Informe Personal',
            input: 'text',
            inputLabel: 'Por favor, ingresa tu número de DNI sin puntos',
            inputPlaceholder: 'Ej: 12345678',
            showCancelButton: true,
            confirmButtonText: 'Consultar',
            cancelButtonText: 'Cancelar',
            inputValidator: (value) => {
                if (!value || isNaN(value)) {
                    return 'Necesitas ingresar un número de DNI válido.'
                }
            }
        }).then((result) => {
            if (result.isConfirmed) {
                const dni = result.value;
                // POR AHORA, SOLO MOSTRAMOS UNA ALERTA.
                // EN EL FUTURO, AQUÍ LLAMAREMOS AL SERVIDOR.
                Swal.fire('Consultando...', `Buscando informe para el DNI: ${dni}`, 'info');
                console.log(`DNI ingresado: ${dni}`);

                // Futuro paso: window.location.href = `/informe.html?dni=${dni}`;
            }
        });
    });

});