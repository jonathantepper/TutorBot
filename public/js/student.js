import { 
    db, auth, collection, doc, getDoc, setDoc, serverTimestamp, 
    signInWithPopup, GoogleAuthProvider, onAuthStateChanged, 
    isLocalHost, app 
} from './config.js';

import { initVisualizer, stopVisualizer } from './visualizer.js';

// --- CONFIGURATION ---
const USE_LOCAL_BACKEND = false; 

const GEMINI_MODEL = "gemini-2.0-flash-001";
const appId = 'default-app-id';

const ORIGINAL_PHRASES = [
    "Take a moment to reflect, and start when you are ready.",
    "I'm ready to listen to your response.",
];
let availablePhrases = [...ORIGINAL_PHRASES];

let userId, interviewData, transcriptDocRef; 
let transcript = []; 
let recognition;     
let isRecording = false;
let isAuthReady = false;
let interviewTurnCount = 0; 
let mediaStream = null;
let timerInterval = null;
let isInterviewExpired = false; // NEW: Global Lock Flag

// --- DYNAMIC SYSTEM PROMPT GENERATOR ---
function generateSystemPrompt(timeLimit) {
    const durationText = (timeLimit && timeLimit > 0) 
        ? `${timeLimit}-minute` 
        : "untimed (open-ended)";

    let pacingInstruction = "";
    if (timeLimit && timeLimit <= 5) {
        pacingInstruction = "Since this is a short interview, move quickly through the phases. Do not spend too long on introductions.";
    } else {
        pacingInstruction = "Maintain a steady pace, allowing the student time to elaborate.";
    }

    return `
### IDENTITY & ROLE
You are "Prompta," a friendly and professional academic interviewer. Your goal is to conduct a ${durationText} oral defense assessment with a Grade 12 student based strictly on the provided [ASSESSMENT_TEMPLATE_CONTENT].

### CORE KNOWLEDGE BASE
The entirety of the interview must be grounded EXCLUSIVELY in the text provided in the [ASSESSMENT_TEMPLATE_CONTENT] below. You must not introduce external questions or general knowledge not found in that specific template.

### BEHAVIORS & INTERACTION RULES
1. **Initiation:** Start the interview by introducing yourself: "Hi, I'm Prompta. I'm here to have a quick conversation about what you've learned." Then, ask the first question from **Phase 1** of the provided Template.
2. **Tone:** Maintain a supportive, encouraging, yet professional demeanor. Use conversational language appropriate for a high school student.
3. **The "No Teaching" Rule (CRITICAL):** You are here to ASSESS, not to teach.
    - NEVER provide the correct answer.
    - NEVER explain the concept if the student is stuck.
    - NEVER summarize the book.
    - If a student gives a **CLEAR but WRONG** answer, simply say "Thank you for sharing that," and move to the next question immediately.

4. **Handling Nonsense/Unclear Answers (THE "RETRY" PROTOCOL):**
    - **Trigger:** If the student's answer is unclear, irrelevant (e.g., "Testing", "Umm..."), or nonsensical.
    - **Attempt 1:** DO NOT move to the next question. You MUST gently paraphrase the *current* question and ask it exactly one more time.
    - **Attempt 2:** If the answer is *still* unclear or irrelevant after the paraphrase, simply say "That's okay, let's move on," and proceed to the NEXT question.

5. **Agency & Pacing:** - You are aware this is a ${durationText} interview. ${pacingInstruction}
    - At the end of a major section (e.g., end of Phase 1), or if the topic is shifting significantly, explicitly ask: "Are you ready to move on to the next part?" 

### EXECUTION FLOW
1. **Follow the Phases:** Move systematically through Phase 1, Phase 2, and Phase 3 of the Template.
2. **The "AI Trap" Check:** When asking "Fact Check" questions from Phase 1, compare the student's answer strictly against the [AI EVALUATION CRITERIA] in the Template. If they miss the specific keywords, accept it internally as a fail, but move on politely.

### TECHNICAL GUARDRAILS (MANDATORY)
- **NO USER SIMULATION:** You must NEVER generate text labeled "Student:" or simulate the student's reply.
- **STOP SEQUENCE:** After asking ONE question, you must STOP generating text immediately to wait for the student.
- **LENGTH:** Keep your conversational turns under 50 words.
- **FORMAT:** Always end your turn with a question.
`;
}

// --- INITIALIZATION ---
window.onload = initApp;

