const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { promisify } = require('util');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const FRAMES_PER_ROUTE = parseInt(process.env.FRAMES_PER_ROUTE) || 200;
const FRAME_WIDTH = parseInt(process.env.FRAME_WIDTH) || 640;
const FRAME_HEIGHT = parseInt(process.env.FRAME_HEIGHT) || 640;
const VIDEO_FPS = parseInt(process.env.VIDEO_FPS) || 10;
const TEMP_DIR = process.env.TEMP_DIR || './temp';
const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';

/**
 * Generate video from Street View route
 */
async function generateVideo(route, options = {}) {
    const { origin, destination } = route;
    
    console.log('[Generator] Starting video generation...');
    console.log(`[Generator] Route: ${origin.lat},${origin.lng} → ${destination.lat},${destination.lng}`);

    try {
        // Step 1: Get directions from Google
        console.log('[Generator] Fetching directions...');
        const directions = await getDirections(origin, destination);
        
        if (!directions.routes || directions.routes.length === 0) {
            throw new Error('No route found between these points');
        }

        const path = directions.routes[0].overview_polyline.points;
        const decodedPath = decodePolyline(path);
        
        console.log(`[Generator] Route decoded: ${decodedPath.length} points`);

        // Step 2: Sample points along route
        const sampledPoints = samplePoints(decodedPath, FRAMES_PER_ROUTE);
        console.log(`[Generator] Sampled ${sampledPoints.length} frames`);

        // Step 3: Download Street View images
        console.log('[Generator] Downloading Street View images...');
        const frameFiles = await downloadStreetViewImages(sampledPoints);
        console.log(`[Generator] Downloaded ${frameFiles.length} images`);

        // Step 4: Generate video with ffmpeg
        console.log('[Generator] Creating video...');
        const filename = `route_${Date.now()}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, filename);
        
        await createVideoFromFrames(frameFiles, outputPath);
        console.log(`[Generator] Video saved: ${outputPath}`);

        // Step 5: Cleanup temp files
        await cleanupTempFiles(frameFiles);

        return {
            filename,
            frames: frameFiles.length,
            duration: frameFiles.length / VIDEO_FPS
        };

    } catch (error) {
        console.error('[Generator Error]', error);
        throw error;
    }
}

/**
 * Get directions from Google Directions API
 */
async function getDirections(origin, destination) {
    const url = 'https://maps.googleapis.com/maps/api/directions/json';
    
    const params = {
        origin: `${origin.lat},${origin.lng}`,
        destination: `${destination.lat},${destination.lng}`,
        mode: 'driving',
        key: GOOGLE_API_KEY
    };

    const response = await axios.get(url, { params });
    
    if (response.data.status !== 'OK') {
        throw new Error(`Directions API error: ${response.data.status}`);
    }

    return response.data;
}

/**
 * Decode Google polyline to array of lat/lng points
 */
function decodePolyline(encoded) {
    const points = [];
    let index = 0, lat = 0, lng = 0;

    while (index < encoded.length) {
        let b, shift = 0, result = 0;
        
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        
        const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;

        shift = 0;
        result = 0;
        
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        
        const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;

        points.push({
            lat: lat / 1e5,
            lng: lng / 1e5
        });
    }

    return points;
}

/**
 * Sample points evenly along the path
 */
function samplePoints(path, count) {
    if (path.length <= count) return path;

    const sampled = [];
    const step = (path.length - 1) / (count - 1);

    for (let i = 0; i < count; i++) {
        const index = Math.round(i * step);
        sampled.push(path[Math.min(index, path.length - 1)]);
    }

    return sampled;
}

/**
 * Download Street View images for each point
 */
async function downloadStreetViewImages(points) {
    const frameFiles = [];
    const batchSize = 5; // Process in batches to avoid rate limits

    for (let i = 0; i < points.length; i += batchSize) {
        const batch = points.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (point, idx) => {
            const frameNum = i + idx;
            const filename = `frame_${String(frameNum).padStart(4, '0')}.jpg`;
            const filepath = path.join(TEMP_DIR, filename);

            try {
                const imageUrl = `https://maps.googleapis.com/maps/api/streetview`;
                const params = {
                    size: `${FRAME_WIDTH}x${FRAME_HEIGHT}`,
                    location: `${point.lat},${point.lng}`,
                    fov: 90,
                    heading: 0, // Could calculate based on route direction
                    pitch: 0,
                    key: GOOGLE_API_KEY,
                    source: process.env.SV_SOURCE || 'outdoor'
                };

                const response = await axios.get(imageUrl, {
                    params,
                    responseType: 'arraybuffer',
                    timeout: 10000
                });

                await fs.writeFile(filepath, response.data);
                return filepath;
            } catch (error) {
                console.warn(`[Frame ${frameNum}] Failed to download, using placeholder`);
                // Create placeholder or skip
                return null;
            }
        });

        const batchResults = await Promise.all(batchPromises);
        frameFiles.push(...batchResults.filter(f => f !== null));

        // Small delay between batches
        if (i + batchSize < points.length) {
            await new Promise(r => setTimeout(r, 200));
        }
    }

    return frameFiles;
}

/**
 * Create MP4 video from frame images using ffmpeg
 */
function createVideoFromFrames(frameFiles, outputPath) {
    return new Promise((resolve, reject) => {
        // Ensure output directory exists
        const outputDir = path.dirname(outputPath);
        
        ffmpeg()
            .input(path.join(TEMP_DIR, 'frame_%04d.jpg'))
            .inputFPS(VIDEO_FPS)
            .output(outputPath)
            .videoCodec('libx264')
            .outputOptions([
                '-pix_fmt yuv420p',
                '-vf scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
                '-movflags +faststart'
            ])
            .on('end', () => {
                console.log('[FFmpeg] Video created successfully');
                resolve();
            })
            .on('error', (err) => {
                console.error('[FFmpeg Error]', err);
                reject(err);
            })
            .run();
    });
}

/**
 * Cleanup temporary frame files
 */
async function cleanupTempFiles(frameFiles) {
    try {
        for (const file of frameFiles) {
            await fs.unlink(file).catch(() => {});
        }
        console.log('[Generator] Cleanup complete');
    } catch (error) {
        console.warn('[Cleanup Warning]', error.message);
    }
}

module.exports = { generateVideo };
