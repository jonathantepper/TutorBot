import { 
    db, auth, storage, 
    collection, query, where, getDocs, getDoc, doc, deleteDoc, orderBy, serverTimestamp, setDoc, 
    signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, 
    ref, uploadBytes, getDownloadURL, isLocalHost 
} from './config.js';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const appId = 'default-app-id';
let currentUser;
let pdfTextContent = ""; // Stores extracted text
let canRecordAudio = false; 
let activeInputMode = 'pdf'; // 'pdf' or 'text'

// --- INITIALIZATION ---
window.onload = initApp;

function initApp() {
    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        updateUIForUser(user);
    });

    document.getElementById('auth-btn').addEventListener('click', handleAuthButton);
    document.getElementById('create-new-btn').addEventListener('click', openCreateModal);
    document.getElementById('close-create-btn').addEventListener('click', closeCreateModal);
    document.getElementById('cancel-create-btn').addEventListener('click', closeCreateModal);
    document.getElementById('save-btn').addEventListener('click', saveInterview);
    
    document.getElementById('close-submissions-btn').addEventListener('click', closeSubmissionsModal);
    document.getElementById('close-viewer-btn').addEventListener('click', closeTranscriptViewer);

    const fileInput = document.getElementById('pdf-upload');
    fileInput.addEventListener('change', (e) => handleFileSelect(e.target));

    // TAB SWITCHING LOGIC
    document.getElementById('tab-pdf').addEventListener('click', () => switchInputMode('pdf'));
    document.getElementById('tab-text').addEventListener('click', () => switchInputMode('text'));
}

function switchInputMode(mode) {
    activeInputMode = mode;
    const tabPdf = document.getElementById('tab-pdf');
    const tabText = document.getElementById('tab-text');
    const contentPdf = document.getElementById('content-pdf');
    const contentText = document.getElementById('content-text');

    if (mode === 'pdf') {
        tabPdf.className = "px-4 py-2 text-sm font-medium text-indigo-600 border-b-2 border-indigo-600 transition-colors focus:outline-none";
        tabText.className = "px-4 py-2 text-sm font-medium text-gray-500 border-b-2 border-transparent hover:text-gray-700 transition-colors focus:outline-none";
        contentPdf.classList.remove('hidden');
        contentText.classList.add('hidden');
    } else {
        tabText.className = "px-4 py-2 text-sm font-medium text-indigo-600 border-b-2 border-indigo-600 transition-colors focus:outline-none";
        tabPdf.className = "px-4 py-2 text-sm font-medium text-gray-500 border-b-2 border-transparent hover:text-gray-700 transition-colors focus:outline-none";
        contentText.classList.remove('hidden');
        contentPdf.classList.add('hidden');
    }
}

async function updateUIForUser(user) {
    if (user) {
        document.getElementById('login-warning').classList.add('hidden');
        document.getElementById('dashboard').classList.remove('hidden');
        document.getElementById('user-display').textContent = user.displayName || user.email;
        document.getElementById('user-display').classList.remove('hidden');
        document.getElementById('auth-btn').textContent = 'Sign Out';
        
        try {
            const roleDoc = await getDoc(doc(db, `artifacts/${appId}/public/data/roles`, user.email.toLowerCase()));
            if (roleDoc.exists() && roleDoc.data().canRecordAudio) {
                canRecordAudio = true;
            } else {
                canRecordAudio = false;
            }
        } catch (e) {
            console.warn("Could not fetch permissions", e);
            canRecordAudio = false;
        }

        setTimeout(loadInterviews, 100);
    } else {
        document.getElementById('login-warning').classList.remove('hidden');
        document.getElementById('dashboard').classList.add('hidden');
        document.getElementById('user-display').classList.add('hidden');
        document.getElementById('auth-btn').textContent = 'Sign In';
        canRecordAudio = false;
    }
}

async function handleAuthButton() {
    if (auth.currentUser) {
        await signOut(auth);
    } else {
        const provider = new GoogleAuthProvider();
        try { await signInWithPopup(auth, provider); } catch (e) { alert(e.message); }
    }
}

