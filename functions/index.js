const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const textToSpeech = require("@google-cloud/text-to-speech");
const path = require("path");

// --- FIX 1: Explicitly define the bucket here ---
admin.initializeApp({
  storageBucket: "tutorbot-184ec.firebasestorage.app" 
});

const db = admin.firestore();
const storage = admin.storage();

// --- PREMIUM VOICE CONFIGURATION ---
const ttsOptions = {};
if (process.env.FUNCTIONS_EMULATOR === "true") {
  ttsOptions.keyFilename = path.join(__dirname, "service-account.json");
}

const ttsClient = new textToSpeech.TextToSpeechClient(ttsOptions);

exports.getGeminiToken = onRequest(
    {
      cors: [
        "http://localhost:5000", 
        "http://127.0.0.1:5000", 
        "https://tutorbot-184ec.web.app", 
        "https://ainterview.curiousit.ca", 
      ],
      secrets: ["GEMINI_API_KEY"],
      region: "us-central1",
    },
    (req, res) => {
      res.status(200).json({token: process.env.GEMINI_API_KEY});
    },
);

exports.deleteInterviewAndTranscripts = onRequest(
    {
      cors: [
        "http://localhost:5000",
        "http://127.0.0.1:5000",
        "https://tutorbot-184ec.web.app",
        "https://ainterview.curiousit.ca",
      ],
      region: "us-central1",
    },
    async (req, res) => {
      if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
      }

      try {
        const {appId, interviewId, teacherId} = req.body;

        if (!appId || !interviewId || !teacherId) {
          res.status(400).json({
            error: "Missing fields: appId, interviewId or teacherId.",
          });
          return;
        }

        const interviewPublicCollectionPath =
          `artifacts/${appId}/public/data/interviews`;
        const transcriptPublicCollectionPath =
          `artifacts/${appId}/public/data/interview_transcripts`;

        const interviewDocRef = db.collection(interviewPublicCollectionPath)
            .doc(interviewId);
        const interviewDoc = await interviewDocRef.get();

        if (!interviewDoc.exists) {
          // It might have already been deleted from DB, but check storage anyway? 
          // For now, let's fail if record is gone to match UI logic.
          res.status(404).json({error: "Interview not found."});
          return;
        }

        if (interviewDoc.data().teacherId !== teacherId) {
          res.status(403).json({
            error: "Permission denied. You do not own this interview.",
          });
          return;
        }

        // 1. DELETE FIRESTORE RECORDS
        const transcriptsQuery = db.collection(transcriptPublicCollectionPath)
            .where("interviewCode", "==", interviewId);
        const transcriptSnapshot = await transcriptsQuery.get();

        const batch = db.batch();
        transcriptSnapshot.forEach((doc) => {
          batch.delete(doc.ref);
        });

        batch.delete(interviewDocRef);
        await batch.commit();

        // 2. DELETE CLOUD STORAGE FILES (PDF)
        // Use the default bucket configured in initializeApp
        const bucket = storage.bucket(); 
        
        // --- FIX 2: Debugging Log ---
        // Path structure: interviews/{teacherId}/{interviewId}/
        const folderPath = `interviews/${teacherId}/${interviewId}/`;
        
        console.log(`[Cleaner] Checking bucket: ${bucket.name}`);
        console.log(`[Cleaner] Deleting prefix: ${folderPath}`);

        await bucket.deleteFiles({
          prefix: folderPath,
        });

        console.log(
            `Deleted interview ${interviewId}, transcripts, and ` +
            `files for teacher ${teacherId}.`,
        );

        res.status(200).json({
          success: true,
          message: `Interview ${interviewId} completely deleted.`,
        });
      } catch (error) {
        console.error("Error in deleteInterviewAndTranscripts:", error);
        res.status(500).json({
          error: "An internal server error occurred.",
        });
      }
    },
);

exports.generateSpeech = onRequest(
    {
      region: "us-central1",
      cors: [
        "https://ainterview.curiousit.ca",
        "http://localhost:5000",
        "http://127.0.0.1:5000",
      ],
      secrets: ["GEMINI_API_KEY"],
    },
    async (req, res) => {
      try {
        if (req.method !== "POST") {
          return res.status(405).send("Method Not Allowed");
        }

        const {text} = req.body;

        if (!text) {
          return res.status(400).send("Missing 'text' field.");
        }

        const request = {
          input: {text: text},
          voice: {
            languageCode: "en-US",
            name: "en-US-Chirp3-HD-Fenrir",
          },
          audioConfig: {audioEncoding: "MP3"},
        };

        const [response] = await ttsClient.synthesizeSpeech(request);
        res.json({audioContent: response.audioContent.toString("base64")});
      } catch (error) {
        console.error("TTS Error:", error);
        res.status(500).send(error.message);
      }
    },
);
