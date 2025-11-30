const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
// For premium voices
const textToSpeech = require("@google-cloud/text-to-speech");
// 1. Initialize the CORS library to allow requests from your specific origins
// We use {origin: true} to dynamically allow the incoming origin
// (for example, your localhost or web app)
const cors = require("cors")({origin: true});

admin.initializeApp();

// LAZY INITIALIZATION: We will initialize the client inside the function
// to prevent cold start crashes from blocking CORS preflight requests.
let ttsClient;

const db = admin.firestore();

/**
 * Returns the Gemini API key to the authenticated client.
 * @param {object} req The request object.
 * @param {object} res The response object.
 * @return {void}
 */
exports.getGeminiToken = onRequest(
    {
      cors: [
        "https://tutorbot-184ec.web.app",
        "http://127.0.0.1:5500",
        "https://ainterview.curiousit.ca",
      ],
      secrets: ["GEMINI_API_KEY"],
      region: "us-central1",
    },
    (req, res) => {
      // We simply pass the key to the client.
      res.status(200).json({token: process.env.GEMINI_API_KEY});
    },
);

/**
 * Deletes an interview and all its associated student transcripts.
 * This is a secure, backend Cloud Function.
 * @param {object} req The request object.
 * @param {object} res The response object.
 * @return {void}
 */
exports.deleteInterviewAndTranscripts = onRequest(
    {
      // We keep this configuration for Cloud Run deployment settings
      cors: [
        "https://tutorbot-184ec.web.app",
        "http://127.0.0.1:5500",
        "https://ainterview.curiousit.ca",
      ],
      region: "us-central1",
    },
    async (req, res) => {
      // 2. WRAP the entire function logic inside the cors middleware.
      // Note: We removed 'async' from the top-level function and
      // moved it inside here.
      cors(req, res, async () => { // eslint-disable-line no-unused-vars
        // Ensure the request is a POST request.
        if (req.method !== "POST") {
          res.status(405).send("Method Not Allowed");
          return;
        }

        try {
          const {appId, interviewId, teacherId} = req.body;

          // Validate the incoming data.
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

          // Verify the teacher owns the interview being deleted.
          const interviewDocRef = db.collection(interviewPublicCollectionPath)
              .doc(interviewId);
          const interviewDoc = await interviewDocRef.get();

          if (!interviewDoc.exists) {
            res.status(404).json({error: "Interview not found."});
            return;
          }

          if (interviewDoc.data().teacherId !== teacherId) {
            res.status(403).json({
              error: "Permission denied. You do not own this interview.",
            });
            return;
          }

          // Find and delete all associated transcripts in a batch.
          const transcriptsQuery = db.collection(transcriptPublicCollectionPath)
              .where("interviewCode", "==", interviewId);
          const transcriptSnapshot = await transcriptsQuery.get();

          const batch = db.batch();
          transcriptSnapshot.forEach((doc) => {
            batch.delete(doc.ref);
          });

          // Delete the main interview document itself.
          batch.delete(interviewDocRef);

          // Commit the batch operation.
          await batch.commit();

          console.log(
              `Deleted interview ${interviewId} and ` +
              `${transcriptSnapshot.size} transcripts ` +
              `for teacher ${teacherId}.`,
          );

          // Send success response
          res.status(200).json({
            success: true,
            message: `Interview ${interviewId} and transcripts deleted.`,
          });
        } catch (error) {
          console.error("Error in deleteInterviewAndTranscripts:", error);
          res.status(500).json({
            error: "An internal server error occurred while trying to " +
              "delete the interview.",
          });
        }
      });
    },
);

/**
 * Generates speech from text using Google's Text-to-Speech API.
 * @param {object} req The request object, expecting `text` in the body.
 * @param {object} res The response object.
 * @return {void}
 */
exports.generateSpeech = onRequest(
    {region: "us-central1"},
    async (req, res) => {
      // Wrap the function logic in the CORS middleware
      cors(req, res, async () => { // eslint-disable-line no-unused-vars
        const {text} = req.body;

        // Lazily initialize the client on first execution.
        if (!ttsClient) {
          ttsClient = new textToSpeech.v1beta1.TextToSpeechClient();
        }

        if (!text) {
          const errorMsg = "Missing 'text' field in request body.";
          res.status(400).json({error: errorMsg});
          return;
        }

        const request = {
          input: {text: text},
          // Premium Voice Selection:
          // "en-US-Studio-O" (Professional, Male) or
          // "en-US-Journey-F" (Expressive, Female)
          voice: {languageCode: "en-US", name: "en-US-Studio-O"},
          audioConfig: {audioEncoding: "MP3"},
        };

        try {
          const [response] = await ttsClient.synthesizeSpeech(request);
          const audioContent = response.audioContent.toString("base64");
          res.status(200).json({audioContent: audioContent});
        } catch (error) {
          console.error("TTS Error:", error);
          res.status(500).json({error: "An internal server error occurred."});
        }
      });
    },
);
