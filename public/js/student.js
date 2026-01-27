import { 
    db, auth, collection, doc, getDoc, setDoc, serverTimestamp, 
    signInWithPopup, GoogleAuthProvider, onAuthStateChanged, 
    isLocalHost, app 
} from './config.js';

// --- VISUALIZER IMPORT ---
import { initVisualizer, stopVisualizer } from './visualizer.js';

// --- CONFIGURATION ---
const SYSTEM_PROMPT = `
### IDENTITY & ROLE
You are "Prompta," a friendly and professional academic interviewer. Your goal is to conduct a 10-minute oral defense assessment with a Grade 12 student based strictly on the provided [ASSESSMENT_TEMPLATE_CONTENT].

### CORE KNOWLEDGE BASE
The entirety of the interview must be grounded EXCLUSIVELY in the text provided in the [ASSESSMENT_TEMPLATE_CONTENT] below. You must not introduce external questions or general knowledge not found in that specific template.

### BEHAVIORS & INTERACTION RULES
1. **Initiation:** Start the interview by introducing yourself: "Hi, I'm Prompta. I'm here to have a quick conversation about what you've learned." Then, ask the first question from **Phase 1** of the provided Template.
2. **Tone:** Maintain a supportive, encouraging, yet professional demeanor. Use conversational language appropriate for a high school student.
3. **The "No Teaching" Rule (CRITICAL):** You are here to ASSESS, not to teach.
    - NEVER provide the correct answer.
    - NEVER explain the concept if the student is stuck.
    - NEVER summarize the book.
    - If a student is wrong, simply say "Thank you for sharing that," and move to the next question.
4. **Handling Non-Answers & Confusion:**
    - **Step 1:** If a student's answer is unclear, irrelevant (e.g., "Testing", "Umm..."), or nonsensical, DO NOT fail them immediately. Gently paraphrase the question and ask it one more time.
    - **Step 2:** If the answer is still unclear or irrelevant on the second try, simply say "That's okay, let's move on," and proceed to the NEXT question.
5. **Agency & Pacing:** - At the end of a major section (e.g., end of Phase 1), or if the topic is shifting significantly, explicitly ask: "Are you ready to move on to the next part?" 
    - Do not rush the student.

### EXECUTION FLOW
1. **Follow the Phases:** Move systematically through Phase 1, Phase 2, and Phase 3 of the Template.
2. **The "AI Trap" Check:** When asking "Fact Check" questions from Phase 1, compare the student's answer strictly against the [AI EVALUATION CRITERIA] in the Template. If they miss the specific keywords, accept it internally as a fail, but move on politely.

### TECHNICAL GUARDRAILS (MANDATORY)
- **NO USER SIMULATION:** You must NEVER generate text labeled "Student:" or simulate the student's reply.
- **STOP SEQUENCE:** After asking ONE question, you must STOP generating text immediately to wait for the student.
- **LENGTH:** Keep your conversational turns under 50 words.
- **FORMAT:** Always end your turn with a question.
`;

const GEMINI_MODEL = "gemini-2.0-flash-001";
const appId = 'default-app-id';

// --- PROMPT PHRASES (Pool of options) ---
const ORIGINAL_PHRASES = [
    "Take a moment to reflect, and start when you are ready.",
    "I'm ready to listen to your response.",
];

// Create a copy we can "consume" so we don't destroy the original list
let availablePhrases = [...ORIGINAL_PHRASES];

// --- GLOBAL VARIABLES ---
let userId, interviewData, transcriptDocRef; 
let transcript = []; 
let recognition;     
let isRecording = false;
let isAuthReady = false;
let interviewTurnCount = 0; // <--- Tracks progress
let mediaStream = null;     // <--- Tracks mic stream for visualizer

// --- INITIALIZATION ---
window.onload = initApp;

function getTransitionPhrase() {
    // --- Turn 1: The "Onboarding" Instruction ---
    if (interviewTurnCount === 1) {
        return "Take a breath and when you are ready, please start speaking. When done press the mic button so you can review your answer before submitting.";
    } 
    
    // --- Turn 2: The "Gentle Reminder" (Different text!) ---
    else if (interviewTurnCount === 2) {
        return "Remember, take your time. Press the mic button to stop. You can always review your response if you need to.";
    }

    // --- Turn 3+: The "Shuffled Deck" (Random Variety) ---
    // As long as we have phrases left in our "deck", use one.
    else if (availablePhrases.length > 0) {
        return availablePhrases.shift(); // Removes and returns the top card
    }

    // --- Turn 8+: Expert Mode (Silent) ---
    return "";
}

function initApp() {
    showLoading('Starting TutorBot...');
    
    // --- NEW: Shuffle the phrases so every student gets a different order ---
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

    // Event Listeners
    document.getElementById('google-signin-btn').addEventListener('click', signInWithGoogle);
    document.getElementById('start-interview-btn').addEventListener('click', startInterviewSession);
    document.getElementById('close-modal-btn').addEventListener('click', closeModal);
    
    // UI Buttons
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
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('chat-screen').style.display = 'flex';
        
        document.getElementById('record-btn').disabled = false;
        
        // Start the First Turn
        await getGeminiResponse();

    } catch (e) {
        codeError.textContent = e.message;
        codeError.style.display = 'block';
    } finally {
        hideLoading();
    }
}

// Fisher-Yates Shuffle Algorithm (Standard for perfect randomness)
function shufflePhrases() {
    for (let i = availablePhrases.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availablePhrases[i], availablePhrases[j]] = [availablePhrases[j], availablePhrases[i]];
    }
}

