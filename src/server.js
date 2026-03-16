require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const rateLimit = require('express-rate-limit');
const { generateVideo } = require('./generator');

const app = express();
const PORT = process.env.PORT || 3000;

// Create directories with absolute paths
const TEMP_DIR = process.env.TEMP_DIR ? path.resolve(process.env.TEMP_DIR) : path.join(__dirname, '..', 'temp');
const OUTPUT_DIR = process.env.OUTPUT_DIR ? path.resolve(process.env.OUTPUT_DIR) : path.join(__dirname, '..', 'output');

async function ensureDirectories() {
    try {
        await fs.mkdir(TEMP_DIR, { recursive: true });
        await fs.mkdir(OUTPUT_DIR, { recursive: true });
        console.log('[Server] Directories ready');
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

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 50,
    message: { 
        error: 'Rate limit exceeded. Max 50 videos per day per IP.',
        retryAfter: '24h'
    }
});

// Daily quota counter
let dailyRequestCount = 0;
const MAX_DAILY_REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS_PER_DAY) || 24000;

setInterval(() => {
    dailyRequestCount = 0;
    console.log('[Rate Limiter] Daily counter reset');
}, 24 * 60 * 60 * 1000);

// Generate video endpoint
app.post('/api/generate', apiLimiter, async (req, res) => {
    try {
        if (dailyRequestCount >= MAX_DAILY_REQUESTS) {
            return res.status(429).json({
                error: 'Daily API quota exceeded. Try again tomorrow.',
                limit: MAX_DAILY_REQUESTS
            });
        }

        const { origin, destination, fps } = req.body;

        if (!origin || !destination) {
            return res.status(400).json({
                error: 'Origin and destination are required'
            });
        }

        if (!origin.lat || !origin.lng || !destination.lat || !destination.lng) {
            return res.status(400).json({
                error: 'Invalid coordinates'
            });
        }

        dailyRequestCount++;

        const validFps = parseInt(fps) || 5;
        const route = { origin, destination };

        const result = await generateVideo(route, { fps: validFps });

        res.json({
            success: true,
            videoUrl: `/output/${result.filename}`,
            frames: result.frames,
            duration: result.duration,
            distance: result.distance
        });

    } catch (error) {
        console.error('[API Error]', error.message);
        res.status(500).json({
            error: error.message || 'Failed to generate video'
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        dailyUsage: dailyRequestCount,
        dailyLimit: MAX_DAILY_REQUESTS,
        remaining: MAX_DAILY_REQUESTS - dailyRequestCount
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Daily limit: ${MAX_DAILY_REQUESTS} requests`);
    console.log(`📁 Output: ${OUTPUT_DIR}`);
});
