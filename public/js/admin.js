// Import tools from our shared config
import { 
    db, auth, collection, query, getDocs, getDoc, doc, deleteDoc, where, 
    signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, 
    isLocalHost 
} from './config.js';

const ADMIN_EMAILS = ["jontepper@gmail.com"]; 
const appId = 'default-app-id';

// --- INITIALIZATION ---
window.onload = initApp;

function initApp() {
    // Listen for Auth Changes
    onAuthStateChanged(auth, (user) => {
        updateUIForAuthState(user);
    });

    // Attach Event Listeners
    const authBtn = document.getElementById('auth-btn');
    if(authBtn) authBtn.addEventListener('click', handleAuthButton);
    
    const refreshBtn = document.getElementById('refresh-btn');
    if(refreshBtn) refreshBtn.addEventListener('click', loadData);
}

// --- AUTHENTICATION ---
function updateUIForAuthState(user) {
    const authBtn = document.getElementById('auth-btn');
    const accessDeniedEl = document.getElementById('access-denied');
    const dashboardEl = document.getElementById('dashboard');

    if (user) {
        authBtn.textContent = 'Sign Out';
        
        if (ADMIN_EMAILS.includes(user.email)) {
            accessDeniedEl.classList.add('hidden');
            dashboardEl.classList.remove('hidden');
            loadData();
        } else {
            alert("Access Denied: You are not an authorized administrator.");
            signOut(auth);
        }
    } else {
        accessDeniedEl.classList.remove('hidden');
        dashboardEl.classList.add('hidden');
        authBtn.textContent = 'Sign In';
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

// --- DATA LOADING ---
async function loadData() {
    const container = document.getElementById('teacher-list');
    container.innerHTML = '<p class="text-center text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i>Loading and organizing data...</p>';

    try {
        const q = query(collection(db, `artifacts/${appId}/public/data/interviews`));
        const snapshot = await getDocs(q);
        const teachers = {}; 

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const tid = data.teacherId;
            if (!tid) return; 
            
            const interviewTimestamp = data.timestamp ? data.timestamp.toDate() : null;
            const email = data.teacherEmail || "no-email-recorded";
 
            if (!teachers[tid]) {
                teachers[tid] = { 
                    id: tid, 
                    name: data.teacherName || "Unknown Teacher", 
                    email: email,
                    domain: email.includes('@') ? email.split('@')[1] : 'Unknown Domain',
                    interviews: [],
                    firstActivity: interviewTimestamp
                };
            } else {
                // Smart Email Update
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
        container.innerHTML = '<p class="text-center text-gray-500">No active teachers found.</p>';
        return;
    }

    // Group by Domain
    const domains = {};
    teachers.forEach(t => {
        if (!domains[t.domain]) domains[t.domain] = [];
        domains[t.domain].push(t);
    });

    // Render each Domain Group
    Object.keys(domains).sort().forEach(domainName => {
        
        // Create Domain Header
        const domainHeader = document.createElement('div');
        domainHeader.className = "mt-8 mb-4 flex items-center gap-2 border-b-2 border-gray-300 pb-2";
        domainHeader.innerHTML = `
            <i class="fas fa-building text-gray-500"></i>
            <h3 class="text-xl font-bold text-gray-800">${domainName}</h3>
            <span class="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded-full">${domains[domainName].length} Teacher(s)</span>
        `;
        container.appendChild(domainHeader);

        // Render Teachers in this Domain
        domains[domainName].forEach(teacher => {
            const card = document.createElement('div');
            card.className = "bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-4";

            const teacherCreationDate = teacher.firstActivity ? teacher.firstActivity.toLocaleDateString() : 'N/A';
            
            // Generate Teacher Card HTML
            let html = `
                <div class="p-4 bg-gray-50 flex justify-between items-center border-b border-gray-200">
                    <div>
                        <div class="flex items-center gap-2">
                            <h3 class="font-bold text-lg text-gray-900">${teacher.name}</h3>
                            <a href="mailto:${teacher.email}" title="Send Email" class="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded hover:bg-blue-100 hover:text-blue-800 transition cursor-pointer">
                                <i class="fas fa-envelope mr-1"></i>${teacher.email}
                            </a>
                        </div>
                        <p class="text-xs text-gray-500 mt-1">ID: ${teacher.id} | First Activity: <span class="font-medium">${teacherCreationDate}</span></p>
                    </div>
                    <button onclick="deleteTeacher('${teacher.id}')" class="text-red-600 hover:text-red-800 text-sm font-medium px-3 py-1 border border-red-200 rounded hover:bg-red-50 transition">
                        <i class="fas fa-trash"></i> Delete Teacher
                    </button>
                </div>
                <div class="p-4">
                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Interviews Created (${teacher.interviews.length})</h4>
                    <div class="space-y-2">
            `;

            // Generate Interview Rows
            teacher.interviews.forEach(interview => {
                const interviewDate = interview.timestamp ? new Date(interview.timestamp.toDate()).toLocaleString() : 'N/A';
                html += `
                    <div class="flex items-center justify-between bg-white border border-gray-100 p-3 rounded hover:border-indigo-200 transition">
                        <div class="flex-1">
                            <div class="flex items-center gap-2">
                                <span class="inline-block bg-indigo-100 text-indigo-700 text-xs font-mono font-bold px-2 py-0.5 rounded">${interview.code || interview.id}</span>
                                <span class="text-gray-800 font-medium text-sm">${interview.title}</span>
                            </div>
                            <span class="text-gray-400 text-xs block mt-1">${interviewDate}</span>
                        </div>
                        
                        <div class="flex items-center gap-3">
                            <button onclick="downloadPDF('${interview.id}')" class="text-gray-400 hover:text-blue-600 text-xs flex items-center gap-1" title="Download Source PDF">
                                <i class="fas fa-file-pdf"></i> PDF
                            </button>
                            <div class="h-4 w-px bg-gray-300"></div>
                            <button onclick="viewTranscripts('${interview.id}')" class="text-indigo-600 hover:text-indigo-800 text-xs font-semibold">View Students</button>
                            <button onclick="deleteInterview('${interview.id}', '${teacher.id}')" class="text-gray-400 hover:text-red-500 text-xs ml-2"><i class="fas fa-times"></i></button>
                        </div>
                    </div>
                    <div id="students-${interview.id}" class="hidden pl-10 pr-4 py-2 bg-gray-50 text-sm space-y-2 border-l-2 border-indigo-100 ml-4 mb-2">
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

// --- ACTIONS ---

// 1. View Transcripts
window.viewTranscripts = async (interviewId) => {
    const container = document.getElementById(`students-${interviewId}`);
    if (!container.classList.contains('hidden')) {
        container.classList.add('hidden'); 
        return;
    }
    container.classList.remove('hidden');
    container.innerHTML = '<i class="fas fa-spinner fa-spin text-gray-400"></i> Loading...';

    try {
        const q = query(
            collection(db, `artifacts/${appId}/public/data/interview_transcripts`),
            where("interviewCode", "==", interviewId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            container.innerHTML = '<span class="text-gray-400 italic">No student submissions yet.</span>';
            return;
        }

        let html = '';
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const date = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleDateString() : 'N/A';
            html += `
                <div class="flex justify-between items-center">
                    <span class="font-medium text-gray-700">${data.studentName || 'Anonymous'}</span>
                    <span class="text-xs text-gray-400">${date}</span>
                </div>
            `;
        });
        container.innerHTML = html;

    } catch (e) {
        console.error(`Error loading transcripts for ${interviewId}:`, e);
        container.innerHTML = '<span class="text-red-500">Error loading students.</span>';
    }
};

// 2. Download PDF
window.downloadPDF = async (interviewId) => {
    const btn = event.currentTarget;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; 

    try {
        const docRef = doc(db, `artifacts/${appId}/public/data/interviews`, interviewId);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
            alert("Record not found.");
            return;
        }

        const data = docSnap.data();
        const fileUrl = data.pdfUrl || data.downloadURL || data.curriculumUrl;

        if (fileUrl) {
            window.open(fileUrl, '_blank');
        } else {
            alert("No PDF file attached to this record.");
        }
    } catch (e) {
        console.error("Error:", e);
        alert("Error retrieving PDF: " + e.message);
    } finally {
        btn.innerHTML = originalText;
    }
};

// 3. Delete Interview
window.deleteInterview = async (interviewId, teacherId) => {
    if (!confirm("ADMIN ACTION: Are you sure you want to delete this interview and all its student transcripts?")) return;
    
    try {
        // Dynamic Cloud Function URL
        const projectId = "tutorbot-184ec"; 
        const functionBaseUrl = isLocalHost 
            ? `http://localhost:5001/${projectId}/us-central1`
            : `https://us-central1-${projectId}.cloudfunctions.net`;
        
        const response = await fetch(`${functionBaseUrl}/deleteInterviewAndTranscripts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId, interviewId, teacherId })
        });
        
        if (response.ok) {
            alert("Interview deleted successfully.");
            loadData(); 
        } else {
            const errorText = await response.text();
            alert(`Failed to delete interview: ${errorText}`);
        }
    } catch (e) {
        console.error("Error calling delete function:", e);
        alert("Error: " + e.message);
    }
};

// 4. Delete Teacher
window.deleteTeacher = async (teacherId) => {
    if (!confirm("WARNING: This will delete ALL interviews and transcripts for this teacher. This action cannot be undone. Continue?")) return;
    
    try {
        const projectId = "tutorbot-184ec";
        const functionBaseUrl = isLocalHost 
            ? `http://localhost:5001/${projectId}/us-central1`
            : `https://us-central1-${projectId}.cloudfunctions.net`;

        const q = query(
            collection(db, `artifacts/${appId}/public/data/interviews`),
            where("teacherId", "==", teacherId)
        );
        const snapshot = await getDocs(q);

        let successCount = 0;
        const promises = snapshot.docs.map(docSnap => {
            return fetch(`${functionBaseUrl}/deleteInterviewAndTranscripts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ appId, interviewId: docSnap.id, teacherId })
            }).then(response => {
                if (response.ok) successCount++;
            }).catch(e => console.error(`Failed to delete interview ${docSnap.id}:`, e));
        });

        await Promise.all(promises);
        
        alert(`Process complete. Deleted ${successCount} of ${snapshot.docs.length} interviews for this teacher.`);
        loadData();
    } catch (e) {
        console.error("Error deleting teacher data:", e);
        alert("An error occurred while trying to delete the teacher's data. Check the console for details.");
    }
};