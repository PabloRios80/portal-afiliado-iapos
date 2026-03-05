// ==============================================================================
// 📚 DICCIONARIO CLÍNICO Y DE COMUNICACIÓN (IAPOS)
// ==============================================================================

function traducirMensajeParaPaciente(item) {
    const ind = item.indicador.toUpperCase();
    const estado = item.estado ? item.estado.toUpperCase() : '';
    const color = item.color;
    const msgOriginal = item.customMsg;

    // ----------------------------------------------------------------------
    // 1. ESTUDIOS PENDIENTES (No hay enfermedad, solo falta el estudio)
    // ----------------------------------------------------------------------
    if (estado.includes('PENDIENTE')) {
        if (ind.includes('MAMOGRAFIA') || ind.includes('MAMA')) return "Tienes pendiente tu estudio mamario anual. Es la mejor herramienta preventiva; por favor, agenda un turno a la brevedad.";
        if (ind.includes('PAP') || ind.includes('HPV') || ind.includes('VPH')) return "Tus estudios de prevención ginecológica figuran como pendientes o no realizados recientemente. Son controles rápidos y fundamentales.";
        if (ind.includes('SOMF') || ind.includes('COLON') || ind.includes('VCC')) return "Por tu edad, el rastreo preventivo de colon es prioridad. Tienes este estudio pendiente, consúltalo con tu médico.";
        if (ind.includes('DENSITOMETRIA') || ind.includes('OSEA')) return "Figura pendiente tu densitometría ósea. Es un estudio sencillo para conocer la salud de tus huesos y prevenir fracturas.";
        if (ind.includes('PROSTATA') || ind.includes('PSA')) return "Tienes pendiente el control prostático. A partir de los 50 años, este chequeo es indispensable.";
        if (ind.includes('ESPIROMETRIA')) return "Al ser fumador/a, tienes pendiente una espirometría. Es clave para saber cómo están funcionando tus pulmones.";

        // Mensaje por defecto para cualquier otro pendiente
        return `Tienes este control pendiente: ${item.indicador}. Es importante mantener tus chequeos al día.`;
    }

    // ----------------------------------------------------------------------
    // 2. ALERTAS ROJAS (Hallazgos Clínicos / Foco Inmediato)
    // ----------------------------------------------------------------------
    if (color === 'red') {
        if (ind.includes('PRESION') || ind.includes('ARTERIAL')) return "Tus valores de presión arterial están elevados. Esto hace trabajar de más a tu corazón. Te sugerimos realizar un control médico seriado.";
        if (ind.includes('DIABETES') || ind.includes('GLUCEMIA')) return "Detectamos alteraciones en tus niveles de azúcar en sangre. Es fundamental iniciar cambios en la dieta y consultar con un médico.";
        if (ind.includes('COLESTEROL') || ind.includes('LIPID')) return "Tus niveles de grasas (colesterol/triglicéridos) requieren atención inmediata para proteger tus arterias.";
        if (ind.includes('TABACO') || ind.includes('FUMA')) return "Notamos que fumas. El tabaquismo es el principal factor de riesgo evitable. ¡Nunca es tarde para dejarlo! IAPOS cuenta con programas para ayudarte.";
        if (ind.includes('SOMF') || ind.includes('COLON') || ind.includes('VCC')) return "El resultado de tu estudio de colon requiere atención. Es clave que asistas a tu médico/a pronto para evaluar los pasos a seguir.";
        if (ind.includes('MAMOGRAFIA') || ind.includes('MAMA')) return "Tus estudios mamarios presentan hallazgos que tu especialista debe revisar a la brevedad.";
        if (ind.includes('PAP') || ind.includes('HPV') || ind.includes('VPH')) return "Los resultados de tu control ginecológico requieren evaluación médica. Acude a tu ginecólogo/a para un seguimiento seguro.";
        if (ind.includes('DEPRESION') || ind.includes('MENTAL')) return "El tamizaje detectó que tu estado de ánimo podría requerir apoyo. La salud mental es prioridad; te animamos a buscar contención profesional.";
        if (ind.includes('IMC') || ind.includes('PESO') || ind.includes('OBESIDAD')) return "Tu relación de peso y altura indica un riesgo metabólico alto. Mejorar la alimentación te ayudará a sentirte mucho mejor.";
        if (ind.includes('VIH') || ind.includes('SIFILIS') || ind.includes('CHAGAS')) return "Detectamos un resultado en tus pruebas infecciosas que requiere confirmación y tratamiento con un especialista.";
    }

    // ----------------------------------------------------------------------
    // 3. ALERTAS AMARILLAS (Precaución / Mediano Plazo)
    // ----------------------------------------------------------------------
    if (color === 'yellow') {
        if (ind.includes('AGUDEZA') || ind.includes('VISUAL')) return "Tu visión presenta algunas alteraciones leves. Te sugerimos agendar una visita oftalmológica para evitar forzar la vista. si ya usas lentes y controlas tu salud visual por favor desestima este consejo y sigue adelante.";
        if (ind.includes('SOMF') || ind.includes('COLON')) return "Tus valores dieron normales, pero por tu edad es altamente recomendable programar una Colonoscopía para seguridad total.";
        if (ind.includes('IMC') || ind.includes('PESO')) return "Tienes un leve sobrepeso. Pequeños cambios en tu alimentación diaria harán una gran diferencia a futuro.";
    }

    // 4. FALLBACK: Si no cae en ninguna regla, devuelve el mensaje original de IAPOS
    return msgOriginal;
}