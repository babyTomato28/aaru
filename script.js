require('dotenv').config();

const express = require('express');
const multer = require('multer');
const os = require('os');
const path = require('path');
const fs = require('fs').promises; // For deleting temp files
const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");

const app = express();

// 1. Configure Multer to use the system's temporary directory with file validation
const upload = multer({ 
  dest: os.tmpdir(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB limit
});

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

/**
 * Uploads the given file to Gemini.
 *
 * @param {string} filePath - The path to the file.
 * @param {string} mimeType - The MIME type of the file.
 * @returns {Object} - The uploaded file information.
 */
async function uploadToGemini(filePath, mimeType) {
  try {
    const uploadResult = await fileManager.uploadFile(filePath, {
      mimeType,
      displayName: path.basename(filePath),
    });
    const file = uploadResult.file;
    console.log(`Uploaded file ${file.displayName} as: ${file.name}`);
    return file;
  } catch (error) {
    console.error('Error uploading to Gemini:', error);
    throw error;
  }
}

const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
});

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

// 2. Logging Middleware: Logs all incoming requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// 3. Serve static files from the root directory
app.use(express.static(__dirname));

// 4. Handle GET request for the root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 5. Handle POST request for image upload
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const filePath = req.file.path; // Temp file path
    const mimeType = req.file.mimetype;

    console.log(`Received file: ${req.file.originalname} with MIME type: ${mimeType}`);

    // Upload to Gemini
    const uploadedFile = await uploadToGemini(filePath, mimeType);

    // Delete the temporary file after upload
    await fs.unlink(filePath);
    console.log(`Deleted temp file: ${filePath}`);

    // Start a chat session with Gemini to verify if the image is of the moon
    const chatSession = model.startChat({
      generationConfig,
      history: [
        {
          role: "user",
          parts: [
            {
              fileData: {
                mimeType: uploadedFile.mimeType,
                fileUri: uploadedFile.uri,
              },
            },
          ],
        },
      ],
    });

    // Send a specific prompt to Gemini
    const result = await chatSession.sendMessage("Is this image of the moon? Give answer in yes or no only");

    const responseText = result.response.text().toLowerCase();
    console.log(`Gemini Response: ${responseText}`);

    // Respond based on Gemini's answer
    if (responseText.includes('yes')) {
      res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Surprise!!!</title>
          <link rel="stylesheet" href="style.css">
        </head>
        <body>
          <div class="container">
            <h1>Dingdingdingding</h1>
            <p>HAPPY BIRTHDAYYYY MOONPIE!!!! I LOVE YOUUU SO MUCH YOU LITTLE DINGUS 🎀</p>
          </div>
        </body>
        </html>
      `);
    } else {
      res.redirect('/'); // Redirect back without any message
    }
  } catch (error) {
    console.error('Error processing upload:', error);
    
    if (error.message.includes('Only image files are allowed')) {
      res.status(400).send('Invalid file type. Please upload an image.');
    } else {
      res.status(500).send('An error occurred while processing your image.');
    }
  }
});

// 6. Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 