function getTransitionPhrase() {
    if (interviewTurnCount === 1) {
        return "Take a breath and when you are ready, please start speaking. When done press the mic button so you can review your answer before submitting.";
    } 
    else if (interviewTurnCount === 2) {
        return "Remember, take your time. Press the mic button to stop. You can always review your response if you need to.";
    }
    else if (availablePhrases.length > 0) {
        return availablePhrases.shift();
    }
    return "";
}

function initApp() {
    showLoading('Starting TutorBot...');
    shufflePhrases(); 

    onAuthStateChanged(auth, (user) => {
        if (user) {
            userId = user.uid;
            isAuthReady = true;
            updateStudentWelcome(user);
        } else {
            userId = null;
            isAuthReady = false;
            document.getElementById('signin-prompt').style.display = 'block';
            document.getElementById('code-entry-screen').style.display = 'none';
        }
        hideLoading();
    });

    // Buttons
    document.getElementById('google-signin-btn').addEventListener('click', signInWithGoogle);
    document.getElementById('start-interview-btn').addEventListener('click', startInterviewSession);
    document.getElementById('close-modal-btn').addEventListener('click', closeModal);
    document.getElementById('record-btn').addEventListener('click', toggleRecording);
    document.getElementById('retry-btn').addEventListener('click', handleRetry);
    document.getElementById('submit-btn').addEventListener('click', submitResponse);

    if (window.speechSynthesis) {
        window.speechSynthesis.getVoices();
    }
    initSpeechToText();
}

// --- UTILS ---
const loadingOverlay = document.getElementById('loading-overlay');
const statusBar = document.getElementById('status-bar');
const statusText = document.getElementById('mic-status-text');
const recordContainer = document.getElementById('record-container');
const reviewContainer = document.getElementById('review-container');
const draftInput = document.getElementById('draft-input');
const recordBtn = document.getElementById('record-btn');

function showLoading(msg) {
    document.getElementById('loading-message').textContent = msg;
    loadingOverlay.style.display = 'flex';
}

function hideLoading() {
    loadingOverlay.style.display = 'none';
}

function showModal(t, m) {
    document.getElementById('modal-title').textContent = t;
    document.getElementById('modal-message').textContent = m;
    document.getElementById('modal-container').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-container').style.display = 'none';
}

function updateProgress(turn) {
    const s1 = document.getElementById('step-1'); 
    const s2 = document.getElementById('step-2'); 
    const s3 = document.getElementById('step-3'); 
    const s4 = document.getElementById('step-4'); 

    const gray = "bg-gray-200";
    const active = "bg-indigo-600";

    s1.className = `flex-1 h-1.5 rounded-full transition-all duration-500 ${active}`;

    if (turn >= 2) s2.className = s2.className.replace(gray, active);
    if (turn >= 5) s3.className = s3.className.replace(gray, active);
    if (turn >= 8) s4.className = s4.className.replace(gray, active);
}

// --- TIMER & HARD STOP LOGIC ---
function startTimer(minutes) {
    const timerDisplay = document.getElementById('timer-display');
    const timeLabel = document.getElementById('time-remaining');
    
    if (!timerDisplay || !timeLabel) return;

    if (!minutes || minutes <= 0) {
        timerDisplay.classList.add('hidden');
        return;
    }

    timerDisplay.classList.remove('hidden');
    let secondsLeft = minutes * 60;

    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    timeLabel.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
        secondsLeft--;

        const m = Math.floor(secondsLeft / 60);
        const s = secondsLeft % 60;
        timeLabel.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

        if (secondsLeft <= 60) {
            timerDisplay.classList.remove('text-indigo-600', 'bg-indigo-50');
            timerDisplay.classList.add('text-red-600', 'bg-red-50', 'animate-pulse');
        }

        if (secondsLeft <= 0) {
            clearInterval(timerInterval);
            timeLabel.textContent = "00:00";
            
            // --- HARD STOP TRIGGER ---
            isInterviewExpired = true;
            if (isRecording) recognition.stop(); // Cut the mic
            setStatus('expired'); // Lock the UI
            
            addMessageToChat('System', "<b>Time is up!</b> The interview is now closed. Great job!");
        }
    }, 1000);
}

// --- LOGIC ---
async function signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    try {
        document.getElementById('google-signin-btn').disabled = true;
        await signInWithPopup(auth, provider);
    } catch (error) {
        showModal("Sign In Failed", error.message);
        document.getElementById('google-signin-btn').disabled = false;
    }
}