// --- SECURE BACKEND CALL ---
async function getGeminiResponse() {
    showTypingIndicator(); 
    setStatus('thinking');

    try {
        const projectId = "tutorbot-184ec";
        
        // V2 Function URL (Use the specific URL you found!)
        const functionUrl = isLocalHost 
            ? `http://127.0.0.1:5001/${projectId}/us-central1/getGeminiResponse`
            : "https://getgeminiresponse-4bqegt74dq-uc.a.run.app"; 

        // 2. Prepare the Data
        const fullPrompt = `${SYSTEM_PROMPT}\n\n[ASSESSMENT_TEMPLATE_CONTENT]:\n${interviewData.curriculumText}`;
        
        // Map history
        let apiHistory = transcript.slice(0, -1).map(entry => ({
            role: entry.role,
            parts: [{ text: entry.text }]
        }));
        
        // Safety check
        if (apiHistory.length > 0 && apiHistory[0].role === 'model') {
            apiHistory.unshift({ role: 'user', parts: [{ text: "I am ready to start." }] });
        }

        const messageToSend = transcript.length > 0 ? transcript[transcript.length - 1].text : "Please introduce yourself.";

        // 3. CALL YOUR BACKEND
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
        const aiText = data.response; // The text from Gemini

        // --- NEW: INCREMENT & APPEND TRANSITION ---
        interviewTurnCount++;

        // 1. CHECK: Is this just an error message?
        const isErrorReprompt = aiText.includes("didn't quite catch") || aiText.includes("Say that again");

        // 2. DECIDE: If error, NO transition. If normal, get the phrase.
        const transition = isErrorReprompt ? "" : getTransitionPhrase();
        
        // 3. COMBINE: Create the version the user SEES and HEARS
        const fullResponse = transition ? `${aiText}\n\n${transition}` : aiText;

        // 4. FETCH AUDIO (This calls your other function)
        const audioBase64 = await fetchAudio(fullResponse);

        removeTypingIndicator();
        
        // 5. UI UPDATE
        addMessageToChat('Prompta', fullResponse); 

        // 6. MEMORY UPDATE: Save ONLY the clean question
        updateTranscript('model', aiText);

        // 7. AUDIO & AUTO-START
        playAudio(audioBase64, fullResponse, () => {
            console.log("🔊 Audio ended. Auto-starting mic...");
            startRecording(); 
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
        
        // V2 Function URL (Use the specific URL you found!)
        const functionUrl = isLocalHost 
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

// --- UPDATED UI HELPER ---
function setStatus(state) {
    statusBar.className = "flex items-center justify-center gap-2 text-sm font-medium transition-colors duration-300";
    
    // Reset Button Classes
    recordBtn.className = "relative group w-20 h-20 rounded-full text-white shadow-xl hover:shadow-2xl transition-all duration-300 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed";

    if (state === 'listening') {
        statusBar.classList.add('text-green-600'); // Green text
        statusText.textContent = "I'm Listening... (Press to Stop)";
        
        recordContainer.style.display = 'flex'; 
        reviewContainer.style.display = 'none';

        // GREEN PULSE ANIMATION (The "Live" Look)
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

        recordBtn.classList.add('bg-blue-600', 'pulse-ring'); // Pulse while speaking
        recordBtn.innerHTML = '<i class="fas fa-volume-up text-2xl"></i>';
        recordBtn.disabled = true;

    } else {
        // IDLE STATE (Fallback)
        statusBar.classList.add('text-gray-400');
        statusText.textContent = "Tap microphone to answer";
        
        recordContainer.style.display = 'flex'; 
        reviewContainer.style.display = 'none';

        recordBtn.classList.add('bg-indigo-600');
        recordBtn.innerHTML = '<i class="fas fa-microphone text-2xl"></i>';
        recordBtn.disabled = false;
    }
}

// --- SPEECH LOGIC (UPDATED WITH VISUALIZER) ---
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
            
            // --- START VISUALIZER ---
            try {
                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                initVisualizer(mediaStream);
            } catch (e) {
                console.warn("Visualizer failed to start", e);
            }
        };
        
        recognition.onend = () => {
            isRecording = false;
            
            // --- STOP VISUALIZER ---
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

// --- NEW: Start Recording Helper (Handles Browser Blocks) ---
function startRecording() {
    try {
        recognition.start();
    } catch (e) {
        console.warn("Auto-start blocked. User must click manually.", e);
        setStatus('idle'); // Fallback to "Tap to Speak"
    }
}

function toggleRecording() {
    isRecording ? recognition.stop() : recognition.start();
}

// --- NEW: Retry Logic (Silent Restart) ---
function handleRetry() {
    draftInput.value = ''; 
    setStatus('listening'); // Force UI update immediately
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

// --- UPDATED: Play Audio + Callback ---
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
        // When audio finishes...
        if (onComplete) {
            onComplete(); // <--- TRIGGERS THE AUTO-RECORD
        } else {
            setStatus('idle');
        }
    };
    
    audio.play().catch(e => {
        console.error("Audio playback failed", e);
        // If audio fails, still trigger the callback so user isn't stuck
        if (onComplete) onComplete();
    });
}

function speakTextFallback(text, onComplete) {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find(v => v.name.includes('Natural')) || voices[0];
    
    utterance.onstart = () => setStatus('speaking');
    
    utterance.onend = () => {
        if (onComplete) {
            onComplete();
        } else {
            setStatus('idle');
        }
    };
    
    window.speechSynthesis.speak(utterance);
}