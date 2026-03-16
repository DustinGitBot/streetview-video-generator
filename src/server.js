require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const rateLimit = require('express-rate-limit');
const { generateVideo } = require('./generator');

const app = express();
const PORT = process.env.PORT || 3000;

// Create temp and output directories with absolute paths
const TEMP_DIR = process.env.TEMP_DIR ? path.resolve(process.env.TEMP_DIR) : path.join(__dirname, '..', 'temp');
const OUTPUT_DIR = process.env.OUTPUT_DIR ? path.resolve(process.env.OUTPUT_DIR) : path.join(__dirname, '..', 'output');

async function ensureDirectories() {
    try {
        await fs.mkdir(TEMP_DIR, { recursive: true });
        await fs.mkdir(OUTPUT_DIR, { recursive: true });
        console.log('[Server] Directories created/verified:');
        console.log('  - Temp:', TEMP_DIR);
        console.log('  - Output:', OUTPUT_DIR);
    } catch (error) {
        console.error('[Server Error] Cannot create directories:', error.message);
    }
}

ensureDirectories();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/output', express.static(OUTPUT_DIR));
app.use('/temp', express.static(TEMP_DIR));

// Rate limiting - protect API quotas
const apiLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 50, // 50 requests per IP per day
    message: { 
        error: 'Rate limit exceeded. Max 50 videos per day per IP.',
        retryAfter: '24h'
    }
});

// Global request counter for daily quota
let dailyRequestCount = 0;
const MAX_DAILY_REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS_PER_DAY) || 24000;

// Reset counter at midnight
const resetDailyCounter = () => {
    dailyRequestCount = 0;
    console.log('[Rate Limiter] Daily counter reset');
};
setInterval(resetDailyCounter, 24 * 60 * 60 * 1000);

// API endpoint to generate video
app.post('/api/generate', apiLimiter, async (req, res) => {
    try {
        // Check global daily limit
        if (dailyRequestCount >= MAX_DAILY_REQUESTS) {
            return res.status(429).json({
                error: 'Daily API quota exceeded. Try again tomorrow.',
                limit: MAX_DAILY_REQUESTS
            });
        }

        const { origin, destination, fps } = req.body;

        // Validate inputs
        if (!origin || !destination) {
            return res.status(400).json({
                error: 'Origin and destination are required'
            });
        }

        if (!origin.lat || !origin.lng || !destination.lat || !destination.lng) {
            return res.status(400).json({
                error: 'Invalid coordinates. Format: {lat: number, lng: number}'
            });
        }

        // Validate FPS
        const validFps = fps && [3, 5, 10, 15, 24].includes(parseInt(fps)) ? parseInt(fps) : 5;

        // Check distance limit
        const distance = calculateDistance(origin, destination);
        const maxDistance = parseFloat(process.env.MAX_ROUTE_DISTANCE_KM) || 50;
        
        if (distance > maxDistance) {
            return res.status(400).json({
                error: `Route too long: ${distance.toFixed(2)}km. Maximum: ${maxDistance}km`,
                distance: distance,
                maxDistance: maxDistance
            });
        }

        console.log(`[Generate] Route: ${distance.toFixed(2)}km | FPS: ${validFps} | ${dailyRequestCount}/${MAX_DAILY_REQUESTS} daily requests`);

        // Increment counter
        dailyRequestCount++;

        // Generate video with FPS option
        const result = await generateVideo({ origin, destination }, { fps: validFps });

        res.json({
            success: true,
            videoUrl: `/output/${result.filename}`,
            frames: result.frames,
            duration: result.duration,
            distance: distance.toFixed(2)
        });

    } catch (error) {
        console.error('[API Error]', error);
        res.status(500).json({
            error: error.message || 'Internal server error'
        });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        dailyRequests: dailyRequestCount,
        dailyLimit: MAX_DAILY_REQUESTS,
        remaining: MAX_DAILY_REQUESTS - dailyRequestCount
    });
});

// Calculate distance between two points
function calculateDistance(p1, p2) {
    const R = 6371;
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLon = (p2.lng - p1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

app.listen(PORT, () => {
    console.log(`🚀 Street View Video Generator running on http://localhost:${PORT}`);
    console.log(`📊 Daily limit: ${MAX_DAILY_REQUESTS} requests`);
    console.log(`📁 Output directory: ${path.resolve('./output')}`);
});

module.exports = app;