function updateStudentWelcome(user) {
    const welcomeEl = document.getElementById('student-welcome');
    let welcomeMessage = user.displayName ? `Welcome, ${user.displayName.split(' ')[0]}!` : `Welcome, ${user.email}!`;
    welcomeEl.textContent = welcomeMessage;
    document.getElementById('signin-prompt').style.display = 'none';
    document.getElementById('code-entry-screen').style.display = 'flex';
}

async function startInterviewSession() {
    if (!isAuthReady) return;
    const code = document.getElementById('interview-code').value.trim().toUpperCase();
    const codeError = document.getElementById('code-error');
    
    if (!code || code.length !== 5) {
        codeError.textContent = "Please enter a 5-letter code.";
        codeError.style.display = 'block';
        return;
    }
    codeError.style.display = 'none';
    showLoading('Joining session...');

    try {
        const interviewDocRef = doc(db, `artifacts/${appId}/public/data/interviews`, code);
        const docSnap = await getDoc(interviewDocRef);

        if (!docSnap.exists()) throw new Error("Invalid code. Please check with your teacher.");

        interviewData = docSnap.data();
        interviewData.code = code;
        transcriptDocRef = doc(collection(db, `artifacts/${appId}/public/data/interview_transcripts`));

        document.getElementById('topic-title-display').textContent = interviewData.title;
        document.getElementById('teacher-id-display').textContent = `Interviewer: ${interviewData.teacherName || 'Teacher'}`;
        document.getElementById('code-display').textContent = code;
        
        document.getElementById('app-header').classList.remove('hidden');
        document.getElementById('app-header').classList.add('flex');
        document.getElementById('progress-container').classList.remove('hidden');

        // Reset State
        isInterviewExpired = false;
        
        if (interviewData.timeLimit && interviewData.timeLimit > 0) {
            startTimer(interviewData.timeLimit);
        }

        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('chat-screen').style.display = 'flex';
        document.getElementById('record-btn').disabled = false;
        
        await getGeminiResponse();

    } catch (e) {
        codeError.textContent = e.message;
        codeError.style.display = 'block';
    } finally {
        hideLoading();
    }
}

function shufflePhrases() {
    for (let i = availablePhrases.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availablePhrases[i], availablePhrases[j]] = [availablePhrases[j], availablePhrases[i]];
    }
}

async function getGeminiResponse() {
    showTypingIndicator(); 
    setStatus('thinking');

    try {
        const projectId = "tutorbot-184ec";
        const functionUrl = (isLocalHost && USE_LOCAL_BACKEND)
            ? `http://127.0.0.1:5001/${projectId}/us-central1/getGeminiResponse`
            : "https://getgeminiresponse-4bqegt74dq-uc.a.run.app"; 

        const dynamicSystemPrompt = generateSystemPrompt(interviewData.timeLimit);
        const fullPrompt = `${dynamicSystemPrompt}\n\n[ASSESSMENT_TEMPLATE_CONTENT]:\n${interviewData.curriculumText}`;
        
        let apiHistory = transcript.slice(0, -1).map(entry => ({
            role: entry.role,
            parts: [{ text: entry.text }]
        }));
        
        if (apiHistory.length > 0 && apiHistory[0].role === 'model') {
            apiHistory.unshift({ role: 'user', parts: [{ text: "I am ready to start." }] });
        }

        const messageToSend = transcript.length > 0 ? transcript[transcript.length - 1].text : "Please introduce yourself.";

        const response = await fetch(functionUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                history: apiHistory,
                message: messageToSend,
                systemPrompt: fullPrompt
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Server Error: ${errText}`);
        }

        const data = await response.json();
        const aiText = data.response; 

        // --- UPDATE PROGRESS ---
        interviewTurnCount++;
        updateProgress(interviewTurnCount); 

        const isErrorReprompt = aiText.includes("didn't quite catch") || aiText.includes("Say that again");
        const transition = isErrorReprompt ? "" : getTransitionPhrase();
        const fullResponse = transition ? `${aiText}\n\n${transition}` : aiText;

        const audioBase64 = await fetchAudio(fullResponse);

        removeTypingIndicator();
        addMessageToChat('Prompta', fullResponse); 
        updateTranscript('model', aiText);

        playAudio(audioBase64, fullResponse, () => {
            console.log("🔊 Audio ended. Checking for auto-start...");
            startRecording(); // This will check isInterviewExpired internally
        });

    } catch (error) {
        removeTypingIndicator();
        console.error("AI Error:", error);
        addMessageToChat('System', "Sorry, I lost connection to the brain. Please try again.");
        setStatus('idle');
    }
}

async function fetchAudio(text) {
    try {
        const projectId = "tutorbot-184ec";
        const functionUrl = (isLocalHost && USE_LOCAL_BACKEND)
            ? `http://127.0.0.1:5001/${projectId}/us-central1/generateSpeech`
            : "https://generatespeech-4bqegt74dq-uc.a.run.app";

        const response = await fetch(functionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });

        if (!response.ok) throw new Error(`Cloud TTS Error: ${response.statusText}`);
        const data = await response.json();
        return data.audioContent;
    } catch (e) {
        console.warn("Cloud TTS failed.", e);
        return null; 
    }
}

