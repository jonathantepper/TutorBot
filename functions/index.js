const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const textToSpeech = require("@google-cloud/text-to-speech");
const {GoogleGenerativeAI} = require("@google/generative-ai");
const path = require("path");
const {
  RecaptchaEnterpriseServiceClient,
} = require("@google-cloud/recaptcha-enterprise");
const nodemailer = require("nodemailer");

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

// --- NEW SECURE AI FUNCTION ---
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

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: "gemini-2.0-flash",
          systemInstruction: systemPrompt,
        });

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

// --- DELETE INTERVIEW FUNCTION ---
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

        if (interviewDoc.exists) {
          if (interviewDoc.data().teacherId !== teacherId) {
            res.status(403).json({
              error: "Permission denied. You do not own this interview.",
            });
            return;
          }

          const transcriptsQuery = db.collection(transcriptPublicCollectionPath)
              .where("interviewCode", "==", interviewId);
          const transcriptSnapshot = await transcriptsQuery.get();

          const batch = db.batch();
          transcriptSnapshot.forEach((doc) => {
            batch.delete(doc.ref);
          });

          batch.delete(interviewDocRef);
          await batch.commit();
        }

        const bucket = storage.bucket();
        const folderPath = `interviews/${teacherId}/${interviewId}/`;

        await bucket.deleteFiles({
          prefix: folderPath,
        });

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

// --- GENERATE SPEECH FUNCTION ---
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

// --- NEW ACCESS REQUEST FUNCTION (WITH RECAPTCHA) ---
exports.sendAccessRequest = onRequest(
    {
      region: "us-central1",
      cors: [
        "https://ainterview.curiousit.ca",
        "http://localhost:5000",
        "http://127.0.0.1:5000",
      ],
      secrets: ["GMAIL_APP_PASSWORD"],
    },
    async (req, res) => {
      if (req.method !== "POST") {
        return res.status(405).send("Method Not Allowed");
      }

      try {
        const {name, school, email, students, note, recaptchaToken} = req.body;

        // 1. Verify reCAPTCHA Token
        const client = new RecaptchaEnterpriseServiceClient();
        const projectPath = client.projectPath("tutorbot-184ec");
        const [assessment] = await client.createAssessment({
          assessment: {
            event: {
              token: recaptchaToken,
              siteKey: "6LfuQUgsAAAAAA7yi-9EYCWV8lp_VC10G0dzJ1LO",
            },
          },
          parent: projectPath,
        });

        // 0.5 is the standard threshold. Lower is more bot-like.
        if (assessment.riskAnalysis.score < 0.5) {
          console.warn("Spam prevented. Score:", assessment.riskAnalysis.score);
          return res.status(403).json({error: "Bot activity detected."});
        }

        // 2. Setup Nodemailer
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: "jontepper+ainterview@gmail.com",
            pass: process.env.GMAIL_APP_PASSWORD,
          },
        });

        // 3. Send Email
        await transporter.sendMail({
          from: "AInterview Form <jontepper+ainterview@gmail.com>",
          to: "jontepper+ainterview@gmail.com",
          subject: `Access Request: ${school}`,
          text: `Name: ${name}\n` +
                `School: ${school}\n` +
                `Email: ${email}\n` +
                `Students: ${students}\n\n` +
                `Note:\n${note}\n\n` +
                `(Human Score: ${assessment.riskAnalysis.score})`,
        });

        res.status(200).json({success: true});
      } catch (error) {
        console.error("Access Request Error:", error);
        res.status(500).send("An internal error occurred.");
      }
    },
);