async function loadInterviews() {
    const list = document.getElementById('interview-list');
    list.innerHTML = '<p class="text-gray-500 text-center py-4">Loading interviews...</p>';
    
    const q = query(
        collection(db, `artifacts/${appId}/public/data/interviews`),
        where("teacherId", "==", currentUser.uid),
        orderBy("timestamp", "desc")
    );

    const snapshot = await getDocs(q);
    list.innerHTML = '';

    if (snapshot.empty) {
        list.innerHTML = `
            <div class="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
                <p class="text-gray-500 mb-2">No interviews created yet.</p>
                <button onclick="window.openCreateModal()" class="text-indigo-600 font-medium hover:underline">Create your first one</button>
            </div>`;
        return;
    }

    snapshot.forEach(docSnap => {
        const data = docSnap.id ? { ...docSnap.data(), code: docSnap.id } : docSnap.data();
        const date = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleDateString() : 'N/A';
        const safeTitle = data.title.replace(/'/g, "\\'");
        
        const timeBadge = (data.timeLimit && data.timeLimit > 0)
            ? `<span class="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded ml-2 border border-blue-200"><i class="far fa-clock"></i> ${data.timeLimit}m</span>`
            : `<span class="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-1 rounded ml-2 border border-gray-200"><i class="fas fa-infinity"></i> No Limit</span>`;

        const recBadge = (data.recordAudio)
             ? `<span class="bg-red-100 text-red-700 text-xs font-bold px-2 py-1 rounded ml-2 border border-red-200"><i class="fas fa-microphone"></i> Rec</span>`
             : ``;

        // Determine icon based on source type
        const sourceIcon = data.sourceType === 'text' ? 'fa-file-alt' : 'fa-file-pdf';
        const sourceLabel = data.sourceType === 'text' ? 'View Text' : 'View PDF';

        const row = document.createElement('div');
        row.className = "bg-white p-4 rounded-lg border border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4 hover:shadow-md transition group";
        const recordAudioBool = data.recordAudio ? 'true' : 'false';

        row.innerHTML = `
            <div class="flex-1 min-w-0 text-center sm:text-left">
                <div class="flex items-center justify-center sm:justify-start gap-2 mb-1 flex-wrap">
                    <h3 class="text-lg font-bold text-gray-900 truncate">${data.title}</h3>
                    <span class="bg-indigo-100 text-indigo-700 text-xs font-mono font-bold px-2 py-1 rounded border border-indigo-200">${data.code}</span>
                    ${timeBadge}
                    ${recBadge}
                </div>
                <div class="flex items-center justify-center sm:justify-start gap-3 mt-1">
                    <p class="text-xs text-gray-500"><i class="far fa-calendar-alt"></i> ${date}</p>
                    <button onclick="window.downloadSourceMaterial('${data.code}')" class="text-xs text-blue-500 hover:text-blue-700 underline flex items-center gap-1">
                        <i class="fas ${sourceIcon}"></i> ${sourceLabel}
                    </button>
                </div>
            </div>
            
            <div class="flex items-center gap-3 opacity-100 sm:opacity-100 transition-opacity">
                <button onclick="window.openSubmissionsList('${data.code}', '${safeTitle}', ${recordAudioBool})" 
                    class="px-4 py-2 bg-white border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 hover:text-indigo-600 transition text-sm flex items-center gap-2">
                    <i class="fas fa-users"></i> View Submissions
                </button>
                <button onclick="window.deleteInterview('${data.code}')" 
                    class="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition" title="Delete Interview">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        list.appendChild(row);
    });
}

function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
}

async function handleFileSelect(input) {
    const file = input.files[0];
    if (!file) return;
    document.getElementById('file-name-display').textContent = file.name;
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(item => item.str).join(" ") + "\n";
        }
        pdfTextContent = fullText;
    } catch (e) { alert("Error reading PDF: " + e.message); }
}

async function saveInterview() {
    const title = document.getElementById('input-title').value;
    const timeSelect = document.getElementById('time-limit-select');
    const audioToggle = document.getElementById('record-audio-toggle'); 
    
    let finalContent = "";
    let downloadURL = null; 
    
    if (activeInputMode === 'pdf') {
        const fileInput = document.getElementById('pdf-upload');
        const file = fileInput.files[0];
        if (!file || !pdfTextContent) {
            alert("Please upload a PDF.");
            return;
        }
        finalContent = pdfTextContent;
    } else {
        const textInput = document.getElementById('text-paste-area').value;
        if (!textInput.trim()) {
            alert("Please paste the curriculum text.");
            return;
        }
        finalContent = textInput.trim();
    }

    if (!title) { alert("Please enter a title."); return; }

    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    btn.textContent = activeInputMode === 'pdf' ? "Uploading..." : "Saving...";

    try {
        const code = generateCode();
        
        // --- 1. HANDLE PDF UPLOAD (Legacy/Stability Path) ---
        if (activeInputMode === 'pdf') {
            const file = document.getElementById('pdf-upload').files[0];
            const storageRef = ref(storage, `interviews/${currentUser.uid}/${code}/${file.name}`);
            const snapshot = await uploadBytes(storageRef, file);
            downloadURL = await getDownloadURL(snapshot.ref);
        }

        // --- 2. SAVE TO DATABASE ---
        await setDoc(doc(db, `artifacts/${appId}/public/data/interviews`, code), {
            title: title,
            curriculumText: finalContent, 
            pdfUrl: downloadURL, // Will be null if Text Mode was used
            sourceType: activeInputMode,  
            teacherId: currentUser.uid,
            teacherName: currentUser.displayName,
            teacherEmail: currentUser.email,
            timestamp: serverTimestamp(),
            timeLimit: parseInt(timeSelect.value) || 0,
            recordAudio: audioToggle ? audioToggle.checked : false 
        });

        closeCreateModal();
        loadInterviews();
        alert("Interview created successfully!");

    } catch (e) {
        console.error(e);
        alert("Error creating interview: " + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "Create";
    }
}

// --- SMART PDF GENERATOR (PUNCTUATION SAFE) ---
window.downloadSourceMaterial = async (code) => {
    const btn = event.currentTarget; 
    const originalIcon = btn.innerHTML;
    
    try {
        console.log("Generating Smart PDF for:", code);
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
        
        const docRef = doc(db, `artifacts/${appId}/public/data/interviews`, code);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) { alert("Interview not found."); return; }
        
        const data = docSnap.data();

        // 1. Legacy PDF Check
        if (data.pdfUrl && data.sourceType !== 'text') {
            window.open(data.pdfUrl, '_blank');
            btn.innerHTML = originalIcon;
            return;
        }

        // 2. Generate Smart PDF
        if (data.curriculumText) {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF();
            
            const margin = 15;
            const pageWidth = 210; 
            const maxLineWidth = 180; 
            let y = 20; 

            const checkPageBreak = (heightNeeded) => {
                if (y + heightNeeded > 280) {
                    pdf.addPage();
                    y = 20;
                }
            };

            // --- HEADER ---
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(16);
            pdf.setTextColor(79, 70, 229); 
            pdf.text(data.title || "Assessment Interview", margin, y);
            y += 8;

            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(10);
            pdf.setTextColor(100);
            pdf.text(`Code: ${code} | Created: ${data.timestamp ? new Date(data.timestamp.toDate()).toLocaleDateString() : 'N/A'}`, margin, y);
            y += 10;
            pdf.setDrawColor(200);
            pdf.line(margin, y, margin + maxLineWidth, y);
            y += 10;

            // --- CLEANING PHASE ---
            let text = data.curriculumText.normalize("NFKC");

            // 1. Flatten Everything
            text = text.replace(/[\r\n\t\u00A0]+/g, " ");

            // 2. ARTIFACT PRE-SCRUB (Delete %I and %Ï globally)
            text = text.replace(/%[IÏiï]/g, " "); 

            // 3. KEYWORD INJECTION (Punctuation Safe)
            // Added "Ideal Analysis" to the list
            const rubricKeywords = ["Ideal Answer", "Ideal Analysis", "Key Concepts", "Fail Condition", "Valid Path", "Scoring", "Look for"];
            
            rubricKeywords.forEach(kw => {
                // Regex Change: [^a-zA-Z0-9\)\].:!?"]*
                // This means: "Eat junk, BUT STOP if you hit a closing bracket, paren, dot, or quote."
                const regex = new RegExp(`(?:[^a-zA-Z0-9\\)\\].:!?"]*)\\s*(${kw})`, "gi");
                text = text.replace(regex, "\n• $1");
            });

            // 4. Structure Injection
            text = text
                .replace(/(PHASE \d)/gi, "\n\n$1")
                .replace(/(SYSTEM CONTEXT)/gi, "\n\n$1")
                .replace(/(Q\d+[:.])/gi, "\n\n$1") 
                .replace(/(\[AI EVALUATION)/gi, "\n$1");

            // 5. Cleanup
            text = text.replace(/ +/g, " "); 
            
            // Header Cleanup: Ensure newline after header bracket
            text = text.replace(/(\[AI EVALUATION CRITERIA\])\s*/gi, "$1\n"); 

            const paragraphs = text.split("\n");

            // --- RENDER PHASE ---
            
            paragraphs.forEach(line => {
                line = line.trim();
                if (!line) return; 

                // A. DEFAULTS
                pdf.setFont("helvetica", "normal");
                pdf.setFontSize(11);
                pdf.setTextColor(50);
                
                let currentMargin = margin;
                let currentWidth = maxLineWidth; 
                let extraY = 1.5; 

                // B. STYLE MATCHER
                if (line.match(/^(PHASE|SYSTEM CONTEXT|GOAL)/i)) {
                    pdf.setFont("helvetica", "bold");
                    pdf.setFontSize(12);
                    pdf.setTextColor(0);
                    checkPageBreak(15);
                    y += 6; 
                } 
                else if (line.match(/^Q\d+[:.]/)) {
                    pdf.setFont("helvetica", "bold");
                    pdf.setFontSize(11);
                    pdf.setTextColor(0);
                    checkPageBreak(10);
                    y += 4;
                }
                else if (line.includes("[AI EVALUATION")) {
                    pdf.setFont("helvetica", "italic");
                    pdf.setFontSize(10);
                    pdf.setTextColor(100);
                    checkPageBreak(8);
                }
                else if (line.startsWith("•")) {
                    // *** SAFETY WRAP ***
                    currentMargin = margin + 5;
                    currentWidth = 160; 
                }

                // C. CALCULATE WRAP
                const splitLines = pdf.splitTextToSize(line, currentWidth);
                const lineHeight = pdf.getFontSize() * 0.3527 * 1.2; 
                const blockHeight = splitLines.length * lineHeight;

                checkPageBreak(blockHeight);
                
                // D. DRAW
                pdf.text(splitLines, currentMargin, y);
                y += blockHeight + extraY; 
            });
            
            pdf.save(`${data.title.replace(/\s+/g, '_')}_Content.pdf`);
        } else {
            alert("No content found to download.");
        }

    } catch (e) {
        console.error(e);
        alert("Error downloading: " + e.message);
    } finally {
        btn.innerHTML = originalIcon;
    }
};

