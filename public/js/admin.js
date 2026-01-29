// Import tools from our shared config
import { 
    db, auth, collection, query, getDocs, getDoc, doc, setDoc, deleteDoc, where, 
    signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, 
    isLocalHost 
} from './config.js';

const appId = 'default-app-id';

// --- CONFIGURATION ---
// SAFETY NET: This email is ALWAYS a Super Admin, even if the database is empty.
// Replace this with your actual email.
const OWNER_EMAIL = "jontepper@gmail.com"; 

// --- GLOBAL STATE ---
let currentUserRole = null; // 'admin', 'manager', or null
let currentUserDomain = null;

// --- INITIALIZATION ---
window.onload = initApp;

function initApp() {
    // Listen for Auth Changes
    onAuthStateChanged(auth, (user) => {
        updateUIForAuthState(user);
    });

    // Attach Event Listeners
    const authBtn = document.getElementById('auth-btn');
    if (authBtn) authBtn.addEventListener('click', handleAuthButton);
    
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadData);

    // Team Management Listeners
    document.getElementById('manage-team-btn').addEventListener('click', openTeamModal);
    document.getElementById('close-team-modal').addEventListener('click', () => {
        document.getElementById('team-modal').classList.add('hidden');
    });
    document.getElementById('add-user-btn').addEventListener('click', addNewUser);
}

// --- AUTHENTICATION & ROLE CHECK ---
async function updateUIForAuthState(user) {
    const authBtn = document.getElementById('auth-btn');
    const accessDeniedEl = document.getElementById('access-denied');
    const dashboardEl = document.getElementById('dashboard');
    const roleBadge = document.getElementById('role-badge');
    const manageTeamBtn = document.getElementById('manage-team-btn');

    if (user) {
        authBtn.textContent = 'Sign Out';
        
        // 1. DETERMINE ROLE (Check DB + Owner Fallback)
        await determineUserRole(user);

        // 2. CHECK ACCESS
        if (currentUserRole) {
            accessDeniedEl.classList.add('hidden');
            dashboardEl.classList.remove('hidden');
            
            // UI Updates
            if (roleBadge) {
                roleBadge.classList.remove('hidden');
                roleBadge.innerHTML = currentUserRole === 'admin' 
                    ? '<i class="fas fa-crown text-yellow-400 mr-1"></i> Super Admin' 
                    : `<i class="fas fa-building text-blue-400 mr-1"></i> Manager (@${currentUserDomain})`;
            }

            // Show "Manage Team" button ONLY for Admins
            if (currentUserRole === 'admin') {
                manageTeamBtn.classList.remove('hidden');
            }

            document.getElementById('filter-status').textContent = currentUserRole === 'admin' 
                ? "Viewing all active accounts" 
                : `Viewing active accounts for @${currentUserDomain}`;

            loadData();
        } else {
            alert("Access Denied: Your email is not on the authorized list.");
            signOut(auth);
        }
    } else {
        accessDeniedEl.classList.remove('hidden');
        dashboardEl.classList.add('hidden');
        if (roleBadge) roleBadge.classList.add('hidden');
        if (manageTeamBtn) manageTeamBtn.classList.add('hidden');
        authBtn.textContent = 'Sign In';
        currentUserRole = null;
    }
}

async function determineUserRole(user) {
    const email = user.email.toLowerCase();
    const domain = email.split('@')[1];

    // Default: Deny
    currentUserRole = null;
    currentUserDomain = null;

    // A. Is it the Owner? (Hardcoded Safety Net)
    if (email === OWNER_EMAIL.toLowerCase()) {
        currentUserRole = 'admin';
        currentUserDomain = 'all';
        return;
    }

    // B. Check Database
    try {
        const docRef = doc(db, `artifacts/${appId}/public/data/roles`, email);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            currentUserRole = data.role; // 'admin' or 'manager'
            currentUserDomain = currentUserRole === 'admin' ? 'all' : domain;
        }
    } catch (e) {
        console.error("Error checking roles:", e);
    }
}

async function handleAuthButton() {
    const user = auth.currentUser;
    if (user) {
        await signOut(auth);
    } else {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
        } catch (e) {
            console.error("Auth Error:", e);
            alert(e.message);
        }
    }
}

// --- TEAM MANAGEMENT ---

async function openTeamModal() {
    document.getElementById('team-modal').classList.remove('hidden');
    loadAuthorizedUsers();
}

