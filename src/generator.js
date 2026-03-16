const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { promisify } = require('util');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const FRAMES_PER_ROUTE = parseInt(process.env.FRAMES_PER_ROUTE) || 200;
const FRAME_WIDTH = parseInt(process.env.FRAME_WIDTH) || 640;
const FRAME_HEIGHT = parseInt(process.env.FRAME_HEIGHT) || 640;
const VIDEO_FPS = parseInt(process.env.VIDEO_FPS) || 5;
const TEMP_DIR = process.env.TEMP_DIR || './temp';
const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const USE_RIFE = process.env.USE_RIFE === 'true'; // Habilitar RIFE

/**
 * Check if RIFE is available
 */
async function checkRifeAvailable() {
    try {
        await execPromise('which rife-ncnn-vulkan');
        return true;
    } catch {
        return false;
    }
}

/**
 * Apply RIFE frame interpolation
 */
async function applyRifeInterpolation(inputDir, outputDir, factor = 2) {
    try {
        const rifeAvailable = await checkRifeAvailable();
        if (!rifeAvailable) {
            console.log('[RIFE] Not available, using fallback');
            return false;
        }

        console.log(`[RIFE] Applying ${factor}x frame interpolation...`);
        
        await execPromise(
            `rife-ncnn-vulkan -i "${inputDir}" -o "${outputDir}" -n ${factor}`,
            { timeout: 120000 }
        );
        
        console.log('[RIFE] Interpolation complete');
        return true;
    } catch (error) {
        console.error('[RIFE Error]', error.message);
        return false;
    }
}

/**
 * Calculate heading (direction) between two points
 */
function calculateHeading(from, to) {
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat * Math.PI / 180;
    const dLng = (to.lng - from.lng) * Math.PI / 180;

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

    let heading = Math.atan2(y, x) * 180 / Math.PI;
    heading = (heading + 360) % 360;

    return Math.round(heading);
}

/**
 * Generate video from Street View route
 */
async function generateVideo(route, options = {}) {
    const { origin, destination } = route;
    const fps = options.fps || VIDEO_FPS;
    const useAI = options.useAI !== false; // Default true
    
    console.log('[Generator] Starting video generation...');
    console.log(`[Generator] Route: ${origin.lat},${origin.lng} → ${destination.lat},${destination.lng}`);
    console.log(`[Generator] FPS: ${fps}, AI Interpolation: ${useAI}`);

    try {
        // Get directions
        console.log('[Generator] Fetching directions...');
        const directions = await getDirections(origin, destination);
        
        if (!directions.routes || directions.routes.length === 0) {
            throw new Error('No route found between these points');
        }

        const polyline = directions.routes[0].overview_polyline.points;
        const decodedPath = decodePolyline(polyline);
        
        console.log(`[Generator] Route decoded: ${decodedPath.length} points`);

        // Sample points
        const sampledPoints = samplePoints(decodedPath, FRAMES_PER_ROUTE);
        console.log(`[Generator] Sampled ${sampledPoints.length} frames`);

        // Calculate headings
        const pointsWithHeadings = calculateHeadings(sampledPoints);
        console.log(`[Generator] Calculated headings for ${pointsWithHeadings.length} points`);

        // Download images
        console.log('[Generator] Downloading Street View images...');
        const frameFiles = await downloadStreetViewImages(pointsWithHeadings);
        console.log(`[Generator] Downloaded ${frameFiles.length} images`);

        // AI Frame Interpolation (RIFE)
        let finalFrameDir = TEMP_DIR;
        let finalFps = fps;
        
        if (useAI && frameFiles.length > 5) {
            const rifeDir = path.join(TEMP_DIR, 'rife_output');
            await fs.mkdir(rifeDir, { recursive: true });
            
            const rifeSuccess = await applyRifeInterpolation(TEMP_DIR, rifeDir, 2);
            
            if (rifeSuccess) {
                finalFrameDir = rifeDir;
                finalFps = fps * 2; // Double FPS after interpolation
                console.log(`[Generator] AI interpolation applied. New FPS: ${finalFps}`);
            }
        }

        // Generate video
        console.log('[Generator] Creating video...');
        const filename = `route_${Date.now()}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, filename);
        
        await createVideoFromFrames(finalFrameDir, outputPath, finalFps);
        console.log(`[Generator] Video saved: ${outputPath}`);

        // Cleanup
        await cleanupTempFiles(frameFiles);
        if (finalFrameDir !== TEMP_DIR) {
            await fs.rm(finalFrameDir, { recursive: true, force: true });
        }

        return {
            filename,
            frames: frameFiles.length,
            duration: frameFiles.length / fps,
            aiEnhanced: finalFrameDir !== TEMP_DIR
        };

    } catch (error) {
        console.error('[Generator Error]', error);
        throw error;
    }
}

/**
 * Calculate heading for each point
 */
function calculateHeadings(points) {
    return points.map((point, index) => {
        let heading = 0;
        
        if (index < points.length - 1) {
            heading = calculateHeading(point, points[index + 1]);
        } else if (index > 0) {
            heading = calculateHeading(points[index - 1], point);
        }
        
        return { ...point, heading };
    });
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
 * Decode Google polyline
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

        points.push({ lat: lat / 1e5, lng: lng / 1e5 });
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
 * Download Street View images
 */
async function downloadStreetViewImages(pointsWithHeadings) {
    const frameFiles = [];
    const batchSize = 5;

    for (let i = 0; i < pointsWithHeadings.length; i += batchSize) {
        const batch = pointsWithHeadings.slice(i, i + batchSize);
        
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
                    heading: point.heading,
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
                console.warn(`[Frame ${frameNum}] Failed to download`);
                return null;
            }
        });

        const batchResults = await Promise.all(batchPromises);
        frameFiles.push(...batchResults.filter(f => f !== null));

        if (i + batchSize < pointsWithHeadings.length) {
            await new Promise(r => setTimeout(r, 200));
        }
    }

    return frameFiles;
}

/**
 * Create MP4 video from frames
 */
function createVideoFromFrames(frameDir, outputPath, fps) {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(path.join(frameDir, 'frame_%04d.jpg'))
            .inputFPS(fps)
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
 * Cleanup temporary files
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

module.exports = { generateVideo, checkRifeAvailable };