window.openCreateModal = () => {
    document.getElementById('create-modal').classList.remove('hidden');
    document.getElementById('input-title').value = '';
    document.getElementById('text-paste-area').value = '';
    document.getElementById('file-name-display').textContent = 'No file selected';
    document.getElementById('pdf-upload').value = '';
    switchInputMode('pdf'); 

    const audioContainer = document.getElementById('audio-permission-container');
    if (canRecordAudio) {
        audioContainer.classList.remove('hidden');
    } else {
        audioContainer.classList.add('hidden');
        document.getElementById('record-audio-toggle').checked = false; 
    }
};

window.deleteInterview = async (code) => {
    if (!confirm("Delete this interview and all student transcripts?")) return;
    try {
        const projectId = "tutorbot-184ec";
        const functionBaseUrl = isLocalHost 
            ? `http://localhost:5001/${projectId}/us-central1`
            : `https://us-central1-${projectId}.cloudfunctions.net`;

        const response = await fetch(`${functionBaseUrl}/deleteInterviewAndTranscripts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId, interviewId: code, teacherId: currentUser.uid })
        });
        if (response.ok) {
            loadInterviews();
        } else {
            alert("Delete failed.");
        }
    } catch (e) {
        console.error(e);
        alert("Error deleting.");
    }
};

window.openSubmissionsList = async (code, title, recordAudio = false) => {
    document.getElementById('submissions-modal').classList.remove('hidden');
    document.getElementById('submission-modal-title').textContent = title;
    document.getElementById('submission-modal-code').textContent = `Code: ${code}`;
    
    const downloadAllBtn = document.getElementById('download-all-btn');
    downloadAllBtn.classList.remove('hidden');
    downloadAllBtn.onclick = () => downloadAllTranscripts(code, title);
    
    const container = document.getElementById('submissions-list');
    container.innerHTML = '<div class="flex justify-center p-8"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>';

    try {
        const q = query(
            collection(db, `artifacts/${appId}/public/data/interview_transcripts`),
            where("interviewCode", "==", code),
            orderBy("timestamp", "desc")
        );
        
        const snapshot = await getDocs(q);
        container.innerHTML = '';

        if (snapshot.empty) {
            container.innerHTML = `<div class="text-center py-10"><p class="text-gray-500">No submissions yet.</p></div>`;
            downloadAllBtn.classList.add('hidden'); 
            return;
        }

        snapshot.forEach(docSnap => {
            const sub = docSnap.data();
            const dateObj = sub.timestamp ? sub.timestamp.toDate() : new Date();
            const dateStr = dateObj.toLocaleString();
            const name = sub.studentName || 'Anonymous Student';
            
            let expiryBadge = '';
            if (recordAudio) {
                const now = new Date();
                const diffTime = Math.abs(now - dateObj);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                const daysRemaining = 270 - diffDays;
                
                if (daysRemaining > 0) {
                    expiryBadge = `<span class="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full border border-orange-200 ml-2" title="Audio auto-deletes in ${daysRemaining} days"><i class="far fa-clock"></i> T-${daysRemaining} Days</span>`;
                } else {
                    expiryBadge = `<span class="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full border border-gray-200 ml-2"><i class="fas fa-ban"></i> Audio Expired</span>`;
                }
            }

            const row = document.createElement('div');
            row.className = "bg-white p-4 rounded-lg border border-gray-200 hover:border-indigo-300 hover:shadow-sm transition flex justify-between items-center group";
            
            const infoDiv = document.createElement('div');
            infoDiv.className = "flex items-center gap-4 cursor-pointer flex-1";
            infoDiv.onclick = () => openTranscriptViewer(name, dateStr, sub.fullTranscript);
            infoDiv.innerHTML = `
                <div class="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-lg">
                    ${name.charAt(0).toUpperCase()}
                </div>
                <div>
                    <div class="flex items-center">
                        <h4 class="font-bold text-gray-900 group-hover:text-indigo-600 transition">${name}</h4>
                        ${expiryBadge}
                    </div>
                    <p class="text-xs text-gray-500">${dateStr}</p>
                </div>
            `;

            const downloadBtn = document.createElement('button');
            downloadBtn.className = "text-gray-400 hover:text-indigo-600 p-2 transition";
            downloadBtn.title = "Download Transcript";
            downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
            downloadBtn.onclick = (e) => {
                e.stopPropagation(); 
                downloadSingleTranscript(sub.fullTranscript, name, dateStr);
            };

            row.appendChild(infoDiv);
            row.appendChild(downloadBtn);
            container.appendChild(row);
        });

    } catch (e) {
        console.error("Error:", e);
        container.innerHTML = `<p class="text-red-500 text-center">Error loading data.</p>`;
    }
};

function closeCreateModal() { document.getElementById('create-modal').classList.add('hidden'); }
function closeSubmissionsModal() { document.getElementById('submissions-modal').classList.add('hidden'); }
function closeTranscriptViewer() { document.getElementById('transcript-viewer-modal').classList.add('hidden'); }

function openTranscriptViewer(name, date, transcriptArray) {
    document.getElementById('transcript-viewer-modal').classList.remove('hidden');
    document.getElementById('viewer-student-name').textContent = name;
    document.getElementById('viewer-date').textContent = date;
    const container = document.getElementById('transcript-content');
    container.innerHTML = '';
    if (!transcriptArray || transcriptArray.length === 0) { container.innerHTML = '<p class="text-gray-400 text-center italic">Transcript is empty.</p>'; return; }

    transcriptArray.forEach(turn => {
        const isAI = turn.role === 'model';
        const div = document.createElement('div');
        div.className = `flex ${isAI ? 'justify-start' : 'justify-end'}`;
        const bubble = document.createElement('div');
        bubble.className = `max-w-[85%] p-4 rounded-xl text-sm leading-relaxed ${isAI ? 'bg-gray-100 text-gray-800 rounded-tl-none' : 'bg-indigo-600 text-white rounded-tr-none'}`;
        const label = document.createElement('div');
        label.className = "text-xs font-bold mb-1 opacity-70";
        label.textContent = isAI ? "Prompta" : name;
        const text = document.createElement('div');
        text.innerHTML = turn.text.replace(/\n/g, '<br>');
        bubble.appendChild(label);
        bubble.appendChild(text);
        if (turn.audioUrl) {
            const audioContainer = document.createElement('div');
            audioContainer.className = "mt-3 pt-2 border-t border-white/20"; 
            const audioLabel = document.createElement('div');
            audioLabel.className = "text-[10px] font-bold uppercase mb-1 opacity-75 flex items-center gap-1";
            audioLabel.innerHTML = '<i class="fas fa-microphone"></i> Recording';
            const audioPlayer = document.createElement('audio');
            audioPlayer.controls = true;
            audioPlayer.src = turn.audioUrl;
            audioPlayer.setAttribute('controlsList', 'nodownload'); 
            audioPlayer.className = "w-full h-8 opacity-90 rounded";
            audioPlayer.style.filter = isAI ? "" : "invert(1) hue-rotate(180deg)"; 
            audioContainer.appendChild(audioLabel);
            audioContainer.appendChild(audioPlayer);
            bubble.appendChild(audioContainer);
        }
        div.appendChild(bubble);
        container.appendChild(div);
    });
}

function formatTranscriptText(transcriptArray, studentName, date) {
    let text = `INTERVIEW TRANSCRIPT\nStudent: ${studentName}\nDate: ${date}\n----------------------------------------\n\n`;
    if (!transcriptArray || transcriptArray.length === 0) return text + "(No transcript data)";
    transcriptArray.forEach(turn => {
        const speaker = turn.role === 'model' ? 'Prompta' : studentName;
        text += `${speaker}: ${turn.text}\n\n`;
    });
    return text;
}

function downloadSingleTranscript(transcriptArray, studentName, date) {
    const text = formatTranscriptText(transcriptArray, studentName, date);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${studentName.replace(/\s+/g, '_')}_Transcript.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function downloadAllTranscripts(code, title) {
    const btn = document.getElementById('download-all-btn');
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Zipping...';
    btn.disabled = true;
    try {
        const q = query(
            collection(db, `artifacts/${appId}/public/data/interview_transcripts`),
            where("interviewCode", "==", code)
        );
        const snapshot = await getDocs(q);
        if (snapshot.empty) { alert("No submissions to download."); return; }
        const zip = new JSZip();
        const folder = zip.folder(`${title.replace(/\s+/g, '_')}_Submissions`);
        snapshot.forEach(docSnap => {
            const sub = docSnap.data();
            const name = sub.studentName || 'Anonymous';
            const date = sub.timestamp ? new Date(sub.timestamp.toDate()).toLocaleDateString().replace(/\//g, '-') : 'Unknown_Date';
            const textContent = formatTranscriptText(sub.fullTranscript, name, date);
            const filename = `${name.replace(/\s+/g, '_')}_${date}_${docSnap.id.substring(0,4)}.txt`;
            folder.file(filename, textContent);
        });
        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${title.replace(/\s+/g, '_')}_All_Submissions.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error("Zip Error:", e);
        alert("Failed to create ZIP file.");
    } finally {
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
}