async function loadAuthorizedUsers() {
    const listEl = document.getElementById('authorized-users-list');
    listEl.innerHTML = '<p class="text-center text-gray-400 py-2"><i class="fas fa-spinner fa-spin"></i> Loading...</p>';

    try {
        const q = query(collection(db, `artifacts/${appId}/public/data/roles`));
        const snapshot = await getDocs(q);
        
        listEl.innerHTML = '';
        
        // Owner (Static)
        const ownerDiv = document.createElement('div');
        ownerDiv.className = "flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-100";
        ownerDiv.innerHTML = `
            <div>
                <span class="font-bold text-gray-800">${OWNER_EMAIL}</span>
                <span class="ml-2 text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">Owner</span>
            </div>
            <span class="text-xs text-gray-400"><i class="fas fa-lock"></i> Protected</span>
        `;
        listEl.appendChild(ownerDiv);

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const email = docSnap.id;
            if (email === OWNER_EMAIL.toLowerCase()) return;

            const row = document.createElement('div');
            row.className = "flex justify-between items-center p-3 bg-white rounded-lg border border-gray-200 hover:border-indigo-300 transition";
            
            const badgeColor = data.role === 'admin' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800';
            const badgeLabel = data.role === 'admin' ? 'Admin' : 'Manager';
            
            // NEW: Check for Audio Permission
            const audioBadge = data.canRecordAudio 
                ? `<span class="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full" title="Audio Recording Enabled"><i class="fas fa-microphone"></i> Rec</span>` 
                : '';

            row.innerHTML = `
                <div>
                    <span class="font-medium text-gray-800">${email}</span>
                    <span class="ml-2 text-xs ${badgeColor} px-2 py-0.5 rounded-full capitalize">${badgeLabel}</span>
                    ${audioBadge}
                </div>
                <button onclick="removeUser('${email}')" class="text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition">
                    <i class="fas fa-trash-alt"></i>
                </button>
            `;
            listEl.appendChild(row);
        });

    } catch (e) {
        listEl.innerHTML = '<p class="text-red-500">Error loading users.</p>';
        console.error(e);
    }
}

async function addNewUser() {
    const emailInput = document.getElementById('new-user-email');
    const roleSelect = document.getElementById('new-user-role');
    const audioCheck = document.getElementById('new-user-audio'); // NEW
    const btn = document.getElementById('add-user-btn');

    const email = emailInput.value.trim().toLowerCase();
    const role = roleSelect.value;

    if (!email || !email.includes('@')) {
        alert("Please enter a valid email address.");
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    try {
        await setDoc(doc(db, `artifacts/${appId}/public/data/roles`, email), {
            role: role,
            canRecordAudio: audioCheck.checked, // NEW: Save permission
            addedBy: auth.currentUser.email,
            timestamp: new Date()
        });
        
        emailInput.value = '';
        audioCheck.checked = false; // Reset checkbox
        loadAuthorizedUsers(); 
    } catch (e) {
        alert("Error adding user: " + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "Add User";
    }
}

// Make removeUser globally accessible for the onclick event
window.removeUser = async (email) => {
    if (!confirm(`Are you sure you want to remove access for ${email}?`)) return;

    try {
        await deleteDoc(doc(db, `artifacts/${appId}/public/data/roles`, email));
        loadAuthorizedUsers(); // Refresh list
    } catch (e) {
        alert("Error removing user: " + e.message);
    }
};


// --- DATA LOADING ---
async function loadData() {
    const container = document.getElementById('teacher-list');
    container.innerHTML = '<div class="text-center py-12"><div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div><p class="text-gray-500">Loading data...</p></div>';

    try {
        const q = query(collection(db, `artifacts/${appId}/public/data/interviews`));
        const snapshot = await getDocs(q);
        const teachers = {}; 

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const tid = data.teacherId;
            if (!tid) return; 
            
            const email = data.teacherEmail || "no-email-recorded";
            const domain = email.includes('@') ? email.split('@')[1] : 'unknown';

            // MANAGER FILTERING
            if (currentUserRole === 'manager' && domain !== currentUserDomain) {
                return; // Skip records outside manager's domain
            }

            const interviewTimestamp = data.timestamp ? data.timestamp.toDate() : null;
 
            if (!teachers[tid]) {
                teachers[tid] = { 
                    id: tid, 
                    name: data.teacherName || "Unknown Teacher", 
                    email: email,
                    domain: domain,
                    interviews: [],
                    firstActivity: interviewTimestamp
                };
            } else {
                if (teachers[tid].email === "no-email-recorded" && email !== "no-email-recorded") {
                    teachers[tid].email = email;
                    teachers[tid].domain = email.split('@')[1];
                }
                if (interviewTimestamp && (!teachers[tid].firstActivity || interviewTimestamp < teachers[tid].firstActivity)) {
                    teachers[tid].firstActivity = interviewTimestamp;
                }
            }
            teachers[tid].interviews.push({ id: docSnap.id, ...data });
        });

        renderTeachersByDomain(teachers);

    } catch (e) {
        console.error("Error loading data:", e);
        container.innerHTML = `<p class="text-red-500 text-center">Error: ${e.message}</p>`;
    }
}

