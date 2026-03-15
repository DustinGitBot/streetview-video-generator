# Street View Video Generator 🎬

Genera videos timelapse de rutas usando Google Street View. Selecciona origen y destino en el mapa, y obtén un video del recorrido.

![Demo](demo.gif)

## 🚀 Características

- 🗺️ **Mapa interactivo**: Selecciona origen y destino con clic
- 🎥 **Generación automática**: Descarga imágenes Street View y crea video MP4
- 📍 **Ejemplo incluido**: Ruta predefinida en Madrid
- ⚡ **Rate limiting**: Protección contra límites de API
- 🔧 **Fácil de personalizar**: Configura tus propias rutas

## 📋 Requisitos

- Node.js 18+
- Cuenta Google Cloud con:
  - Directions API activada
  - Street View Static API activada
  - API Key válida

## 🛠️ Instalación

```bash
# Clonar repo
git clone https://github.com/tuusuario/streetview-video.git
cd streetview-video

# Instalar dependencias
npm install

# Configurar API Key
cp .env.example .env
# Editar .env con tu GOOGLE_API_KEY

# Iniciar
npm run dev
```

## ⚙️ Configuración

Edita `.env`:
```
GOOGLE_API_KEY=tu_api_key_aqui
PORT=3000
RATE_LIMIT_REQUESTS_PER_DAY=24000
MAX_ROUTE_DISTANCE_KM=50
FRAMES_PER_ROUTE=200
```

## 🗺️ Uso

### Opción 1: Web (Interactivo)
1. Abre `http://localhost:3000`
2. Haz clic en el mapa para marcar **origen** (verde)
3. Haz clic para marcar **destino** (rojo)
4. Click en "Generar Video"
5. Espera ~30-60 segundos
6. Descarga tu video MP4

### Opción 2: API Directa
```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "origin": {"lat": 40.4168, "lng": -3.7038},
    "destination": {"lat": 40.4530, "lng": -3.6883}
  }'
```

### Opción 3: Script Programático
```javascript
const { generateVideo } = require('./src/generator');

const route = {
  origin: { lat: 40.4168, lng: -3.7038 },      // Puerta del Sol
  destination: { lat: 40.4530, lng: -3.6883 }   // Santiago Bernabéu
};

await generateVideo(route, {
  outputFile: 'mi_ruta.mp4',
  fps: 10,
  quality: 'high'
});
```

## 🚦 Límites y Protecciones

| Límite | Valor | Descripción |
|--------|-------|-------------|
| Max distancia | 50 km | Rutas más largas dan error |
| Max imágenes/ruta | 200 | ~1 imagen cada 250m |
| Requests/día | 24,000 | Cerca del límite gratuito de Google |
| Concurrentes | 3 | Máximo 3 generaciones simultáneas |

**Costo estimado:** Gratis (25,000 imágenes/día incluidas)

## 🎯 Ejemplo: Madrid

Ruta predefinida incluida:
```
Puerta del Sol → Gran Vía → Plaza España → Templo Debod → Palacio Real
```

Generar:
```bash
npm run example:madrid
```

## 📁 Estructura

```
streetview-video/
├── public/           # Frontend (HTML + Mapa)
├── src/
│   ├── server.js     # Express + API endpoints
│   ├── generator.js  # Lógica de generación
│   ├── google-api.js # Cliente Google APIs
│   └── rate-limiter.js # Protección límites
├── output/           # Videos generados
├── temp/             # Imágenes temporales
├── .env.example      # Configuración ejemplo
└── package.json
```

## 🛡️ Rate Limiting

El sistema incluye protecciones:

```javascript
// src/rate-limiter.js
const dailyLimiter = new RateLimiter({
  maxRequests: process.env.RATE_LIMIT_REQUESTS_PER_DAY,
  windowMs: 24 * 60 * 60 * 1000 // 24 horas
});
```

Si superas el límite, devuelve error 429 con tiempo de espera.

## 🔑 Obtener API Key

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Crea nuevo proyecto
3. Habilita APIs:
   - Directions API
   - Street View Static API
4. Crea API Key (restringe por IP si es producción)
5. Copia a `.env`

**Nota:** La API Key puede tardar 5-10 min en activarse.

## 🐛 Troubleshooting

### "OVER_QUERY_LIMIT"
- Espera 24h o verifica tu quota en Google Cloud
- Considera habilitar billing (sigue siendo gratis hasta 25k)

### "ZERO_RESULTS" (Street View)
- Algunas zonas no tienen cobertura Street View
- Prueba rutas por ciudades principales
- Usa `preference: 'nearest'` para encontrar alternativas

### Video muy corto/largo
- Ajusta `FRAMES_PER_ROUTE` en `.env`
- Distancia recomendada: 5-20 km para videos de 20-40 segundos

## 📝 TODO

- [ ] Soporte múltiples waypoints intermedios
- [ ] Transiciones suaves entre frames
- [ ] Música de fondo opcional
- [ ] Compartir videos generados (S3/CDN)
- [ ] Modo "timelapse rápido" (2x, 4x velocidad)

## 📄 Licencia

MIT - Libre para uso personal y comercial.

---

⭐ Si te gusta, dale star en GitHub!
