let audioContext;
let analyser;
let dataArray;
let canvas, ctx;
let animationId;
let isVisualizerRunning = false;

export function initVisualizer(stream) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Connect the mic stream to the analyser
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048; // Resolution of the wave
    
    source.connect(analyser);
    
    // Buffer to hold audio data
    const bufferLength = analyser.fftSize;
    dataArray = new Uint8Array(bufferLength);
    
    // Get Canvas Context
    canvas = document.getElementById('audio-visualizer');
    ctx = canvas.getContext('2d');
    
    isVisualizerRunning = true;
    draw();
}

export function stopVisualizer() {
    isVisualizerRunning = false;
    if (animationId) cancelAnimationFrame(animationId);
    // Clear canvas
    if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

function draw() {
    if (!isVisualizerRunning) return;

    animationId = requestAnimationFrame(draw);

    analyser.getByteTimeDomainData(dataArray);

    // Style the canvas (Transparent background)
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4f46e5'; // Indigo-600 color
    ctx.beginPath();

    const sliceWidth = canvas.width * 1.0 / analyser.fftSize;
    let x = 0;

    for (let i = 0; i < analyser.fftSize; i++) {
        const v = dataArray[i] / 128.0; // Normalize byte data (0-255) to (0-2)
        const y = v * canvas.height / 2;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }

        x += sliceWidth;
    }

    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
}