// --- UI RENDERING ---
function renderTeachersByDomain(teachersMap) {
    const container = document.getElementById('teacher-list');
    container.innerHTML = '';
    
    const teachers = Object.values(teachersMap);
    if (teachers.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 bg-white rounded-xl border border-gray-200 border-dashed">
                <i class="fas fa-users-slash text-4xl text-gray-300 mb-3"></i>
                <p class="text-gray-500">No active teachers found for your view.</p>
            </div>`;
        return;
    }

    const domains = {};
    teachers.forEach(t => {
        if (!domains[t.domain]) domains[t.domain] = [];
        domains[t.domain].push(t);
    });

    Object.keys(domains).sort().forEach(domainName => {
        const domainHeader = document.createElement('div');
        domainHeader.className = "mt-8 mb-4 flex items-center gap-2 border-b-2 border-gray-200 pb-2";
        domainHeader.innerHTML = `
            <div class="bg-gray-100 p-2 rounded-lg"><i class="fas fa-building text-gray-500"></i></div>
            <h3 class="text-xl font-bold text-gray-800">${domainName}</h3>
            <span class="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">${domains[domainName].length} Teacher(s)</span>
        `;
        container.appendChild(domainHeader);

        domains[domainName].forEach(teacher => {
            const card = document.createElement('div');
            card.className = "bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-4 transition hover:shadow-md";

            const teacherCreationDate = teacher.firstActivity ? teacher.firstActivity.toLocaleDateString() : 'N/A';
            
            // Managers cannot delete teachers
            const deleteTeacherBtn = currentUserRole === 'admin' 
                ? `<button onclick="deleteTeacher('${teacher.id}')" class="text-red-600 hover:text-red-800 text-xs font-medium px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 transition flex items-center gap-1">
                     <i class="fas fa-trash"></i> Delete Teacher
                   </button>` 
                : '';

            let html = `
                <div class="p-4 bg-gray-50 flex flex-wrap gap-4 justify-between items-center border-b border-gray-100">
                    <div>
                        <div class="flex items-center gap-2">
                            <h3 class="font-bold text-lg text-gray-900">${teacher.name}</h3>
                            <a href="mailto:${teacher.email}" class="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full hover:bg-blue-100 transition">
                                ${teacher.email}
                            </a>
                        </div>
                        <p class="text-xs text-gray-500 mt-1">ID: <span class="font-mono">${teacher.id}</span> • Active Since: ${teacherCreationDate}</p>
                    </div>
                    ${deleteTeacherBtn}
                </div>
                <div class="p-4">
                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <i class="fas fa-list-alt"></i> Interviews (${teacher.interviews.length})
                    </h4>
                    <div class="space-y-2">
            `;

            teacher.interviews.forEach(interview => {
                const interviewDate = interview.timestamp ? new Date(interview.timestamp.toDate()).toLocaleString() : 'N/A';
                
                // NEW: Time Limit Badge logic (Consistent with Teacher Dashboard)
                const timeBadge = (interview.timeLimit && interview.timeLimit > 0)
                    ? `<span class="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded ml-2 border border-blue-200"><i class="far fa-clock"></i> ${interview.timeLimit}m</span>`
                    : `<span class="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded ml-2 border border-gray-200"><i class="fas fa-infinity"></i> No Limit</span>`;

                html += `
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between bg-white border border-gray-100 p-3 rounded-lg hover:border-indigo-200 transition group">
                        <div class="flex-1 mb-2 sm:mb-0">
                            <div class="flex items-center gap-2">
                                <span class="inline-block bg-indigo-50 text-indigo-700 text-xs font-mono font-bold px-2 py-0.5 rounded border border-indigo-100">${interview.code || interview.id}</span>
                                <span class="text-gray-800 font-medium text-sm group-hover:text-indigo-700 transition">${interview.title}</span>
                                ${timeBadge}
                            </div>
                            <span class="text-gray-400 text-xs block mt-1 ml-1"><i class="far fa-clock mr-1"></i>${interviewDate}</span>
                        </div>
                        
                        <div class="flex items-center gap-2 flex-wrap">
                            <button onclick="downloadPDF('${interview.id}')" class="text-gray-500 hover:text-blue-600 text-xs bg-gray-50 hover:bg-blue-50 px-3 py-1.5 rounded border border-gray-200 transition flex items-center gap-1" title="Download Source PDF">
                                <i class="fas fa-file-pdf"></i> PDF
                            </button>
                            <button onclick="viewTranscripts('${interview.id}')" class="text-indigo-600 hover:text-white hover:bg-indigo-600 text-xs font-medium px-3 py-1.5 rounded border border-indigo-200 transition">
                                View Students
                            </button>
                            <button onclick="deleteInterview('${interview.id}', '${teacher.id}')" class="text-gray-400 hover:text-red-600 hover:bg-red-50 text-xs px-2 py-1.5 rounded transition"><i class="fas fa-trash-alt"></i></button>
                        </div>
                    </div>
                    <div id="students-${interview.id}" class="hidden pl-4 pr-4 py-3 bg-gray-50 text-sm space-y-2 border-l-2 border-indigo-100 ml-2 mb-2 mt-2 rounded-r-lg">
                        Loading students...
                    </div>
                `;
            });

            html += `</div></div>`;
            card.innerHTML = html;
            container.appendChild(card);
        });
    });
}

// --- ACTIONS (Unchanged) ---
// 1. View List of Students (Now with "Read Chat" button)
window.viewTranscripts = async (interviewId) => {
    const container = document.getElementById(`students-${interviewId}`);
    
    // Toggle visibility
    if (!container.classList.contains('hidden')) { 
        container.classList.add('hidden'); 
        return; 
    }
    
    container.classList.remove('hidden');
    container.innerHTML = '<div class="flex items-center gap-2 text-gray-400 text-xs"><i class="fas fa-spinner fa-spin"></i> Loading transcripts...</div>';

    try {
        const q = query(
            collection(db, `artifacts/${appId}/public/data/interview_transcripts`), 
            where("interviewCode", "==", interviewId)
        );
        
        const snapshot = await getDocs(q);

        if (snapshot.empty) { 
            container.innerHTML = '<span class="text-gray-400 italic text-xs pl-2">No student submissions yet.</span>'; 
            return; 
        }
        
        let html = '';
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const date = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleDateString() : 'N/A';
            const studentEmail = data.studentEmail ? `<span class="text-xs text-gray-400 ml-1">(${data.studentEmail})</span>` : '';
            
            // Calculate length
            const turnCount = data.fullTranscript ? Math.floor(data.fullTranscript.length / 2) : 0;

            html += `
                <div class="flex justify-between items-center p-3 hover:bg-indigo-50/50 rounded-lg border-b border-gray-100 last:border-0 transition group">
                    <div>
                        <div class="font-bold text-gray-700 text-sm flex items-center">
                            <i class="fas fa-user-graduate mr-2 text-indigo-300"></i>
                            ${data.studentName || 'Anonymous'}
                            ${studentEmail}
                        </div>
                        <div class="text-xs text-gray-400 ml-6 mt-0.5">
                            ${date} • ${turnCount} Turns
                        </div>
                    </div>
                    
                    <button onclick="openTranscriptModal('${docSnap.id}')" 
                        class="text-xs bg-white text-indigo-600 px-3 py-1.5 rounded-md border border-indigo-200 hover:bg-indigo-600 hover:text-white transition shadow-sm font-medium">
                        <i class="far fa-comments mr-1"></i> Read Chat
                    </button>
                </div>
            `;
        });
        container.innerHTML = html;

    } catch (e) { 
        console.error(e);
        container.innerHTML = '<span class="text-red-500 text-xs">Error loading list.</span>'; 
    }
};

// 2. Open the Chat Window
window.openTranscriptModal = async (transcriptId) => {
    const modal = document.getElementById('transcript-modal');
    const content = document.getElementById('modal-content');
    const nameLabel = document.getElementById('modal-student-name');
    const topicLabel = document.getElementById('modal-topic');

    // Show Modal immediately with loading state
    modal.classList.remove('hidden');
    content.innerHTML = '<div class="flex h-full items-center justify-center text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mr-3"></i> Loading conversation...</div>';

    try {
        const docRef = doc(db, `artifacts/${appId}/public/data/interview_transcripts`, transcriptId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            content.innerHTML = '<div class="text-center text-red-400 py-10">Transcript not found.</div>';
            return;
        }

        const data = docSnap.data();
        nameLabel.textContent = data.studentName || 'Anonymous Student';
        topicLabel.textContent = data.topic || 'Untitled Interview';

        // Render the Chat
        let chatHtml = '';
        
        if (data.fullTranscript && Array.isArray(data.fullTranscript)) {
            data.fullTranscript.forEach(msg => {
                const isAi = msg.role === 'model' || msg.role === 'ai';
                
                // Style bubbles based on who is speaking
                const align = isAi ? 'justify-start' : 'justify-end';
                const bgColor = isAi ? 'bg-white border border-gray-200 text-gray-800' : 'bg-indigo-600 text-white';
                const radius = isAi ? 'rounded-tl-none' : 'rounded-tr-none';
                const avatar = isAi 
                    ? `<div class="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs shrink-0 mr-2"><i class="fas fa-robot"></i></div>`
                    : `<div class="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs shrink-0 ml-2"><i class="fas fa-user"></i></div>`;

                // Add to HTML
                chatHtml += `
                    <div class="flex w-full ${align} mb-4">
                        ${isAi ? avatar : ''}
                        <div class="max-w-[80%] ${bgColor} p-4 rounded-2xl ${radius} shadow-sm text-sm leading-relaxed">
                            <div class="text-[10px] font-bold opacity-50 uppercase tracking-wider mb-1">
                                ${isAi ? 'Prompta' : 'Student'}
                            </div>
                            ${msg.text.replace(/\n/g, '<br>')}
                        </div>
                        ${!isAi ? avatar : ''}
                    </div>
                `;
            });
            content.innerHTML = chatHtml;
        } else {
            content.innerHTML = '<div class="text-center text-gray-400 py-10">Transcript data is empty or invalid.</div>';
        }

    } catch (e) {
        console.error("Error fetching transcript details:", e);
        content.innerHTML = '<div class="text-center text-red-500 py-10">Error loading transcript details.</div>';
    }
};

window.downloadPDF = async (interviewId) => {
    const btn = event.currentTarget; const originalText = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; 
    try {
        const docRef = doc(db, `artifacts/${appId}/public/data/interviews`, interviewId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) { alert("Record not found."); return; }
        const data = docSnap.data();
        const fileUrl = data.pdfUrl || data.downloadURL || data.curriculumUrl;
        if (fileUrl) { window.open(fileUrl, '_blank'); } else { alert("No PDF file attached."); }
    } catch (e) { alert("Error: " + e.message); } finally { btn.innerHTML = originalText; }
};

window.deleteInterview = async (interviewId, teacherId) => {
    if (!confirm("Are you sure? This deletes all student transcripts too.")) return;
    try {
        const projectId = "tutorbot-184ec"; 
        const functionBaseUrl = isLocalHost ? `http://localhost:5001/${projectId}/us-central1` : `https://us-central1-${projectId}.cloudfunctions.net`;
        const response = await fetch(`${functionBaseUrl}/deleteInterviewAndTranscripts`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId, interviewId, teacherId })
        });
        if (response.ok) { alert("Deleted."); loadData(); } else { alert("Failed."); }
    } catch (e) { alert("Error: " + e.message); }
};

window.deleteTeacher = async (teacherId) => {
    if (currentUserRole !== 'admin') { alert("Only Super Admins can delete teachers."); return; }
    if (!confirm("Delete ALL data for this teacher?")) return;
    try {
        const projectId = "tutorbot-184ec";
        const functionBaseUrl = isLocalHost ? `http://localhost:5001/${projectId}/us-central1` : `https://us-central1-${projectId}.cloudfunctions.net`;
        const q = query(collection(db, `artifacts/${appId}/public/data/interviews`), where("teacherId", "==", teacherId));
        const snapshot = await getDocs(q);
        const promises = snapshot.docs.map(docSnap => fetch(`${functionBaseUrl}/deleteInterviewAndTranscripts`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId, interviewId: docSnap.id, teacherId })
        }));
        await Promise.all(promises);
        alert(`Deleted teacher data.`); loadData();
    } catch (e) { alert("Error deleting teacher."); }
};