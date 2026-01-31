const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const textToSpeech = require("@google-cloud/text-to-speech");
const {GoogleGenerativeAI} = require("@google/generative-ai");
const path = require("path");

// --- FIX 1: Explicitly define the bucket here ---
admin.initializeApp({
  storageBucket: "tutorbot-184ec.firebasestorage.app",
});

const db = admin.firestore();
const storage = admin.storage();

// --- PREMIUM VOICE CONFIGURATION ---
const ttsOptions = {};
if (process.env.FUNCTIONS_EMULATOR === "true") {
  ttsOptions.keyFilename = path.join(__dirname, "service-account.json");
}

const ttsClient = new textToSpeech.TextToSpeechClient(ttsOptions);

// --- NEW SECURE AI FUNCTION (Replaces getGeminiToken) ---
exports.getGeminiResponse = onRequest(
    {
      cors: [
        "http://localhost:5000",
        "http://127.0.0.1:5000",
        "https://tutorbot-184ec.web.app",
        "https://ainterview.curiousit.ca",
      ],
      region: "us-central1",
      secrets: ["GEMINI_API_KEY"],
    },
    async (req, res) => {
      try {
        if (req.method !== "POST") {
          res.status(405).send("Method Not Allowed");
          return;
        }

        const {history, message, systemPrompt} = req.body;
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
          throw new Error("Server is missing Gemini API Key");
        }

        // Initialize Gemini on the server side
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: "gemini-2.0-flash",
          systemInstruction: systemPrompt,
        });

        // Convert the history format if needed, or pass directly
        const chat = model.startChat({history: history || []});
        const result = await chat.sendMessage(message);
        const responseText = result.response.text();

        res.status(200).json({response: responseText});
      } catch (error) {
        console.error("Gemini Error:", error);
        res.status(500).json({error: error.message});
      }
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

        // --- ORPHAN CLEANUP LOGIC ---
        if (interviewDoc.exists) {
          if (interviewDoc.data().teacherId !== teacherId) {
            res.status(403).json({
              error: "Permission denied. You do not own this interview.",
            });
            return;
          }

          // 1. DELETE TRANSCRIPTS
          const transcriptsQuery = db.collection(transcriptPublicCollectionPath)
              .where("interviewCode", "==", interviewId);
          const transcriptSnapshot = await transcriptsQuery.get();

          const batch = db.batch();
          transcriptSnapshot.forEach((doc) => {
            batch.delete(doc.ref);
          });

          // 2. DELETE INTERVIEW DOC
          batch.delete(interviewDocRef);
          await batch.commit();
          console.log(`[Database] Deleted records for ${interviewId}`);
        } else {
          console.log(
              `[Database] Doc ${interviewId} not found. ` +
            `Proceeding to clean orphans.`,
          );
        }

        // 3. DELETE CLOUD STORAGE FILES (PDF)
        const bucket = storage.bucket();
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
          message: `Cleanup complete for ${interviewId}.`,
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