function setStatus(state) {
    // --- GLOBAL LOCK: If expired, FORCE the closed state ---
    if (isInterviewExpired) {
        statusBar.className = "flex items-center justify-center gap-2 text-sm font-medium text-red-600";
        statusText.textContent = "Interview Closed";
        recordContainer.style.display = 'flex'; 
        reviewContainer.style.display = 'none';
        
        recordBtn.className = "relative group w-16 h-16 rounded-full bg-gray-100 text-gray-400 cursor-not-allowed flex items-center justify-center shadow-none border-0";
        recordBtn.innerHTML = '<i class="fas fa-ban text-2xl"></i>';
        recordBtn.disabled = true;
        return; // EXIT FUNCTION
    }

    statusBar.className = "flex items-center justify-center gap-2 text-sm font-medium transition-colors duration-300";
    recordBtn.className = "relative group w-16 h-16 rounded-full text-white shadow-xl hover:shadow-2xl transition-all duration-300 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed";

    if (state === 'listening') {
        statusBar.classList.add('text-green-600'); 
        statusText.textContent = "I'm Listening... (Press to Stop)";
        recordContainer.style.display = 'flex'; 
        reviewContainer.style.display = 'none';
        recordBtn.classList.add('bg-green-500', 'animate-pulse', 'border-4', 'border-green-200');
        recordBtn.innerHTML = '<i class="fas fa-microphone text-3xl"></i>';
        recordBtn.disabled = false;

    } else if (state === 'review') {
        statusBar.classList.add('text-indigo-600');
        statusText.textContent = "Review your answer";
        recordContainer.style.display = 'none'; 
        reviewContainer.style.display = 'flex';

    } else if (state === 'thinking') {
        statusBar.classList.add('text-indigo-500');
        statusText.textContent = "Prompta is thinking...";
        recordContainer.style.display = 'flex'; 
        reviewContainer.style.display = 'none';
        recordBtn.classList.add('bg-gray-400');
        recordBtn.innerHTML = '<i class="fas fa-brain text-2xl animate-pulse"></i>';
        recordBtn.disabled = true;

    } else if (state === 'speaking') {
        statusBar.classList.add('text-blue-600');
        statusText.textContent = "Prompta is speaking...";
        recordContainer.style.display = 'flex'; 
        reviewContainer.style.display = 'none';
        recordBtn.classList.add('bg-blue-600', 'pulse-ring'); 
        recordBtn.innerHTML = '<i class="fas fa-volume-up text-2xl"></i>';
        recordBtn.disabled = true;

    } else {
        statusBar.classList.add('text-gray-400');
        statusText.textContent = "Tap microphone to answer";
        recordContainer.style.display = 'flex'; 
        reviewContainer.style.display = 'none';
        recordBtn.classList.add('bg-indigo-600');
        recordBtn.innerHTML = '<i class="fas fa-microphone text-2xl"></i>';
        recordBtn.disabled = false;
    }
}

function initSpeechToText() {
    if ('webkitSpeechRecognition' in window) {
        recognition = new webkitSpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = async () => { 
            isRecording = true; 
            setStatus('listening'); 
            draftInput.value = ''; 
            try {
                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                initVisualizer(mediaStream);
            } catch (e) {
                console.warn("Visualizer failed to start", e);
            }
        };
        
        recognition.onend = () => {
            isRecording = false;
            stopVisualizer();
            if (mediaStream) {
                mediaStream.getTracks().forEach(track => track.stop());
                mediaStream = null;
            }
            if (draftInput.value.trim().length > 0) {
                formatAndShowDraft(); 
            } else {
                setStatus('idle');
            }
        };

        recognition.onresult = (event) => {
            let final = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    final += event.results[i][0].transcript;
                }
            }
            if (final) draftInput.value += final + ' ';
        };
    } else {
        showModal("Browser Not Supported", "Please use Google Chrome.");
    }
}

