require('dotenv').config();
const { generateVideo } = require('../src/generator');

/**
 * Ejemplo: Ruta icónica de Madrid
 * Puerta del Sol → Gran Vía → Plaza de España → Templo de Debod → Palacio Real
 */
async function runMadridExample() {
    console.log('🇪🇸 Ejemplo: Ruta Madrid');
    console.log('========================\n');

    const route = {
        origin: { 
            lat: 40.4168, 
            lng: -3.7038,
            name: 'Puerta del Sol'
        },
        destination: { 
            lat: 40.4180, 
            lng: -3.7140,
            name: 'Palacio Real'
        }
    };

    console.log(`Origen: ${route.origin.name} (${route.origin.lat}, ${route.origin.lng})`);
    console.log(`Destino: ${route.destination.name} (${route.destination.lat}, ${route.destination.lng})`);
    console.log('Generando video...\n');

    try {
        const result = await generateVideo(route, {
            outputName: 'madrid_route_example'
        });

        console.log('\n✅ ¡Video generado!');
        console.log(`📁 Archivo: ${result.filename}`);
        console.log(`🎬 Frames: ${result.frames}`);
        console.log(`⏱️ Duración: ${result.duration.toFixed(1)}s`);
        console.log(`\nAbre el archivo en: ./output/${result.filename}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

runMadridExample();
