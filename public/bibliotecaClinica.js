// ==============================================================================
// 📚 DICCIONARIO CLÍNICO Y DE COMUNICACIÓN (IAPOS) - VERSIÓN INTEGRAL
// Cubre 100% de variables: Adultos, Niños y Adolescentes.
// ==============================================================================

function traducirMensajeParaPaciente(item) {
    // Normalizamos quitando tildes y pasando a mayúsculas para atrapar cualquier variación de escritura
    const ind = item.indicador.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const estado = item.estado ? item.estado.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : '';
    const color = item.color;
    const msgOriginal = item.customMsg || '';

    // ======================================================================
    // 1. ⏳ ESTUDIOS PENDIENTES (No hay patología, solo falta prevención)
    // ======================================================================
    if (estado.includes('PENDIENTE')) {
        if (ind.includes('MAMA') || ind.includes('MAMOGRAFIA')) return "Tienes pendiente tu estudio mamario anual. Es la mejor herramienta preventiva; por favor, agenda un turno a la brevedad.";
        if (ind.includes('PAP') || ind.includes('HPV') || ind.includes('VPH') || ind.includes('CERVICO')) return "Tus estudios de prevención ginecológica figuran como pendientes o no realizados recientemente. Son controles rápidos y fundamentales.";
        if (ind.includes('COLON') || ind.includes('SOMF') || ind.includes('VCC') || ind.includes('COLONOSCOPIA')) return "Por tu edad, el rastreo preventivo de cáncer de colon es prioridad. Tienes este estudio pendiente, consúltalo con tu médico.";
        if (ind.includes('DENSITOMETRIA') || ind.includes('OSEA') || ind.includes('OSTEOPOROSIS')) return "Figura pendiente tu densitometría ósea. Es un estudio sencillo para conocer la salud de tus huesos y prevenir fracturas.";
        if (ind.includes('PROSTATA') || ind.includes('PSA')) return "Tienes pendiente el control prostático. A partir de los 50 años, este chequeo preventivo es indispensable.";
        if (ind.includes('ESPIROMETRIA') || ind.includes('EPOC')) return "Al registrar hábitos de tabaquismo, tienes pendiente realizarte una espirometría. Es clave para conocer la salud de tus pulmones.";
        if (ind.includes('VACUNA') || ind.includes('INMUNIZACION')) return "Figura pendiente la actualización de tu carnet de vacunación. Recuerda que las vacunas son tu primer escudo de defensa.";
        
        return `Tienes este chequeo pendiente: ${item.indicador}. Mantener tus controles al día es vital para prevenir problemas a futuro.`;
    }

    // ======================================================================
    // 2. 🚨 ALERTAS ROJAS (Prioridad Alta / Foco Inmediato)
    // ======================================================================
    if (color === 'red') {
        // --- Metabólico y Cardiovascular ---
        if (ind.includes('PRESION') || ind.includes('ARTERIAL') || ind.includes('HIPERTENSION')) return "Tus valores de presión arterial están elevados. Esto hace trabajar de más a tu corazón y daña las arterias. Requiere control médico seriado y urgente.";
        if (ind.includes('DIABETES') || ind.includes('GLUCEMIA') || ind.includes('METABOLICO')) return "Se detectaron alteraciones en tus niveles metabólicos/azúcar. Es fundamental iniciar cambios en la dieta y consultar con tu médico para evitar complicaciones severas.";
        if (ind.includes('COLESTEROL') || ind.includes('LIPID') || ind.includes('LIPEMIA') || ind.includes('DISLIPEMIA')) return "Tus niveles de grasas en sangre requieren atención médica y nutricional inmediata. Reducirlos es vital para proteger tu sistema cardiovascular.";
        if (ind.includes('PESO') || ind.includes('IMC') || ind.includes('OBESIDAD') || ind.includes('TALLA')) return "La relación de peso y altura indica un riesgo metabólico. Un abordaje integral (nutrición y movimiento) es clave para revertirlo y sentirte mejor.";
        if (ind.includes('ANEURISMA') || ind.includes('AORTA')) return "El estudio de aorta presentó hallazgos que requieren evaluación médica cardiovascular pronta para evitar complicaciones.";
        
        // --- Hábitos y Psicosocial ---
        if (ind.includes('TABACO') || ind.includes('FUMA')) return "El tabaquismo es el principal factor de riesgo evitable para múltiples enfermedades graves. ¡Nunca es tarde para dejarlo! IAPOS cuenta con apoyo para acompañarte.";
        if (ind.includes('ALCOHOL') || ind.includes('SUSTANCIAS')) return "Detectamos pautas de riesgo asociadas al consumo (alcohol o sustancias). Abordar esto a tiempo protege tu salud integral. Busca apoyo profesional.";
        if (ind.includes('DEPRESION') || ind.includes('MENTAL')) return "La evaluación detectó que tu estado de ánimo o salud mental requiere apoyo. Tu bienestar emocional es prioridad absoluta; te animamos a buscar contención psicológica.";
        if (ind.includes('VIOLENCIA')) return "Se han detectado indicadores de vulnerabilidad o violencia en tu entorno. No estás solo/a. Te recomendamos acercarte a los equipos interdisciplinarios de IAPOS.";
        
        // --- Estudios Específicos y Prevención Oncológica ---
        if (ind.includes('COLON') || ind.includes('SOMF') || ind.includes('VCC')) return "El resultado del rastreo de colon requiere atención. Es muy importante que asistas a tu médico/a a la brevedad para realizar una Videocolonoscopía u otros estudios.";
        if (ind.includes('MAMA') || ind.includes('MAMOGRAFIA')) return "Tus estudios mamarios presentan hallazgos que tu especialista (Ginecología/Mastología) debe revisar pronto para un abordaje oportuno.";
        if (ind.includes('PAP') || ind.includes('HPV') || ind.includes('VPH') || ind.includes('CERVICO')) return "Los resultados de tu control ginecológico requieren evaluación médica. Agenda un turno para un seguimiento seguro.";
        if (ind.includes('PROSTATA') || ind.includes('PSA')) return "El valor de tu antígeno prostático (PSA) requiere la evaluación de un especialista en Urología.";
        if (ind.includes('PIEL')) return "Se detectaron lesiones en la piel que ameritan una consulta dermatológica urgente para un correcto diagnóstico.";

        // --- Órganos y Sistemas ---
        if (ind.includes('ESPIROMETRIA') || ind.includes('EPOC')) return "El estudio indica signos de obstrucción pulmonar. Es fundamental que un Neumonólogo evalúe tu caso para cuidar tu capacidad respiratoria.";
        if (ind.includes('RENAL') || ind.includes('RIÑON') || ind.includes('ERC')) return "Tu función renal presenta alteraciones. Acude a una consulta médica para cuidar la salud de tus riñones.";
        if (ind.includes('ODONTO') || ind.includes('BUCAL') || ind.includes('CPO')) return "Tu evaluación indica un alto riesgo odontológico. Es muy importante que agendes un turno con tu odontólogo/a de confianza para un tratamiento adecuado.";
        if (ind.includes('AUDICION') || ind.includes('AUDITIV')) return "Se han detectado problemas en tu audición. Te recomendamos una consulta con Otorrinolaringología.";
        if (ind.includes('OSTEOPOROSIS') || ind.includes('DENSITOMETRIA') || ind.includes('OSEA')) return "El estudio indica debilidad ósea (osteoporosis/osteopenia). Consulta con tu médico para evitar el riesgo de fracturas.";

        // --- Infecciosas ---
        if (ind.includes('VIH') || ind.includes('SIFILIS') || ind.includes('CHAGAS') || ind.includes('HEPATITIS') || ind.includes('VDRL') || ind.includes('ITS')) return "Tus pruebas de laboratorio detectaron resultados que requieren confirmación y tratamiento infectológico. Existen tratamientos altamente efectivos.";

        // --- Especificos Niños y Adultos Mayores ---
        if (ind.includes('CAIDA')) return "Presentas un riesgo elevado de sufrir caídas. Sugerimos revisar la seguridad de tu hogar y consultar para mejorar tu estabilidad física.";
        if (ind.includes('VIAL')) return "Se detectaron riesgos en seguridad vial (uso de casco/cinturón). Recuerda que las normas de tránsito salvan tu vida directamente.";
        if (ind.includes('ESCOLAR') || ind.includes('APRENDIZAJE')) return "Se observaron pautas de alarma en el desarrollo o aprendizaje escolar. Recomendamos una consulta con el equipo de pediatría o psicopedagogía.";
        if (ind.includes('PANTALLA')) return "El uso excesivo de pantallas está afectando el bienestar. Es crucial establecer límites de tiempo para cuidar el desarrollo, el descanso y la visión.";
        if (ind.includes('ESCOLIOSIS')) return "Se observaron alteraciones en la postura o columna. Sugerimos agendar una visita con Traumatología o Kinesiología.";
        if (ind.includes('VACUNA') || ind.includes('INMUNIZACION')) return "Tienes vacunas atrasadas. Un esquema incompleto te expone a enfermedades graves. Visita un vacunatorio urgente.";
        if (ind.includes('FOLICO') || ind.includes('ACIDO FOLICO')) return "Está indicada la suplementación con ácido fólico. Es un paso fundamental de preparación médica si estás buscando un embarazo.";
    }

    // ======================================================================
    // 3. ⚠️ ALERTAS AMARILLAS (Precaución / Ocuparse con tiempo)
    // ======================================================================
    if (color === 'yellow') {
        if (ind.includes('VISUAL') || ind.includes('AGUDEZA') || ind.includes('OFTALMO') || ind.includes('OCULAR')) return "Tu visión presenta alteraciones o disminución visual leve. Te sugerimos agendar una visita con tu oftalmólogo/a en los próximos meses.";
        if (ind.includes('ODONTO') || ind.includes('BUCAL') || ind.includes('CPO')) return "Se ha detectado un riesgo odontológico moderado. Te recomendamos programar una visita de control con tu odontólogo/a para evitar que avance a caries mayores.";
        if (ind.includes('PESO') || ind.includes('IMC')) return "Te encuentras con sobrepeso leve. Hacer pequeños cambios en tu alimentación diaria y sumar caminatas harán una gran diferencia en tu salud futura.";
        if (ind.includes('ALIMENTACION')) return "Tu encuesta nutricional indica que hay margen para mejorar. Sumar más frutas, verduras y agua beneficiará todos tus sistemas.";
        if (ind.includes('FISICA') || ind.includes('EJERCICIO')) return "Tu nivel de actividad física es bajo. Sumar al menos 30 minutos de movimiento al día protegerá tu corazón y mejorará tu ánimo.";
        if (ind.includes('RIESGO CV') || ind.includes('ESTRATIFICACION') || ind.includes('CARDIOVASCULAR')) return "Tu evaluación cardiovascular sugiere que es el momento ideal para empezar a tomar medidas preventivas para cuidar tu corazón a largo plazo.";
        if (ind.includes('COLESTEROL') || ind.includes('LIPID') || ind.includes('LIPEMIA') || ind.includes('DISLIPEMIA')) return "Tus niveles de grasas están en el límite superior. Te recomendamos moderar el consumo de ultraprocesados y harinas.";
        if (ind.includes('ESPIROMETRIA') || ind.includes('EPOC')) return "Te sugerimos controlar tu salud respiratoria periódicamente. Si eres fumador/a, este es el momento para proteger tus pulmones disminuyendo el consumo.";
        if (ind.includes('PANTALLA')) return "Recomendamos supervisar y disminuir la cantidad de horas frente a las pantallas para asegurar un buen descanso y salud visual.";
        if (ind.includes('COLON') || ind.includes('SOMF') || ind.includes('VCC')) return "Aunque tu estudio de sangre oculta dio bien, por tu grupo de edad es muy recomendable realizar una videocolonoscopía de control para tu total tranquilidad.";
    }

    // ======================================================================
    // 4. 🛟 RED DE SEGURIDAD (Fallback)
    // ======================================================================
    // Si la lógica original de main.js manda la palabra vacía, la transformamos en frase:
    if (msgOriginal === 'Alerta' || msgOriginal === 'Atención' || msgOriginal === 'Precaución') {
        return `El indicador de "${item.indicador}" requiere evaluación o seguimiento médico, te sugerimos agendar una consulta.`;
    }

    // Si todo falla, devuelve el mensaje de la lógica cruda
    return msgOriginal;
}