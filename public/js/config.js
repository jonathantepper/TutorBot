import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, getDoc, doc, deleteDoc, orderBy, serverTimestamp, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app-check.js";

// --- SMART KEY SWITCHER ---
const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

// Keys
const DEV_KEY = "AIzaSyAy2-MY2Mjidp2O2xxJcZef2gwdQQv6y3c"; 
const PROD_KEY = "AIzaSyDdBR4c_boRaXpMT8ByYkbhVgXvQ1dNi7Q";

// Select Config
const firebaseConfig = {
    apiKey: isLocalHost ? DEV_KEY : PROD_KEY,
    authDomain: "tutorbot-184ec.firebaseapp.com",
    projectId: "tutorbot-184ec",
    storageBucket: "tutorbot-184ec.firebasestorage.app",
    messagingSenderId: "666724888666",
    appId: "1:666724888666:web:003a280426ad97d013e863"
};

console.log(isLocalHost ? "🔧 System: Dev Mode" : "🚀 System: Live Mode");

// --- INITIALIZE SERVICES ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Initialize App Check (The "Vault Door")
// We wrap this in a try-catch so it doesn't crash local dev if captcha fails
try {
    const appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider('6LfuQUgsAAAAAA7yi-9EYCWV8lp_VC10G0dzJ1LO'),
        isTokenAutoRefreshEnabled: true
    });
} catch (e) {
    console.warn("App Check failed to load (Expected in some dev environments):", e);
}

// Export services for other files to use
export { 
    app, db, auth, storage, 
    collection, query, where, getDocs, getDoc, doc, deleteDoc, orderBy, serverTimestamp, setDoc, writeBatch,
    signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, signInAnonymously, signInWithCustomToken,
    ref, uploadBytes, getDownloadURL,
    isLocalHost
};