function startRecording() {
    // --- LOCKOUT CHECK ---
    if (isInterviewExpired) {
        console.log("Timer expired. Microphone auto-start blocked.");
        return;
    }
    try {
        recognition.start();
    } catch (e) {
        console.warn("Auto-start blocked. User must click manually.", e);
        setStatus('idle');
    }
}

function toggleRecording() {
    // --- LOCKOUT CHECK ---
    if (isInterviewExpired) return;
    
    isRecording ? recognition.stop() : recognition.start();
}

function handleRetry() {
    draftInput.value = ''; 
    setStatus('listening'); 
    startRecording();
}

function formatAndShowDraft() {
    let cleanText = draftInput.value.trim();
    cleanText = cleanText.replace(/\s{2,}/g, ". ");
    cleanText = cleanText.charAt(0).toUpperCase() + cleanText.slice(1);
    cleanText = cleanText.replace(/\b i \b/g, " I ");
    cleanText = cleanText.replace(/(\. )([a-z])/g, (match, sep, char) => sep + char.toUpperCase());
    if (!/[.?!]$/.test(cleanText)) cleanText += ".";

    draftInput.value = cleanText;
    setStatus('review');
}

async function submitResponse() {
    const text = draftInput.value.trim();
    if (!text) return;
    setStatus('thinking');
    addMessageToChat('Student', text);
    updateTranscript('user', text);
    await getGeminiResponse();
}

function addMessageToChat(role, text) {
    const chatBox = document.getElementById('chat-box');
    const isUser = role === 'Student';
    const div = document.createElement('div');
    div.className = `flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-4`;
    
    const avatar = document.createElement('div');
    avatar.className = `w-8 h-8 rounded-full flex items-center justify-center text-white text-xs shadow-sm shrink-0 ${isUser ? 'ml-2 bg-indigo-500 order-2' : 'mr-2 bg-teal-500 order-1'}`;
    avatar.innerHTML = isUser ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';

    const bubble = document.createElement('div');
    bubble.className = `max-w-[80%] p-4 rounded-2xl shadow-sm text-sm leading-relaxed ${isUser ? 'bg-indigo-600 text-white rounded-tr-none order-1' : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none order-2'}`;
    bubble.innerHTML = text.replace(/\n/g, '<br>');
    
    div.appendChild(avatar);
    div.appendChild(bubble);
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function showTypingIndicator() {
    const chatBox = document.getElementById('chat-box');
    const div = document.createElement('div');
    div.id = 'typing-bubble';
    div.className = `flex w-full justify-start mb-4`;
    div.innerHTML = `<div class="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white mr-2"><i class="fas fa-robot"></i></div><div class="bg-white border border-gray-100 p-4 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-1 h-[52px]"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function removeTypingIndicator() {
    const el = document.getElementById('typing-bubble');
    if (el) el.remove();
}

function updateTranscript(role, text) {
    if (!text) return;
    transcript.push({ role: role.toLowerCase(), text: text, timestamp: new Date().toISOString() });
    if (transcriptDocRef) {
        setDoc(transcriptDocRef, {
            fullTranscript: transcript, timestamp: serverTimestamp(),
            interviewCode: interviewData.code, studentId: userId,
            studentName: auth.currentUser.displayName || 'Anonymous', 
            studentEmail: auth.currentUser.email,
            topic: interviewData.title
        }, { merge: true }).catch(e => console.error(e));
    }
}

function playAudio(base64String, textFallback, onComplete) {
    if (recognition) recognition.stop();
    window.speechSynthesis.cancel(); 
    
    if (!base64String) { 
        speakTextFallback(textFallback, onComplete); 
        return; 
    }

    const audio = new Audio("data:audio/mp3;base64," + base64String);
    audio.onplay = () => setStatus('speaking');
    audio.onended = () => {
        if (onComplete) onComplete(); else setStatus('idle');
    };
    audio.play().catch(e => {
        console.error("Audio playback failed", e);
        if (onComplete) onComplete();
    });
}

function speakTextFallback(text, onComplete) {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find(v => v.name.includes('Natural')) || voices[0];
    utterance.onstart = () => setStatus('speaking');
    utterance.onend = () => {
        if (onComplete) onComplete(); else setStatus('idle');
    };
    window.speechSynthesis.speak(utterance);
}