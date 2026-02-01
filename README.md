# AInterview: AI-Driven Oral Assessments

A professional platform designed for educators to deliver asynchronous oral interviews and assessments using AI. Built with **Firebase v2**, **Google Gemini 2.0 Flash**, and **Vanilla JavaScript**.

## 🚀 Core Features
- **Prompta AI Interviewer**: Grounded exclusively in teacher-provided curriculum PDFs/text.
- **Greater Response Agency**: "Stop & Review" functionality allowing students to edit transcripts before submission.
- **Parallel Audio Capture**: High-quality `.webm` recordings saved to Firebase Storage alongside text transcripts.
- **Secure Admin Console**: Domain-based management with "Teacher Discovery" and granular premium feature toggling.
- **Secure Cloud Contact Form**: Automated access requests protected by reCAPTCHA Enterprise.

## 🛠 Technical Architecture

AInterview utilizes a decoupled architecture to ensure maximum security for student data and sensitive API credentials. By routing all traffic through a secure backend, we prevent the exposure of API keys and allow for rigorous server-side validation.

### System Components:

    1. **Frontend (Vanilla JavaScript & Tailwind CSS)**
    - Handles the Student and Teacher interfaces.
    - Manages client-side reCAPTCHA token generation for form security.
    - Implements the "Stop & Review" logic for student agency.

    2. **Cloud Functions (Node.js / Firebase v2)**
    - Acts as the secure "Middleman" between the browser and external services.
    - **Authentication Verification**: Ensures only authorized teachers access the Admin Console.
    - **Secret Handling**: Fetches API keys from Google Secret Manager on-the-fly.

    3. **Firestore Database**
    - **Interviews**: Stores interview templates, curriculum text, and teacher configurations.
    - **Transcripts**: Stores JSON conversation logs, student data, and pointers to audio files.
    - **Roles**: Manages the Discovered/Authorized teacher list.

    4. **Cloud Storage**
    - Securely hosts curriculum PDFs (Teacher side) and `.webm` response recordings (Student side).
    - Enforces 9-month auto-deletion policies via bucket lifecycle rules.

    5. **AI & Media Services**
    - **Google Gemini 2.0 Flash**: Powers the conversational "Prompta" interviewer.
    - **Google Cloud TTS**: Provides high-fidelity, premium voices for oral accessibility.
    - **reCAPTCHA Enterprise**: Analyzes interaction patterns to block automated spam.

### Backend (Firebase Cloud Functions v2)
- **`getGeminiResponse`**: Handles secure, server-side communication with the Gemini API.
- **`generateSpeech`**: Converts AI text to speech using Google Cloud TTS (Fenrir HD voices).
- **`sendAccessRequest`**: SMTP-based email handler with reCAPTCHA verification.
- **`deleteInterviewAndTranscripts`**: Automated cleanup of Firestore records and Cloud Storage files.

### Security & Privacy
- **Google Cloud Secret Manager**: Used for sensitive keys (`GEMINI_API_KEY`, `GMAIL_APP_PASSWORD`).
- **reCAPTCHA Enterprise**: Protects public forms with an invisible "risk score" barrier.
- **9-Month Retention**: Storage rules and cleanup logic ensure student data is automatically purged.

## 📋 Setup & Deployment Instructions

### 1. Environment Requirements
- **Node.js**: v18 or higher.
- **Firebase CLI**: `npm install -g firebase-tools`
- **Plan**: **Firebase Blaze (Pay-As-You-Go)** is required for outbound networking (Email/Gemini).

### 2. Secret Configuration
Before deploying, you must set the following secrets in the Firebase CLI:
```bash
firebase functions:secrets:set GEMINI_API_KEY # Your Google AI Studio Key
firebase functions:secrets:set GMAIL_APP_PASSWORD # 16-character Gmail App Password